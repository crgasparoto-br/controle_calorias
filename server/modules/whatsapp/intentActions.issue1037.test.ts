import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countableGate: vi.fn(),
  pendingGate: vi.fn(async () => ({ step: "continue_pipeline" as const })),
  foodClarification: vi.fn(async () => null),
}));

vi.mock("../../db", () => ({
  getHabitSnapshots: vi.fn(async () => []),
  getUserNutritionGoal: vi.fn(async () => null),
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));

vi.mock("../../nutritionEngine", () => ({
  MealInferenceError: class MealInferenceError extends Error {
    code = "meal_inference_failed";
  },
  processMealInput: vi.fn(),
}));

vi.mock("../meals/service", () => ({
  listMeals: vi.fn(async () => []),
  updateMeal: vi.fn(),
}));

vi.mock("../water/service", () => ({ createWaterLog: vi.fn() }));
vi.mock("../onboarding/profileRead", () => ({
  getUserOnboardingProfile: vi.fn(async () => ({ timezone: "America/Sao_Paulo" })),
}));
vi.mock("./messageRouter", () => ({ resolveWhatsAppPrecedenceGate: mocks.pendingGate }));
vi.mock("./foodClarification", () => ({ handleWhatsappFoodClarification: mocks.foodClarification }));
vi.mock("./foodClarificationPresentation", () => ({
  attachWhatsappFoodClarificationPresentation: vi.fn(),
}));
vi.mock("./deleteIntent", () => ({ executeWhatsappDeleteIntent: vi.fn(async () => null) }));
vi.mock("./countableFoodRegistrationGate", () => ({
  prepareWhatsappCountableFoodRegistration: mocks.countableGate,
}));

const { executeWhatsappTextIntent } = await import("./intentActions");

const clarificationResult = {
  handled: true as const,
  action: "food_clarification_requested" as const,
  reply: "Preciso de uma medida segura antes de registrar.",
  eventType: "whatsapp.food_clarification.requested",
  detail: "Medida contável sem referência segura.",
};

describe("issue #1037 — consumidor direto de executeWhatsappTextIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pendingGate.mockResolvedValue({ step: "continue_pipeline" });
    mocks.foodClarification.mockResolvedValue(null);
    mocks.countableGate.mockResolvedValue({ kind: "clarification", result: clarificationResult });
  });

  it("mantém o preflight contável para chamadas que não passam pelo wrapper textual", async () => {
    const text = "1 fatia de presunto";
    const receivedAt = new Date("2026-09-02T18:00:00.000Z");

    const result = await executeWhatsappTextIntent(42, {
      text,
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid.issue1037.direct",
    });

    expect(result).toEqual(clarificationResult);
    expect(mocks.countableGate).toHaveBeenCalledTimes(1);
    expect(mocks.countableGate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      text,
      originalText: text,
      inboundMessageId: "wamid.issue1037.direct",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    }));
  });

  it("não repete o preflight quando o consumidor direto já recebe gramatura resolvida", async () => {
    const result = await executeWhatsappTextIntent(42, {
      text: "60 g de presunto",
      receivedAt: new Date("2026-09-02T18:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid.issue1037.resolved-grams",
    });

    expect(result).toBeNull();
    expect(mocks.countableGate).not.toHaveBeenCalled();
  });
});
