import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, search, replacement, context) {
  if (!source.includes(search)) {
    throw new Error(`Missing expected text for ${context}`);
  }
  return source.replace(search, replacement);
}

function replaceRegex(source, pattern, replacement, context) {
  if (!pattern.test(source)) {
    throw new Error(`Missing expected pattern for ${context}: ${pattern}`);
  }
  return source.replace(pattern, replacement);
}

function removeBlock(source, startMarker, endMarker, context) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing start marker for ${context}`);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Missing end marker for ${context}`);
  return source.slice(0, start) + source.slice(end);
}

const goalsStore = `import type { NutritionGoal } from "../../../drizzle/schema";
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
`;

const gamificationStore = `import type { GamificationRepository } from "../../repositories/gamificationRepository";

type BadgeCode =
  | "registered_3_days_week"
  | "registered_5_days_week"
  | "protein_4_days_week"
  | "water_3_days_week"
  | "created_favorite_meal"
  | "planned_meal"
  | "weekly_consistency";

type BadgeDefinition = {
  code: BadgeCode;
  title: string;
  description: string;
};

type UserBadgeEntry = {
  id: number;
  userId: number;
  badgeCode: BadgeCode;
  earnedAt: number;
  weekStart: string | null;
  metadata?: Record<string, unknown>;
};

type GamificationSettingEntry = {
  userId: number;
  enabled: boolean;
  updatedAt: number;
};

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  { code: "registered_3_days_week", title: "3 dias registrados", description: "Registrou refeições em 3 dias da semana." },
  { code: "registered_5_days_week", title: "5 dias registrados", description: "Registrou refeições em 5 dias da semana." },
  { code: "protein_4_days_week", title: "Proteína em 4 dias", description: "Atingiu a meta de proteína em 4 dias da semana." },
  { code: "water_3_days_week", title: "Água em 3 dias", description: "Registrou água em 3 dias da semana." },
  { code: "created_favorite_meal", title: "Refeição favorita criada", description: "Salvou uma refeição favorita para reduzir fricção na rotina." },
  { code: "planned_meal", title: "Refeição planejada", description: "Planejou uma refeição para um horário futuro." },
  { code: "weekly_consistency", title: "Consistência semanal", description: "Manteve registros consistentes ao longo da semana." },
];

const BADGE_DEFINITION_BY_CODE = new Map(BADGE_DEFINITIONS.map(badge => [badge.code, badge]));

function withBadgeDefinition(entry: UserBadgeEntry) {
  const definition = BADGE_DEFINITION_BY_CODE.get(entry.badgeCode);
  return {
    id: entry.id,
    code: entry.badgeCode,
    title: definition?.title ?? entry.badgeCode,
    description: definition?.description ?? "",
    earnedAt: entry.earnedAt,
    weekStart: entry.weekStart,
    metadata: entry.metadata ?? {},
  };
}

export type WeeklyGamificationDay = {
  quality: { mealCount: number };
  goalProtein: number;
  protein: number;
  waterConsumedMl: number;
};

export function createGamificationService(deps: {
  gamificationRepository: GamificationRepository;
  getDb: () => Promise<unknown>;
  getWeekStart: () => string;
  getWeeklySummary: (userId: number) => Promise<WeeklyGamificationDay[]>;
  listFavoriteMeals: (userId: number) => Promise<unknown[]>;
  listUserMeals: (userId: number) => Promise<Array<{ occurredAt: number; source: "web" | "whatsapp" }>>;
  parseJsonObject: (value: string | null | undefined, fallback: Record<string, unknown>) => Record<string, unknown>;
  onWarning: (scope: string, error: unknown) => void;
  now?: () => number;
}) {
  const gamificationSettingsStore = new Map<number, GamificationSettingEntry>();
  const userBadgeStore = new Map<number, UserBadgeEntry[]>();
  let userBadgeIdSequence = 1;
  const now = deps.now ?? (() => Date.now());

  async function getGamificationEnabled(userId: number) {
    const memory = gamificationSettingsStore.get(userId);
    if (memory) return memory.enabled;

    const db = await deps.getDb();
    if (db) {
      try {
        const row = await deps.gamificationRepository.findSettingByUserId(userId);
        if (row) {
          const setting = { userId, enabled: row.enabled === 1, updatedAt: new Date(row.updatedAt).getTime() };
          gamificationSettingsStore.set(userId, setting);
          return setting.enabled;
        }
      } catch (error) {
        deps.onWarning("Gamification settings read skipped", error);
      }
    }

    return true;
  }

  async function updateUserGamificationSettings(userId: number, enabled: boolean) {
    const setting = { userId, enabled, updatedAt: now() };
    gamificationSettingsStore.set(userId, setting);

    try {
      await deps.gamificationRepository.upsertSetting(userId, enabled);
    } catch (error) {
      deps.onWarning("Gamification settings persistence skipped", error);
    }

    return { enabled };
  }

  async function loadUserBadges(userId: number) {
    const db = await deps.getDb();
    if (db) {
      try {
        const rows = await deps.gamificationRepository.findBadgesByUserId(userId);
        const entries = rows.map(row => ({
          id: row.id,
          userId: row.userId,
          badgeCode: row.badgeCode as BadgeCode,
          earnedAt: new Date(row.earnedAt).getTime(),
          weekStart: row.weekStart ?? null,
          metadata: deps.parseJsonObject(row.metadataJson, {}),
        }));
        userBadgeStore.set(userId, entries);
        return entries;
      } catch (error) {
        deps.onWarning("User badges read skipped", error);
      }
    }

    return userBadgeStore.get(userId) ?? [];
  }

  async function awardUserBadge(userId: number, badgeCode: BadgeCode, weekStart: string, metadata: Record<string, unknown>) {
    const current = await loadUserBadges(userId);
    const existing = current.find(badge => badge.badgeCode === badgeCode && badge.weekStart === weekStart);
    if (existing) return existing;

    const badge: UserBadgeEntry = {
      id: userBadgeIdSequence++,
      userId,
      badgeCode,
      earnedAt: now(),
      weekStart,
      metadata,
    };

    const db = await deps.getDb();
    if (db) {
      try {
        const insertedId = await deps.gamificationRepository.insertBadge({
          userId,
          badgeCode,
          weekStart,
          metadataJson: JSON.stringify(metadata),
        });
        if (insertedId) badge.id = insertedId;
      } catch (error) {
        deps.onWarning("User badge persistence skipped", error);
      }
    }

    userBadgeStore.set(userId, [badge, ...current]);
    return badge;
  }

  async function calculateEarnedBadgeCodes(userId: number, weekly: WeeklyGamificationDay[]): Promise<Array<{ code: BadgeCode; metadata: Record<string, unknown> }>> {
    const daysWithMeals = weekly.filter(day => day.quality.mealCount > 0).length;
    const daysWithProteinGoal = weekly.filter(day => day.goalProtein > 0 && day.protein >= day.goalProtein).length;
    const daysWithWater = weekly.filter(day => day.waterConsumedMl > 0).length;
    const favorites = await deps.listFavoriteMeals(userId);
    const meals = await deps.listUserMeals(userId);
    const hasPlannedMeal = meals.some(meal => meal.occurredAt > now() && meal.source === "web");
    const badges: Array<{ code: BadgeCode; metadata: Record<string, unknown> }> = [];

    if (daysWithMeals >= 3) badges.push({ code: "registered_3_days_week", metadata: { daysWithMeals } });
    if (daysWithMeals >= 5) badges.push({ code: "registered_5_days_week", metadata: { daysWithMeals } });
    if (daysWithProteinGoal >= 4) badges.push({ code: "protein_4_days_week", metadata: { daysWithProteinGoal } });
    if (daysWithWater >= 3) badges.push({ code: "water_3_days_week", metadata: { daysWithWater } });
    if (favorites.length > 0) badges.push({ code: "created_favorite_meal", metadata: { favoriteMeals: favorites.length } });
    if (hasPlannedMeal) badges.push({ code: "planned_meal", metadata: {} });
    if (daysWithMeals >= 5 && daysWithWater >= 3) badges.push({ code: "weekly_consistency", metadata: { daysWithMeals, daysWithWater } });

    return badges;
  }

  async function getUserGamification(userId: number, weekly?: WeeklyGamificationDay[]) {
    const enabled = await getGamificationEnabled(userId);
    const history = await loadUserBadges(userId);

    if (!enabled) {
      return {
        enabled,
        availableBadges: BADGE_DEFINITIONS,
        earnedBadges: history.map(withBadgeDefinition),
        newlyEarnedBadges: [],
      };
    }

    const weekStart = deps.getWeekStart();
    const weeklyData = weekly ?? await deps.getWeeklySummary(userId);
    const earnedCandidates = await calculateEarnedBadgeCodes(userId, weeklyData);
    const newlyEarned: UserBadgeEntry[] = [];

    for (const candidate of earnedCandidates) {
      const before = (userBadgeStore.get(userId) ?? history).some(badge => badge.badgeCode === candidate.code && badge.weekStart === weekStart);
      const awarded = await awardUserBadge(userId, candidate.code, weekStart, candidate.metadata);
      if (!before) newlyEarned.push(awarded);
    }

    const updatedHistory = await loadUserBadges(userId);
    return {
      enabled,
      availableBadges: BADGE_DEFINITIONS,
      earnedBadges: updatedHistory.map(withBadgeDefinition),
      newlyEarnedBadges: newlyEarned.map(withBadgeDefinition),
    };
  }

  function clearMemory(userId: number) {
    gamificationSettingsStore.delete(userId);
    userBadgeStore.delete(userId);
  }

  return {
    getUserGamification,
    updateUserGamificationSettings,
    loadUserBadges,
    clearMemory,
  };
}

export type GamificationService = ReturnType<typeof createGamificationService>;
`;

