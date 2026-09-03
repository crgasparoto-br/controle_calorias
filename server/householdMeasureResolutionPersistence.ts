import { createHash } from "node:crypto";
import { userPreferences } from "../drizzle/schema";
import { normalizeMeasurementUnit } from "../shared/measurementUnits";

export type PersistedHouseholdMeasureKind =
  | "researched_exact"
  | "usual_average"
  | "contextual_estimate"
  | "user_learned";

export type HouseholdMeasurePersistenceIdentity = {
  userId: number;
  foodName: string;
  brand?: string | null;
  quantity: number;
  unit: string;
};

export type UserLearnedHouseholdMeasureInput = {
  userId: number;
  foodName: string;
  brand?: string | null;
  originalQuantity: number;
  originalUnit: string;
  correctedQuantity: number;
  correctedUnit: string;
};

export type PersistedHouseholdMeasureResolution = {
  version: 1;
  kind: PersistedHouseholdMeasureKind;
  foodName: string;
  normalizedFoodName: string;
  brand: string | null;
  normalizedBrand: string;
  unit: string;
  measureQuantity: number;
  grams: number;
  evidence: string | null;
  sourceUrls: string[];
  referenceCount: number;
  verifiedAt: string;
  expiresAt: string | null;
};

export type BuiltHouseholdMeasurePreference = {
  preferenceKey: string;
  preferenceValue: string;
  record: PersistedHouseholdMeasureResolution;
};

const PREFERENCE_PREFIX = "household_measure_v1:";
const MASS_VOLUME_UNITS = new Set(["mg", "g", "kg", "ml", "l"]);

export function normalizeHouseholdMeasureIdentityText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:mucarela|mozarela|mussarela)\b/g, "mussarela")
    .replace(/\blaticinios?\b/g, "laticinio")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeHouseholdMeasureCountableUnit(value: string) {
  const unit = normalizeMeasurementUnit(value);
  return unit === "un" ? "unidade" : unit;
}

export function normalizedHouseholdMeasureIdentity(
  input: Pick<HouseholdMeasurePersistenceIdentity, "foodName" | "brand" | "unit">,
) {
  return {
    foodName: normalizeHouseholdMeasureIdentityText(input.foodName),
    brand: normalizeHouseholdMeasureIdentityText(input.brand ?? ""),
    unit: normalizeHouseholdMeasureCountableUnit(input.unit),
  };
}

export function householdMeasurePreferenceKey(
  input: Pick<HouseholdMeasurePersistenceIdentity, "foodName" | "brand" | "unit">,
  kind: PersistedHouseholdMeasureKind,
) {
  const identity = normalizedHouseholdMeasureIdentity(input);
  const digest = createHash("sha256")
    .update([identity.foodName, identity.brand, identity.unit, kind].join("|"))
    .digest("hex");
  return `${PREFERENCE_PREFIX}${digest}`;
}

export function correctedMassOrVolumeToGrams(quantity: number, unit: string) {
  const normalizedUnit = normalizeMeasurementUnit(unit);
  if (!MASS_VOLUME_UNITS.has(normalizedUnit)) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  switch (normalizedUnit) {
    case "kg": return quantity * 1000;
    case "mg": return quantity / 1000;
    case "l": return quantity * 1000;
    case "ml":
    case "g":
      return quantity;
    default:
      return null;
  }
}

export function buildUserLearnedHouseholdMeasurePreference(
  input: UserLearnedHouseholdMeasureInput,
  verifiedAt = new Date(),
): BuiltHouseholdMeasurePreference | null {
  const originalUnit = normalizeHouseholdMeasureCountableUnit(input.originalUnit);
  if (MASS_VOLUME_UNITS.has(originalUnit)) return null;
  if (!Number.isFinite(input.originalQuantity) || input.originalQuantity <= 0) return null;
  const correctedGrams = correctedMassOrVolumeToGrams(input.correctedQuantity, input.correctedUnit);
  if (!correctedGrams || correctedGrams <= 0) return null;

  const identity = normalizedHouseholdMeasureIdentity({
    foodName: input.foodName,
    brand: input.brand,
    quantity: input.originalQuantity,
    unit: originalUnit,
    userId: input.userId,
  });
  const record: PersistedHouseholdMeasureResolution = {
    version: 1,
    kind: "user_learned",
    foodName: input.foodName.trim(),
    normalizedFoodName: identity.foodName,
    brand: input.brand?.trim() || null,
    normalizedBrand: identity.brand,
    unit: identity.unit,
    measureQuantity: input.originalQuantity,
    grams: Number(correctedGrams.toFixed(2)),
    evidence: "Correção explícita do usuário para a mesma medida e identidade alimentar.",
    sourceUrls: [],
    referenceCount: 0,
    verifiedAt: verifiedAt.toISOString(),
    expiresAt: null,
  };

  return {
    preferenceKey: householdMeasurePreferenceKey({
      userId: input.userId,
      foodName: input.foodName,
      brand: input.brand,
      quantity: input.originalQuantity,
      unit: originalUnit,
    }, "user_learned"),
    preferenceValue: JSON.stringify(record),
    record,
  };
}

export async function upsertHouseholdMeasurePreference(
  db: any,
  input: { userId: number } & BuiltHouseholdMeasurePreference,
) {
  await db.insert(userPreferences).values({
    userId: input.userId,
    preferenceKey: input.preferenceKey,
    preferenceValue: input.preferenceValue,
  }).onDuplicateKeyUpdate({
    set: {
      preferenceValue: input.preferenceValue,
      updatedAt: new Date(),
    },
  });
}
