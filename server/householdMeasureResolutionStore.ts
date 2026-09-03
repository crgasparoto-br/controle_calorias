import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { userPreferences } from "../drizzle/schema";
import { normalizeMeasurementUnit } from "../shared/measurementUnits";
import { getDb } from "./db";
import { safeLogDetail } from "./privacy";

export type PersistedHouseholdMeasureKind =
  | "researched_exact"
  | "usual_average"
  | "contextual_estimate"
  | "user_learned";

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

export type HouseholdMeasurePersistenceInput = {
  userId: number;
  foodName: string;
  brand?: string | null;
  quantity: number;
  unit: string;
};

export type PersistHouseholdMeasureResolutionInput = HouseholdMeasurePersistenceInput & {
  kind: PersistedHouseholdMeasureKind;
  grams: number;
  evidence: string | null;
  sourceUrls: string[];
  referenceCount: number;
  verifiedAt?: Date;
  expiresAt?: Date | null;
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

const PREFERENCE_PREFIX = "household_measure_v1:";
export const HOUSEHOLD_MEASURE_SEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MASS_VOLUME_UNITS = new Set(["mg", "g", "kg", "ml", "l"]);
const PERSISTED_KINDS: PersistedHouseholdMeasureKind[] = [
  "researched_exact",
  "usual_average",
  "contextual_estimate",
  "user_learned",
];

function normalizeIdentityText(value: string) {
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

function normalizeCountableUnit(value: string) {
  const unit = normalizeMeasurementUnit(value);
  return unit === "un" ? "unidade" : unit;
}

function normalizedIdentity(input: Pick<HouseholdMeasurePersistenceInput, "foodName" | "brand" | "unit">) {
  return {
    foodName: normalizeIdentityText(input.foodName),
    brand: normalizeIdentityText(input.brand ?? ""),
    unit: normalizeCountableUnit(input.unit),
  };
}

function preferenceKey(
  input: Pick<HouseholdMeasurePersistenceInput, "foodName" | "brand" | "unit">,
  kind: PersistedHouseholdMeasureKind,
) {
  const identity = normalizedIdentity(input);
  const digest = createHash("sha256")
    .update([identity.foodName, identity.brand, identity.unit, kind].join("|"))
    .digest("hex");
  return `${PREFERENCE_PREFIX}${digest}`;
}

function parseStoredResolution(
  value: string | null | undefined,
): PersistedHouseholdMeasureResolution | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PersistedHouseholdMeasureResolution>;
    if (parsed.version !== 1) return null;
    if (!parsed.kind || !PERSISTED_KINDS.includes(parsed.kind)) return null;
    if (!parsed.normalizedFoodName || typeof parsed.normalizedBrand !== "string" || !parsed.unit) return null;
    if (typeof parsed.measureQuantity !== "number" || !Number.isFinite(parsed.measureQuantity) || parsed.measureQuantity <= 0) return null;
    if (typeof parsed.grams !== "number" || !Number.isFinite(parsed.grams) || parsed.grams <= 0) return null;
    if (!parsed.verifiedAt || Number.isNaN(new Date(parsed.verifiedAt).getTime())) return null;
    if (parsed.expiresAt && Number.isNaN(new Date(parsed.expiresAt).getTime())) return null;
    return {
      version: 1,
      kind: parsed.kind,
      foodName: String(parsed.foodName ?? ""),
      normalizedFoodName: parsed.normalizedFoodName,
      brand: parsed.brand ?? null,
      normalizedBrand: parsed.normalizedBrand,
      unit: parsed.unit,
      measureQuantity: parsed.measureQuantity,
      grams: parsed.grams,
      evidence: typeof parsed.evidence === "string" ? parsed.evidence : null,
      sourceUrls: Array.isArray(parsed.sourceUrls)
        ? parsed.sourceUrls.filter((item): item is string => typeof item === "string")
        : [],
      referenceCount: typeof parsed.referenceCount === "number" && Number.isFinite(parsed.referenceCount)
        ? Math.max(0, parsed.referenceCount)
        : 0,
      verifiedAt: parsed.verifiedAt,
      expiresAt: parsed.expiresAt ?? null,
    };
  } catch {
    return null;
  }
}

function recordMatchesInput(
  record: PersistedHouseholdMeasureResolution,
  input: HouseholdMeasurePersistenceInput,
) {
  const identity = normalizedIdentity(input);
  return record.normalizedFoodName === identity.foodName
    && record.normalizedBrand === identity.brand
    && record.unit === identity.unit;
}

