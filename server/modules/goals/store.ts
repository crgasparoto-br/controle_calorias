import type { NutritionGoal } from "../../../drizzle/schema";
import { canUseMemoryPersistenceFallback } from "../../repositories/memoryFallback";
import type { NutritionGoalsRepository } from "../../repositories/nutritionGoalsRepository";
import type { GoalInput } from "./schemas";

export type { GoalInput } from "./schemas";

type GoalExceptionDuration = "1_week" | "2_weeks" | "3_weeks" | "always";

type GoalDayView = NutritionGoal & {
  label: string;
  shortLabel: string;
  source: "default" | "exception";
  exceptionId?: number;
};

type GoalExceptionView = NutritionGoal & {
  label: string;
  shortLabel: string;
  isActive: boolean;
};

export type GoalSummary = {
  defaultGoal: NutritionGoal;
  exceptions: GoalExceptionView[];
  days: GoalDayView[];
  today: GoalDayView;
  weeklyTotals: {
    calories: number;
    proteinGrams: number;
    carbsGrams: number;
    fatGrams: number;
  };
};

const DEFAULT_GOAL_WEEKDAY = -1;

const WEEKDAY_META = [
  { weekday: 0, label: "Segunda-feira", shortLabel: "seg." },
  { weekday: 1, label: "Terça-feira", shortLabel: "ter." },
  { weekday: 2, label: "Quarta-feira", shortLabel: "qua." },
  { weekday: 3, label: "Quinta-feira", shortLabel: "qui." },
  { weekday: 4, label: "Sexta-feira", shortLabel: "sex." },
  { weekday: 5, label: "Sábado", shortLabel: "sáb." },
  { weekday: 6, label: "Domingo", shortLabel: "dom." },
] as const;

function getWeekdayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function startOfWeek(date: Date) {
  const value = startOfDay(date);
  value.setDate(value.getDate() - getWeekdayIndex(value));
  return value;
}

function endOfWeek(date: Date) {
  const value = startOfWeek(date);
  value.setDate(value.getDate() + 6);
  value.setHours(23, 59, 59, 999);
  return value;
}

function buildExceptionEndDate(referenceDate: Date, durationType: GoalExceptionDuration) {
  if (durationType === "always") {
    return null;
  }

  const durationWeeks = durationType === "1_week" ? 1 : durationType === "2_weeks" ? 2 : 3;
  const value = endOfWeek(referenceDate);
  value.setDate(value.getDate() + (durationWeeks - 1) * 7);
  return value;
}

function isDefaultGoalActiveOnDate(rule: NutritionGoal, date: Date) {
  if (rule.ruleType !== "default") {
    return false;
  }

  const currentTime = date.getTime();
  const startTime = new Date(rule.effectiveFrom).getTime();
  const endTime = rule.effectiveUntil ? new Date(rule.effectiveUntil).getTime() : Number.POSITIVE_INFINITY;
  return currentTime >= startTime && currentTime <= endTime;
}

function getDefaultGoalRule(userId: number, rows: NutritionGoal[], referenceDate = new Date(), createDefaultGoal: (userId: number) => NutritionGoal) {
  return rows
    .filter(row => isDefaultGoalActiveOnDate(row, referenceDate))
    .sort((a, b) => {
      if (!a.effectiveUntil && b.effectiveUntil) return -1;
      if (a.effectiveUntil && !b.effectiveUntil) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })[0] ?? createDefaultGoal(userId);
}

function getExceptionRules(rows: NutritionGoal[]) {
  return rows
    .filter(row => row.ruleType === "exception")
    .slice()
    .sort((a, b) => {
      const updatedDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (updatedDiff !== 0) return updatedDiff;
      return new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime();
    });
}

function isExceptionActiveOnDate(rule: NutritionGoal, date: Date) {
  if (rule.ruleType !== "exception") {
    return false;
  }

  if (rule.weekday !== getWeekdayIndex(date)) {
    return false;
  }

  const currentWeek = startOfWeek(date).getTime();
  const startWeek = startOfWeek(new Date(rule.effectiveFrom)).getTime();
  const endTime = rule.effectiveUntil ? new Date(rule.effectiveUntil).getTime() : Number.POSITIVE_INFINITY;
  return currentWeek >= startWeek && date.getTime() < endTime;
}

function resolveGoalForDate(userId: number, rows: NutritionGoal[], date: Date, createDefaultGoal: (userId: number) => NutritionGoal): GoalDayView {
  const fallback = getDefaultGoalRule(userId, rows, date, createDefaultGoal);
  const activeException = getExceptionRules(rows).find(rule => isExceptionActiveOnDate(rule, date));
  const applied = activeException ?? fallback;
  const weekday = getWeekdayIndex(date);
  const meta = WEEKDAY_META[weekday] ?? { label: "Dia", shortLabel: "dia" };

  return {
    ...applied,
    weekday,
    label: meta.label,
    shortLabel: meta.shortLabel,
    source: activeException ? "exception" : "default",
    exceptionId: activeException?.id,
  };
}