const goalsTest = `import { describe, expect, it, vi } from "vitest";
import type { NutritionGoal } from "../../../drizzle/schema";
import type { NutritionGoalsRepository } from "../../repositories/nutritionGoalsRepository";
import { createGoalsService } from "./store";

function createRepository(rows: NutritionGoal[] | null = null): NutritionGoalsRepository {
  return {
    findByUserId: async userId => rows?.filter(row => row.userId === userId) ?? null,
    replaceForUser: async (_userId, goals) => {
      rows = goals;
    },
    createVersionForUser: async (_userId, goals) => {
      rows = [...(rows ?? []), ...goals];
    },
  };
}

describe("createGoalsService", () => {
  it("retorna meta padrao em fallback de memoria quando usuario nao possui meta", async () => {
    const service = createGoalsService({
      nutritionGoalsRepository: createRepository(null),
      now: () => new Date("2026-01-07T12:00:00.000Z"),
      onEvent: vi.fn(),
    });

    const goal = await service.getUserNutritionGoal(1);

    expect(goal.defaultGoal).toMatchObject({ userId: 1, calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70 });
    expect(goal.days).toHaveLength(7);
    expect(goal.today.source).toBe("default");
  });

  it("preserva excecoes e totais semanais ao atualizar meta", async () => {
    const onEvent = vi.fn();
    const service = createGoalsService({
      nutritionGoalsRepository: createRepository(null),
      now: () => new Date("2026-01-07T12:00:00.000Z"),
      onEvent,
    });

    const goal = await service.upsertNutritionGoal(2, {
      defaultGoal: { calories: 2000, proteinGrams: 150, carbsGrams: 220, fatGrams: 60 },
      exceptions: [
        { weekday: 2, durationType: "always", calories: 2300, proteinGrams: 170, carbsGrams: 260, fatGrams: 70 },
      ],
    });

    expect(goal.defaultGoal).toMatchObject({ userId: 2, calories: 2000 });
    expect(goal.days.find(day => day.weekday === 2)).toMatchObject({ source: "exception", calories: 2300 });
    expect(goal.weeklyTotals.calories).toBe(14300);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "goal.updated", userId: 2 }));
  });

  it("isola metas persistidas por usuario", async () => {
    const persisted: NutritionGoal[] = [
      {
        id: 10,
        userId: 3,
        ruleType: "default",
        weekday: -1,
        durationType: "always",
        calories: 1800,
        proteinGrams: 120,
        carbsGrams: 200,
        fatGrams: 55,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveUntil: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    const service = createGoalsService({
      nutritionGoalsRepository: createRepository(persisted),
      now: () => new Date("2026-01-07T12:00:00.000Z"),
      onEvent: vi.fn(),
    });

    await expect(service.getUserNutritionGoal(3)).resolves.toMatchObject({ defaultGoal: { calories: 1800 } });
    await expect(service.getUserNutritionGoal(4)).resolves.toMatchObject({ defaultGoal: { calories: 2200 } });
  });
});
`;

