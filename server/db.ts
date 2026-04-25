import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  habitMemories,
  inferenceLogs,
  InsertUser,
  mealInferences,
  mealItems,
  mealMedia,
  meals,
  foodCatalog,
  NutritionGoal,
  nutritionGoals,
  User,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { HabitSnapshot, MealDraftItem, MealProcessingResult } from "./nutritionEngine";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    return;
  }

  const values: InsertUser = {
    openId: user.openId,
  };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  type TextField = (typeof textFields)[number];

  const assignNullable = (field: TextField) => {
    const value = user[field];
    if (value === undefined) return;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  };

  textFields.forEach(assignNullable);

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) {
    values.lastSignedIn = new Date();
  }

  if (Object.keys(updateSet).length === 0) {
    updateSet.lastSignedIn = new Date();
  }

  try {
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.warn("[Database] Failed to upsert user, continuing with auth only:", error);
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    return undefined;
  }

  try {
    const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    console.warn("[Database] Failed to get user by openId:", error);
    return undefined;
  }
}

type GoalTargetInput = {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

type GoalExceptionDuration = "1_week" | "2_weeks" | "3_weeks" | "always";

type GoalExceptionInput = GoalTargetInput & {
  id?: number;
  weekday: number;
  durationType: GoalExceptionDuration;
};

type GoalInput = {
  defaultGoal: GoalTargetInput;
  exceptions: GoalExceptionInput[];
};

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

type GoalSummary = {
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

const WEEKDAY_META = [
  { weekday: 0, label: "Segunda-feira", shortLabel: "seg." },
  { weekday: 1, label: "Terça-feira", shortLabel: "ter." },
  { weekday: 2, label: "Quarta-feira", shortLabel: "qua." },
  { weekday: 3, label: "Quinta-feira", shortLabel: "qui." },
  { weekday: 4, label: "Sexta-feira", shortLabel: "sex." },
  { weekday: 5, label: "Sábado", shortLabel: "sáb." },
  { weekday: 6, label: "Domingo", shortLabel: "dom." },
] as const;

type SavedMedia = {
  id: number;
  mediaType: "image" | "audio";
  storageKey: string;
  storageUrl: string;
  mimeType: string;
  originalFileName?: string;
};

type PendingInference = {
  draftId: string;
  userId: number;
  source: "web" | "whatsapp";
  processed: MealProcessingResult;
  media: SavedMedia[];
  createdAt: number;
};

type SavedMeal = {
  id: number;
  userId: number;
  source: "web" | "whatsapp";
  mealLabel: string;
  status: "confirmed";
  occurredAt: number;
  notes?: string;
  sourceText: string;
  transcript?: string;
  confidence: number;
  items: MealDraftItem[];
  media: SavedMedia[];
  createdAt: number;
};

type HabitMemoryState = {
  foodName: string;
  typicalMealLabel?: string | null;
  preferredPortionGrams: number;
  notes?: string | null;
  occurrenceCount: number;
  lastSeenAt: number;
};

type AdminLogEntry = {
  id: string;
  userId?: number | null;
  origin: "web" | "whatsapp" | "admin";
  status: "success" | "warning" | "error";
  eventType: string;
  detail: string;
  createdAt: number;
};

const goalStore = new Map<number, NutritionGoal[]>();
const mealStore = new Map<number, SavedMeal[]>();
const habitStore = new Map<number, HabitMemoryState[]>();
const inferenceStore = new Map<string, PendingInference>();
const adminLogStore: AdminLogEntry[] = [];
let mealIdSequence = 1;
let mediaIdSequence = 1;
let goalIdSequence = 1;

function getWeekdayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

const DEFAULT_GOAL_WEEKDAY = -1;

const defaultGoal = (userId: number): NutritionGoal => ({
  id: goalIdSequence++,
  userId,
  ruleType: "default",
  weekday: DEFAULT_GOAL_WEEKDAY,
  durationType: "always",
  calories: 2200,
  proteinGrams: 160,
  carbsGrams: 240,
  fatGrams: 70,
  effectiveFrom: new Date(),
  effectiveUntil: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

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

function getDefaultGoalRule(userId: number, rows: NutritionGoal[]) {
  return rows
    .filter(row => row.ruleType === "default")
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ?? defaultGoal(userId);
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
  const endWeek = rule.effectiveUntil ? startOfWeek(new Date(rule.effectiveUntil)).getTime() : Number.POSITIVE_INFINITY;
  return currentWeek >= startWeek && currentWeek <= endWeek;
}

function resolveGoalForDate(userId: number, rows: NutritionGoal[], date: Date): GoalDayView {
  const fallback = getDefaultGoalRule(userId, rows);
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

function buildGoalSummary(rows: NutritionGoal[], userId: number, referenceDate = new Date()): GoalSummary {
  const monday = startOfWeek(referenceDate);
  const days = Array.from({ length: 7 }).map((_, index) => {
    const current = new Date(monday);
    current.setDate(monday.getDate() + index);
    return resolveGoalForDate(userId, rows, current);
  });
  const today = resolveGoalForDate(userId, rows, referenceDate);
  const defaultGoalRule = getDefaultGoalRule(userId, rows);
  const exceptions = getExceptionRules(rows).map(rule => ({
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

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function dateKey(date: Date) {
  return startOfDay(date).toISOString().slice(0, 10);
}

function sumItems(items: MealDraftItem[]) {
  return items.reduce(
    (acc, item) => {
      acc.calories += item.calories;
      acc.protein += item.protein;
      acc.carbs += item.carbs;
      acc.fat += item.fat;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function isMissingTableError(error: unknown) {
  const code = (error as { code?: string })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return code === "ER_NO_SUCH_TABLE" || causeCode === "ER_NO_SUCH_TABLE";
}

function logPersistenceWarning(scope: string, error: unknown) {
  if (isMissingTableError(error)) {
    return;
  }
  console.warn(`[Database] ${scope}:`, error);
}

function parseJsonArray<T>(value: string | null | undefined, fallback: T[]): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeCatalogText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

async function resolveFoodCatalogIds(items: MealDraftItem[]) {
  const db = await getDb();
  if (!db || !items.length) {
    return new Map<string, number>();
  }

  try {
    const rows = await db.select().from(foodCatalog);
    const catalogIndex = new Map<string, number>();

    for (const row of rows) {
      const aliases = parseJsonArray<string>(row.aliases, []);
      const keys = [row.name, ...aliases].map(normalizeCatalogText);
      for (const key of keys) {
        if (key) {
          catalogIndex.set(key, row.id);
        }
      }
    }

    const resolved = new Map<string, number>();
    for (const item of items) {
      const directKey = normalizeCatalogText(item.canonicalName);
      const fallbackKey = normalizeCatalogText(item.foodName);
      const resolvedId = catalogIndex.get(directKey) ?? catalogIndex.get(fallbackKey);
      if (resolvedId) {
        resolved.set(item.canonicalName, resolvedId);
        resolved.set(item.foodName, resolvedId);
      }
    }

    return resolved;
  } catch (error) {
    logPersistenceWarning("Food catalog resolution skipped", error);
    return new Map<string, number>();
  }
}

async function persistGoalToDb(goals: NutritionGoal[]) {
  const db = await getDb();
  if (!db || !goals.length) return;

  try {
    await db.delete(nutritionGoals).where(eq(nutritionGoals.userId, goals[0].userId));
    await db.insert(nutritionGoals).values(
      goals.map(goal => ({
        userId: goal.userId,
        ruleType: goal.ruleType,
        weekday: goal.weekday,
        durationType: goal.durationType,
        calories: goal.calories,
        proteinGrams: goal.proteinGrams,
        carbsGrams: goal.carbsGrams,
        fatGrams: goal.fatGrams,
        effectiveFrom: goal.effectiveFrom,
        effectiveUntil: goal.effectiveUntil,
      })),
    );
  } catch (error) {
    logPersistenceWarning("Goal persistence skipped", error);
  }
}

async function persistInferenceToDb(draft: PendingInference) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(mealInferences).values({
      draftId: draft.draftId,
      userId: draft.userId,
      source: draft.source,
      requestSummary: draft.processed.sourceText,
      sourceText: draft.processed.sourceText,
      transcript: draft.processed.transcript ?? null,
      mediaJson: JSON.stringify(draft.media),
      reasoning: draft.processed.reasoning,
      confidence: draft.processed.confidence,
      itemsJson: JSON.stringify(draft.processed.items),
      totalsJson: JSON.stringify(draft.processed.totals),
    });
  } catch (error) {
    try {
      await db.insert(mealInferences).values({
        userId: draft.userId,
        source: draft.source,
        requestSummary: draft.processed.sourceText,
        reasoning: draft.processed.reasoning,
        confidence: draft.processed.confidence,
        itemsJson: JSON.stringify(draft.processed.items),
        totalsJson: JSON.stringify(draft.processed.totals),
      } as any);
    } catch (legacyError) {
      logPersistenceWarning("Inference persistence skipped", legacyError);
    }
  }
}

async function persistMealToDb(meal: SavedMeal) {
  const db = await getDb();
  if (!db) return;

  try {
    const mealInsert = await db.insert(meals).values({
      userId: meal.userId,
      source: meal.source,
      status: meal.status,
      mealLabel: meal.mealLabel,
      notes: meal.notes ?? null,
      sourceText: meal.sourceText || null,
      transcript: meal.transcript ?? null,
      confidence: meal.confidence,
      occurredAt: new Date(meal.occurredAt),
    });

    const insertedMealId = Number((mealInsert as any)?.[0]?.insertId ?? (mealInsert as any)?.insertId ?? 0);
    const resolvedMealId = insertedMealId || meal.id;
    meal.id = resolvedMealId;

    if (meal.items.length) {
      const resolvedCatalogIds = await resolveFoodCatalogIds(meal.items);
      await db.insert(mealItems).values(
        meal.items.map(item => ({
          mealId: resolvedMealId,
          foodCatalogId: resolvedCatalogIds.get(item.canonicalName) ?? resolvedCatalogIds.get(item.foodName) ?? null,
          foodName: item.foodName,
          canonicalName: item.canonicalName,
          portionText: item.portionText,
          servings: item.servings,
          estimatedGrams: item.estimatedGrams,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          source: item.source,
        })),
      );
    }

    if (meal.media.length) {
      await db.insert(mealMedia).values(
        meal.media.map(media => ({
          mealId: resolvedMealId,
          mediaType: media.mediaType,
          storageKey: media.storageKey,
          storageUrl: media.storageUrl,
          mimeType: media.mimeType,
          originalFileName: media.originalFileName ?? null,
        })),
      );
    }
  } catch (error) {
    logPersistenceWarning("Meal persistence skipped", error);
  }
}

async function persistHabitsToDb(userId: number, habits: HabitMemoryState[]) {
  const db = await getDb();
  if (!db) return;

  try {
    for (const habit of habits) {
      await db.insert(habitMemories).values({
        userId,
        foodName: habit.foodName,
        typicalMealLabel: habit.typicalMealLabel ?? null,
        preferredPortionGrams: habit.preferredPortionGrams,
        notes: habit.notes ?? null,
        occurrenceCount: habit.occurrenceCount,
        lastSeenAt: new Date(habit.lastSeenAt),
      });
    }
  } catch (error) {
    logPersistenceWarning("Habit persistence skipped", error);
  }
}

async function persistLogToDb(entry: AdminLogEntry) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(inferenceLogs).values({
      userId: entry.userId ?? null,
      origin: entry.origin,
      status: entry.status,
      eventType: entry.eventType,
      detail: entry.detail,
    });
  } catch (error) {
    logPersistenceWarning("Log persistence skipped", error);
  }
}

async function loadGoalFromDb(userId: number) {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select().from(nutritionGoals).where(eq(nutritionGoals.userId, userId)).orderBy(desc(nutritionGoals.updatedAt));
    return rows;
  } catch (error) {
    logPersistenceWarning("Goal read skipped", error);
    return null;
  }
}

async function loadMealsFromDb(userId: number) {
  const db = await getDb();
  if (!db) return null;

  try {
    const mealRows = await db.select().from(meals).where(eq(meals.userId, userId));
    if (!mealRows.length) return [];

    const builtMeals = await Promise.all(
      mealRows
        .filter(row => row.status === "confirmed")
        .map(async row => {
          const [itemRows, mediaRows] = await Promise.all([
            db.select().from(mealItems).where(eq(mealItems.mealId, row.id)),
            db.select().from(mealMedia).where(eq(mealMedia.mealId, row.id)),
          ]);

          const items: MealDraftItem[] = itemRows.map(item => ({
            foodName: item.foodName,
            canonicalName: item.canonicalName,
            portionText: item.portionText,
            servings: item.servings,
            estimatedGrams: item.estimatedGrams,
            calories: item.calories,
            protein: item.protein,
            carbs: item.carbs,
            fat: item.fat,
            confidence: 0.9,
            source: item.source,
          }));

          const media: SavedMedia[] = mediaRows.map(media => ({
            id: media.id,
            mediaType: media.mediaType,
            storageKey: media.storageKey,
            storageUrl: media.storageUrl,
            mimeType: media.mimeType,
            originalFileName: media.originalFileName ?? undefined,
          }));

          return {
            id: row.id,
            userId: row.userId,
            source: row.source,
            mealLabel: row.mealLabel,
            status: "confirmed" as const,
            occurredAt: new Date(row.occurredAt).getTime(),
            notes: row.notes ?? undefined,
            sourceText: row.sourceText ?? "",
            transcript: row.transcript ?? undefined,
            confidence: row.confidence,
            items,
            media,
            createdAt: new Date(row.createdAt).getTime(),
          } satisfies SavedMeal;
        }),
    );

    builtMeals.sort((a, b) => b.occurredAt - a.occurredAt);
    return builtMeals;
  } catch (error) {
    logPersistenceWarning("Meal read skipped", error);
    return null;
  }
}

async function loadHabitsFromDb(userId: number) {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select().from(habitMemories).where(eq(habitMemories.userId, userId));
    if (!rows.length) return [];

    const aggregate = new Map<string, HabitMemoryState>();
    for (const row of rows) {
      const current = aggregate.get(row.foodName);
      const lastSeenAt = new Date(row.lastSeenAt).getTime();
      if (!current) {
        aggregate.set(row.foodName, {
          foodName: row.foodName,
          typicalMealLabel: row.typicalMealLabel ?? undefined,
          preferredPortionGrams: row.preferredPortionGrams,
          notes: row.notes ?? undefined,
          occurrenceCount: row.occurrenceCount,
          lastSeenAt,
        });
        continue;
      }

      aggregate.set(row.foodName, {
        foodName: row.foodName,
        typicalMealLabel: lastSeenAt >= current.lastSeenAt ? row.typicalMealLabel ?? current.typicalMealLabel : current.typicalMealLabel,
        preferredPortionGrams: lastSeenAt >= current.lastSeenAt ? row.preferredPortionGrams : current.preferredPortionGrams,
        notes: lastSeenAt >= current.lastSeenAt ? row.notes ?? current.notes : current.notes,
        occurrenceCount: current.occurrenceCount + row.occurrenceCount,
        lastSeenAt: Math.max(current.lastSeenAt, lastSeenAt),
      });
    }

    return Array.from(aggregate.values()).sort((a, b) => b.occurrenceCount - a.occurrenceCount || b.lastSeenAt - a.lastSeenAt);
  } catch (error) {
    logPersistenceWarning("Habit read skipped", error);
    return null;
  }
}

async function loadRecentLogsFromDb() {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select().from(inferenceLogs).orderBy(desc(inferenceLogs.createdAt)).limit(20);
    return rows.map(row => ({
      id: String(row.id),
      userId: row.userId ?? undefined,
      origin: row.origin,
      status: row.status,
      eventType: row.eventType,
      detail: row.detail,
      createdAt: new Date(row.createdAt).getTime(),
    } satisfies AdminLogEntry));
  } catch (error) {
    logPersistenceWarning("Log read skipped", error);
    return null;
  }
}

async function getStoredNutritionGoals(userId: number) {
  const dbGoals = await loadGoalFromDb(userId);
  if (dbGoals?.length) {
    goalStore.set(userId, dbGoals);
    return dbGoals;
  }

  const stored = goalStore.get(userId);
  if (stored?.length) {
    return stored;
  }

  const created = [defaultGoal(userId)];
  goalStore.set(userId, created);
  return created;
}

export async function getUserNutritionGoal(userId: number) {
  const goals = await getStoredNutritionGoals(userId);
  return buildGoalSummary(goals, userId);
}

export async function upsertNutritionGoal(userId: number, input: GoalInput) {
  const now = new Date();
  const effectiveFrom = startOfWeek(now);

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
      createdAt: now,
      updatedAt: now,
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
      createdAt: now,
      updatedAt: now,
    })),
  ];

  goalStore.set(userId, updated);
  await persistGoalToDb(updated);
  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "goal.updated",
    detail: "Meta padrão e exceções nutricionais atualizadas pelo usuário.",
  });
  return buildGoalSummary(updated, userId);
}

