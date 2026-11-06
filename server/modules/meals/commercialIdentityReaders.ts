import type { MealDraftItem } from "../../nutritionEngineTypes";

export type CommercialFields = Pick<MealDraftItem, "brand" | "productVariant">;
export type JsonRecord = Record<string, unknown>;
export type CommercialKey = keyof CommercialFields;

export const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const has = (value: JsonRecord, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

export function decodeCommercialSnapshot(
  snapshotJson: string | null | undefined
): JsonRecord | null {
  if (!snapshotJson) return null;
  try {
    const parsed: unknown = JSON.parse(snapshotJson);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Length bounds mirror the public meal-item schema, not food materiality rules.
const MAX_COMMERCIAL_FIELD_LENGTH: Readonly<Record<CommercialKey, number>> = {
  brand: 80,
  productVariant: 120,
};

export function validCommercialValue(
  value: unknown,
  key: CommercialKey
): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_COMMERCIAL_FIELD_LENGTH[key] &&
      value.trim() === value)
  );
}

/** Previously confirmed labels outrank catalog labels; legacy resolution is fallback evidence. */
export function savedValue(snapshot: JsonRecord | null, key: CommercialKey): unknown {
  if (!snapshot) return undefined;
  const confirmed = isRecord(snapshot.confirmedCommercialIdentity)
    ? snapshot.confirmedCommercialIdentity
    : null;
  if (confirmed && has(confirmed, key)) return confirmed[key];
  if (key === "brand")
    return has(snapshot, "brandName") ? snapshot.brandName : undefined;
  if (has(snapshot, "productVariant")) return snapshot.productVariant;
  const resolution = isRecord(snapshot.resolution) ? snapshot.resolution : null;
  return resolution && has(resolution, "productVariant")
    ? resolution.productVariant
    : undefined;
}

/** Read only explicitly persisted commercial identity; never infer from a live catalog. */
export function readSavedMealCommercialIdentity(
  snapshotJson: string | null | undefined
): Partial<CommercialFields> {
  const snapshot = decodeCommercialSnapshot(snapshotJson);
  const result: Partial<CommercialFields> = {};
  for (const key of ["brand", "productVariant"] as const) {
    const value = savedValue(snapshot, key);
    if (validCommercialValue(value, key)) result[key] = value;
  }
  return result;
}

export function readSavedMealAdjustmentIdentity(
  item: {
    foodId?: number | null;
    foodVariantId?: number | null;
    nutritionProfileId?: number | null;
    foodPortionId?: number | null;
    portionId?: number | null;
  },
  snapshotJson: string | null | undefined
) {
  return {
    foodId: item.foodId ?? undefined,
    foodVariantId: item.foodVariantId ?? null,
    nutritionProfileId: item.nutritionProfileId ?? null,
    foodPortionId: item.foodPortionId ?? null,
    portionId: item.portionId ?? undefined,
    ...readSavedMealCommercialIdentity(snapshotJson),
  };
}

/** Never assume an explicit variant matches when the historical label is missing. */
export function matchesSavedMealCommercialIdentity(
  snapshotJson: string | null | undefined,
  item: CommercialFields
): boolean {
  if (item.brand === undefined && item.productVariant === undefined)
    return true;
  const saved = decodeCommercialSnapshot(snapshotJson);
  for (const key of ["brand", "productVariant"] as const) {
    if (item[key] === undefined) continue;
    const value = savedValue(saved, key);
    if (!validCommercialValue(value, key) || value !== item[key]) return false;
  }
  return true;
}

/** Explicit labels proven by legacy data still need a typed, item-scoped confirmation. */
export function needsSavedMealCommercialConfirmation(
  snapshotJson: string | null | undefined,
  item: CommercialFields
): boolean {
  if (item.brand === undefined && item.productVariant === undefined)
    return false;
  const snapshot = decodeCommercialSnapshot(snapshotJson);
  const confirmed = isRecord(snapshot?.confirmedCommercialIdentity)
    ? snapshot.confirmedCommercialIdentity
    : null;
  return (["brand", "productVariant"] as const).some(
    key =>
      item[key] !== undefined &&
      (!confirmed || !has(confirmed, key) || confirmed[key] !== item[key])
  );
}
