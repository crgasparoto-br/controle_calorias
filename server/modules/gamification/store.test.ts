import { describe, expect, it, vi } from "vitest";
import type { GamificationRepository } from "../../repositories/gamificationRepository";
import { createGamificationService } from "./store";

function createRepository(dbEnabled = false): GamificationRepository {
  const badges: Array<{ id: number; userId: number; badgeCode: string; earnedAt: Date; weekStart: string | null; metadataJson: string }> = [];
  let setting: { userId: number; enabled: number; updatedAt: Date } | undefined;

  return {
    findSettingByUserId: async userId => (setting?.userId === userId ? setting as any : undefined),
    upsertSetting: async (userId, enabled) => {
      if (dbEnabled) setting = { userId, enabled: enabled ? 1 : 0, updatedAt: new Date("2026-01-07T12:00:00.000Z") };
    },
    findBadgesByUserId: async userId => badges.filter(badge => badge.userId === userId) as any,
    insertBadge: async input => {
      const id = badges.length + 1;
      badges.push({ id, userId: input.userId, badgeCode: input.badgeCode, earnedAt: new Date("2026-01-07T12:00:00.000Z"), weekStart: input.weekStart, metadataJson: input.metadataJson });
      return id;
    },
  };
}

const weekly = [
  { quality: { mealCount: 1 }, goalProtein: 100, protein: 120, waterConsumedMl: 1000 },
  { quality: { mealCount: 1 }, goalProtein: 100, protein: 120, waterConsumedMl: 1000 },
  { quality: { mealCount: 1 }, goalProtein: 100, protein: 120, waterConsumedMl: 1000 },
  { quality: { mealCount: 1 }, goalProtein: 100, protein: 120, waterConsumedMl: 0 },
  { quality: { mealCount: 1 }, goalProtein: 100, protein: 120, waterConsumedMl: 0 },
  { quality: { mealCount: 0 }, goalProtein: 100, protein: 0, waterConsumedMl: 0 },
  { quality: { mealCount: 0 }, goalProtein: 100, protein: 0, waterConsumedMl: 0 },
];

describe("createGamificationService", () => {
  it("usa configuracao padrao habilitada e evita duplicar badges na mesma semana", async () => {
    const service = createGamificationService({
      gamificationRepository: createRepository(false),
      getDb: async () => null,
      getWeekStart: () => "2026-01-05",
      getWeeklySummary: async () => weekly,
      listFavoriteMeals: async () => [{}],
      listUserMeals: async () => [{ occurredAt: Date.now() + 1000, source: "web" }],
      parseJsonObject: value => JSON.parse(value ?? "{}"),
      onWarning: vi.fn(),
      now: () => new Date("2026-01-07T12:00:00.000Z").getTime(),
    });

    const first = await service.getUserGamification(1);
    const second = await service.getUserGamification(1);

    expect(first.enabled).toBe(true);
    expect(first.newlyEarnedBadges.length).toBeGreaterThan(0);
    expect(second.newlyEarnedBadges).toEqual([]);
    expect(second.earnedBadges.map(badge => badge.code)).toContain("weekly_consistency");
  });

  it("mantem badges persistidos e respeita configuracao desabilitada", async () => {
    const repository = createRepository(true);
    const service = createGamificationService({
      gamificationRepository: repository,
      getDb: async () => ({}),
      getWeekStart: () => "2026-01-05",
      getWeeklySummary: async () => weekly,
      listFavoriteMeals: async () => [],
      listUserMeals: async () => [],
      parseJsonObject: value => JSON.parse(value ?? "{}"),
      onWarning: vi.fn(),
      now: () => new Date("2026-01-07T12:00:00.000Z").getTime(),
    });

    await service.updateUserGamificationSettings(2, false);
    const disabled = await service.getUserGamification(2);

    expect(disabled.enabled).toBe(false);
    expect(disabled.newlyEarnedBadges).toEqual([]);
  });
});
