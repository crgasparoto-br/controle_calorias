import { eq, inArray } from "drizzle-orm";
import {
  appSecrets,
  dailySummaries,
  exercises,
  foodCatalog,
  foodFavorites,
  habitMemories,
  inferenceLogs,
  mealFavorites,
  mealInferences,
  mealItems,
  mealMedia,
  meals,
  userBadges,
  userGamificationSettings,
  userPreferences,
  userProfiles,
  userRestrictions,
  users,
  waterGoals,
  waterLogs,
  weightEntries,
  whatsappConnections,
} from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;

export type AccountRepository = {
  purgeUserData(userId: number): Promise<void>;
};

export function createDrizzleAccountRepository(deps: { getDb: DbProvider }): AccountRepository {
  return {
    async purgeUserData(userId) {
      const db = await deps.getDb();
      if (!db) return;

      const mealIdsForUser = db.select({ id: meals.id }).from(meals).where(eq(meals.userId, userId));
      await db.delete(mealItems).where(inArray(mealItems.mealId, mealIdsForUser));
      await db.delete(mealMedia).where(inArray(mealMedia.mealId, mealIdsForUser));
      await db.delete(mealInferences).where(eq(mealInferences.userId, userId));
      await db.delete(inferenceLogs).where(eq(inferenceLogs.userId, userId));
      await db.delete(foodFavorites).where(eq(foodFavorites.userId, userId));
      await db.delete(mealFavorites).where(eq(mealFavorites.userId, userId));
      await db.delete(habitMemories).where(eq(habitMemories.userId, userId));
      await db.delete(dailySummaries).where(eq(dailySummaries.userId, userId));
      await db.delete(exercises).where(eq(exercises.userId, userId));
      await db.delete(waterLogs).where(eq(waterLogs.userId, userId));
      await db.delete(waterGoals).where(eq(waterGoals.userId, userId));
      await db.delete(weightEntries).where(eq(weightEntries.userId, userId));
      await db.delete(userPreferences).where(eq(userPreferences.userId, userId));
      await db.delete(userRestrictions).where(eq(userRestrictions.userId, userId));
      await db.delete(userBadges).where(eq(userBadges.userId, userId));
      await db.delete(userGamificationSettings).where(eq(userGamificationSettings.userId, userId));
      await db.delete(whatsappConnections).where(eq(whatsappConnections.userId, userId));
      await db.update(foodCatalog).set({ createdByUserId: null }).where(eq(foodCatalog.createdByUserId, userId));
      await db.update(appSecrets).set({ updatedByUserId: null }).where(eq(appSecrets.updatedByUserId, userId));
      await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
      await db.delete(meals).where(eq(meals.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    },
  };
}