const gamificationTest = `import { describe, expect, it, vi } from "vitest";
import type { GamificationRepository } from "../../repositories/gamificationRepository";
import { createGamificationService } from "./store";

function createRepository(dbEnabled = false): GamificationRepository {
  const badges: Array<{ id: number; userId: number; badgeCode: string; earnedAt: Date; weekStart: string | null; metadataJson: string }> = [];
  let setting: { userId: number; enabled: number; updatedAt: Date } | undefined;

  return {
    findSettingByUserId: async userId => (setting?.userId === userId ? setting as any : undefined),
    upsertSetting: async (userId, enabled) => {
      if (dbEnabled) setting = { userId, enabled: enabled ? 1 : 0, updatedAt: new Date("2026-01-07T12:00:00.000Z") };
    },
    findBadgesByUserId: async userId => badges.filter(badge => badge.userId === userId) as any,
    insertBadge: async input => {
      const id = badges.length + 1;
      badges.push({ id, userId: input.userId, badgeCode: input.badgeCode, earnedAt: new Date("2026-01-07T12:00:00.000Z"), weekStart: input.weekStart, metadataJson: input.metadataJson });
      return id;
    },
  };
}

const weekly = [
  { quality: { mealCount: 1 }, goalProtein: 100, protein: 120, waterConsumedMl: 1000 },
  { quality: { mealCount: 1 }, goalProtein: 100, protein: 120, waterConsumedMl: 1000 },
  { quality: { mealCount: 1 }, goalProtein: 100, protein: 120, waterConsumedMl: 1000 },
  { quality: { mealCount: 1 }, goalProtein: 100, protein: 120, waterConsumedMl: 0 },
  { quality: { mealCount: 1 }, goalProtein: 100, protein: 120, waterConsumedMl: 0 },
  { quality: { mealCount: 0 }, goalProtein: 100, protein: 0, waterConsumedMl: 0 },
  { quality: { mealCount: 0 }, goalProtein: 100, protein: 0, waterConsumedMl: 0 },
];

describe("createGamificationService", () => {
  it("usa configuracao padrao habilitada e evita duplicar badges na mesma semana", async () => {
    const service = createGamificationService({
      gamificationRepository: createRepository(false),
      getDb: async () => null,
      getWeekStart: () => "2026-01-05",
      getWeeklySummary: async () => weekly,
      listFavoriteMeals: async () => [{}],
      listUserMeals: async () => [{ occurredAt: Date.now() + 1000, source: "web" }],
      parseJsonObject: value => JSON.parse(value ?? "{}"),
      onWarning: vi.fn(),
      now: () => new Date("2026-01-07T12:00:00.000Z").getTime(),
    });

    const first = await service.getUserGamification(1);
    const second = await service.getUserGamification(1);

    expect(first.enabled).toBe(true);
    expect(first.newlyEarnedBadges.length).toBeGreaterThan(0);
    expect(second.newlyEarnedBadges).toEqual([]);
    expect(second.earnedBadges.map(badge => badge.code)).toContain("weekly_consistency");
  });

  it("mantem badges persistidos e respeita configuracao desabilitada", async () => {
    const repository = createRepository(true);
    const service = createGamificationService({
      gamificationRepository: repository,
      getDb: async () => ({}),
      getWeekStart: () => "2026-01-05",
      getWeeklySummary: async () => weekly,
      listFavoriteMeals: async () => [],
      listUserMeals: async () => [],
      parseJsonObject: value => JSON.parse(value ?? "{}"),
      onWarning: vi.fn(),
      now: () => new Date("2026-01-07T12:00:00.000Z").getTime(),
    });

    await service.updateUserGamificationSettings(2, false);
    const disabled = await service.getUserGamification(2);

    expect(disabled.enabled).toBe(false);
    expect(disabled.newlyEarnedBadges).toEqual([]);
  });
});
`;

