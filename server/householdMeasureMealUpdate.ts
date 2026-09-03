import { calculateMealTotals } from "../shared/mealTotals";
import { foodCatalogDirectKey } from "./foodCatalogKeys";
import { buildUserLearnedHouseholdMeasurePreference, type UserLearnedHouseholdMeasureInput } from "./householdMeasureResolutionPersistence";
import { getDb, listUserMeals, logInferenceEvent, logPersistenceWarning, rebuildUserMealHabits } from "./dbImplementation";
import type { MealDraftItem } from "./nutritionEngine";
import { createDrizzleMealsRepository } from "./repositories/mealsRepository";

const atomicMealsRepository = createDrizzleMealsRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export class HouseholdMeasureLearningUpdateError extends Error {
  constructor(public readonly code: "stale" | "not_found" | "unsupported") {
    const message = code === "stale"
      ? "A refeição mudou antes de concluir a correção. Tente novamente com o estado atual."
      : code === "not_found"
        ? "Refeição não encontrada para concluir a correção."
        : "Persistência transacional indisponível para concluir a correção com aprendizado.";
    super(message);
    this.name = "HouseholdMeasureLearningUpdateError";
  }
}

function preserveResolvedCatalogIds(items: MealDraftItem[]) {
  const ids = new Map<string, number>();
  for (const item of items) {
    const id = Number(item.foodCatalogId);
    if (!Number.isFinite(id) || id <= 0) continue;
    ids.set(foodCatalogDirectKey(id), id);
    if (item.canonicalName) ids.set(item.canonicalName, id);
    if (item.foodName) ids.set(item.foodName, id);
  }
  return ids;
}

export async function updateMealAndHouseholdMeasureLearning(input: {
  userId: number;
  mealId: number;
  mealLabel: string;
  occurredAt: string;
  notes?: string;
  items: MealDraftItem[];
  expectedOriginalItem: MealDraftItem;
  learning: UserLearnedHouseholdMeasureInput;
}) {
  if (input.learning.userId !== input.userId) {
    throw new Error("Household measure learning user must match the requested user.");
  }

  const builtLearning = buildUserLearnedHouseholdMeasurePreference(input.learning);
  if (!builtLearning) {
    throw new HouseholdMeasureLearningUpdateError("unsupported");
  }

  const current = await listUserMeals(input.userId);
  const existing = current.find(meal => meal.id === input.mealId);
  if (!existing) {
    throw new HouseholdMeasureLearningUpdateError("not_found");
  }

  const persistenceResult = await atomicMealsRepository.persistMealUpdateWithHouseholdMeasureLearning({
    meal: {
      id: existing.id,
      userId: existing.userId,
      mealLabel: input.mealLabel,
      notes: input.notes,
      confidence: existing.confidence,
      occurredAt: new Date(input.occurredAt).getTime(),
    },
    items: input.items,
    expectedOriginalItem: input.expectedOriginalItem,
    resolvedCatalogIds: preserveResolvedCatalogIds(input.items),
    learning: builtLearning,
  });

  if (persistenceResult !== "updated") {
    throw new HouseholdMeasureLearningUpdateError(persistenceResult);
  }

  // Refresh the existing in-process fallback cache from the committed database state.
  const refreshed = await listUserMeals(input.userId);
  const updatedMeal = refreshed.find(meal => meal.id === input.mealId);
  if (!updatedMeal) {
    throw new HouseholdMeasureLearningUpdateError("not_found");
  }

  await rebuildUserMealHabits(input.userId);
  logInferenceEvent({
    userId: input.userId,
    origin: "whatsapp",
    status: "success",
    eventType: "meal.household_measure_learning_updated",
    detail: `Refeição ${updatedMeal.mealLabel} atualizada com aprendizado de medida caseira após revalidação transacional.`,
  });

  return { ...updatedMeal, totals: calculateMealTotals(updatedMeal.items) };
}
