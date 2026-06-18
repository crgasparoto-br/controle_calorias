import { eq } from "drizzle-orm";
import { habitMemories } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type HabitMemoryState = {
  foodName: string;
  typicalMealLabel?: string | null;
  preferredPortionGrams: number;
  notes?: string | null;
  occurrenceCount: number;
  lastSeenAt: number;
};

export type HabitsRepository = {
  findRawByUserId(userId: number): Promise<Array<typeof habitMemories.$inferSelect> | null>;
  insertMany(userId: number, habits: HabitMemoryState[]): Promise<void>;
};

const MYSQL_INT_MAX = 2_147_483_647;

function clampInt(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value), 0), MYSQL_INT_MAX);
}

function sanitizeText(value: string | null | undefined, maxLength?: number) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function sanitizeHabit(habit: HabitMemoryState) {
  const foodName = sanitizeText(habit.foodName, 255);
  if (!foodName) {
    return null;
  }

  const preferredPortionGrams = Number.isFinite(habit.preferredPortionGrams)
    ? Math.max(habit.preferredPortionGrams, 0)
    : 0;
  const lastSeenAt = Number.isFinite(habit.lastSeenAt) && habit.lastSeenAt > 0
    ? new Date(habit.lastSeenAt)
    : new Date();

  return {
    foodName,
    typicalMealLabel: sanitizeText(habit.typicalMealLabel, 80),
    preferredPortionGrams,
    notes: sanitizeText(habit.notes),
    occurrenceCount: clampInt(habit.occurrenceCount, 1),
    lastSeenAt,
  };
}

function buildHabitSnapshot(userId: number, habits: HabitMemoryState[]) {
  const byFoodName = new Map<string, ReturnType<typeof sanitizeHabit> & { userId: number }>();

  for (const habit of habits) {
    const sanitized = sanitizeHabit(habit);
    if (!sanitized) {
      continue;
    }

    const existing = byFoodName.get(sanitized.foodName);
    if (!existing) {
      byFoodName.set(sanitized.foodName, { userId, ...sanitized });
      continue;
    }

    const useLatestDetails = sanitized.lastSeenAt.getTime() >= existing.lastSeenAt.getTime();
    byFoodName.set(sanitized.foodName, {
      userId,
      foodName: sanitized.foodName,
      typicalMealLabel: useLatestDetails ? sanitized.typicalMealLabel : existing.typicalMealLabel,
      preferredPortionGrams: useLatestDetails ? sanitized.preferredPortionGrams : existing.preferredPortionGrams,
      notes: useLatestDetails ? sanitized.notes : existing.notes,
      occurrenceCount: clampInt(existing.occurrenceCount + sanitized.occurrenceCount, 1),
      lastSeenAt: useLatestDetails ? sanitized.lastSeenAt : existing.lastSeenAt,
    });
  }

  return Array.from(byFoodName.values());
}

export function createDrizzleHabitsRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): HabitsRepository {
  return {
    async findRawByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        return await db.select().from(habitMemories).where(eq(habitMemories.userId, userId));
      } catch (error) {
        deps.onWarning("Habit read skipped", error);
        return null;
      }
    },

    async insertMany(userId, habits) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        const snapshot = buildHabitSnapshot(userId, habits);
        await db.delete(habitMemories).where(eq(habitMemories.userId, userId));
        if (snapshot.length) {
          await db.insert(habitMemories).values(snapshot);
        }
      } catch (error) {
        deps.onWarning("Habit persistence skipped", error);
      }
    },
  };
}
