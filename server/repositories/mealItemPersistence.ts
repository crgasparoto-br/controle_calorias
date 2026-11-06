import { foodCatalogDirectKey } from "../foodCatalogKeys";
import type { MealDraftItem } from "../nutritionEngine";
import {
  mergeConfirmedMealClassification,
  mergePreservingMealClassification,
} from "../modules/meals/classificationSnapshot";
import { mergePreservingMealCommercialIdentity } from "../modules/meals/commercialIdentitySnapshot";
import {
  clearPersistedMealItemIdentityValues,
  persistedMealItemIdentityUpdate,
  persistedMealItemIdentityValues,
} from "../modules/meals/mealItemIdentityPersistence";

type SavedMealSnapshot = {
  id: number;
  userId: number;
  source: "web" | "whatsapp";
  mealLabel: string;
  status: "confirmed";
  occurredAt: number;
  notes?: string;
  confidence: number;
};

export function getMealItemCatalogId(
  item: MealDraftItem,
  resolvedCatalogIds: Map<string, number>
) {
  const directId = Number(item.foodCatalogId);
  if (Number.isFinite(directId) && directId > 0) {
    const resolvedDirectId = resolvedCatalogIds.get(
      foodCatalogDirectKey(directId)
    );
    if (resolvedDirectId) return resolvedDirectId;
  }

  return (
    resolvedCatalogIds.get(item.canonicalName) ??
    resolvedCatalogIds.get(item.foodName) ??
    null
  );
}

export function readMealItemResolution(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as {
      resolution?: MealDraftItem["resolution"];
    };
    return parsed?.resolution ?? undefined;
  } catch {
    return undefined;
  }
}

export function buildMealItemValues(
  mealId: number,
  items: MealDraftItem[],
  resolvedCatalogIds: Map<string, number>
) {
  return items.map(item => ({
    ...(() => {
      const enriched = item as MealDraftItem & {
        grams?: number;
        caloriesKcal?: number;
        proteinG?: number;
        carbG?: number;
        fatG?: number;
        fiberG?: number | null;
        sodiumMg?: number | null;
        foodSnapshotJson?: string;
      };
      return {
        ...persistedMealItemIdentityValues(item),
        grams: enriched.grams ?? item.estimatedGrams,
        caloriesKcal: enriched.caloriesKcal ?? item.calories,
        proteinG: enriched.proteinG ?? item.protein,
        carbG: enriched.carbG ?? item.carbs,
        fatG: enriched.fatG ?? item.fat,
        fiberG: enriched.fiberG ?? null,
        sodiumMg: enriched.sodiumMg ?? null,
        foodSnapshotJson: mergePreservingMealCommercialIdentity(
          mergeConfirmedMealClassification(
            enriched.foodSnapshotJson ??
              (item.resolution
                ? JSON.stringify({
                    kind: "meal_item_resolution",
                    resolution: item.resolution,
                  })
                : null),
            item.classification
          ),
          null,
          item
        ),
      };
    })(),
    mealId,
    foodCatalogId: getMealItemCatalogId(item, resolvedCatalogIds),
    foodName: item.foodName,
    canonicalName: item.canonicalName,
    portionText: item.portionText,
    quantity: item.quantity,
    unit: item.unit,
    servings: item.servings,
    estimatedGrams: item.estimatedGrams,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    sourceMediaStorageKey: item.sourceMediaStorageKey ?? null,
    source: item.source,
  }));
}

export function assertMealItemSnapshot(
  currentItems: any[],
  expectedItems: MealDraftItem[]
) {
  if (currentItems.length !== expectedItems.length) {
    throw new Error(
      "A refeição foi alterada antes do salvamento. Recarregue os dados e tente novamente."
    );
  }
  currentItems.forEach((row, index) => {
    if (!samePersistedMealItem(row, expectedItems[index])) {
      throw new Error(
        "A refeição foi alterada antes do salvamento. Recarregue os dados e tente novamente."
      );
    }
  });
}