export async function getHabitSnapshots(userId: number): Promise<HabitSnapshot[]> {
  const dbHabits = await loadHabitsFromDb(userId);
  const habits = dbHabits ?? habitStore.get(userId) ?? [];
  if (dbHabits) {
    habitStore.set(userId, dbHabits);
  }

  return habits
    .slice()
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
    .slice(0, 8)
    .map(item => ({
      foodName: item.foodName,
      typicalTimeLabel: item.typicalMealLabel,
      notes: item.notes,
      occurrenceCount: item.occurrenceCount,
    }));
}

export function createPendingMealInference(userId: number, source: "web" | "whatsapp", processed: MealProcessingResult, media: SavedMedia[] = []) {
  const draftId = crypto.randomUUID();
  const draft: PendingInference = {
    draftId,
    userId,
    source,
    processed,
    media,
    createdAt: Date.now(),
  };
  inferenceStore.set(draftId, draft);
  void persistInferenceToDb(draft);
  logInferenceEvent({
    userId,
    origin: source,
    status: processed.confidence >= 0.6 ? "success" : "warning",
    eventType: "meal.inference_created",
    detail: `Inferência criada para ${processed.detectedMealLabel} com ${processed.items.length} itens.`,
  });
  return draft;
}

export function getPendingInference(draftId: string) {
  return inferenceStore.get(draftId);
}

