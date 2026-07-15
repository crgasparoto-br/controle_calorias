import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserWaterGoalMock = vi.hoisted(() => vi.fn());
const listUserWaterLogsMock = vi.hoisted(() => vi.fn());
const listUserWeightEntriesMock = vi.hoisted(() => vi.fn());
const getUserOnboardingProfileMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({
  getUserWaterGoal: getUserWaterGoalMock,
  listUserWaterLogs: listUserWaterLogsMock,
  listUserWeightEntries: listUserWeightEntriesMock,
}));
vi.mock("../onboarding/profileRead", () => ({
  getUserOnboardingProfile: getUserOnboardingProfileMock,
}));

const { getWhatsAppWaterProgress, getWhatsAppWeightVariation } = await import("./userMeasurementReplyContext");

describe("userMeasurementReplyContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserOnboardingProfileMock.mockResolvedValue({ timezone: "America/Sao_Paulo" });
  });

  it("soma somente a água do dia lógico solicitado", async () => {
    getUserWaterGoalMock.mockResolvedValue({ dailyTargetMl: 2500 });
    listUserWaterLogsMock.mockResolvedValue([
      { amountMl: 500, occurredAt: "2026-07-14T10:00:00-03:00" },
      { amountMl: 300, occurredAt: "2026-07-14T22:00:00-03:00" },
      { amountMl: 700, occurredAt: "2026-07-13T22:00:00-03:00" },
    ]);

    await expect(getWhatsAppWaterProgress(7, new Date("2026-07-14T20:00:00-03:00"))).resolves.toEqual({
      totalMl: 800,
      goalMl: 2500,
      timeZone: "America/Sao_Paulo",
      dateKey: "2026-07-14",
    });
  });


  it("usa o timezone do usuário para separar os dias de hidratação", async () => {
    getUserOnboardingProfileMock.mockResolvedValue({ timezone: "America/Los_Angeles" });
    getUserWaterGoalMock.mockResolvedValue({ dailyTargetMl: 2500 });
    listUserWaterLogsMock.mockResolvedValue([
      { amountMl: 500, occurredAt: "2026-07-15T02:00:00.000Z" },
      { amountMl: 300, occurredAt: "2026-07-15T10:00:00.000Z" },
    ]);

    await expect(getWhatsAppWaterProgress(7, new Date("2026-07-15T03:00:00.000Z"))).resolves.toMatchObject({
      totalMl: 500,
      timeZone: "America/Los_Angeles",
      dateKey: "2026-07-14",
    });
  });

  it("calcula variação contra o registro anterior válido do mesmo usuário", async () => {
    listUserWeightEntriesMock.mockResolvedValue([
      { weightKg: 68, measuredAt: new Date("2026-07-15T08:00:00-03:00") },
      { weightKg: 66.7, measuredAt: new Date("2026-07-13T08:00:00-03:00") },
      { weightKg: 67.1, measuredAt: new Date("2026-07-10T08:00:00-03:00") },
    ]);

    await expect(getWhatsAppWeightVariation(7, new Date("2026-07-14T08:00:00-03:00"), 66.3)).resolves.toEqual({
      variationKg: -0.4,
      previousWeightKg: 66.7,
    });
  });

  it("identifica primeiro registro quando não existe peso anterior", async () => {
    listUserWeightEntriesMock.mockResolvedValue([]);
    await expect(getWhatsAppWeightVariation(7, new Date(), 66.3)).resolves.toEqual({
      variationKg: null,
      previousWeightKg: null,
    });
  });
});
