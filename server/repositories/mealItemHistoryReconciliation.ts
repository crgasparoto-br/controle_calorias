/** A-030: pure historical-item reconciliation; no catalog queries or mutations. */
import { mealItems } from "../../drizzle/schema";
import { foodCatalogDirectKey } from "../foodCatalogKeys";
import type { MealDraftItem } from "../nutritionEngine";
import { mergeConfirmedMealClassification, mergePreservingMealClassification } from "../modules/meals/classificationSnapshot";
import { matchesSavedMealCommercialIdentity, mergePreservingMealCommercialIdentity, needsSavedMealCommercialConfirmation } from "../modules/meals/commercialIdentitySnapshot";

/** A public V1 edit omits shadow-only IDs; omission must not erase persisted identity. */
export function sameHistoricalMealFood(row: typeof mealItems.$inferSelect, item: MealDraftItem) {
  const incoming = item as MealDraftItem & { foodId?: number };
  // Saved confirmation (or typed legacy evidence) decides whether an
  // explicitly submitted commercial identity is still the same item.
  if (!matchesSavedMealCommercialIdentity(row.foodSnapshotJson, item)) return false;
  const historicalRef = row.foodVariantId != null ? `variant:${row.foodVariantId}`
    : row.foodId != null ? `food:${row.foodId}`
    : row.foodCatalogId != null ? `catalog:${row.foodCatalogId}` : null;
  return row.foodName === item.foodName && row.canonicalName === item.canonicalName &&
    row.source === item.source && (row.foodCatalogId ?? null) === (item.foodCatalogId ?? null) &&
    (incoming.foodId === undefined || incoming.foodId === row.foodId) &&
    (!item.historicalRef || item.historicalRef === historicalRef);
}

/**
 * For individual edits/moves, never attach old V2 identity or nutrition to a
 * different food. The source row is locked by the calling transaction.
 */
export function guardHistoricalMealItemUpdate(
  saved: typeof mealItems.$inferSelect,
  item: MealDraftItem,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  if (sameHistoricalMealFood(saved, item)) {
    // A live name-to-catalog lookup must not remap this confirmed identity.
    return { ...updates, foodCatalogId: saved.foodCatalogId };
  }
  const enriched = item as MealDraftItem & {
    foodSnapshotJson?: string; fiberG?: number | null; sodiumMg?: number | null;
  };
  const freshFoodId = enriched.foodId != null && enriched.foodId !== saved.foodId
    ? enriched.foodId : null;
  const newCatalog = item.foodCatalogId != null && item.foodCatalogId !== saved.foodCatalogId;
  // Regenerated nutrition from the old foodId is not evidence for a new
  // brand/variant. Without a new identity, discard that stale payload.
  const freshSnapshot = freshFoodId !== null || (saved.foodId == null && newCatalog)
    ? (enriched.foodSnapshotJson ?? (item.resolution
        ? JSON.stringify({ kind: "meal_item_resolution", resolution: item.resolution }) : null))
    : null;
  return {
    ...updates,
    // A client may carry the former IDs while changing brand or food.
    foodCatalogId: newCatalog ? (updates.foodCatalogId ?? null) : null,
    foodId: freshFoodId,
    foodVariantId: null, nutritionProfileId: null, foodPortionId: null,
    recipeId: null, portionId: null, itemType: "food",
    fiberG: enriched.fiberG ?? null, sodiumMg: enriched.sodiumMg ?? null,
    foodSnapshotJson: mergePreservingMealCommercialIdentity(
      mergeConfirmedMealClassification(freshSnapshot, item.classification), null, item,
    ),
  };
}

