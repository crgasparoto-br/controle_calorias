import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const processMealInputMock = vi.fn();

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
  processMealInput: processMealInputMock,
}));

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

vi.mock("../water/service", () => ({
  createWaterLog: vi.fn(),
}));

vi.mock("../onboarding/profileRead", () => ({
  getUserOnboardingProfile: vi.fn(async () => ({ timezone: "America/Sao_Paulo" })),
}));

vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async (input: {
    options?: { actionLines?: string[] };
  }) => input.options?.actionLines?.join("\n") ?? ""),
}));

const { executeWhatsappTextIntent } = await import("./intentActions");

const receivedAt = new Date("2026-08-12T12:00:00.000Z");
const breakfast = {
  id: 970,
  userId: 42,
  mealLabel: "Café da manhã",
  occurredAt: new Date("2026-08-12T10:00:00.000Z").getTime(),
  notes: "Registro pelo WhatsApp",
  items: [],
};

describe("issue #970 - cadeia real do interpretador de texto", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    processMealInputMock.mockReset();
  });

  it.each([
    "Adicionar 3 xícaras de café sem açúcar no café da manhã",
    "Adicione 3 xícaras de café sem açúcar ao café da manhã",
    "Inclua 3 xícaras de café sem açúcar na refeição café da manhã",
    "Coloque 3 xícaras de café sem açúcar para o café da manhã",
    "Acrescente 3 xícaras de café sem açúcar à refeição café da manhã",
    "Registre 3 xícaras de café sem açúcar para a refeição café da manhã",
    "Lance 3 xícaras de café sem açúcar a refeição café da manhã",
  ])("mantém os verbos de adição de café no executor especializado sem LLM: %s", async text => {
    listMealsMock.mockResolvedValue([breakfast]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 970,
      ...input,
    }));

    const result = await executeWhatsappTextIntent(42, {
      text,
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(updateMealMock).toHaveBeenCalledOnce();
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 970,
      mealLabel: "Café da manhã",
      items: [
        expect.objectContaining({
          foodName: "Café sem açúcar",
          canonicalName: "Café preto sem açúcar",
          quantity: 3,
          unit: "xícara",
          portionText: "3 xícaras (150 ml)",
          estimatedGrams: 150,
          calories: 6,
        }),
      ],
    }));
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_added",
      eventType: "whatsapp.intent.meal_item_added",
    }));
    expect(result?.reply).toContain("Adicionei 3 xícaras (150 ml) de café sem açúcar");
    expect(result?.reply).not.toContain("Me diga a quantidade e a refeição");
  });

  it("pergunta somente a quantidade quando a refeição já foi reconhecida", async () => {
    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar café sem açúcar no café da manhã",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(updateMealMock).not.toHaveBeenCalled();
    expect(listMealsMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "clarification_needed",
      eventType: "whatsapp.intent.clarification_needed",
    }));
    expect(result?.reply).toContain("Me diga apenas a quantidade");
    expect(result?.reply).not.toContain("Me diga a quantidade e a refeição");
  });

  it("pergunta somente a refeição quando a quantidade já foi reconhecida", async () => {
    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar 3 xícaras de café sem açúcar",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(updateMealMock).not.toHaveBeenCalled();
    expect(listMealsMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "clarification_needed",
      eventType: "whatsapp.intent.clarification_needed",
    }));
    expect(result?.reply).toContain("Me diga apenas a refeição");
    expect(result?.reply).not.toContain("Me diga a quantidade e a refeição");
  });
});
