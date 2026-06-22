import { and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
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
  async function createVersionForUser(userId: number, goals: NutritionGoal[], _effectiveFrom: Date) {
    const db = await deps.getDb();
    if (!db || !goals.length) return;

    try {
      const goalsToInsert: NutritionGoal[] = [];

      for (const goal of goals) {
        const now = new Date();
        const goalDateKey = goal.effectiveFrom.toISOString().slice(0, 10);

        await db
          .update(nutritionGoals)
          .set({ effectiveUntil: goal.effectiveFrom, updatedAt: now })
          .where(
            and(
              eq(nutritionGoals.userId, userId),
              eq(nutritionGoals.ruleType, goal.ruleType),
              eq(nutritionGoals.weekday, goal.weekday),
              or(
                and(
                  lt(nutritionGoals.effectiveFrom, goal.effectiveFrom),
                  or(isNull(nutritionGoals.effectiveUntil), gt(nutritionGoals.effectiveUntil, goal.effectiveFrom)),
                ),
                and(
                  isNull(nutritionGoals.effectiveUntil),
                  ne(nutritionGoals.effectiveFrom, goal.effectiveFrom),
                  sql`DATE(${nutritionGoals.effectiveFrom}) = ${goalDateKey}`,
                ),
              ),
            ),
          );

        const existingSameWindow = await db
          .select()
          .from(nutritionGoals)
          .where(
            and(
              eq(nutritionGoals.userId, userId),
              eq(nutritionGoals.ruleType, goal.ruleType),
              eq(nutritionGoals.weekday, goal.weekday),
              eq(nutritionGoals.effectiveFrom, goal.effectiveFrom),
            ),
          )
          .limit(1);

        if (existingSameWindow.length) {
          await db
            .update(nutritionGoals)
            .set({
              durationType: goal.durationType,
              calories: goal.calories,
              proteinGrams: goal.proteinGrams,
              carbsGrams: goal.carbsGrams,
              fatGrams: goal.fatGrams,
              effectiveUntil: goal.effectiveUntil,
              updatedAt: now,
            })
            .where(eq(nutritionGoals.id, existingSameWindow[0].id));
        } else {
          goalsToInsert.push(goal);
        }
      }

      if (goalsToInsert.length) {
        await db.insert(nutritionGoals).values(toInsertValues(goalsToInsert));
      }
    } catch (error) {
      deps.onWarning("Goal persistence skipped", error);
    }
  }

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
      await createVersionForUser(userId, goals, goals[0].effectiveFrom);
    },

    createVersionForUser,
  };
}