export async function getPendingInferenceFromDb(draftId: string) {
  const db = await getDb();
  if (!db) return undefined;

  try {
    const rows = await db.select().from(mealInferences).where(eq(mealInferences.draftId, draftId)).limit(1);
    const row = rows[0];
    if (!row) return undefined;

    const requestText = row.sourceText ?? row.requestSummary ?? "";
    const items = parseJsonArray<MealDraftItem>(row.itemsJson, []);
    const rawTotals = row.totalsJson ? JSON.parse(row.totalsJson) as Record<string, number> : {};
    const mealLabel = requestText.split(/[,.!?\n]/)[0]?.trim() || items[0]?.foodName || "Refeição";

    return {
      draftId: row.draftId,
      userId: row.userId,
      source: row.source,
      processed: {
        sourceText: requestText,
        transcript: row.transcript ?? undefined,
        reasoning: row.reasoning ?? "",
        confidence: row.confidence,
        detectedMealLabel: mealLabel,
        needsConfirmation: true,
        items,
        totals: {
          calories: Number(rawTotals.calories ?? 0),
          protein: Number(rawTotals.protein ?? 0),
          carbs: Number(rawTotals.carbs ?? 0),
          fat: Number(rawTotals.fat ?? 0),
        },
      },
      media: parseJsonArray<SavedMedia>(row.mediaJson, []),
      createdAt: new Date(row.createdAt).getTime(),
    } satisfies PendingInference;
  } catch (error) {
    logPersistenceWarning("Pending inference rehydration skipped", error);
    return undefined;
  }
}

