import { getDb, getUserNutritionGoal, listUserExercisesByDate, upsertNutritionGoal } from "../../db";
import { createDrizzleNutritionGoalsRepository } from "../../repositories/nutritionGoalsRepository";
import type { NutritionGoal } from "../../../drizzle/schema";
import { assessNutritionGoalInput } from "@shared/nutritionSafety";
import type { NutritionGoalSafetyIssue } from "@shared/nutritionSafety";
import { GoalInput } from "./schemas";
import { calculateAdjustedGoalCalories } from "../../../shared/reportsGoalAnalytics";
import { sumExercises } from "../exercises/store";
import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "../../../shared/timeZone";
import {
  getProfessionalGoalWeek,
  hasProfessionalGoalControl,
  ProfessionalGoalControlError,
} from "../professionals/officialGoalsService";

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

const inFlightGoalRowsByUserId = new Map<number, Promise<NutritionGoal[] | null>>();

function todayDateKey(timeZone = DEFAULT_APP_TIME_ZONE) {
  return getDateKeyInTimeZone(new Date(), timeZone);
}

function startOfUtcDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function logicalUtcDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
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
    includeExerciseCalories: input.includeExerciseCalories,
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
      includeExerciseCalories: input.includeExerciseCalories,
      effectiveFrom: exceptionEffectiveFrom,
      effectiveUntil: buildExceptionEndDate(exceptionEffectiveFrom, exception.durationType),
      createdAt: now,
      updatedAt: now,
    };
  });
}

function hasSameGoalTargets(row: NutritionGoal, target: GoalInput["defaultGoal"], includeExerciseCalories: boolean) {
  return row.calories === target.calories
    && row.proteinGrams === target.proteinGrams
    && row.carbsGrams === target.carbsGrams
    && row.fatGrams === target.fatGrams
    && row.includeExerciseCalories === includeExerciseCalories;
}

function hasSameExceptionVersion(row: NutritionGoal, version: NutritionGoal) {
  return row.ruleType === "exception"
    && version.ruleType === "exception"
    && row.weekday === version.weekday
    && row.durationType === version.durationType
    && dateKeyFromDate(row.effectiveFrom) === dateKeyFromDate(version.effectiveFrom)
    && hasSameGoalTargets(row, version, version.includeExerciseCalories);
}

function buildVersionRows(userId: number, input: GoalInput, defaultStartDate: string, rows: NutritionGoal[]): NutritionGoal[] {
  const now = new Date();
  const existingDefaultVersion = rows.find(row => row.ruleType === "default" && dateKeyFromDate(row.effectiveFrom) === defaultStartDate);
  const defaultVersionRows = existingDefaultVersion && hasSameGoalTargets(existingDefaultVersion, input.defaultGoal, input.includeExerciseCalories)
    ? []
    : [buildDefaultVersionRow(userId, input, defaultStartDate, now)];
  const exceptionVersionRows = buildExceptionVersionRows(userId, input, defaultStartDate, now)
    .filter(version => !rows.some(row => hasSameExceptionVersion(row, version)));

  return [
    ...defaultVersionRows,
    ...exceptionVersionRows,
  ];
}

function hasZeroLengthVersion(row: NutritionGoal) {
  return Boolean(row.effectiveUntil) && dateKeyFromDate(row.effectiveFrom) === dateKeyFromDate(row.effectiveUntil!);
}

