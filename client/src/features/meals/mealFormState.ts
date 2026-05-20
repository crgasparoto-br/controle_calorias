import { toDateTimeLocalValue } from "@/lib/dateTime";
import { calculateMealTotals } from "../../../../shared/mealTotals";
import type { ManualMealState, MealItemState } from "./types";

export function createEmptyItem(): MealItemState {
  return {
    foodName: "",
    canonicalName: "",
    portionText: "1 porção",
    servings: 1,
    estimatedGrams: 0,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 1,
    source: "heuristic",
  };
}

export function createManualMealState(): ManualMealState {
  return {
    mealId: undefined,
    mealLabel: "almoço",
    occurredAt: toDateTimeLocalValue(),
    notes: "",
    items: [createEmptyItem()],
  };
}

export async function fileToBase64(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function sumItems(items: MealItemState[]) {
  return calculateMealTotals(items);
}
