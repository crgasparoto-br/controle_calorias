import { getUserNutritionGoal, upsertNutritionGoal } from "../../db";
import { GoalInput } from "./schemas";

export async function getNutritionGoal(userId: number) {
  return getUserNutritionGoal(userId);
}

export async function updateNutritionGoal(userId: number, input: GoalInput) {
  return upsertNutritionGoal(userId, input);
}
