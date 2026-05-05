import { and, desc, eq, isNull } from "drizzle-orm";
import { NutritionGoal, nutritionGoals } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type NutritionGoalsRepository = {
  findByUserId(userId: number): Promise<NutritionGoal[] | null>;
  replaceForUser(userId: number, goals: NutritionGoal[]): Promise<void>;
};

export function createDrizzleNutritionGoalsRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): NutritionGoalsRepository {
  return {
    async findByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        return await db
          .select()
          .from(nutritionGoals)
          .where(eq(nutritionGoals.userId, userId))
          .orderBy(desc(nutritionGoals.updatedAt));
      } catch (error) {
        deps.onWarning("Goal read skipped", error);
        return null;
      }
    },

    async replaceForUser(userId, goals) {
      const db = await deps.getDb();
      if (!db || !goals.length) return;

      try {
        const effectiveUntil = new Date();
        await db
          .update(nutritionGoals)
          .set({ effectiveUntil, updatedAt: effectiveUntil })
          .where(and(eq(nutritionGoals.userId, userId), isNull(nutritionGoals.effectiveUntil)));
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
        deps.onWarning("Goal persistence skipped", error);
      }
    },
  };
}
