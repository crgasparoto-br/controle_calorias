import type { MealDraftItem } from "./nutritionEngine";

export function associateMealItemsWithSourceMedia(
  items: MealDraftItem[],
  sourceMediaStorageKey?: string | null,
): MealDraftItem[] {
  const key = sourceMediaStorageKey?.trim();
  if (!key) return items.map(item => ({ ...item }));
  return items.map(item => ({ ...item, sourceMediaStorageKey: key }));
}

export function clearMealItemSourceMedia(item: MealDraftItem): MealDraftItem {
  const next = { ...item };
  delete next.sourceMediaStorageKey;
  return next;
}

export function clearMealItemsSourceMedia(items: MealDraftItem[]): MealDraftItem[] {
  return items.map(clearMealItemSourceMedia);
}
