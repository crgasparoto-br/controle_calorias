import { and, eq, inArray } from "drizzle-orm";
import { userPreferences, userProfiles, userRestrictions } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type UserProfileRepository = {
  findProfileByUserId(userId: number): Promise<typeof userProfiles.$inferSelect | undefined>;
  upsertProfile(userId: number, values: Record<string, unknown>): Promise<void>;
  updateCurrentWeight(userId: number, weightKg: number): Promise<void>;
  findPreferencesByUserId(userId: number): Promise<Array<typeof userPreferences.$inferSelect>>;
  replacePreferences(userId: number, keys: string[], values: Array<{ preferenceKey: string; preferenceValue: string }>): Promise<void>;
  findRestrictionsByUserId(userId: number): Promise<Array<typeof userRestrictions.$inferSelect>>;
  insertRestrictions(userId: number, labels: string[]): Promise<void>;
};

export function createDrizzleUserProfileRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): UserProfileRepository {
  return {
    async findProfileByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return undefined;

      try {
        const rows = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
        return rows[0] ?? undefined;
      } catch (error) {
        deps.onWarning("User profile read skipped", error);
        return undefined;
      }
    },

    async upsertProfile(userId, values) {
      const db = await deps.getDb();
      if (!db) return;

      const existing = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
      if (existing.length) {
        await db.update(userProfiles).set(values).where(eq(userProfiles.userId, userId));
      } else {
        await db.insert(userProfiles).values({ userId, ...values, createdAt: new Date() });
      }
    },

    async updateCurrentWeight(userId, weightKg) {
      const db = await deps.getDb();
      if (!db) return;

      await db.update(userProfiles).set({
        currentWeightKg: weightKg,
        updatedAt: new Date(),
      }).where(eq(userProfiles.userId, userId));
    },

    async findPreferencesByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return [];

      try {
        return await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
      } catch (error) {
        deps.onWarning("User preferences read skipped", error);
        return [];
      }
    },

    async replacePreferences(userId, keys, values) {
      const db = await deps.getDb();
      if (!db) return;

      await db.delete(userPreferences).where(and(eq(userPreferences.userId, userId), inArray(userPreferences.preferenceKey, keys)));
      await db.insert(userPreferences).values(values.map(value => ({ userId, ...value })));
    },

    async findRestrictionsByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return [];

      try {
        return await db.select().from(userRestrictions).where(eq(userRestrictions.userId, userId));
      } catch (error) {
        deps.onWarning("User restrictions read skipped", error);
        return [];
      }
    },

    async insertRestrictions(userId, labels) {
      if (!labels.length) return;
      const db = await deps.getDb();
      if (!db) return;

      await db.insert(userRestrictions).values(labels.map(label => ({
        userId,
        restrictionType: "other" as const,
        label,
        severity: "avoid" as const,
        notes: "Informado no onboarding.",
      })));
    },
  };
}
