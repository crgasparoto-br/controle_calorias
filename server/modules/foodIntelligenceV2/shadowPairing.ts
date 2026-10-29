/** Pure, read-only V1/V2 item matching. No raw identity leaves this module. */
import type { MealDraftItem } from "../../nutritionEngineTypes";
import type { FoodResolutionDecision } from "./schemas";

export const metric = (n: number): number => Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : 0;
/** Preserve micro-dollar costs in aggregate telemetry. */
export const costMetric = (n: number): number => Number.isFinite(n) && n >= 0 ? Math.round(n * 100000000) / 100000000 : 0;
export const abs = (a: number, b: number): number | null =>
  Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0
    ? metric(Math.abs(a - b)) : null;
const normalize = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const exactDifference = (a: string | null | undefined, b: string | null | undefined) =>
  normalize(a) !== normalize(b);

/** Only a persisted V2 variant reference shares identity with identity.variantId. */
export function persistedVariantId(item: MealDraftItem): number | null {
  const reference = item.historicalRef;
  if (!reference?.startsWith("variant:")) return null;
  const text = reference.slice("variant:".length);
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 && String(id) === text ? id : null;
}

/**
 * Align saved variant IDs before legacy text labels, never by array position.
 * Do not match two distinct known variant IDs just because their labels agree:
 * these remain unpaired and cannot contribute unrelated nutrition deltas.
 * Repetitions select the closest saved quantity and nutrition within each pass.
 * No free-form identity or food name is emitted to telemetry.
 */
function shadowPairCost(left: MealDraftItem, right: FoodResolutionDecision): number {
  const nutrition = right.nutrition.consumed;
  const macroDelta = nutrition ?
    (abs(left.calories, nutrition.calories) ?? 0) +
    (abs(left.protein, nutrition.protein) ?? 0) +
    (abs(left.carbs, nutrition.carbs) ?? 0) +
    (abs(left.fat, nutrition.fat) ?? 0) : 0;
  return (exactDifference(left.brand, right.identity.brand) ? 1000000 : 0) +
    (exactDifference(left.productVariant, right.identity.variant) ? 1000000 : 0) +
    (exactDifference(left.unit, right.quantity.unit) ? 100000 : 0) +
    (right.quantity.value === null ? 1000 : (abs(left.quantity, right.quantity.value) ?? 1000)) * 1000 +
    (right.quantity.grams === null ? 0 : (abs(left.estimatedGrams, right.quantity.grams) ?? 1000) * 10) +
    macroDelta;
}

export function pairFoodShadowItems(
  left: readonly MealDraftItem[], right: readonly FoodResolutionDecision[],
): { pairs: Array<{ left: MealDraftItem; right: FoodResolutionDecision }>; unpairedVariantChanges: number } {
  const usedLeft = new Set<number>();
  const usedRight = new Set<number>();
  const pairs: Array<{ left: MealDraftItem; right: FoodResolutionDecision }> = [];
  const leftIds = left.map(persistedVariantId);
  // Stable IDs take precedence even when a display label or nutrition changes.
  const stableCandidates: Array<{ i: number; j: number; cost: number }> = [];
  for (let i = 0; i < left.length; i++) {
    if (leftIds[i] === null) continue;
    for (let j = 0; j < right.length; j++) {
      if (leftIds[i] === right[j].identity.variantId) {
        stableCandidates.push({ i, j, cost: shadowPairCost(left[i], right[j]) });
      }
    }
  }
  stableCandidates.sort((a, b) => a.cost - b.cost || a.i - b.i || a.j - b.j);
  for (const { i, j } of stableCandidates) {
    if (usedLeft.has(i) || usedRight.has(j)) continue;
    usedLeft.add(i);
    usedRight.add(j);
    pairs.push({ left: left[i], right: right[j] });
  }
  for (const exactVariant of [true, false]) {
    const candidates: Array<{ i: number; j: number; cost: number }> = [];
    for (let i = 0; i < left.length; i++) {
      if (usedLeft.has(i)) continue;
      const name = normalize(left[i].canonicalName || left[i].foodName);
      if (!name) continue;
      for (let j = 0; j < right.length; j++) {
        if (usedRight.has(j) || name !== normalize(right[j].identity.canonicalName)) continue;
        // A different persisted V2 ID is not an interchangeable same-name item.
        if (leftIds[i] !== null && right[j].identity.variantId !== null) continue;
        if (exactVariant && (exactDifference(left[i].brand, right[j].identity.brand) ||
          exactDifference(left[i].productVariant, right[j].identity.variant))) continue;
        candidates.push({ i, j, cost: shadowPairCost(left[i], right[j]) });
      }
    }
    candidates.sort((a, b) => a.cost - b.cost || a.i - b.i || a.j - b.j);
    for (const { i, j } of candidates) {
      if (usedLeft.has(i) || usedRight.has(j)) continue;
      usedLeft.add(i);
      usedRight.add(j);
      pairs.push({ left: left[i], right: right[j] });
    }
  }
  // Unmatched, same-name items with two known IDs represent variant drift;
  // they must not be compared as nutritionally equivalent pairs.
  const knownLeftByName = new Map<string, number>();
  for (let i = 0; i < left.length; i++) {
    if (usedLeft.has(i) || leftIds[i] === null) continue;
    const name = normalize(left[i].canonicalName || left[i].foodName);
    if (name) knownLeftByName.set(name, (knownLeftByName.get(name) ?? 0) + 1);
  }
  let unpairedVariantChanges = 0;
  for (let j = 0; j < right.length; j++) {
    if (usedRight.has(j) || right[j].identity.variantId === null) continue;
    const name = normalize(right[j].identity.canonicalName);
    const remaining = knownLeftByName.get(name) ?? 0;
    if (!remaining) continue;
    unpairedVariantChanges++;
    knownLeftByName.set(name, remaining - 1);
  }
  return { pairs, unpairedVariantChanges };
}
