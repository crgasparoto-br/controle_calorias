import { desc, eq } from "drizzle-orm";
import { inferenceLogs } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type LogsRepository = {
  insert(entry: { userId?: number | null; origin: string; status: string; eventType: string; detail: string }): Promise<void>;
  findRecent(limit: number): Promise<Array<typeof inferenceLogs.$inferSelect> | null>;
  deleteByUserId(userId: number): Promise<void>;
};

export function createDrizzleLogsRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): LogsRepository {
  return {
    async insert(entry) {
      const db = await deps.getDb();
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
        deps.onWarning("Log persistence skipped", error);
      }
    },

    async findRecent(limit) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        return await db.select().from(inferenceLogs).orderBy(desc(inferenceLogs.createdAt)).limit(limit);
      } catch (error) {
        deps.onWarning("Log read skipped", error);
        return null;
      }
    },

    async deleteByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return;

      await db.delete(inferenceLogs).where(eq(inferenceLogs.userId, userId));
    },
  };
}
