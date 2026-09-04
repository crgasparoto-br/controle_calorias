import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const processMealInputMock = vi.fn();
const resolveHouseholdMeasureMock = vi.fn();
const resolveWhatsAppPrecedenceGateMock = vi.fn(async () => ({ step: "continue_pipeline" as const }));

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

vi.mock("../../householdMeasureResolution", () => ({
  resolveHouseholdMeasure: resolveHouseholdMeasureMock,
  isApproximateHouseholdMeasureResolutionKind: (kind: string) =>
    kind === "usual_average" || kind === "contextual_estimate" || kind === "user_learned",
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

vi.mock("./messageRouter", () => ({
  resolveWhatsAppPrecedenceGate: resolveWhatsAppPrecedenceGateMock,
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

function canonicalBananaResult() {
  return {
    items: [{
      foodName: "Banana",
      canonicalName: "Banana",
      quantity: 86,
      unit: "g",
      portionText: "86 g",
      servings: 1,
      estimatedGrams: 86,
      calories: 76.5,
      protein: 1,
      carbs: 20,
      fat: 0.2,
      confidence: 0.9,
      source: "catalog",
    }],
  };
}

describe("issue #970 - cadeia real do interpretador de texto", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    processMealInputMock.mockReset();
    resolveHouseholdMeasureMock.mockReset();
    resolveWhatsAppPrecedenceGateMock.mockClear();

    resolveHouseholdMeasureMock.mockImplementation(async (input: { foodName: string; quantity: number; unit: string }) => {
      if (!/banana/i.test(input.foodName)) return null;
      return {
        kind: "canonical_portion",
        grams: 86 * input.quantity,
        requestedQuantity: input.quantity,
        requestedUnit: input.unit,
        evidence: "1 unidade de banana = 86 g",
        sourceUrls: [],
        referenceCount: 1,
      };
    });
    processMealInputMock.mockImplementation(async (input: { text?: string }) => {
      if (/banana/i.test(input.text ?? "")) return canonicalBananaResult();
      throw new Error(`processMealInput não deveria ser chamado para: ${input.text ?? ""}`);
    });
  });

  it.each([
    "Adicionar 3 xícaras de café sem açúcar no café da manhã",
    "Adicione 3 xícaras de café sem açúcar ao café da manhã",
    "Inclua 3 xícaras de café sem açúcar na refeição café da manhã",
    "Coloque 3 xícaras de café sem açúcar para o café da manhã",
    "Acrescente 3 xícaras de café sem açúcar à refeição café da manhã",
    "Registre 3 xícaras de café sem açúcar para a refeição café da manhã",
    "Lance 3 xícaras de café sem açúcar a refeição café da manhã",
  ])("mantém os verbos de adição de café no executor canônico sem LLM: %s", async text => {
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
          canonicalName: "Café sem açúcar",
          quantity: 3,
          unit: "xícara",
          portionText: "3 xícaras (600 ml)",
          estimatedGrams: 600,
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
    expect(result?.reply).toContain("Adicionei 3 xícaras (600 ml) de café sem açúcar");
    expect(result?.reply).not.toContain("Me diga a quantidade e a refeição");
  });

  it("mantém a mesma decisão no entrypoint de áudio transcrito", async () => {
    listMealsMock.mockResolvedValue([breakfast]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 970,
      ...input,
    }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar 3 xícaras de café sem açúcar no café da manhã",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      entrypoint: "audioTranscription",
    });

    expect(resolveWhatsAppPrecedenceGateMock).toHaveBeenCalledOnce();
    expect(updateMealMock).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_added",
      eventType: "whatsapp.intent.meal_item_added",
    }));
    expect(processMealInputMock).not.toHaveBeenCalled();
  });

  it("preserva todos os itens quando café sem açúcar aparece em comando misto", async () => {
    listMealsMock.mockResolvedValue([breakfast]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 970,
      ...input,
    }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar 3 xícaras de café sem açúcar e 1 banana no café da manhã",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(updateMealMock).toHaveBeenCalledOnce();
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 970,
      items: [
        expect.objectContaining({
          foodName: "Café sem açúcar",
          quantity: 3,
          unit: "xícara",
          estimatedGrams: 600,
        }),
        expect.objectContaining({
          foodName: "banana",
          quantity: 1,
          unit: "un",
          estimatedGrams: 86,
        }),
      ],
    }));
    expect(processMealInputMock).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_added",
      data: expect.objectContaining({ itemCount: 2 }),
    }));
  });

  it("preserva itens mistos também quando café não é o primeiro item", async () => {
    listMealsMock.mockResolvedValue([breakfast]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 970,
      ...input,
    }));

    await executeWhatsappTextIntent(42, {
      text: "Adicionar 1 banana e 3 xícaras de café sem açúcar no café da manhã",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(updateMealMock).toHaveBeenCalledOnce();
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      items: [
        expect.objectContaining({ foodName: "banana", quantity: 1, unit: "un", estimatedGrams: 86 }),
        expect.objectContaining({ foodName: "Café sem açúcar", quantity: 3, unit: "xícara", estimatedGrams: 600 }),
      ],
    }));
    expect(processMealInputMock).toHaveBeenCalledOnce();
  });

  it("preserva copo como unidade canônica no executor e na resposta", async () => {
    listMealsMock.mockResolvedValue([breakfast]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 970,
      ...input,
    }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar 3 copos de café sem açúcar no café da manhã",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(updateMealMock).toHaveBeenCalledOnce();
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      items: [expect.objectContaining({
        foodName: "Café sem açúcar",
        quantity: 3,
        unit: "copo",
        portionText: "3 copos (600 ml)",
        estimatedGrams: 600,
      })],
    }));
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(result?.reply).toContain("3 copos");
    expect(result?.reply).not.toContain("3 xícaras");
  });

  it("preserva copo na clarificação quando somente a refeição está ausente", async () => {
    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar 3 copos de café sem açúcar",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(updateMealMock).not.toHaveBeenCalled();
    expect(result?.reply).toContain("3 copos de café sem açúcar");
    expect(result?.reply).toContain("Me diga apenas a refeição");
    expect(result?.reply).not.toContain("3 xícaras");
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
    expect(result?.data).toEqual(expect.objectContaining({
      pendingType: "coffee_addition_clarification",
      preservedMealLabel: "café da manhã",
      missingField: "quantity",
    }));
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
    expect(result?.data).toEqual(expect.objectContaining({
      pendingType: "coffee_addition_clarification",
      preservedQuantity: 3,
      preservedUnit: "xícara",
      missingField: "meal",
    }));
  });
});
