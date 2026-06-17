import { and, desc, eq, gte, lt } from "drizzle-orm";
import { waterGoals, waterLogs } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type WaterGoalRecord = {
  id: number;
  userId: number;
  dailyTargetMl: number;
  createdAt: number;
  updatedAt: Date;
};

export type WaterLogRecord = {
  id: number;
  userId: number;
  amountMl: number;
  occurredAt: number;
  createdAt: number;
  updatedAt: Date;
};

export type WaterRepository = {
  findGoalByUserId(userId: number): Promise<WaterGoalRecord | null>;
  upsertGoal(goal: WaterGoalRecord): Promise<void>;
  findLogsByUserId(userId: number): Promise<WaterLogRecord[] | null>;
  findLogsByUserIdAndRange(userId: number, startAt: Date, endAt: Date): Promise<WaterLogRecord[] | null>;
  insertLog(log: WaterLogRecord): Promise<void>;
  deleteLog(userId: number, waterLogId: number): Promise<void>;
};

export function createDrizzleWaterRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): WaterRepository {
  return {
    async findGoalByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        const rows = await db.select().from(waterGoals).where(eq(waterGoals.userId, userId)).limit(1);
        if (!rows.length) return null;
        const row = rows[0] as typeof waterGoals.$inferSelect;
        return {
          ...row,
          createdAt: new Date(row.createdAt).getTime(),
          updatedAt: new Date(row.updatedAt),
        };
      } catch (error) {
        deps.onWarning("Water goal read skipped", error);
        return null;
      }
    },

    async upsertGoal(goal) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        const existing = await db.select().from(waterGoals).where(eq(waterGoals.userId, goal.userId)).limit(1);
        if (existing.length) {
          await db
            .update(waterGoals)
            .set({ dailyTargetMl: goal.dailyTargetMl, updatedAt: new Date() })
            .where(eq(waterGoals.userId, goal.userId));
          return;
        }

        const insertResult = await db.insert(waterGoals).values({ userId: goal.userId, dailyTargetMl: goal.dailyTargetMl });
        const insertedId = Number((insertResult as any)?.[0]?.insertId ?? (insertResult as any)?.insertId ?? 0);
        if (insertedId) {
          goal.id = insertedId;
        }
      } catch (error) {
        deps.onWarning("Water goal persistence skipped", error);
      }
    },

    async findLogsByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        const rows = await db.select().from(waterLogs).where(eq(waterLogs.userId, userId)).orderBy(desc(waterLogs.occurredAt));
        return rows.map((row: typeof waterLogs.$inferSelect) => ({
          ...row,
          occurredAt: new Date(row.occurredAt).getTime(),
          createdAt: new Date(row.createdAt).getTime(),
          updatedAt: new Date(row.updatedAt),
        }));
      } catch (error) {
        deps.onWarning("Water log read skipped", error);
        return null;
      }
    },

    async findLogsByUserIdAndRange(userId, startAt, endAt) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        const rows = await db
          .select()
          .from(waterLogs)
          .where(and(eq(waterLogs.userId, userId), gte(waterLogs.occurredAt, startAt), lt(waterLogs.occurredAt, endAt)))
          .orderBy(desc(waterLogs.occurredAt));
        return rows.map((row: typeof waterLogs.$inferSelect) => ({
          ...row,
          occurredAt: new Date(row.occurredAt).getTime(),
          createdAt: new Date(row.createdAt).getTime(),
          updatedAt: new Date(row.updatedAt),
        }));
      } catch (error) {
        deps.onWarning("Water log range read skipped", error);
        return null;
      }
    },

    async insertLog(log) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        const insertResult = await db.insert(waterLogs).values({
          userId: log.userId,
          amountMl: log.amountMl,
          occurredAt: new Date(log.occurredAt),
        });
        const insertedId = Number((insertResult as any)?.[0]?.insertId ?? (insertResult as any)?.insertId ?? 0);
        if (insertedId) {
          log.id = insertedId;
        }
      } catch (error) {
        deps.onWarning("Water log persistence skipped", error);
      }
    },

    async deleteLog(userId, waterLogId) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        await db.delete(waterLogs).where(and(eq(waterLogs.userId, userId), eq(waterLogs.id, waterLogId)));
      } catch (error) {
        deps.onWarning("Water log deletion skipped", error);
      }
    },
  };
}