function summarizeDefaultVersions(rows: NutritionGoal[] | null) {
  const seenVersions = new Set<string>();

  return (rows ?? [])
    .filter(row => row.ruleType === "default" && !hasZeroLengthVersion(row))
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
    .filter(version => {
      const endDate = version.effectiveUntil ? dateKeyFromDate(version.effectiveUntil) : "current";
      const key = [
        version.startDate,
        endDate,
        version.calories,
        version.proteinGrams,
        version.carbsGrams,
        version.fatGrams,
      ].join(":");

      if (seenVersions.has(key)) return false;
      seenVersions.add(key);
      return true;
    })
    .sort((first, second) => {
      const firstHasEndDate = Boolean(first.effectiveUntil);
      const secondHasEndDate = Boolean(second.effectiveUntil);

      if (firstHasEndDate !== secondHasEndDate) {
        return firstHasEndDate ? 1 : -1;
      }

      return second.startDate.localeCompare(first.startDate);
    });
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

type GoalRowsContext = {
  rows: NutritionGoal[] | null;
  versions: ReturnType<typeof summarizeDefaultVersions>;
  exceptionVersions: ReturnType<typeof summarizeExceptionVersions>;
};

const inFlightGoalContextByUserId = new Map<number, Promise<GoalRowsContext>>();

function buildGoalRowsContext(rows: NutritionGoal[] | null): GoalRowsContext {
  return {
    rows,
    versions: summarizeDefaultVersions(rows),
    exceptionVersions: summarizeExceptionVersions(rows),
  };
}

function findConflictingExceptionVersion(_rows: NutritionGoal[], versionRows: NutritionGoal[]) {
  const seenVersions = new Set<string>();

  return versionRows.find(version => {
    if (version.ruleType !== "exception") {
      return false;
    }

    const key = `${version.weekday}:${dateKeyFromDate(version.effectiveFrom)}`;
    if (seenVersions.has(key)) {
      return true;
    }

    seenVersions.add(key);
    return false;
  });
}

function isActiveOnDate(row: NutritionGoal, date: Date) {
  const dateStartTime = startOfUtcDate(dateKeyFromDate(date)).getTime();
  const dateEndTime = dateStartTime + 86_400_000;
  const startTime = new Date(row.effectiveFrom).getTime();
  const endTime = row.effectiveUntil ? new Date(row.effectiveUntil).getTime() : Number.POSITIVE_INFINITY;
  return startTime < dateEndTime && endTime > dateStartTime;
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
  const maybeDays = Array.from({ length: 7 }).map((_, index) => {
    const current = new Date(monday);
    current.setUTCDate(monday.getUTCDate() + index);
    return buildGoalDayView(rows, userId, current);
  });
  const days = maybeDays.filter((day): day is NonNullable<(typeof maybeDays)[number]> => Boolean(day));
  const today = buildGoalDayView(rows, userId, referenceDate) ?? days[0];
  const defaultGoal = resolveDefaultGoalForDate(rows, referenceDate) ?? rows.find(row => row.ruleType === "default");
  const currentTime = referenceDate.getTime();
  const activeException = resolveExceptionForDate(rows, referenceDate);
  const exceptions = rows
    .filter(row => row.ruleType === "exception" && (!row.effectiveUntil || new Date(row.effectiveUntil).getTime() > currentTime))
    .sort(sortByEffectiveDateDesc)
    .map(rule => ({
      ...rule,
      label: WEEKDAY_META[rule.weekday]?.label ?? "Dia",
      shortLabel: WEEKDAY_META[rule.weekday]?.shortLabel ?? "dia",
      isActive: activeException?.id === rule.id,
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
  const current = inFlightGoalRowsByUserId.get(userId);
  if (current) {
    return current;
  }

  const request = nutritionGoalsRepository.findByUserId(userId)
    .finally(() => {
      inFlightGoalRowsByUserId.delete(userId);
    });
  inFlightGoalRowsByUserId.set(userId, request);
  return request;
}

async function listGoalContext(userId: number) {
  const current = inFlightGoalContextByUserId.get(userId);
  if (current) {
    return current;
  }

  const request = listGoalRows(userId)
    .then(buildGoalRowsContext)
    .finally(() => {
      inFlightGoalContextByUserId.delete(userId);
    });
  inFlightGoalContextByUserId.set(userId, request);
  return request;
}

async function getPersonalNutritionGoal(userId: number) {
  const [goal, context] = await Promise.all([
    getUserNutritionGoal(userId),
    listGoalContext(userId),
  ]);
  const assessment = assessNutritionGoalInput({
    defaultGoal: goal.defaultGoal,
    exceptions: goal.exceptions,
  });

  const personal = {
    ...goal,
    startDate: dateKeyFromDate(goal.defaultGoal.effectiveFrom),
    versions: context.versions,
    exceptionVersions: context.exceptionVersions,
    safetyWarnings: assessment.warnings,
    goalOrigin: context.rows?.length ? "personal" as const : "system_estimate" as const,
    professionalControlActive: false,
  };
  return personal;
}

export async function getNutritionGoal(userId: number) {
  const [personal, professionalControlActive] = await Promise.all([
    getPersonalNutritionGoal(userId),
    hasProfessionalGoalControl(userId),
  ]);
  personal.professionalControlActive = professionalControlActive;
  const professional = await getProfessionalGoalWeek(userId, todayDateKey());
  return professional ? mergeProfessionalGoalWeek(personal, professional) : personal;
}

function mergeProfessionalGoalWeek<TPersonal extends {
  today: unknown;
  goalOrigin: "personal" | "system_estimate";
  days: Array<{ weekday: number; calories: number; proteinGrams: number; carbsGrams: number; fatGrams: number }>;
}>(personal: TPersonal, professional: NonNullable<Awaited<ReturnType<typeof getProfessionalGoalWeek>>>) {
  const professionalByWeekday = new Map(professional.days.map(day => [day.weekday, day]));
  const days = personal.days.map(day => professionalByWeekday.get(day.weekday) ?? { ...day, goalOrigin: personal.goalOrigin });
  return {
    ...personal,
    ...professional,
    days,
    today: professional.today ?? personal.today,
    weeklyTotals: days.reduce((total, day) => ({
      calories: total.calories + day.calories,
      proteinGrams: total.proteinGrams + day.proteinGrams,
      carbsGrams: total.carbsGrams + day.carbsGrams,
      fatGrams: total.fatGrams + day.fatGrams,
    }), { calories: 0, proteinGrams: 0, carbsGrams: 0, fatGrams: 0 }),
  };
}

export async function getNutritionGoalForDate(userId: number, date: string) {
  const context = await listGoalContext(userId);
  const { rows } = context;
  if (!rows?.length) {
    const goal = await getPersonalNutritionGoal(userId);
    const weekday = getUtcWeekdayIndex(logicalUtcDate(date));
    const today = goal.days.find(day => day.weekday === weekday) ?? goal.today;

    const personal = {
      ...goal,
      today,
      goalOrigin: "system_estimate" as const,
      professionalControlActive: false,
    };
    const professional = await getProfessionalGoalWeek(userId, date);
    if (!professional) personal.professionalControlActive = await hasProfessionalGoalControl(userId);
    return professional ? mergeProfessionalGoalWeek(personal, professional) : personal;
  }

  const goal = buildGoalSummaryForReferenceDate(rows, userId, logicalUtcDate(date));
  if (!goal) {
    const personal = await getPersonalNutritionGoal(userId);
    const professional = await getProfessionalGoalWeek(userId, date);
    if (!professional) personal.professionalControlActive = await hasProfessionalGoalControl(userId);
    return professional ? mergeProfessionalGoalWeek(personal, professional) : personal;
  }

  const assessment = assessNutritionGoalInput({
    defaultGoal: goal.defaultGoal,
    exceptions: goal.exceptions,
  });

  const personal = {
    ...goal,
    startDate: dateKeyFromDate(goal.defaultGoal.effectiveFrom),
    versions: context.versions,
    exceptionVersions: context.exceptionVersions,
    safetyWarnings: assessment.warnings,
    goalOrigin: "personal" as const,
    professionalControlActive: false,
  };
  const professional = await getProfessionalGoalWeek(userId, date);
  if (!professional) personal.professionalControlActive = await hasProfessionalGoalControl(userId);
  return professional ? mergeProfessionalGoalWeek(personal, professional) : personal;
}

export async function updateNutritionGoal(userId: number, input: GoalInput, timeZone = DEFAULT_APP_TIME_ZONE) {
  if (await hasProfessionalGoalControl(userId)) {
    throw new ProfessionalGoalControlError("Sua meta oficial está sob acompanhamento profissional. Você pode solicitar uma revisão sem alterar o plano vigente.");
  }
  const assessment = assessNutritionGoalInput(input);
  if (assessment.blockers.length) {
    throw new UnsafeNutritionGoalError(assessment.blockers);
  }

  const startDate = input.startDate ?? todayDateKey(timeZone);
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
  const savedContext = await listGoalContext(userId);
  const savedAssessment = assessNutritionGoalInput({
    defaultGoal: goal.defaultGoal,
    exceptions: goal.exceptions,
  });

  return {
    ...goal,
    startDate: dateKeyFromDate(goal.defaultGoal.effectiveFrom),
    versions: savedContext.versions,
    exceptionVersions: savedContext.exceptionVersions,
    safetyWarnings: savedAssessment.warnings,
  };
}


async function resolveAppliedGoalForDate(userId: number, dateKey: string) {
  return (await getNutritionGoalForDate(userId, dateKey)).today;
}

async function listExercisesForGoalDate(userId: number, dateKey: string, timeZone: string) {
  try {
    return (await listUserExercisesByDate(userId, dateKey, timeZone)) ?? [];
  } catch {
    return [];
  }
}

export async function getEffectiveNutritionGoalForDate(
  userId: number,
  dateKey: string,
  timeZone = DEFAULT_APP_TIME_ZONE,
) {
  const [appliedGoal, exercises] = await Promise.all([
    resolveAppliedGoalForDate(userId, dateKey),
    listExercisesForGoalDate(userId, dateKey, timeZone),
  ]);
  const exerciseCalories = Math.max(0, sumExercises(exercises));
  const effectiveGoalCalories = calculateAdjustedGoalCalories(
    appliedGoal.calories,
    exerciseCalories,
    appliedGoal.includeExerciseCalories,
  );
  return {
    effectiveGoalCalories,
    exerciseCalories,
    includeExerciseCalories: appliedGoal.includeExerciseCalories,
    appliedGoal,
  };
}
