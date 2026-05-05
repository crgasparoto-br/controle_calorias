import { getUserNutritionGoal, upsertNutritionGoal } from "../../db";
import { assessNutritionGoalInput } from "@shared/nutritionSafety";
import type { NutritionGoalSafetyIssue } from "@shared/nutritionSafety";
import { GoalInput } from "./schemas";

export class UnsafeNutritionGoalError extends Error {
  constructor(public readonly blockers: NutritionGoalSafetyIssue[]) {
    super(blockers.map(issue => issue.message).join(" "));
    this.name = "UnsafeNutritionGoalError";
  }
}

export async function getNutritionGoal(userId: number) {
  const goal = await getUserNutritionGoal(userId);
  const assessment = assessNutritionGoalInput({
    defaultGoal: goal.defaultGoal,
    exceptions: goal.exceptions,
  });

  return {
    ...goal,
    safetyWarnings: assessment.warnings,
  };
}

export async function updateNutritionGoal(userId: number, input: GoalInput) {
  const assessment = assessNutritionGoalInput(input);
  if (assessment.blockers.length) {
    throw new UnsafeNutritionGoalError(assessment.blockers);
  }

  const goal = await upsertNutritionGoal(userId, input);
  const savedAssessment = assessNutritionGoalInput({
    defaultGoal: goal.defaultGoal,
    exceptions: goal.exceptions,
  });

  return {
    ...goal,
    safetyWarnings: savedAssessment.warnings,
  };
}
