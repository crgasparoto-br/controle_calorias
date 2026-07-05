import type { MealDraftItem } from "../../nutritionEngine";
import { resolveWhatsAppMealConsolidationTarget, type WhatsAppMealConsolidationCandidate } from "./mealConsolidation";

export type WhatsAppConsolidationSavedMeal = WhatsAppMealConsolidationCandidate & {
  userId: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string;
  items: MealDraftItem[];
};

export type WhatsAppMealConsolidationServiceDeps = {
  listUserMeals: (userId: number) => Promise<WhatsAppConsolidationSavedMeal[]>;
  updateUserMeal: (input: {
    userId: number;
    mealId: number;
    mealLabel: string;
    occurredAt: string;
    notes?: string;
    items: MealDraftItem[];
  }) => Promise<WhatsAppConsolidationSavedMeal>;
  removeUserMeal: (userId: number, mealId: number) => Promise<unknown>;
};

export type WhatsAppMealConsolidationServiceResult =
  | { action: "created"; meal: WhatsAppConsolidationSavedMeal }
  | { action: "updated"; meal: WhatsAppConsolidationSavedMeal; appendedMealId: number }
  | { action: "ambiguous"; meal: WhatsAppConsolidationSavedMeal; candidates: WhatsAppConsolidationSavedMeal[] };

function toOccurredAtIso(value: number | string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export async function consolidateWhatsAppMealAfterSave(
  deps: WhatsAppMealConsolidationServiceDeps,
  savedMeal: WhatsAppConsolidationSavedMeal,
): Promise<WhatsAppMealConsolidationServiceResult> {
  const meals = await deps.listUserMeals(savedMeal.userId);
  const target = resolveWhatsAppMealConsolidationTarget({
    savedMealId: savedMeal.id,
    mealLabel: savedMeal.mealLabel,
    occurredAt: savedMeal.occurredAt,
    meals,
  });

  if (target.action === "create") {
    return { action: "created", meal: savedMeal };
  }

  if (target.action === "ambiguous") {
    return { action: "ambiguous", meal: savedMeal, candidates: target.meals as WhatsAppConsolidationSavedMeal[] };
  }

  const existingMeal = target.meal as WhatsAppConsolidationSavedMeal;
  const updatedMeal = await deps.updateUserMeal({
    userId: savedMeal.userId,
    mealId: existingMeal.id,
    mealLabel: existingMeal.mealLabel,
    occurredAt: toOccurredAtIso(existingMeal.occurredAt),
    notes: existingMeal.notes,
    items: [...existingMeal.items, ...savedMeal.items],
  });

  await deps.removeUserMeal(savedMeal.userId, savedMeal.id);

  return {
    action: "updated",
    meal: updatedMeal,
    appendedMealId: savedMeal.id,
  };
}