async function updateHabitsFromMeal(meal: SavedMeal) {
  const existing = (await loadHabitsFromDb(meal.userId)) ?? habitStore.get(meal.userId) ?? [];
  const next = [...existing];

  for (const item of meal.items) {
    const matchIndex = next.findIndex(habit => habit.foodName === item.canonicalName);
    if (matchIndex >= 0) {
      next[matchIndex] = {
        ...next[matchIndex],
        typicalMealLabel: meal.mealLabel,
        preferredPortionGrams: item.estimatedGrams,
        notes: `Última porção confirmada: ${item.portionText}`,
        occurrenceCount: next[matchIndex].occurrenceCount + 1,
        lastSeenAt: meal.occurredAt,
      };
    } else {
      next.push({
        foodName: item.canonicalName,
        typicalMealLabel: meal.mealLabel,
        preferredPortionGrams: item.estimatedGrams,
        notes: `Última porção confirmada: ${item.portionText}`,
        occurrenceCount: 1,
        lastSeenAt: meal.occurredAt,
      });
    }
  }

  const ordered = next.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  habitStore.set(meal.userId, ordered);
  await persistHabitsToDb(meal.userId, ordered);
}

export async function confirmPendingMeal(input: {
  draftId: string;
  userId: number;
  mealLabel: string;
  occurredAt: string;
  notes?: string;
  items: MealDraftItem[];
}) {
  const pending = inferenceStore.get(input.draftId);
  if (!pending || pending.userId !== input.userId) {
    throw new Error("Rascunho de inferência não encontrado.");
  }

  const savedMeal: SavedMeal = {
    id: mealIdSequence++,
    userId: input.userId,
    source: pending.source,
    mealLabel: input.mealLabel,
    status: "confirmed",
    occurredAt: new Date(input.occurredAt).getTime(),
    notes: input.notes,
    sourceText: pending.processed.sourceText,
    transcript: pending.processed.transcript,
    confidence: pending.processed.confidence,
    items: input.items,
    media: pending.media,
    createdAt: Date.now(),
  };

  const mealsForUser = (await loadMealsFromDb(input.userId)) ?? mealStore.get(input.userId) ?? [];
  mealStore.set(input.userId, [savedMeal, ...mealsForUser.filter(meal => meal.id !== savedMeal.id)]);
  inferenceStore.delete(input.draftId);
  await persistMealToDb(savedMeal);
  await updateHabitsFromMeal(savedMeal);
  logInferenceEvent({
    userId: input.userId,
    origin: pending.source,
    status: "success",
    eventType: "meal.confirmed",
    detail: `Refeição ${savedMeal.mealLabel} confirmada e salva com ${savedMeal.items.length} itens.`,
  });
  return savedMeal;
}

