import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteIntentMock = vi.fn();
const foodClarificationMock = vi.fn();
const parseCoffeeLorCapsuleIntentMock = vi.fn();
const handleCoffeeLorCapsuleIntentMock = vi.fn();

vi.mock("./deleteIntent", () => ({
  executeWhatsappDeleteIntent: deleteIntentMock,
}));
vi.mock("./foodClarification", () => ({
  handleWhatsappFoodClarification: foodClarificationMock,
}));
vi.mock("./intent/foodAdditionHandlers", () => ({
  handleCoffeeAdditionIntent: vi.fn(),
  handleCoffeeLorCapsuleIntent: handleCoffeeLorCapsuleIntentMock,
  handleFoodAdditionIntent: vi.fn(),
}));
vi.mock("./intent/foodReplacementHandlers", () => ({
  handleFoodReplacementIntents: vi.fn(),
}));
vi.mock("./intent/gramsAdjustmentHandlers", () => ({
  handleMealItemMultiAdjustment: vi.fn(),
  handleMealItemMultiIncrement: vi.fn(),
  handleMealItemReplacement: vi.fn(),
  handleQuantityCorrectionIntent: vi.fn(),
}));
vi.mock("./intent/waterAndReportHandlers", () => ({
  handlePeriodReportIntent: vi.fn(),
  handleSnackSuggestionIntent: vi.fn(),
  handleWaterIntent: vi.fn(),
}));
vi.mock("./intent/parsers", () => ({
  parseCoffeeAdditionIntent: vi.fn(() => null),
  parseCoffeeLorCapsuleIntent: parseCoffeeLorCapsuleIntentMock,
  parseFoodAdditionIntent: vi.fn(() => null),
  parseFoodReplacementIntents: vi.fn(() => null),
  parseMealItemGramsAdjustmentMulti: vi.fn(() => null),
  parseMealItemGramsIncrementMulti: vi.fn(() => null),
  parseMealItemGramsReplacement: vi.fn(() => null),
  parseQuantityCorrectionIntent: vi.fn(() => null),
  parseSnackSuggestionIntent: vi.fn(() => false),
  parseWaterIntent: vi.fn(() => null),
}));
vi.mock("./intent/dateTime", () => ({
  parseReportPeriod: vi.fn(() => null),
}));
vi.mock("./userMeasurementReplyContext", () => ({
  getWhatsAppUserTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));

const { executeWhatsappTextIntent } = await import("./intentActions");

describe("executeWhatsappTextIntent issue #855", () => {
  beforeEach(() => {
    deleteIntentMock.mockReset().mockResolvedValue(null);
    foodClarificationMock.mockReset().mockResolvedValue(null);
    parseCoffeeLorCapsuleIntentMock.mockReset().mockReturnValue(null);
    handleCoffeeLorCapsuleIntentMock.mockReset();
  });

  it("passa a contagem ambígua pelo contrato persistente antes do parser alimentar genérico", async () => {
    foodClarificationMock.mockResolvedValue({
      handled: true,
      action: "food_clarification_requested",
      reply: "Qual é o peso do iogurte natural desnatado?",
      eventType: "whatsapp.food_clarification.requested",
      detail: "pendência persistida",
    });

    const result = await executeWhatsappTextIntent(42, {
      text: "1 iogurte natual desnatado",
      receivedAt: new Date("2026-07-21T15:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
      entrypoint: "audio_transcription",
    });

    expect(deleteIntentMock).toHaveBeenCalledOnce();
    expect(foodClarificationMock).toHaveBeenCalledOnce();
    expect(deleteIntentMock.mock.invocationCallOrder[0]).toBeLessThan(
      foodClarificationMock.mock.invocationCallOrder[0],
    );
    expect(foodClarificationMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      text: "1 iogurte natual desnatado",
      messageId: expect.stringMatching(/^derived:[a-f0-9]{32}$/),
    }));
    expect(result).toEqual(expect.objectContaining({ action: "food_clarification_requested" }));
  });

  it("mantém parser especializado de café antes de criar nova pendência", async () => {
    parseCoffeeLorCapsuleIntentMock.mockReturnValue({ quantity: 1, mealLabel: null });
    handleCoffeeLorCapsuleIntentMock.mockResolvedValue({
      handled: true,
      action: "meal_item_added",
      reply: "Café registrado.",
      eventType: "whatsapp.intent.meal_item_added",
      detail: "cápsula reconhecida",
    });

    const result = await executeWhatsappTextIntent(42, {
      text: "1 café l'or",
      receivedAt: new Date("2026-07-21T15:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toEqual(expect.objectContaining({ action: "meal_item_added" }));
    expect(foodClarificationMock).not.toHaveBeenCalled();
  });
});
