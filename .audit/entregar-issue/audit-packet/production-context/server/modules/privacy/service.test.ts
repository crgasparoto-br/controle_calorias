import { describe, expect, it, vi } from "vitest";
import { createPrivacyService } from "./service";

function createDeps(overrides: Partial<Parameters<typeof createPrivacyService>[0]> = {}) {
  return {
    getDb: vi.fn(async () => null),
    findUserById: vi.fn(async () => undefined),
    findProfileByUserId: vi.fn(async () => undefined),
    getOnboardingProfileMemory: vi.fn(() => null),
    findPreferencesByUserId: vi.fn(async () => []),
    findRestrictionsByUserId: vi.fn(async () => []),
    getStoredNutritionGoals: vi.fn(async () => ({ calories: 2000 })),
    listUserMeals: vi.fn(async () => []),
    listFavoriteMeals: vi.fn(() => []),
    listUserExercises: vi.fn(async () => []),
    getUserWaterGoal: vi.fn(async () => ({ dailyTargetMl: 2500 })),
    listUserWaterLogs: vi.fn(async () => []),
    getWeeklyProgress: vi.fn(async () => ({ weight: { current: 70 } })),
    getUserWhatsappConnection: vi.fn(async () => null),
    purgeDatabaseUserData: vi.fn(async () => undefined),
    purgeMemoryDomains: [] as Array<(userId: number) => void>,
    ...overrides,
  };
}

describe("privacy service", () => {
  describe("exportUserPrivacyData", () => {
    it("returns an in-memory account shape and onboarding profile fallback when there is no database", async () => {
      const deps = createDeps({
        getOnboardingProfileMemory: vi.fn(() => ({ objective: "emagrecer" })),
      });
      const service = createPrivacyService(deps);

      const result = await service.exportUserPrivacyData(42);

      expect(result.account).toEqual({ id: 42 });
      expect(result.profile).toEqual({ objective: "emagrecer" });
      expect(deps.findUserById).not.toHaveBeenCalled();
      expect(deps.findProfileByUserId).not.toHaveBeenCalled();
    });

    it("returns database-backed account and profile fields when a database is configured", async () => {
      const dbUser = {
        id: 7,
        name: "Ana",
        email: "ana@example.com",
        loginMethod: "email",
        role: "user",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        lastSignedIn: "2026-01-03T00:00:00.000Z",
      };
      const deps = createDeps({
        getDb: vi.fn(async () => ({})),
        findUserById: vi.fn(async () => dbUser),
        findProfileByUserId: vi.fn(async () => ({ objective: "manter" })),
        findPreferencesByUserId: vi.fn(async () => ["vegetariano"]),
        findRestrictionsByUserId: vi.fn(async () => ["lactose"]),
      });
      const service = createPrivacyService(deps);

      const result = await service.exportUserPrivacyData(7);

      expect(result.account).toEqual(dbUser);
      expect(result.profile).toEqual({ objective: "manter" });
      expect(result.preferences).toEqual(["vegetariano"]);
      expect(result.restrictions).toEqual(["lactose"]);
      expect(deps.getOnboardingProfileMemory).not.toHaveBeenCalled();
    });

    it("includes whatsapp connection details only when a connection exists", async () => {
      const deps = createDeps({
        getUserWhatsappConnection: vi.fn(async () => ({
          status: "active",
          phoneNumber: "5511999999999",
          displayName: "Maria",
          createdAt: 1,
          updatedAt: 2,
        })),
      });
      const service = createPrivacyService(deps);

      const result = await service.exportUserPrivacyData(1);

      expect(result.whatsapp).toEqual({
        status: "active",
        phoneNumber: "5511999999999",
        displayName: "Maria",
        createdAt: 1,
        updatedAt: 2,
      });
    });

    it("returns null whatsapp field when there is no connection", async () => {
      const service = createPrivacyService(createDeps());
      const result = await service.exportUserPrivacyData(1);
      expect(result.whatsapp).toBeNull();
    });

    it("aggregates meals, exercises, water and weight from injected domain readers", async () => {
      const deps = createDeps({
        listUserMeals: vi.fn(async () => [{ id: 1 }]),
        listFavoriteMeals: vi.fn(() => [{ id: 2 }]),
        listUserExercises: vi.fn(async () => [{ id: 3 }]),
        getUserWaterGoal: vi.fn(async () => ({ dailyTargetMl: 3000 })),
        listUserWaterLogs: vi.fn(async () => [{ id: 4 }]),
        getWeeklyProgress: vi.fn(async () => ({ weight: { current: 65 } })),
      });
      const service = createPrivacyService(deps);

      const result = await service.exportUserPrivacyData(9);

      expect(result.meals).toEqual([{ id: 1 }]);
      expect(result.favoriteMeals).toEqual([{ id: 2 }]);
      expect(result.exercises).toEqual([{ id: 3 }]);
      expect(result.water).toEqual({ goal: { dailyTargetMl: 3000 }, logs: [{ id: 4 }] });
      expect(result.weight).toEqual({ current: 65 });
    });
  });

  describe("requestUserAccountDeletion", () => {
    it("purges database data and every registered memory domain when a database is configured", async () => {
      const purgeA = vi.fn();
      const purgeB = vi.fn();
      const deps = createDeps({
        getDb: vi.fn(async () => ({})),
        purgeMemoryDomains: [purgeA, purgeB],
      });
      const service = createPrivacyService(deps);

      const result = await service.requestUserAccountDeletion(11);

      expect(deps.purgeDatabaseUserData).toHaveBeenCalledWith(11);
      expect(purgeA).toHaveBeenCalledWith(11);
      expect(purgeB).toHaveBeenCalledWith(11);
      expect(result.success).toBe(true);
    });

    it("skips database purge but still clears memory domains when there is no database", async () => {
      const purgeA = vi.fn();
      const deps = createDeps({
        getDb: vi.fn(async () => null),
        purgeMemoryDomains: [purgeA],
      });
      const service = createPrivacyService(deps);

      await service.requestUserAccountDeletion(3);

      expect(deps.purgeDatabaseUserData).not.toHaveBeenCalled();
      expect(purgeA).toHaveBeenCalledWith(3);
    });

    it("continues purging remaining domains when one memory domain has no data for the user", async () => {
      const noopPurge = vi.fn();
      const purgeAfter = vi.fn();
      const deps = createDeps({ purgeMemoryDomains: [noopPurge, purgeAfter] });
      const service = createPrivacyService(deps);

      await service.requestUserAccountDeletion(5);

      expect(noopPurge).toHaveBeenCalledWith(5);
      expect(purgeAfter).toHaveBeenCalledWith(5);
    });
  });
});