function recordIsActive(record: PersistedHouseholdMeasureResolution, now: Date) {
  if (!record.expiresAt) return true;
  return new Date(record.expiresAt).getTime() > now.getTime();
}

export async function loadPersistedHouseholdMeasureResolution(
  input: HouseholdMeasurePersistenceInput,
  kinds: PersistedHouseholdMeasureKind[],
  now = new Date(),
): Promise<PersistedHouseholdMeasureResolution | null> {
  if (!kinds.length) return null;
  const db = await getDb();
  if (!db) return null;

  const keys = kinds.map(kind => preferenceKey(input, kind));
  try {
    const rows = await db
      .select({
        preferenceKey: userPreferences.preferenceKey,
        preferenceValue: userPreferences.preferenceValue,
      })
      .from(userPreferences)
      .where(and(
        eq(userPreferences.userId, input.userId),
        inArray(userPreferences.preferenceKey, keys),
      ));
    const byKey = new Map(rows.map(row => [row.preferenceKey, row.preferenceValue]));
    for (const kind of kinds) {
      const record = parseStoredResolution(byKey.get(preferenceKey(input, kind)));
      if (!record || record.kind !== kind) continue;
      if (!recordMatchesInput(record, input)) continue;
      if (!recordIsActive(record, now)) continue;
      return record;
    }
  } catch (error) {
    console.warn("[Database] Household measure read skipped:", safeLogDetail(error));
  }
  return null;
}

export async function persistHouseholdMeasureResolution(
  input: PersistHouseholdMeasureResolutionInput,
): Promise<boolean> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return false;
  if (!Number.isFinite(input.grams) || input.grams <= 0) return false;
  const db = await getDb();
  if (!db) return false;

  const identity = normalizedIdentity(input);
  const verifiedAt = input.verifiedAt ?? new Date();
  const expiresAt = input.kind === "user_learned"
    ? null
    : (input.expiresAt ?? new Date(verifiedAt.getTime() + HOUSEHOLD_MEASURE_SEARCH_TTL_MS));
  const record: PersistedHouseholdMeasureResolution = {
    version: 1,
    kind: input.kind,
    foodName: input.foodName.trim(),
    normalizedFoodName: identity.foodName,
    brand: input.brand?.trim() || null,
    normalizedBrand: identity.brand,
    unit: identity.unit,
    measureQuantity: input.quantity,
    grams: Number(input.grams.toFixed(2)),
    evidence: input.evidence?.trim() || null,
    sourceUrls: [...new Set(input.sourceUrls.filter(Boolean))],
    referenceCount: Math.max(0, Math.trunc(input.referenceCount)),
    verifiedAt: verifiedAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
  };
  const key = preferenceKey(input, input.kind);
  const serialized = JSON.stringify(record);

  try {
    await db.insert(userPreferences).values({
      userId: input.userId,
      preferenceKey: key,
      preferenceValue: serialized,
    }).onDuplicateKeyUpdate({
      set: {
        preferenceValue: serialized,
        updatedAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    console.warn("[Database] Household measure persistence skipped:", safeLogDetail(error));
    return false;
  }
}

function correctedMassOrVolumeToGrams(quantity: number, unit: string) {
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

export async function persistUserLearnedHouseholdMeasure(
  input: UserLearnedHouseholdMeasureInput,
): Promise<boolean> {
  const originalUnit = normalizeCountableUnit(input.originalUnit);
  if (MASS_VOLUME_UNITS.has(originalUnit)) return false;
  if (!Number.isFinite(input.originalQuantity) || input.originalQuantity <= 0) return false;
  const correctedGrams = correctedMassOrVolumeToGrams(input.correctedQuantity, input.correctedUnit);
  if (!correctedGrams || correctedGrams <= 0) return false;

  return persistHouseholdMeasureResolution({
    userId: input.userId,
    foodName: input.foodName,
    brand: input.brand,
    quantity: input.originalQuantity,
    unit: originalUnit,
    kind: "user_learned",
    grams: correctedGrams,
    evidence: "Correção explícita do usuário para a mesma medida e identidade alimentar.",
    sourceUrls: [],
    referenceCount: 0,
    verifiedAt: new Date(),
    expiresAt: null,
  });
}
