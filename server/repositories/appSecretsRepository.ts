import { eq } from "drizzle-orm";
import { appSecrets } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type AppSecretRecord = {
  id: number;
  secretKey: string;
  valueEncrypted: string;
  updatedAt: Date | null;
  updatedByUserId: number | null;
};

export type AppSecretsRepository = {
  findBySecretKey(secretKey: string): Promise<AppSecretRecord | null>;
  upsert(secretKey: string, valueEncrypted: string, updatedByUserId: number): Promise<void>;
};

export function createDrizzleAppSecretsRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): AppSecretsRepository {
  return {
    async findBySecretKey(secretKey) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        const rows = await db.select().from(appSecrets).where(eq(appSecrets.secretKey, secretKey)).limit(1);
        return rows[0] ?? null;
      } catch (error) {
        deps.onWarning("App secret read skipped", error);
        return null;
      }
    },

    async upsert(secretKey, valueEncrypted, updatedByUserId) {
      const db = await deps.getDb();
      if (!db) return;

      const existing = await this.findBySecretKey(secretKey);
      if (existing) {
        await db
          .update(appSecrets)
          .set({ valueEncrypted, updatedByUserId })
          .where(eq(appSecrets.id, existing.id));
      } else {
        await db.insert(appSecrets).values({ secretKey, valueEncrypted, updatedByUserId });
      }
    },
  };
}
