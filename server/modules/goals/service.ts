import { getDb, getUserNutritionGoal, upsertNutritionGoal } from "../../db";
import { createDrizzleNutritionGoalsRepository } from "../../repositories/nutritionGoalsRepository";
import type { NutritionGoal } from "../../../drizzle/schema";
import { assessNutritionGoalInput } from "@shared/nutritionSafety";
import type { NutritionGoalSafetyIssue } from "@shared/nutritionSafety";
import { GoalInput } from "./schemas";

type GoalValidationIssue = NutritionGoalSafetyIssue | {
  code: "conflicting_goal_version";
  severity: "block";
  targetLabel: string;
  message: string;
};

export class UnsafeNutritionGoalError extends Error {
  constructor(public readonly blockers: GoalValidationIssue[]) {
    super(blockers.map(issue => issue.message).join(" "));
    this.name = "UnsafeNutritionGoalError";
  }
}

export class ConflictingNutritionGoalVersionError extends UnsafeNutritionGoalError {
  constructor(startDate: string) {
    super([
      {
        code: "conflicting_goal_version",
        severity: "block",
        targetLabel: "Meta geral",
        message: `Já existe uma versão de meta geral iniciando em ${startDate}. Escolha outra data de início.`,
      },
    ]);
    this.name = "ConflictingNutritionGoalVersionError";
  }
}

const DEFAULT_GOAL_WEEKDAY = -1;

type GoalExceptionDuration = "1_week" | "2_weeks" | "3_weeks" | "always";

const nutritionGoalsRepository = createDrizzleNutritionGoalsRepository({
  getDb,
  onWarning(scope, error) {
    console.warn(`[Goals] ${scope}:`, error);
  },
});

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function startOfUtcDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function dateKeyFromDate(value: Date | string | number) {
  return new Date(value).toISOString().slice(0, 10);
}

function endOfUtcWeek(date: Date) {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  const weekday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - weekday + 6);
  value.setUTCHours(23, 59, 59, 999);
  return value;
}

function buildExceptionEndDate(referenceDate: Date, durationType: GoalExceptionDuration) {
  if (durationType === "always") {
    return null;
  }

  const durationWeeks = durationType === "1_week" ? 1 : durationType === "2_weeks" ? 2 : 3;
  const value = endOfUtcWeek(referenceDate);
  value.setUTCDate(value.getUTCDate() + (durationWeeks - 1) * 7);
  return value;
}

function buildVersionRows(userId: number, input: GoalInput, effectiveFrom: Date): NutritionGoal[] {
  const now = new Date();
  return [
    {
      id: 0,
      userId,
      ruleType: "default",
      weekday: DEFAULT_GOAL_WEEKDAY,
      durationType: "always",
      calories: input.defaultGoal.calories,
      proteinGrams: input.defaultGoal.proteinGrams,
      carbsGrams: input.defaultGoal.carbsGrams,
      fatGrams: input.defaultGoal.fatGrams,
      effectiveFrom,
      effectiveUntil: null,
      createdAt: now,
      updatedAt: now,
    },
    ...input.exceptions.map(exception => ({
      id: 0,
      userId,
      ruleType: "exception" as const,
      weekday: exception.weekday,
      durationType: exception.durationType,
      calories: exception.calories,
      proteinGrams: exception.proteinGrams,
      carbsGrams: exception.carbsGrams,
      fatGrams: exception.fatGrams,
      effectiveFrom,
      effectiveUntil: buildExceptionEndDate(effectiveFrom, exception.durationType),
      createdAt: now,
      updatedAt: now,
    })),
  ];
}

function summarizeDefaultVersions(rows: NutritionGoal[] | null) {
  return (rows ?? [])
    .filter(row => row.ruleType === "default")
    .map(row => ({
      id: row.id,
      startDate: dateKeyFromDate(row.effectiveFrom),
      effectiveFrom: row.effectiveFrom,
      effectiveUntil: row.effectiveUntil,
      calories: row.calories,
      proteinGrams: row.proteinGrams,
      carbsGrams: row.carbsGrams,
      fatGrams: row.fatGrams,
      isCurrent: !row.effectiveUntil || new Date(row.effectiveUntil).getTime() > Date.now(),
    }))
    .sort((first, second) => second.startDate.localeCompare(first.startDate));
}

async function listGoalRows(userId: number) {
  return nutritionGoalsRepository.findByUserId(userId);
}

export async function getNutritionGoal(userId: number) {
  const [goal, rows] = await Promise.all([
    getUserNutritionGoal(userId),
    listGoalRows(userId),
  ]);
  const assessment = assessNutritionGoalInput({
    defaultGoal: goal.defaultGoal,
    exceptions: goal.exceptions,
  });

  return {
    ...goal,
    startDate: dateKeyFromDate(goal.defaultGoal.effectiveFrom),
    versions: summarizeDefaultVersions(rows),
    safetyWarnings: assessment.warnings,
  };
}

export async function updateNutritionGoal(userId: number, input: GoalInput) {
  const assessment = assessNutritionGoalInput(input);
  if (assessment.blockers.length) {
    throw new UnsafeNutritionGoalError(assessment.blockers);
  }

  const startDate = input.startDate ?? todayDateKey();
  const effectiveFrom = startOfUtcDate(startDate);
  const rows = await listGoalRows(userId);

  if (!rows) {
    const goal = await upsertNutritionGoal(userId, input);
    const savedAssessment = assessNutritionGoalInput({
      defaultGoal: goal.defaultGoal,
      exceptions: goal.exceptions,
    });

    return {
      ...goal,
      startDate: dateKeyFromDate(goal.defaultGoal.effectiveFrom),
      versions: [],
      safetyWarnings: savedAssessment.warnings,
    };
  }

  const hasDefaultVersionOnStartDate = rows.some(row => (
    row.ruleType === "default" && dateKeyFromDate(row.effectiveFrom) === startDate
  ));
  if (hasDefaultVersionOnStartDate) {
    throw new ConflictingNutritionGoalVersionError(startDate);
  }

  const versionRows = buildVersionRows(userId, input, effectiveFrom);
  await nutritionGoalsRepository.createVersionForUser(userId, versionRows, effectiveFrom);

  const goal = await getUserNutritionGoal(userId);
  const savedRows = await listGoalRows(userId);
  const savedAssessment = assessNutritionGoalInput({
    defaultGoal: goal.defaultGoal,
    exceptions: goal.exceptions,
  });

  return {
    ...goal,
    startDate: dateKeyFromDate(goal.defaultGoal.effectiveFrom),
    versions: summarizeDefaultVersions(savedRows),
    safetyWarnings: savedAssessment.warnings,
  };
}
