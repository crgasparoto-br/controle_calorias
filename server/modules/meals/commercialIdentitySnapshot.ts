/**
 * Persist commercial identity explicitly confirmed with a meal item.
 * Historical snapshots are the source of truth, never a live catalog lookup.
 */
import {
  decodeCommercialSnapshot,
  isRecord,
  savedValue,
  validCommercialValue,
  type CommercialFields,
  type CommercialKey,
} from "./commercialIdentityReaders";

export {
  matchesSavedMealCommercialIdentity,
  needsSavedMealCommercialConfirmation,
  readSavedMealAdjustmentIdentity,
  readSavedMealCommercialIdentity,
} from "./commercialIdentityReaders";

/**
 * Keep previously confirmed commercial labels on same-food edits. A real
 * replacement passes savedSnapshotJson=null and cannot inherit old labels.
 */
export function mergePreservingMealCommercialIdentity(
  nextSnapshotJson: string | null | undefined,
  savedSnapshotJson: string | null | undefined,
  item: CommercialFields
): string | null {
  const saved = decodeCommercialSnapshot(savedSnapshotJson);
  const next = decodeCommercialSnapshot(nextSnapshotJson);
  const savedConfirmed = isRecord(saved?.confirmedCommercialIdentity)
    ? saved.confirmedCommercialIdentity
    : null;
  const nextConfirmed = isRecord(next?.confirmedCommercialIdentity)
    ? next.confirmedCommercialIdentity
    : null;
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
    return nextSnapshotJson === undefined
      ? (savedSnapshotJson ?? null)
      : nextSnapshotJson;
  }
  // An explicitly cleared classification must not be resurrected from saved.
  const target =
    nextSnapshotJson === undefined
      ? (saved ?? {})
      : nextSnapshotJson === null
        ? {}
        : next;
  if (!target) throw new TypeError("invalid-meal-food-snapshot");
  return JSON.stringify({ ...target, confirmedCommercialIdentity: confirmed });
}
