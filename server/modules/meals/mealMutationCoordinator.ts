import type { MealDraftItem } from "../../nutritionEngine";
import type { UserLearnedHouseholdMeasureInput } from "../../householdMeasureResolutionPersistence";
import { attachMealMutationPreImage } from "./mealMutationToken";
import { MEAL_UPDATE_SERVICE_OPTIONS } from "./mealUpdateOptions";
import type { MealItemWithNutritionSnapshot } from "./nutritionSnapshot";
import type { UpdateMealInput } from "./schemas";

export type UpdateMealServiceOptions = {
  recordCatalogUsage?: boolean;
  updateHabits?: boolean;
  logEvent?: boolean;
  expectedPreImage?: string;
  finalizeBatch?: {
    meals: Array<{ items: MealItemWithNutritionSnapshot[] }>;
    recordCatalogUsage?: boolean;
    throwOnHabitFailure?: boolean;
  };
};

type CoordinatorDeps = {
  prepareMealItemsForSave: (
    userId: number,
    items: MealDraftItem[],
    options?: { recordUsage?: boolean }
  ) => Promise<MealItemWithNutritionSnapshot[]>;
  updateUserMeal: (input: any, options: any) => Promise<any>;
  updateUserMealItem: (input: any) => Promise<any>;
  moveUserMealItem: (input: any) => Promise<any>;
  decorateMealWithImageUrl: (meal: any) => any;
  recordMealItemsCatalogUsage: (
    userId: number,
    items: MealItemWithNutritionSnapshot[]
  ) => Promise<void>;
  rebuildUserMealHabits: (userId: number) => Promise<unknown>;
  logPersistenceWarning: (scope: string, error: unknown) => void;
  updateMealAndHouseholdMeasureLearning: (
    input: any
  ) => Promise<any>;
  buildUserLearnedHouseholdMeasurePreference: (
    relation: UserLearnedHouseholdMeasureInput
  ) => unknown;
  ensureCurrentIrreversibleEffectAllowed: () => Promise<void>;
  clearMealItemSourceMedia: (item: MealDraftItem) => MealDraftItem;
};

type MealMutationCoordinator = {
  updateMeal: (userId: number, input: UpdateMealInput) => Promise<any>;
  updateMealItem: (userId: number, input: any) => Promise<any>;
  moveMealItem: (userId: number, input: any) => Promise<any>;
  updateMealWithHouseholdMeasureLearning: (
    userId: number,
    input: UpdateMealInput,
    learning: {
      expectedOriginalItem: MealDraftItem;
      relation: UserLearnedHouseholdMeasureInput;
    }
  ) => Promise<any>;
};

export function createMealMutationCoordinator(
  deps: CoordinatorDeps
): MealMutationCoordinator {
  async function updateMeal(userId: number, input: UpdateMealInput) {
    await deps.ensureCurrentIrreversibleEffectAllowed();
    const options =
      (
        input as UpdateMealInput & {
          [MEAL_UPDATE_SERVICE_OPTIONS]?: UpdateMealServiceOptions;
        }
      )[MEAL_UPDATE_SERVICE_OPTIONS] ?? {};
    const items = await deps.prepareMealItemsForSave(userId, input.items, {
      recordUsage: options.recordCatalogUsage !== false,
    });
    await deps.ensureCurrentIrreversibleEffectAllowed();
    const updatedMeal = await deps.updateUserMeal(
      {
        userId,
        mealId: input.mealId,
        mealLabel: input.mealLabel,
        occurredAt: input.occurredAt,
        notes: input.notes,
        items,
      },
      {
        updateHabits: options.updateHabits !== false,
        logEvent: options.logEvent !== false,
        expectedPreImage: options.expectedPreImage,
      }
    );
    const mutationPreImage = updatedMeal.mutationPreImage;
    const publicMeal = { ...updatedMeal };
    delete publicMeal.mutationPreImage;
    const meal = deps.decorateMealWithImageUrl(
      attachMealMutationPreImage(publicMeal, mutationPreImage)
    );

    if (options.finalizeBatch) {
      if (options.finalizeBatch.recordCatalogUsage !== false) {
        try {
          for (const batchMeal of options.finalizeBatch.meals) {
            await deps.recordMealItemsCatalogUsage(userId, batchMeal.items);
          }
        } catch (error) {
          deps.logPersistenceWarning(
            "Meal batch catalog usage finalization skipped",
            error
          );
        }
      }
      try {
        await deps.rebuildUserMealHabits(userId);
      } catch (error) {
        deps.logPersistenceWarning("Meal batch habit rebuild skipped", error);
        if (options.finalizeBatch.throwOnHabitFailure) throw error;
      }
    }
    return meal;
  }

  async function updateMealItem(userId: number, input: any) {
    await deps.ensureCurrentIrreversibleEffectAllowed();
    const [preparedItem] = await deps.prepareMealItemsForSave(
      userId,
      [input.item],
      { recordUsage: true }
    );
    await deps.ensureCurrentIrreversibleEffectAllowed();
    const meal = await deps.updateUserMealItem({
      userId,
      sourceMeal: input.sourceMeal,
      itemIndex: input.itemIndex,
      updatedItem: preparedItem,
      mealLabel: input.targetMealLabel,
      occurredAt: input.occurredAt,
    });
    return deps.decorateMealWithImageUrl(meal);
  }

  async function moveMealItem(userId: number, input: any) {
    await deps.ensureCurrentIrreversibleEffectAllowed();
    const [preparedItem] = await deps.prepareMealItemsForSave(
      userId,
      [deps.clearMealItemSourceMedia(input.item)],
      { recordUsage: true }
    );
    await deps.ensureCurrentIrreversibleEffectAllowed();
    const persisted = await deps.moveUserMealItem({
      userId,
      sourceMeal: input.sourceMeal,
      itemIndex: input.itemIndex,
      updatedItem: preparedItem,
      targetMealLabel: input.targetMealLabel,
      occurredAt: input.occurredAt,
    });
    if (!persisted) {
      throw new Error("Não foi possível confirmar a movimentação da refeição.");
    }
    return {
      moved: true,
      meal: deps.decorateMealWithImageUrl(persisted.meal),
      sourceMeal: deps.decorateMealWithImageUrl(persisted.sourceMeal),
    };
  }

  async function updateMealWithHouseholdMeasureLearning(
    userId: number,
    input: UpdateMealInput,
    learning: {
      expectedOriginalItem: MealDraftItem;
      relation: UserLearnedHouseholdMeasureInput;
    }
  ) {
    if (learning.relation.userId !== userId) {
      throw new Error(
        "Household measure learning user must match the authenticated user."
      );
    }
    if (!deps.buildUserLearnedHouseholdMeasurePreference(learning.relation)) {
      return updateMeal(userId, input);
    }
    await deps.ensureCurrentIrreversibleEffectAllowed();
    const items = await deps.prepareMealItemsForSave(userId, input.items);
    await deps.ensureCurrentIrreversibleEffectAllowed();
    return deps.decorateMealWithImageUrl(
      await deps.updateMealAndHouseholdMeasureLearning({
        userId,
        mealId: input.mealId,
        mealLabel: input.mealLabel,
        occurredAt: input.occurredAt,
        notes: input.notes,
        items,
        expectedOriginalItem: learning.expectedOriginalItem,
        learning: learning.relation,
      })
    );
  }

  return {
    updateMeal,
    updateMealItem,
    moveMealItem,
    updateMealWithHouseholdMeasureLearning,
  };
}
