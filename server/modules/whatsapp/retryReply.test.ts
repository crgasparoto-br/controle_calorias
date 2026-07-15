import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  listUserMeals: vi.fn(),
  listUserWaterLogs: vi.fn(),
  listUserWeightEntries: vi.fn(),
}));

vi.mock("../../db", () => dbMocks);
vi.mock("./goalProgressService", () => ({ getWhatsAppMealGoalProgress: vi.fn(async () => null) }));
vi.mock("./userMeasurementReplyContext", () => ({
  getWhatsAppWaterProgress: vi.fn(async () => ({ totalMl: 1500, goalMl: 2000 })),
  getWhatsAppWeightVariation: vi.fn(async () => ({ variationKg: null, previousWeightKg: null })),
}));

const { buildWhatsAppRetryReply } = await import("./retryReply");

describe("buildWhatsAppRetryReply", () => {
  beforeEach(() => vi.clearAllMocks());

  it("não inventa resposta quando não há vínculo de domínio persistido", async () => {
    await expect(buildWhatsAppRetryReply(42, [], new Date())).resolves.toBeNull();
  });

  it("reconstrói a resposta de hidratação sem repetir a mutação", async () => {
    dbMocks.listUserWaterLogs.mockResolvedValue([{
      id: 91,
      userId: 42,
      amountMl: 500,
      occurredAt: new Date("2026-07-15T12:00:00Z"),
    }]);

    const reply = await buildWhatsAppRetryReply(42, [{
      id: 1,
      messageId: 10,
      waterLogId: 91,
      mealId: null,
      weightEntryId: null,
      createdAt: new Date(),
    }], new Date());

    expect(reply?.replyText).toContain("*💧 Água registrada*");
    expect(reply?.replyText).toContain("*Quantidade:* 500 ml");
    expect(dbMocks.listUserMeals).not.toHaveBeenCalled();
  });
});