let db = readFileSync("server/db.ts", "utf8");

db = replaceOnce(
  db,
  'import { createExercisesService, sumExercises } from "./modules/exercises/store";\nimport { createWaterService, sumWater } from "./modules/water/store";',
  'import { createExercisesService, sumExercises } from "./modules/exercises/store";\nimport { createGamificationService, BADGE_DEFINITIONS } from "./modules/gamification/store";\nimport { createGoalsService, type GoalInput } from "./modules/goals/store";\nimport { createWaterService, sumWater } from "./modules/water/store";',
  "store imports",
);

db = replaceRegex(
  db,
  /\ntype GoalTargetInput = \{[\s\S]*?type GoalSummary = \{[\s\S]*?\n\};\n/,
  "\n",
  "goal type extraction",
);

db = replaceRegex(
  db,
  /\ntype BadgeCode =[\s\S]*?type GamificationSettingEntry = \{[\s\S]*?\};\n/,
  "\n",
  "gamification type extraction",
);

db = replaceOnce(db, "const goalStore = new Map<number, NutritionGoal[]>();\n", "", "goal store extraction");
db = replaceOnce(db, "const gamificationSettingsStore = new Map<number, GamificationSettingEntry>();\n", "", "gamification settings store extraction");
db = replaceOnce(db, "const userBadgeStore = new Map<number, UserBadgeEntry[]>();\n", "", "user badge store extraction");
db = replaceOnce(db, "let goalIdSequence = 1;\n", "", "goal sequence extraction");
db = replaceOnce(db, "let userBadgeIdSequence = 1;\n", "", "badge sequence extraction");

db = removeBlock(db, "export const BADGE_DEFINITIONS", "function getWeekdayIndex", "badge definitions extraction");
db = "function getWeekdayIndex" + db.split("function getWeekdayIndex").slice(1).join("function getWeekdayIndex");

db = removeBlock(db, "const DEFAULT_GOAL_WEEKDAY", "function startOfDay", "goal helpers extraction");
db = "function startOfDay" + db.split("function startOfDay").slice(1).join("function startOfDay");

db = removeBlock(db, "function badgeWeekStart", "function isMissingTableError", "gamification helpers extraction");
db = "function isMissingTableError" + db.split("function isMissingTableError").slice(1).join("function isMissingTableError");

db = removeBlock(db, "async function persistGoalToDb", "async function persistInferenceToDb", "goal persistence helper extraction");
db = "async function persistInferenceToDb" + db.split("async function persistInferenceToDb").slice(1).join("async function persistInferenceToDb");

db = removeBlock(db, "async function loadGoalFromDb", "type OccurredAtRange", "goal load helper extraction");
db = "type OccurredAtRange" + db.split("type OccurredAtRange").slice(1).join("type OccurredAtRange");

db = removeBlock(db, "async function getStoredNutritionGoals", "export async function getHabitSnapshots", "goal facade extraction");
db = "export async function getHabitSnapshots" + db.split("export async function getHabitSnapshots").slice(1).join("export async function getHabitSnapshots");

db = replaceOnce(
  db,
  `const nutritionGoalsRepository = createDrizzleNutritionGoalsRepository({
  getDb,
  onWarning: logPersistenceWarning,
});`,
  `const nutritionGoalsRepository = createDrizzleNutritionGoalsRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const goalsService = createGoalsService({
  nutritionGoalsRepository,
  onEvent: logInferenceEvent,
});
const getStoredNutritionGoals = goalsService.getStoredNutritionGoals;
export const getUserNutritionGoal = goalsService.getUserNutritionGoal;
export const upsertNutritionGoal = goalsService.upsertNutritionGoal;`,
  "goals service facade",
);

db = replaceOnce(
  db,
  `const gamificationRepository = createDrizzleGamificationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});`,
  `const gamificationRepository = createDrizzleGamificationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const gamificationService = createGamificationService({
  gamificationRepository,
  getDb,
  getWeekStart: () => dateKey(startOfLocalWeek(new Date())),
  getWeeklySummary,
  listFavoriteMeals,
  listUserMeals,
  parseJsonObject,
  onWarning: logPersistenceWarning,
});
export const getUserGamification = gamificationService.getUserGamification;
export const updateUserGamificationSettings = gamificationService.updateUserGamificationSettings;`,
  "gamification service facade",
);

db = replaceOnce(
  db,
  `  goalStore.delete(userId);
  usersService.clearMemory(userId);`,
  `  goalsService.clearMemory(userId);
  usersService.clearMemory(userId);`,
  "goal memory cleanup",
);

db = replaceOnce(
  db,
  `  gamificationSettingsStore.delete(userId);
  userBadgeStore.delete(userId);`,
  `  gamificationService.clearMemory(userId);`,
  "gamification memory cleanup",
);

writeFileSync("server/db.ts", db);
writeFileSync("server/modules/goals/store.ts", goalsStore);
writeFileSync("server/modules/gamification/store.ts", gamificationStore);
writeFileSync("server/modules/goals/store.test.ts", goalsTest);
writeFileSync("server/modules/gamification/store.test.ts", gamificationTest);

let architecture = readFileSync("ARCHITECTURE.md", "utf8");
architecture = replaceOnce(
  architecture,
  "- [ ] `goals/gamification`: mover metas nutricionais, snapshots semanais de badges e cálculo de conquistas.",
  "- [x] `goals/gamification`: mover metas nutricionais, configurações de gamificação, snapshots semanais de badges e cálculo de conquistas (`server/modules/goals/store.ts`, `server/modules/gamification/store.ts`), preservando `server/db.ts` como fachada.",
  "architecture checklist",
);
writeFileSync("ARCHITECTURE.md", architecture);
