/**
 * Persist commercial identity explicitly confirmed with a meal item.
 * Historical snapshots are the source of truth, never a live catalog lookup.
 */
import type { MealDraftItem } from "../../nutritionEngineTypes";

type CommercialFields = Pick<MealDraftItem, "brand" | "productVariant">;
type JsonRecord = Record<string, unknown>;
type CommercialKey = keyof CommercialFields;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const has = (value: JsonRecord, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function decode(snapshotJson: string | null | undefined): JsonRecord | null {
  if (!snapshotJson) return null;
  try {
    const parsed: unknown = JSON.parse(snapshotJson);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validCommercialValue(value: unknown, key: CommercialKey): value is string | null {
  const max = key === "brand" ? 80 : 120;
  return value === null || (typeof value === "string" &&
    value.length > 0 && value.length <= max && value.trim() === value);
}

/** Previously confirmed labels outrank catalog labels; legacy resolution is fallback evidence. */
function savedValue(snapshot: JsonRecord | null, key: CommercialKey): unknown {
  if (!snapshot) return undefined;
  const confirmed = isRecord(snapshot.confirmedCommercialIdentity)
    ? snapshot.confirmedCommercialIdentity : null;
  if (confirmed && has(confirmed, key)) return confirmed[key];
  if (key === "brand") return has(snapshot, "brandName") ? snapshot.brandName : undefined;
  if (has(snapshot, "productVariant")) return snapshot.productVariant;
  const resolution = isRecord(snapshot.resolution) ? snapshot.resolution : null;
  return resolution && has(resolution, "productVariant") ? resolution.productVariant : undefined;
}

/** Never assume an explicit variant matches when the historical label is missing. */
export function matchesSavedMealCommercialIdentity(
  snapshotJson: string | null | undefined, item: CommercialFields,
): boolean {
  if (item.brand === undefined && item.productVariant === undefined) return true;
  const saved = decode(snapshotJson);
  for (const key of ["brand", "productVariant"] as const) {
    if (item[key] === undefined) continue;
    const value = savedValue(saved, key);
    if (!validCommercialValue(value, key) || value !== item[key]) return false;
  }
  return true;
}

/**
 * Keep previously confirmed commercial labels on same-food edits. A real
 * replacement passes savedSnapshotJson=null and cannot inherit old labels.
 */
export function mergePreservingMealCommercialIdentity(
  nextSnapshotJson: string | null | undefined,
  savedSnapshotJson: string | null | undefined,
  item: CommercialFields,
): string | null {
  const saved = decode(savedSnapshotJson);
  const next = decode(nextSnapshotJson);
  const savedConfirmed = isRecord(saved?.confirmedCommercialIdentity)
    ? saved.confirmedCommercialIdentity : null;
  const nextConfirmed = isRecord(next?.confirmedCommercialIdentity)
    ? next.confirmedCommercialIdentity : null;
  const confirmed: Partial<Record<CommercialKey, string | null>> = {};
  for (const key of ["brand", "productVariant"] as const) {
    // The previous confirmed identity is authoritative on an omitted field.
    const nextValue = nextConfirmed?.[key];
    const savedValue = savedConfirmed?.[key];
    if (validCommercialValue(nextValue, key)) confirmed[key] = nextValue;
    if (validCommercialValue(savedValue, key)) confirmed[key] = savedValue;
    const submitted = item[key];
    if (submitted !== undefined) {
      if (!validCommercialValue(submitted, key)) {
        throw new TypeError("invalid-confirmed-commercial-identity");
      }
      confirmed[key] = submitted;
    }
  }
  if (Object.keys(confirmed).length === 0) {
    // null can be the result of an explicit classification clear. Unlike an
    // omitted snapshot, it must never fall back to the old JSON.
    return nextSnapshotJson === undefined ? savedSnapshotJson ?? null : nextSnapshotJson;
  }
  // An explicitly cleared classification must not be resurrected from saved.
  const target = nextSnapshotJson === undefined ? saved ?? {} :
    nextSnapshotJson === null ? {} : next;
  if (!target) throw new TypeError("invalid-meal-food-snapshot");
  return JSON.stringify({ ...target, confirmedCommercialIdentity: confirmed });
}
