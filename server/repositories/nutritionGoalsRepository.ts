import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { NutritionGoal, nutritionGoals } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type NutritionGoalsRepository = {
  findByUserId(userId: number): Promise<NutritionGoal[] | null>;
  replaceForUser(userId: number, goals: NutritionGoal[]): Promise<void>;
  createVersionForUser(userId: number, goals: NutritionGoal[], effectiveFrom: Date): Promise<void>;
};

function toInsertValues(goals: NutritionGoal[]) {
  return goals.map(goal => ({
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
  }));
}

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
          .orderBy(desc(nutritionGoals.effectiveFrom), desc(nutritionGoals.updatedAt));
      } catch (error) {
        deps.onWarning("Goal read skipped", error);
        return null;
      }
    },

    async replaceForUser(userId, goals) {
      if (!goals.length) return;
      await this.createVersionForUser(userId, goals, goals[0].effectiveFrom);
    },

    async createVersionForUser(userId, goals, effectiveFrom) {
      const db = await deps.getDb();
      if (!db || !goals.length) return;

      try {
        await db
          .update(nutritionGoals)
          .set({ effectiveUntil: effectiveFrom, updatedAt: new Date() })
          .where(
            and(
              eq(nutritionGoals.userId, userId),
              lt(nutritionGoals.effectiveFrom, effectiveFrom),
              or(isNull(nutritionGoals.effectiveUntil), gt(nutritionGoals.effectiveUntil, effectiveFrom)),
            ),
          );
        await db.insert(nutritionGoals).values(toInsertValues(goals));
      } catch (error) {
        deps.onWarning("Goal persistence skipped", error);
      }
    },
  };
}