export function samePersistedMealMetadata(row: any, expected: SavedMealSnapshot) {
  const occurredAt = new Date(row.occurredAt).getTime();
  return (
    Number(row.id) === expected.id &&
    Number(row.userId) === expected.userId &&
    String(row.source ?? "") === expected.source &&
    String(row.status ?? "") === expected.status &&
    String(row.mealLabel ?? "") === expected.mealLabel &&
    String(row.notes ?? "") === String(expected.notes ?? "") &&
    Number.isFinite(occurredAt) &&
    occurredAt === expected.occurredAt &&
    Math.abs(Number(row.confidence) - expected.confidence) < 1e-9
  );
}

export function assertMealMetadataSnapshot(
  currentMeal: any,
  expectedMeal: SavedMealSnapshot
) {
  if (!samePersistedMealMetadata(currentMeal, expectedMeal)) {
    throw new Error(
      "A refeição foi alterada antes do salvamento. Recarregue os dados e tente novamente."
    );
  }
}

/** Only new item-bound evidence may establish a replacement's nutrition. */
export function sanitizeUnverifiedReplacement(item: MealDraftItem) {
  return {
    ...item,
    classification: undefined,
    resolution: undefined,
    foodSnapshotJson: undefined,
  };
}

export function buildMealItemUpdate(
  item: MealDraftItem,
  resolvedCatalogIds: Map<string, number>,
  savedSnapshot: string | null | undefined
) {
  const values = {
    ...buildMealItemValues(0, [item], resolvedCatalogIds)[0],
  } as Record<string, unknown>;
  const enriched = item as MealDraftItem & {
    grams?: number;
    caloriesKcal?: number;
    proteinG?: number;
    carbG?: number;
    fatG?: number;
    fiberG?: number | null;
    sodiumMg?: number | null;
    foodSnapshotJson?: string;
  };
  delete values.mealId;
  clearPersistedMealItemIdentityValues(values);
  for (const field of [
    "grams",
    "caloriesKcal",
    "proteinG",
    "carbG",
    "fatG",
    "fiberG",
    "sodiumMg",
    "foodSnapshotJson",
  ]) {
    delete values[field];
  }
  return {
    ...values,
    ...persistedMealItemIdentityUpdate(item),
    grams: enriched.grams ?? item.estimatedGrams,
    caloriesKcal: enriched.caloriesKcal ?? item.calories,
    proteinG: enriched.proteinG ?? item.protein,
    carbG: enriched.carbG ?? item.carbs,
    fatG: enriched.fatG ?? item.fat,
    ...(enriched.fiberG !== undefined ? { fiberG: enriched.fiberG } : {}),
    ...(enriched.sodiumMg !== undefined ? { sodiumMg: enriched.sodiumMg } : {}),
    // Preserve the existing nutrition/resolution snapshot on a partial edit;
    // replace only its classification when the item explicitly supplies one.
    ...(enriched.foodSnapshotJson !== undefined ||
    item.classification !== undefined ||
    item.brand !== undefined ||
    item.productVariant !== undefined
      ? {
          foodSnapshotJson: mergePreservingMealCommercialIdentity(
            mergePreservingMealClassification(
              enriched.foodSnapshotJson,
              savedSnapshot,
              item.classification
            ),
            savedSnapshot,
            item
          ),
        }
      : {}),
  };
}

export function samePersistedMealItem(row: any, expected: MealDraftItem) {
  const numericEqual = (actual: unknown, wanted: unknown) => {
    const a = Number(actual);
    const b = Number(wanted);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
  };
  return (
    String(row.foodName ?? "") === String(expected.foodName ?? "") &&
    String(row.canonicalName ?? "") === String(expected.canonicalName ?? "") &&
    String(row.foodCatalogId ?? "") === String(expected.foodCatalogId ?? "") &&
    String(row.portionText ?? "") === String(expected.portionText ?? "") &&
    String(row.unit ?? "") === String(expected.unit ?? "") &&
    numericEqual(row.quantity, expected.quantity) &&
    numericEqual(row.servings, expected.servings) &&
    numericEqual(row.estimatedGrams, expected.estimatedGrams) &&
    numericEqual(row.calories, expected.calories) &&
    numericEqual(row.protein, expected.protein) &&
    numericEqual(row.carbs, expected.carbs) &&
    numericEqual(row.fat, expected.fat) &&
    String(row.sourceMediaStorageKey ?? "") ===
      String(expected.sourceMediaStorageKey ?? "") &&
    String(row.source ?? "") === String(expected.source ?? "")
  );
}
