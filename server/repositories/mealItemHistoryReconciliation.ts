/** A-030: pure historical-item reconciliation; no catalog queries or mutations. */
import { mealItems } from "../../drizzle/schema";
import type { MealDraftItem } from "../nutritionEngine";
import { mergeConfirmedMealClassification } from "../modules/meals/classificationSnapshot";

/** A public V1 edit omits shadow-only IDs; omission must not erase persisted identity. */
export function sameHistoricalMealFood(row: typeof mealItems.$inferSelect, item: MealDraftItem) {
  const incoming = item as MealDraftItem & { foodId?: number };
  // Brand/variant labels are not materialized in the public V1 reader. An
  // explicit commercial change cannot inherit a saved variant just by name.
  const brandSpecified = item.brand !== undefined;
  const variantSpecified = item.productVariant !== undefined;
  if (brandSpecified || variantSpecified) {
    let snapshot: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = row.foodSnapshotJson ? JSON.parse(row.foodSnapshotJson) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        snapshot = parsed as Record<string, unknown>;
      }
    } catch { /* An invalid source cannot prove commercial identity. */ }
    if (!snapshot ||
        (brandSpecified && (!Object.prototype.hasOwnProperty.call(snapshot, "brandName") ||
          snapshot.brandName !== item.brand)) ||
        (variantSpecified && (!Object.prototype.hasOwnProperty.call(snapshot, "productVariant") ||
          snapshot.productVariant !== item.productVariant))) return false;
  }
  const historicalRef = row.foodVariantId != null ? `variant:${row.foodVariantId}`
    : row.foodId != null ? `food:${row.foodId}`
    : row.foodCatalogId != null ? `catalog:${row.foodCatalogId}` : null;
  return row.foodName === item.foodName && row.canonicalName === item.canonicalName &&
    row.source === item.source && (row.foodCatalogId ?? null) === (item.foodCatalogId ?? null) &&
    (incoming.foodId === undefined || incoming.foodId === row.foodId) &&
    (!item.historicalRef || item.historicalRef === historicalRef);
}

/** Determine which same-identity rows actually require a write. */
export function historyInPlaceEditIndices(
  previous: Array<typeof mealItems.$inferSelect>, items: MealDraftItem[],
  isSamePersisted: (row: typeof mealItems.$inferSelect, item: MealDraftItem) => boolean,
): number[] | null {
  if (previous.length !== items.length || !previous.every((row, index) =>
    Number.isSafeInteger(row.id) && row.id > 0 && sameHistoricalMealFood(row, items[index]))) return null;
  // Equal-length meals can still reorder same-name commercial variants. If
  // an edited slot exactly matches a different stored row, reconcile by content
  // instead of attaching the incoming nutrition to the old index's variant.
  const unchanged = previous.map((row, index) => isSamePersisted(row, items[index]));
  for (let i = 0; i < items.length; i++) {
    if (unchanged[i]) continue;
    if (previous.some((row, j) => j !== i && sameHistoricalMealFood(row, items[i]) &&
        isSamePersisted(row, items[i]))) return null;
  }
  return items.flatMap((item, index) => {
    const enriched = item as MealDraftItem & { foodSnapshotJson?: string };
    return unchanged[index] && item.classification === undefined &&
      enriched.foodSnapshotJson === undefined ? [] : [index];
  });
}

/** Retain each confirmed row's immutable V2 references and typed snapshot. */
export function preserveHistoricalMealValues<T extends object>(
  values: T[], items: MealDraftItem[],
  saved: Array<typeof mealItems.$inferSelect | null>,
): T[] {
  return values.map((value, index) => {
    const previous = saved[index];
    if (!previous) return value;
    const incoming = items[index] as MealDraftItem & {
      foodId?: number; foodSnapshotJson?: string; fiberG?: number | null; sodiumMg?: number | null;
    };
    return {
      ...value,
      // Saved identity is authoritative when the logical food did not change.
      foodCatalogId: previous.foodCatalogId, foodId: incoming.foodId ?? previous.foodId,
      foodVariantId: previous.foodVariantId, nutritionProfileId: previous.nutritionProfileId,
      foodPortionId: previous.foodPortionId, recipeId: previous.recipeId,
      portionId: previous.portionId, itemType: previous.itemType,
      createdAt: previous.createdAt,
      ...(incoming.fiberG === undefined ? { fiberG: previous.fiberG } : {}),
      ...(incoming.sodiumMg === undefined ? { sodiumMg: previous.sodiumMg } : {}),
      foodSnapshotJson: mergeConfirmedMealClassification(
        incoming.foodSnapshotJson ?? previous.foodSnapshotJson, incoming.classification,
      ),
    };
  });
}

/** Match immutable source rows before any destructive fallback; never match by label alone. */
export function retainConfirmedItemRows(
  previous: Array<typeof mealItems.$inferSelect>, items: MealDraftItem[],
  isSamePersisted: (row: typeof mealItems.$inferSelect, item: MealDraftItem) => boolean,
): Array<typeof mealItems.$inferSelect | null> {
  const matches: Array<typeof mealItems.$inferSelect | null> = items.map(() => null);
  const used = new Set<number>();
  const assign = (itemIndex: number, oldIndex: number) => {
    matches[itemIndex] = previous[oldIndex];
    used.add(oldIndex);
  };
  // Positional identity is only safe when the full list cardinality is
  // unchanged. After removal, two identical labels can denote distinct V2
  // variants; choosing the first one would silently forge historical identity.
  if (previous.length === items.length) {
    for (let i = 0; i < items.length; i++) {
      if (sameHistoricalMealFood(previous[i], items[i]) &&
          isSamePersisted(previous[i], items[i])) assign(i, i);
    }
  }
  // Reordering with distinct stored values is safe; ambiguous matches do not
  // inherit another item's historical reference.
  for (let i = 0; i < items.length; i++) {
    if (matches[i]) continue;
    const candidates = previous.flatMap((row, index) => !used.has(index) &&
      sameHistoricalMealFood(row, items[i]) && isSamePersisted(row, items[i]) ? [index] : []);
    if (candidates.length === 1) assign(i, candidates[0]);
  }
  // Portion/quantity edits may retain their own saved identity when the row
  // remains at the same position and the food identity is unchanged.
  for (let i = 0; i < items.length; i++) {
    if (matches[i] || i >= previous.length || used.has(i) ||
        !sameHistoricalMealFood(previous[i], items[i])) continue;
    const possible = previous.flatMap((row, index) => !used.has(index) &&
      sameHistoricalMealFood(row, items[i]) ? [index] : []);
    if (possible.length === 1 && possible[0] === i) assign(i, i);
  }
  return matches;
}

