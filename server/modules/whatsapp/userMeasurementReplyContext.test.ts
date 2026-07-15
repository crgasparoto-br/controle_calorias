import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserWaterGoalMock = vi.hoisted(() => vi.fn());
const listUserWaterLogsMock = vi.hoisted(() => vi.fn());
const getWeeklyProgressMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({
  getUserWaterGoal: getUserWaterGoalMock,
  listUserWaterLogs: listUserWaterLogsMock,
  getWeeklyProgress: getWeeklyProgressMock,
}));

const { getWhatsAppWaterProgress, getWhatsAppWeightVariation } = await import("./userMeasurementReplyContext");

describe("userMeasurementReplyContext", () => {
  beforeEach(() => vi.clearAllMocks());

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
    });
  });

  it("calcula variação contra o registro anterior válido do mesmo usuário", async () => {
    getWeeklyProgressMock.mockResolvedValue({
      weight: { entries: [
        { weightKg: 68, date: "2026-07-15" },
        { weightKg: 66.7, date: "2026-07-13" },
        { weightKg: 67.1, date: "2026-07-10" },
      ] },
    });

    await expect(getWhatsAppWeightVariation(7, new Date("2026-07-14T08:00:00-03:00"), 66.3)).resolves.toEqual({
      variationKg: -0.4,
      previousWeightKg: 66.7,
    });
  });

  it("identifica primeiro registro quando não existe peso anterior", async () => {
    getWeeklyProgressMock.mockResolvedValue({ weight: { entries: [] } });
    await expect(getWhatsAppWeightVariation(7, new Date(), 66.3)).resolves.toEqual({
      variationKg: null,
      previousWeightKg: null,
    });
  });
});