/** Determine which same-identity rows actually require a write. */
export function historyInPlaceEditIndices(
  previous: Array<typeof mealItems.$inferSelect>, items: MealDraftItem[],
  isSamePersisted: (row: typeof mealItems.$inferSelect, item: MealDraftItem) => boolean,
): number[] | null {
  if (previous.length !== items.length || !previous.every((row, index) =>
    Number.isSafeInteger(row.id) && row.id > 0 && sameHistoricalMealFood(row, items[index]))) return null;
  // Reordering plus edits can hide every exact match. A changed slot is
  // positional only if no other changed saved row could be its origin.
  const unchanged = previous.map((row, index) => isSamePersisted(row, items[index]));
  for (let i = 0; i < items.length; i++) {
    if (unchanged[i]) continue;
    if (previous.some((row, j) => j !== i && sameHistoricalMealFood(row, items[i]) &&
        (!unchanged[j] || isSamePersisted(row, items[i])))) return null;
  }
  return items.flatMap((item, index) => {
    const enriched = item as MealDraftItem & { foodSnapshotJson?: string };
    return unchanged[index] && item.classification === undefined &&
      enriched.foodSnapshotJson === undefined &&
      !needsSavedMealCommercialConfirmation(previous[index].foodSnapshotJson, item)
      ? [] : [index];
  });
}

/**
 * A replacement may carry an old V1 catalog, resolution and provenance through
 * the edit API even when its food name and commercial identity both changed.
 * The caller provides ONLY displaced historical rows, never retained siblings.
 */
export function discardUnverifiedCommercialReplacement<T extends object>(
  value: T, item: MealDraftItem, previous: Array<typeof mealItems.$inferSelect>,
  resolvedCatalogIds: Map<string, number>,
): T {
  // A confirmed match has already been retained; no displaced row means this
  // is a pure insertion, not an unverified replacement of historical evidence.
  if (!previous.length) return value;
  const conflicting = previous;

  const enriched = item as MealDraftItem & {
    foodId?: number; foodSnapshotJson?: string; fiberG?: number | null;
    sodiumMg?: number | null;
  };
  // A new *direct* catalog ID may survive; a name-based catalog lookup cannot
  // prove commercial identity and may return the replaced item's catalog.
  const directCatalog = Number(item.foodCatalogId);
  const freshCatalog = Number.isSafeInteger(directCatalog) && directCatalog > 0 &&
    conflicting.every(row => row.foodCatalogId !== directCatalog) &&
    resolvedCatalogIds.get(foodCatalogDirectKey(directCatalog)) === directCatalog;
  // A new V2 food requires a new ID AND a matching authoritative snapshot.
  // Merely retaining the old foodId through enrichment is not new evidence.
  const foodId = Number(enriched.foodId);
  let freshFood = false;
  if (Number.isSafeInteger(foodId) && foodId > 0 &&
      conflicting.every(row => row.foodId !== foodId) && enriched.foodSnapshotJson &&
      matchesSavedMealCommercialIdentity(enriched.foodSnapshotJson, item)) {
    try {
      const snapshot: unknown = JSON.parse(enriched.foodSnapshotJson);
      freshFood = !!snapshot && typeof snapshot === "object" &&
        (snapshot as { foodId?: unknown }).foodId === foodId;
    } catch { /* Unparseable evidence cannot prove a replacement. */ }
  }

  const snapshot = mergePreservingMealCommercialIdentity(
    mergeConfirmedMealClassification(freshFood ? enriched.foodSnapshotJson : null,
      item.classification), null, item,
  );
  return {
    ...value,
    foodCatalogId: freshCatalog ? directCatalog : null,
    foodId: freshFood ? foodId : null,
    // Unverified old nutrition, fiber and source must not appear as confirmed.
    fiberG: freshFood ? (enriched.fiberG ?? null) : null,
    sodiumMg: freshFood ? (enriched.sodiumMg ?? null) : null,
    foodSnapshotJson: snapshot,
    source: freshCatalog || freshFood ? item.source : "heuristic",
  };
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
      foodSnapshotJson: mergePreservingMealCommercialIdentity(
        mergePreservingMealClassification(
          incoming.foodSnapshotJson, previous.foodSnapshotJson, incoming.classification,
        ),
        previous.foodSnapshotJson, incoming,
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
  // An explicit saved reference or confirmed commercial label can identify a
  // swapped item even if its portion changed; require a single eligible source.
  for (let i = 0; i < items.length; i++) {
    if (matches[i] || !(items[i].historicalRef ||
        items[i].brand !== undefined || items[i].productVariant !== undefined)) continue;
    const candidates = previous.flatMap((row, index) => !used.has(index) &&
      sameHistoricalMealFood(row, items[i]) ? [index] : []);
    if (candidates.length === 1) assign(i, candidates[0]);
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
