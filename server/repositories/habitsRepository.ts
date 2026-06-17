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
        deps.onWarning("Habit persistence skipped", error);
      }
    },
  };
}
