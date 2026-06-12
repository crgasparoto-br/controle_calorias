import { getDb, getUserNutritionGoal, upsertNutritionGoal } from "../../db";
import { createDrizzleNutritionGoalsRepository } from "../../repositories/nutritionGoalsRepository";
import type { NutritionGoal } from "../../../drizzle/schema";
import { assessNutritionGoalInput } from "@shared/nutritionSafety";
import type { NutritionGoalSafetyIssue } from "@shared/nutritionSafety";
import { GoalInput } from "./schemas";

type GoalValidationIssue = NutritionGoalSafetyIssue | {
  code: "conflicting_goal_version" | "conflicting_goal_exception_version";
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

export class ConflictingNutritionGoalExceptionVersionError extends UnsafeNutritionGoalError {
  constructor(weekdayLabel: string, startDate: string) {
    super([
      {
        code: "conflicting_goal_exception_version",
        severity: "block",
        targetLabel: weekdayLabel,
        message: `Já existe uma exceção para ${weekdayLabel} iniciando em ${startDate}. Escolha outra data de início.`,
      },
    ]);
    this.name = "ConflictingNutritionGoalExceptionVersionError";
  }
}

const DEFAULT_GOAL_WEEKDAY = -1;

const WEEKDAY_LABELS = [
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
  "domingo",
] as const;

const WEEKDAY_META = [
  { weekday: 0, label: "Segunda-feira", shortLabel: "seg." },
  { weekday: 1, label: "Terça-feira", shortLabel: "ter." },
  { weekday: 2, label: "Quarta-feira", shortLabel: "qua." },
  { weekday: 3, label: "Quinta-feira", shortLabel: "qui." },
  { weekday: 4, label: "Sexta-feira", shortLabel: "sex." },
  { weekday: 5, label: "Sábado", shortLabel: "sáb." },
  { weekday: 6, label: "Domingo", shortLabel: "dom." },
] as const;

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

function logicalUtcDate(dateKey: string) {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

function dateKeyFromDate(value: Date | string | number) {
  return new Date(value).toISOString().slice(0, 10);
}

function getUtcWeekdayIndex(date: Date) {
  return (date.getUTCDay() + 6) % 7;
}

function startOfUtcWeek(date: Date) {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() - getUtcWeekdayIndex(value));
  return value;
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

function buildDefaultVersionRow(userId: number, input: GoalInput, startDate: string, now: Date): NutritionGoal {
  return {
    id: 0,
    userId,
    ruleType: "default",
    weekday: DEFAULT_GOAL_WEEKDAY,
    durationType: "always",
    calories: input.defaultGoal.calories,
    proteinGrams: input.defaultGoal.proteinGrams,
    carbsGrams: input.defaultGoal.carbsGrams,
    fatGrams: input.defaultGoal.fatGrams,
    effectiveFrom: startOfUtcDate(startDate),
    effectiveUntil: null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildExceptionVersionRows(userId: number, input: GoalInput, defaultStartDate: string, now: Date): NutritionGoal[] {
  return input.exceptions.map(exception => {
    const exceptionEffectiveFrom = startOfUtcDate(exception.startDate ?? defaultStartDate);

    return {
      id: 0,
      userId,
      ruleType: "exception" as const,
      weekday: exception.weekday,
      durationType: exception.durationType,
      calories: exception.calories,
      proteinGrams: exception.proteinGrams,
      carbsGrams: exception.carbsGrams,
      fatGrams: exception.fatGrams,
      effectiveFrom: exceptionEffectiveFrom,
      effectiveUntil: buildExceptionEndDate(exceptionEffectiveFrom, exception.durationType),
      createdAt: now,
      updatedAt: now,
    };
  });
}

function hasSameGoalTargets(row: NutritionGoal, target: GoalInput["defaultGoal"]) {
  return row.calories === target.calories
    && row.proteinGrams === target.proteinGrams
    && row.carbsGrams === target.carbsGrams
    && row.fatGrams === target.fatGrams;
}

function hasSameExceptionVersion(row: NutritionGoal, version: NutritionGoal) {
  return row.ruleType === "exception"
    && version.ruleType === "exception"
    && row.weekday === version.weekday
    && row.durationType === version.durationType
    && dateKeyFromDate(row.effectiveFrom) === dateKeyFromDate(version.effectiveFrom)
    && hasSameGoalTargets(row, version);
}

function buildVersionRows(userId: number, input: GoalInput, defaultStartDate: string, rows: NutritionGoal[]): NutritionGoal[] {
  const now = new Date();
  const existingDefaultVersion = rows.find(row => row.ruleType === "default" && dateKeyFromDate(row.effectiveFrom) === defaultStartDate);
  const defaultVersionRows = existingDefaultVersion && hasSameGoalTargets(existingDefaultVersion, input.defaultGoal)
    ? []
    : [buildDefaultVersionRow(userId, input, defaultStartDate, now)];
  const exceptionVersionRows = buildExceptionVersionRows(userId, input, defaultStartDate, now)
    .filter(version => !rows.some(row => hasSameExceptionVersion(row, version)));

  return [
    ...defaultVersionRows,
    ...exceptionVersionRows,
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

function summarizeExceptionVersions(rows: NutritionGoal[] | null) {
  return (rows ?? [])
    .filter(row => row.ruleType === "exception")
    .map(row => ({
      id: row.id,
      weekday: row.weekday,
      label: WEEKDAY_LABELS[row.weekday] ?? "dia",
      startDate: dateKeyFromDate(row.effectiveFrom),
      durationType: row.durationType,
      effectiveFrom: row.effectiveFrom,
      effectiveUntil: row.effectiveUntil,
      calories: row.calories,
      proteinGrams: row.proteinGrams,
      carbsGrams: row.carbsGrams,
      fatGrams: row.fatGrams,
      isCurrent: !row.effectiveUntil || new Date(row.effectiveUntil).getTime() > Date.now(),
    }))
    .sort((first, second) => second.startDate.localeCompare(first.startDate) || first.weekday - second.weekday);
}

function findDefaultVersionOnStartDate(rows: NutritionGoal[], startDate: string) {
  return rows.find(row => row.ruleType === "default" && dateKeyFromDate(row.effectiveFrom) === startDate);
}

function findConflictingExceptionVersion(rows: NutritionGoal[], versionRows: NutritionGoal[]) {
  return versionRows.find(version => version.ruleType === "exception" && rows.some(row => (
    row.ruleType === "exception"
    && row.weekday === version.weekday
    && dateKeyFromDate(row.effectiveFrom) === dateKeyFromDate(version.effectiveFrom)
  )));
}

function isActiveOnDate(row: NutritionGoal, date: Date) {
  const dateTime = date.getTime();
  const startTime = new Date(row.effectiveFrom).getTime();
  const endTime = row.effectiveUntil ? new Date(row.effectiveUntil).getTime() : Number.POSITIVE_INFINITY;
  return startTime <= dateTime && dateTime < endTime;
}

function sortByEffectiveDateDesc(first: NutritionGoal, second: NutritionGoal) {
  const effectiveDiff = new Date(second.effectiveFrom).getTime() - new Date(first.effectiveFrom).getTime();
  if (effectiveDiff !== 0) return effectiveDiff;
  return new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
}

function resolveDefaultGoalForDate(rows: NutritionGoal[], date: Date) {
  const defaultRows = rows.filter(row => row.ruleType === "default");
  return defaultRows
    .filter(row => isActiveOnDate(row, date))
    .sort(sortByEffectiveDateDesc)[0]
    ?? defaultRows.slice().sort((first, second) => new Date(first.effectiveFrom).getTime() - new Date(second.effectiveFrom).getTime())[0]
    ?? null;
}

function resolveExceptionForDate(rows: NutritionGoal[], date: Date) {
  const weekday = getUtcWeekdayIndex(date);
  return rows
    .filter(row => row.ruleType === "exception" && row.weekday === weekday && isActiveOnDate(row, date))
    .sort(sortByEffectiveDateDesc)[0]
    ?? null;
}

function buildGoalDayView(rows: NutritionGoal[], userId: number, date: Date) {
  const defaultGoal = resolveDefaultGoalForDate(rows, date);
  const exception = resolveExceptionForDate(rows, date);
  const applied = exception ?? defaultGoal;
  const weekday = getUtcWeekdayIndex(date);
  const meta = WEEKDAY_META[weekday] ?? { label: "Dia", shortLabel: "dia" };

  if (!applied) {
    return null;
  }

  return {
    ...applied,
    userId,
    weekday,
    label: meta.label,
    shortLabel: meta.shortLabel,
    source: exception ? "exception" as const : "default" as const,
    exceptionId: exception?.id,
  };
}

function buildGoalSummaryForReferenceDate(rows: NutritionGoal[], userId: number, referenceDate: Date) {
  const monday = startOfUtcWeek(referenceDate);
  const days = Array.from({ length: 7 }).map((_, index) => {
    const current = new Date(monday);
    current.setUTCDate(monday.getUTCDate() + index);
    return buildGoalDayView(rows, userId, current);
  }).filter((day): day is NonNullable<typeof day> => Boolean(day));
  const today = buildGoalDayView(rows, userId, referenceDate) ?? days[0];
  const defaultGoal = resolveDefaultGoalForDate(rows, referenceDate) ?? rows.find(row => row.ruleType === "default");
  const currentTime = referenceDate.getTime();
  const exceptions = rows
    .filter(row => row.ruleType === "exception" && (!row.effectiveUntil || new Date(row.effectiveUntil).getTime() > currentTime))
    .sort(sortByEffectiveDateDesc)
    .map(rule => ({
      ...rule,
      label: WEEKDAY_META[rule.weekday]?.label ?? "Dia",
      shortLabel: WEEKDAY_META[rule.weekday]?.shortLabel ?? "dia",
      isActive: resolveExceptionForDate(rows, referenceDate)?.id === rule.id,
    }));

  if (!defaultGoal || !today) {
    return null;
  }

  return {
    defaultGoal,
    exceptions,
    days,
    today,
    weeklyTotals: days.reduce(
      (acc, day) => {
        acc.calories += day.calories;
        acc.proteinGrams += day.proteinGrams;
        acc.carbsGrams += day.carbsGrams;
        acc.fatGrams += day.fatGrams;
        return acc;
      },
      { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 },
    ),
  };
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
    exceptionVersions: summarizeExceptionVersions(rows),
    safetyWarnings: assessment.warnings,
  };
}

export async function getNutritionGoalForDate(userId: number, date: string) {
  const rows = await listGoalRows(userId);
  if (!rows?.length) {
    return getNutritionGoal(userId);
  }

  const goal = buildGoalSummaryForReferenceDate(rows, userId, logicalUtcDate(date));
  if (!goal) {
    return getNutritionGoal(userId);
  }

  const assessment = assessNutritionGoalInput({
    defaultGoal: goal.defaultGoal,
    exceptions: goal.exceptions,
  });

  return {
    ...goal,
    startDate: dateKeyFromDate(goal.defaultGoal.effectiveFrom),
    versions: summarizeDefaultVersions(rows),
    exceptionVersions: summarizeExceptionVersions(rows),
    safetyWarnings: assessment.warnings,
  };
}

export async function updateNutritionGoal(userId: number, input: GoalInput) {
  const assessment = assessNutritionGoalInput(input);
  if (assessment.blockers.length) {
    throw new UnsafeNutritionGoalError(assessment.blockers);
  }

  const startDate = input.startDate ?? todayDateKey();
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
      exceptionVersions: [],
      safetyWarnings: savedAssessment.warnings,
    };
  }

  const defaultVersionOnStartDate = findDefaultVersionOnStartDate(rows, startDate);
  if (defaultVersionOnStartDate && !hasSameGoalTargets(defaultVersionOnStartDate, input.defaultGoal)) {
    throw new ConflictingNutritionGoalVersionError(startDate);
  }

  const versionRows = buildVersionRows(userId, input, startDate, rows);
  const conflictingException = findConflictingExceptionVersion(rows, versionRows);
  if (conflictingException) {
    throw new ConflictingNutritionGoalExceptionVersionError(
      WEEKDAY_LABELS[conflictingException.weekday] ?? "dia",
      dateKeyFromDate(conflictingException.effectiveFrom),
    );
  }

  await nutritionGoalsRepository.createVersionForUser(userId, versionRows, startOfUtcDate(startDate));

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
    exceptionVersions: summarizeExceptionVersions(savedRows),
    safetyWarnings: savedAssessment.warnings,
  };
}