function buildGoalSummary(rows: NutritionGoal[], userId: number, referenceDate: Date, createDefaultGoal: (userId: number) => NutritionGoal): GoalSummary {
  const monday = startOfWeek(referenceDate);
  const days = Array.from({ length: 7 }).map((_, index) => {
    const current = new Date(monday);
    current.setDate(monday.getDate() + index);
    return resolveGoalForDate(userId, rows, current, createDefaultGoal);
  });
  const today = resolveGoalForDate(userId, rows, referenceDate, createDefaultGoal);
  const defaultGoalRule = getDefaultGoalRule(userId, rows, referenceDate, createDefaultGoal);
  const currentTime = referenceDate.getTime();
  const exceptions = getExceptionRules(rows)
    .filter(rule => !rule.effectiveUntil || new Date(rule.effectiveUntil).getTime() > currentTime)
    .map(rule => ({
      ...rule,
      label: WEEKDAY_META[rule.weekday]?.label ?? "Dia",
      shortLabel: WEEKDAY_META[rule.weekday]?.shortLabel ?? "dia",
      isActive: isExceptionActiveOnDate(rule, referenceDate),
    }));

  return {
    defaultGoal: defaultGoalRule,
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

export function createGoalsService(deps: {
  nutritionGoalsRepository: NutritionGoalsRepository;
  now?: () => Date;
  onEvent: (entry: { userId: number; origin: "web"; status: "success"; eventType: string; detail: string }) => void;
}) {
  const goalStore = new Map<number, NutritionGoal[]>();
  let goalIdSequence = 1;
  const now = deps.now ?? (() => new Date());

  function defaultGoal(userId: number): NutritionGoal {
    return {
      id: goalIdSequence++,
      userId,
      ruleType: "default",
      weekday: DEFAULT_GOAL_WEEKDAY,
      durationType: "always",
      calories: 2200,
      proteinGrams: 160,
      carbsGrams: 240,
      fatGrams: 70,
      effectiveFrom: now(),
      effectiveUntil: null,
      createdAt: now(),
      updatedAt: now(),
    };
  }

  async function getStoredNutritionGoals(userId: number) {
    const dbGoals = await deps.nutritionGoalsRepository.findByUserId(userId);
    if (dbGoals?.length) {
      if (canUseMemoryPersistenceFallback()) {
        goalStore.set(userId, dbGoals);
      }
      return dbGoals;
    }

    if (canUseMemoryPersistenceFallback()) {
      const stored = goalStore.get(userId);
      if (stored?.length) {
        return stored;
      }
    }

    const created = [defaultGoal(userId)];
    if (canUseMemoryPersistenceFallback()) {
      goalStore.set(userId, created);
    }
    return created;
  }

  async function getUserNutritionGoal(userId: number) {
    const goals = await getStoredNutritionGoals(userId);
    return buildGoalSummary(goals, userId, now(), defaultGoal);
  }

  async function upsertNutritionGoal(userId: number, input: GoalInput) {
    const currentNow = now();
    const effectiveFrom = startOfWeek(currentNow);
    const currentGoals = await getStoredNutritionGoals(userId);
    const historicalGoals = currentGoals.map(goal => {
      const existingEnd = goal.effectiveUntil ? new Date(goal.effectiveUntil).getTime() : Number.POSITIVE_INFINITY;
      if (existingEnd <= effectiveFrom.getTime()) {
        return goal;
      }

      return {
        ...goal,
        effectiveUntil: effectiveFrom,
        updatedAt: currentNow,
      };
    });

    const updated: NutritionGoal[] = [
      {
        id: goalIdSequence++,
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
        createdAt: currentNow,
        updatedAt: currentNow,
      },
      ...input.exceptions.map(exception => ({
        id: exception.id ?? goalIdSequence++,
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
        createdAt: currentNow,
        updatedAt: currentNow,
      })),
    ];

    if (canUseMemoryPersistenceFallback()) {
      goalStore.set(userId, [...historicalGoals, ...updated]);
    }
    await deps.nutritionGoalsRepository.replaceForUser(userId, updated);
    deps.onEvent({
      userId,
      origin: "web",
      status: "success",
      eventType: "goal.updated",
      detail: "Meta padrão e exceções nutricionais atualizadas pelo usuário.",
    });
    return buildGoalSummary([...historicalGoals, ...updated], userId, currentNow, defaultGoal);
  }

  function clearMemory(userId: number) {
    goalStore.delete(userId);
  }

  return {
    getStoredNutritionGoals,
    getUserNutritionGoal,
    upsertNutritionGoal,
    clearMemory,
  };
}

export type GoalsService = ReturnType<typeof createGoalsService>;
