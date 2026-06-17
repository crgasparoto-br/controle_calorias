import { desc, eq } from "drizzle-orm";
import { userBadges, userGamificationSettings } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type GamificationRepository = {
  findSettingByUserId(userId: number): Promise<typeof userGamificationSettings.$inferSelect | undefined>;
  upsertSetting(userId: number, enabled: boolean): Promise<void>;
  findBadgesByUserId(userId: number): Promise<Array<typeof userBadges.$inferSelect>>;
  insertBadge(input: { userId: number; badgeCode: string; weekStart: string; metadataJson: string }): Promise<number>;
};

export function createDrizzleGamificationRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): GamificationRepository {
  return {
    async findSettingByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return undefined;

      const rows = await db.select().from(userGamificationSettings).where(eq(userGamificationSettings.userId, userId)).limit(1);
      return rows[0] ?? undefined;
    },

    async upsertSetting(userId, enabled) {
      const db = await deps.getDb();
      if (!db) return;

      await db.insert(userGamificationSettings).values({
        userId,
        enabled: enabled ? 1 : 0,
      }).onDuplicateKeyUpdate({
        set: {
          enabled: enabled ? 1 : 0,
          updatedAt: new Date(),
        },
      });
    },

    async findBadgesByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return [];

      return await db.select().from(userBadges).where(eq(userBadges.userId, userId)).orderBy(desc(userBadges.earnedAt));
    },

    async insertBadge(input) {
      const db = await deps.getDb();
      if (!db) return 0;

      const inserted = await db.insert(userBadges).values(input);
      return Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? 0);
    },
  };
}
