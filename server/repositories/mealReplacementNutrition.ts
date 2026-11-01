/** A-037: a changed food identity must have new, item-bound nutrition evidence. */
import { eq } from "drizzle-orm";
import { foodCatalog, mealItems } from "../../drizzle/schema";
import { foodCatalogDirectKey } from "../foodCatalogKeys";
import type { MealDraftItem } from "../nutritionEngine";
import { mergePreservingMealCommercialIdentity } from "../modules/meals/commercialIdentitySnapshot";

type SavedRow = typeof mealItems.$inferSelect;
type NutritionColumns = {
  calories: number; protein: number; carbs: number; fat: number;
  caloriesKcal: number; proteinG: number; carbG: number; fatG: number;
  grams: number; fiberG: number | null; sodiumMg: number | null;
};

const fail = (): never => {
  throw new Error("Recalcule e confirme os valores nutricionais do novo alimento antes de salvar.");
};

const validAmount = (value: unknown, limit: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= limit;

function checkedNutrition(calculated: Record<string, unknown>, grams: unknown): NutritionColumns {
  if (!validAmount(grams, 5000) || grams <= 0 ||
      !validAmount(calculated.caloriesKcal, 10000) ||
      !validAmount(calculated.proteinG, 1000) ||
      !validAmount(calculated.carbG, 1000) ||
      !validAmount(calculated.fatG, 1000)) fail();
  return {
    calories: calculated.caloriesKcal as number,
    protein: calculated.proteinG as number,
    carbs: calculated.carbG as number,
    fat: calculated.fatG as number,
    caloriesKcal: calculated.caloriesKcal as number,
    proteinG: calculated.proteinG as number,
    carbG: calculated.carbG as number,
    fatG: calculated.fatG as number,
    grams: grams as number,
    fiberG: validAmount(calculated.fiberG, 1000) ? calculated.fiberG : null,
    sodiumMg: validAmount(calculated.sodiumMg, 100000) ? calculated.sodiumMg : null,
  };
}

function freshFoodSnapshot(item: MealDraftItem, previous: SavedRow[]) {
  const enriched = item as MealDraftItem & { foodSnapshotJson?: string };
  if (!enriched.foodId || previous.some(row => row.foodId === enriched.foodId) ||
      !enriched.foodSnapshotJson) return null;
  try {
    const snapshot = JSON.parse(enriched.foodSnapshotJson) as Record<string, unknown>;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
        snapshot.foodId !== enriched.foodId || !snapshot.calculated ||
        typeof snapshot.calculated !== "object" || Array.isArray(snapshot.calculated)) return null;
    const result = checkedNutrition(snapshot.calculated as Record<string, unknown>, snapshot.grams);
    if (!sameLabel(snapshot.name, item.canonicalName) ||
        snapshot.grams !== item.estimatedGrams) return null;
    const { classification: _oldClassification, ...withoutClassification } = snapshot;
    return { ...result, snapshot: JSON.stringify(withoutClassification) };
  } catch { return null; }
}

const sameLabel = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" &&
  a.trim().toLocaleLowerCase("pt-BR") === b.trim().toLocaleLowerCase("pt-BR");

/**
 * Called inside the locked meal transaction only for an actual food or
 * commercial-identity change, never for a portion edit, reorder or insertion.
 * A catalog ID alone validates identity, not the nutrition copied by the V1
 * editor. Recompute from its currently authorized row or reject atomically.
 */
export async function requireFreshReplacementNutrition<T extends object>(
  tx: any, userId: number, previous: SavedRow[], item: MealDraftItem,
  resolvedCatalogIds: Map<string, number>, values: T,
): Promise<T> {
  const freshV2 = freshFoodSnapshot(item, previous);
  if (freshV2) {
    const parsed = JSON.parse(freshV2.snapshot) as Record<string, unknown>;
    if ((item.brand !== undefined &&
        !(item.brand === null && parsed.brandName == null) &&
        !sameLabel(parsed.brandName, item.brand)) ||
        (item.productVariant !== undefined &&
        !(item.productVariant === null && parsed.productVariant == null) &&
        !sameLabel(parsed.productVariant, item.productVariant))) fail();
    const { snapshot, ...nutrition } = freshV2;
    return { ...values, ...nutrition, foodId: item.foodId, foodCatalogId: null,
      sourceMediaStorageKey: null,
      foodSnapshotJson: mergePreservingMealCommercialIdentity(snapshot, null, item),
      source: "catalog" };
  }

  const catalogId = Number(item.foodCatalogId);
  if (!Number.isSafeInteger(catalogId) || catalogId <= 0 ||
      previous.some(row => row.foodCatalogId === catalogId) ||
      resolvedCatalogIds.get(foodCatalogDirectKey(catalogId)) !== catalogId) fail();
  const [row] = await tx.select().from(foodCatalog).where(eq(foodCatalog.id, catalogId)).limit(1);
  if (!row || row.status !== "active" ||
      (row.createdByUserId != null && row.createdByUserId !== userId) ||
      !(sameLabel(row.name, item.foodName) || sameLabel(row.name, item.canonicalName)) ||
      (item.brand !== undefined && !sameLabel(row.brandName, item.brand) &&
        !(item.brand === null && row.brandName == null)) ||
      (item.productVariant !== undefined && !sameLabel(row.productVariant, item.productVariant) &&
        !(item.productVariant === null && row.productVariant == null)) ||
      !validAmount(row.gramsPerServing, 5000) || row.gramsPerServing <= 0 ||
      !validAmount(item.estimatedGrams, 5000) || item.estimatedGrams <= 0) fail();

  const factor = item.estimatedGrams / row.gramsPerServing;
  const round2 = (value: unknown) => typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * factor * 100) / 100 : NaN;
  const nutrition = checkedNutrition({
    caloriesKcal: round2(row.calories), proteinG: round2(row.protein),
    carbG: round2(row.carbs), fatG: round2(row.fat),
    fiberG: row.fiber == null ? null : round2(row.fiber), sodiumMg: null,
  }, item.estimatedGrams);
  const commercial = mergePreservingMealCommercialIdentity(null, null, item);
  return {
    ...values, ...nutrition,
    foodId: null, foodCatalogId: catalogId, source: "catalog",
    sourceMediaStorageKey: null,
    foodSnapshotJson: JSON.stringify({
      kind: "catalog_replacement_nutrition", foodCatalogId: catalogId,
      grams: nutrition.grams,
      calculated: { caloriesKcal: nutrition.caloriesKcal, proteinG: nutrition.proteinG,
        carbG: nutrition.carbG, fatG: nutrition.fatG },
      ...(commercial ? JSON.parse(commercial) as Record<string, unknown> : {}),
    }),
  };
}
