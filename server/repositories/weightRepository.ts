import { eq } from "drizzle-orm";
import { weightEntries } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type WeightRepository = {
  insertEntry(userId: number, weightKg: number, measuredAt: Date, notes: string): Promise<void>;
  findByUserId(userId: number): Promise<Array<typeof weightEntries.$inferSelect> | null>;
};

export function createDrizzleWeightRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): WeightRepository {
  return {
    async insertEntry(userId, weightKg, measuredAt, notes) {
      const db = await deps.getDb();
      if (!db) return;

      await db.insert(weightEntries).values({ userId, weightKg, measuredAt, notes });
    },

    async findByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        const rows = await db.select().from(weightEntries).where(eq(weightEntries.userId, userId));
        return rows
          .map((row: typeof weightEntries.$inferSelect) => ({
            ...row,
            measuredAt: new Date(row.measuredAt),
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
          }))
          .sort((a: { measuredAt: Date }, b: { measuredAt: Date }) => b.measuredAt.getTime() - a.measuredAt.getTime());
      } catch (error) {
        deps.onWarning("Weight entries read skipped", error);
        return null;
      }
    },
  };
}
