import { desc, eq } from "drizzle-orm";
import { InsertUser, User, users } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type UsersRepository = {
  upsert(values: InsertUser, updateSet: Record<string, unknown>): Promise<void>;
  findByOpenId(openId: string): Promise<User | undefined>;
  findById(userId: number): Promise<User | undefined>;
  listRecent(limit: number): Promise<User[] | null>;
};

export function createDrizzleUsersRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): UsersRepository {
  return {
    async upsert(values, updateSet) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
      } catch (error) {
        deps.onWarning("User upsert skipped", error);
      }
    },

    async findByOpenId(openId) {
      const db = await deps.getDb();
      if (!db) return undefined;

      try {
        const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
        return result[0] ?? undefined;
      } catch (error) {
        deps.onWarning("User read by openId skipped", error);
        return undefined;
      }
    },

    async findById(userId) {
      const db = await deps.getDb();
      if (!db) return undefined;

      try {
        const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        return result[0] ?? undefined;
      } catch (error) {
        deps.onWarning("User read by id skipped", error);
        return undefined;
      }
    },

    async listRecent(limit) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        return await db.select().from(users).orderBy(desc(users.lastSignedIn)).limit(limit);
      } catch (error) {
        deps.onWarning("User list skipped", error);
        return null;
      }
    },
  };
}
