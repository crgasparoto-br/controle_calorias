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

const receivedAt = new Date("2026-08-23T12:34:56.000Z");
const clarificationResult = {
  handled: true as const,
  action: "food_clarification_requested" as const,
  reply: "Para registrar 1 ovo frito sem assumir 100 g, informe somente o peso ou volume correspondente.",
  eventType: "whatsapp.food_clarification.requested",
  detail: "Refeição textual aguardando quantidade segura antes do registro, sem persistência parcial.",
};

describe("issue #997 - preflight contável no executor textual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pendingGate.mockResolvedValue({ step: "continue_pipeline" });
    mocks.foodClarification.mockResolvedValue(null);
    mocks.countableGate.mockResolvedValue({ kind: "clarification", result: clarificationResult });
  });

  it("interrompe o fallback nutricional para alimento TACO sem porção caseira segura", async () => {
    const text = [
      "1 pão francês",
      "1 ovo frito",
      "1 fatia presunto",
      "1 fatia mussarela",
      "45g requeijão catupiry light",
    ].join("\n");

    const result = await executeWhatsappTextIntent(42, {
      text,
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid.issue997",
    });

    expect(result).toEqual(clarificationResult);
    expect(mocks.countableGate).toHaveBeenCalledOnce();
    expect(mocks.countableGate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      text,
      originalText: text,
      inboundMessageId: "wamid.issue997",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    }));
  });

  it("não sequestra texto numérico que não resolve para alimento conhecido", async () => {
    const result = await executeWhatsappTextIntent(42, {
      text: "2 dias de relatório",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(mocks.countableGate).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