export async function listUserMeals(userId: number) {
  const dbMeals = await loadMealsFromDb(userId);
  const mealsForUser = dbMeals ?? mealStore.get(userId) ?? [];
  if (dbMeals) {
    mealStore.set(userId, dbMeals);
  }

  return mealsForUser
    .slice()
    .sort((a, b) => b.occurredAt - a.occurredAt)
    .map(meal => ({
      ...meal,
      totals: sumItems(meal.items),
    }));
}

export async function getWeeklySummary(userId: number) {
  const goal = await getUserNutritionGoal(userId);
  const mealsForUser = await listUserMeals(userId);
  const today = startOfDay(new Date());
  const mondayOffset = getWeekdayIndex(today);
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayOffset);

  const days = Array.from({ length: 7 }).map((_, index) => {
    const current = new Date(monday);
    current.setDate(monday.getDate() + index);
    return current;
  });

  return days.map((day, index) => {
    const key = dateKey(day);
    const dailyMeals = mealsForUser.filter(meal => dateKey(new Date(meal.occurredAt)) === key);
    const totals = dailyMeals.reduce(
      (acc, meal) => {
        const mealTotals = sumItems(meal.items);
        acc.calories += mealTotals.calories;
        acc.protein += mealTotals.protein;
        acc.carbs += mealTotals.carbs;
        acc.fat += mealTotals.fat;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );
    const planned = goal.days[index] ?? goal.today;

    return {
      date: key,
      label: planned.shortLabel,
      calories: round(totals.calories),
      protein: round(totals.protein),
      carbs: round(totals.carbs),
      fat: round(totals.fat),
      goalCalories: planned.calories,
      goalProtein: planned.proteinGrams,
      goalCarbs: planned.carbsGrams,
      goalFat: planned.fatGrams,
    };
  });
}

