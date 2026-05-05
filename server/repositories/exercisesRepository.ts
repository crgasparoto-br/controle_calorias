import { and, desc, eq } from "drizzle-orm";
import { exercises } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type ExerciseRecord = {
  id: number;
  userId: number;
  activityType: string;
  durationMinutes: number;
  caloriesBurned: number;
  notes?: string | null;
  occurredAt: number;
  createdAt: number;
  updatedAt: Date;
};

export type ExercisesRepository = {
  findByUserId(userId: number): Promise<ExerciseRecord[] | null>;
  insert(exercise: ExerciseRecord): Promise<void>;
  update(exercise: ExerciseRecord): Promise<void>;
  delete(userId: number, exerciseId: number): Promise<void>;
};

export function createDrizzleExercisesRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): ExercisesRepository {
  return {
    async findByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        const rows = await db.select().from(exercises).where(eq(exercises.userId, userId)).orderBy(desc(exercises.occurredAt));
        return rows.map((row: typeof exercises.$inferSelect) => ({
          ...row,
          occurredAt: new Date(row.occurredAt).getTime(),
          createdAt: new Date(row.createdAt).getTime(),
        }));
      } catch (error) {
        deps.onWarning("Exercise read skipped", error);
        return null;
      }
    },

    async insert(exercise) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        const insertResult = await db.insert(exercises).values({
          userId: exercise.userId,
          activityType: exercise.activityType,
          durationMinutes: exercise.durationMinutes,
          caloriesBurned: exercise.caloriesBurned,
          notes: exercise.notes ?? null,
          occurredAt: new Date(exercise.occurredAt),
        });

        const insertedId = Number((insertResult as any)?.[0]?.insertId ?? (insertResult as any)?.insertId ?? 0);
        if (insertedId) {
          exercise.id = insertedId;
        }
      } catch (error) {
        deps.onWarning("Exercise persistence skipped", error);
      }
    },

    async update(exercise) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        await db
          .update(exercises)
          .set({
            activityType: exercise.activityType,
            durationMinutes: exercise.durationMinutes,
            caloriesBurned: exercise.caloriesBurned,
            notes: exercise.notes ?? null,
            occurredAt: new Date(exercise.occurredAt),
          })
          .where(and(eq(exercises.userId, exercise.userId), eq(exercises.id, exercise.id)));
      } catch (error) {
        deps.onWarning("Exercise update skipped", error);
      }
    },

    async delete(userId, exerciseId) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        await db.delete(exercises).where(and(eq(exercises.userId, userId), eq(exercises.id, exerciseId)));
      } catch (error) {
        deps.onWarning("Exercise deletion skipped", error);
      }
    },
  };
}