export async function getDashboardSnapshot(userId: number) {
  const goal = await getUserNutritionGoal(userId);
  const mealsForUser = await listUserMeals(userId);
  const todayKey = dateKey(new Date());
  const todaysMeals = mealsForUser.filter(meal => dateKey(new Date(meal.occurredAt)) === todayKey);
  const todayTotals = todaysMeals.reduce(
    (acc, meal) => {
      const totals = sumItems(meal.items);
      acc.calories += totals.calories;
      acc.protein += totals.protein;
      acc.carbs += totals.carbs;
      acc.fat += totals.fat;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const [weekly, habits] = await Promise.all([
    getWeeklySummary(userId),
    getHabitSnapshots(userId),
  ]);

  const weeklyConsumed = weekly.reduce(
    (acc, day) => {
      acc.calories += day.calories;
      acc.protein += day.protein;
      acc.carbs += day.carbs;
      acc.fat += day.fat;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  return {
    goal,
    today: {
      goal: {
        calories: goal.today.calories,
        protein: goal.today.proteinGrams,
        carbs: goal.today.carbsGrams,
        fat: goal.today.fatGrams,
        label: goal.today.label,
      },
      consumed: Object.fromEntries(Object.entries(todayTotals).map(([key, value]) => [key, round(value)])),
      remaining: {
        calories: round(goal.today.calories - todayTotals.calories),
        protein: round(goal.today.proteinGrams - todayTotals.protein),
        carbs: round(goal.today.carbsGrams - todayTotals.carbs),
        fat: round(goal.today.fatGrams - todayTotals.fat),
      },
      adherence: round(goal.today.calories ? Math.min((todayTotals.calories / goal.today.calories) * 100, 100) : 0),
    },
    week: {
      planned: {
        calories: round(goal.weeklyTotals.calories),
        protein: round(goal.weeklyTotals.proteinGrams),
        carbs: round(goal.weeklyTotals.carbsGrams),
        fat: round(goal.weeklyTotals.fatGrams),
      },
      consumed: Object.fromEntries(Object.entries(weeklyConsumed).map(([key, value]) => [key, round(value)])),
      remaining: {
        calories: round(goal.weeklyTotals.calories - weeklyConsumed.calories),
        protein: round(goal.weeklyTotals.proteinGrams - weeklyConsumed.protein),
        carbs: round(goal.weeklyTotals.carbsGrams - weeklyConsumed.carbs),
        fat: round(goal.weeklyTotals.fatGrams - weeklyConsumed.fat),
      },
      adherence: round(goal.weeklyTotals.calories ? Math.min((weeklyConsumed.calories / goal.weeklyTotals.calories) * 100, 100) : 0),
    },
    weekly,
    meals: mealsForUser.slice(0, 8),
    habits,
  };
}

export async function getKnownUsers(): Promise<User[]> {
  const db = await getDb();
  if (db) {
    try {
      return await db.select().from(users).orderBy(desc(users.lastSignedIn)).limit(25);
    } catch {
      // continue with synthetic list
    }
  }

  return [
    {
      id: 1,
      openId: ENV.ownerOpenId || "owner",
      name: "Administrador",
      email: null,
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
  ];
}

export async function getAdminSnapshot() {
  const usersList = await getKnownUsers();
  const db = await getDb();

  if (db) {
    try {
      const [mealRows, recentLogs] = await Promise.all([
        db.select().from(meals),
        loadRecentLogsFromDb(),
      ]);

      return {
        usage: {
          usersCount: usersList.length,
          mealsCount: mealRows.filter(row => row.status === "confirmed").length,
          pendingInferences: inferenceStore.size,
          logsCount: recentLogs?.length ?? adminLogStore.length,
        },
        users: usersList,
        recentInferenceLogs: recentLogs ?? adminLogStore.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 20),
      };
    } catch (error) {
      logPersistenceWarning("Admin read skipped", error);
    }
  }

  const allMeals = Array.from(mealStore.values()).flat();
  return {
    usage: {
      usersCount: usersList.length,
      mealsCount: allMeals.length,
      pendingInferences: inferenceStore.size,
      logsCount: adminLogStore.length,
    },
    users: usersList,
    recentInferenceLogs: adminLogStore.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 20),
  };
}

export function logInferenceEvent(entry: Omit<AdminLogEntry, "id" | "createdAt">) {
  const created: AdminLogEntry = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...entry,
  };
  adminLogStore.unshift(created);
  void persistLogToDb(created);
}

export function buildSavedMedia(input: Omit<SavedMedia, "id">) {
  return {
    ...input,
    id: mediaIdSequence++,
  };
}
