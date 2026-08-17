import { describe, expect, it, vi } from "vitest";

const processMock = vi.hoisted(() => vi.fn());
const createMealMock = vi.hoisted(() => vi.fn());
vi.mock("./intentContext", () => ({ buildWhatsappIntentContext: vi.fn() }));
vi.mock("./intentInterpreter", () => ({ interpretWhatsappMessageWithDiagnostics: vi.fn() }));
vi.mock("./intentAuditLog", () => ({ recordWhatsappIntentAuditLog: vi.fn() }));
vi.mock("./intentValidation", () => ({ validateWhatsappRuntimeIntentForPersistence: vi.fn() }));
vi.mock("../meals/service", () => ({ listMeals: vi.fn(async () => []), createManualMeal: createMealMock, updateMeal: vi.fn() }));
vi.mock("../../db", () => ({ getDb: vi.fn(), getHabitSnapshots: vi.fn(async () => []), logPersistenceWarning: vi.fn() }));
vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({ createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => ({ getActivePendingOperation: vi.fn() })) }));
vi.mock("../../nutritionEngine", () => ({ MealInferenceError: class extends Error {}, processMealInput: processMock }));
vi.mock("./foodQuantityClarification", () => ({ requestWhatsappCaloricComplementQuantityClarification: vi.fn() }));
vi.mock("./mealActionReplyComposer", () => ({ composeWhatsAppMealActionReply: vi.fn(async () => "ok") }));
vi.mock("./userMeasurementReplyContext", () => ({ getWhatsAppUserTimeZone: vi.fn(async () => "America/Sao_Paulo") }));

import { resumeWhatsappStructuredCoffeePreparation } from "./structuredCoffeeIntentActions";

const receivedAt = new Date("2026-08-13T13:00:00.000Z");
const target = {
  contractVersion: 1 as const,
  interactionId: "coffee_preparation.sugar_choice" as const,
  kind: "coffee_preparation_clarification" as const,
  originalText: "3 xícaras de café e 1 pão",
  originalReceivedAt: receivedAt.toISOString(),
  inboundMessageId: "wamid-974-compound",
  userTimezone: "America/Sao_Paulo",
  mealLabel: "Café da manhã",
  createIfMissing: true,
  intentDate: null,
  items: [
    { foodName: "Café", quantity: 3, unit: "xícaras", brand: null, preparation: null },
    { foodName: "Pão", quantity: 1, unit: "unidade", brand: null, preparation: null },
  ],
  ambiguousItemIndexes: [0],
  instructionText: "Seu café foi sem açúcar ou com açúcar?",
  actions: [],
};
const coffee = { foodName: "Café sem açúcar", canonicalName: "Café sem açúcar", portionText: "3 xícaras", servings: 3, estimatedGrams: 600, calories: 6, protein: 0.6, carbs: 0, fat: 0, confidence: 1, source: "catalog" };
const bread = { foodName: "Pão", canonicalName: "Pão", portionText: "1 unidade", servings: 1, estimatedGrams: 50, calories: 135, protein: 4, carbs: 25, fat: 2, confidence: 1, source: "catalog" };

describe("issue #974 - café composto", () => {
  it("without_sugar preserva o pão e cria a refeição uma única vez", async () => {
    processMock.mockResolvedValue({ detectedMealLabel: "Café da manhã", items: [coffee, bread], totals: {}, sourceText: "Café sem açúcar e Pão" });
    createMealMock.mockResolvedValue({ id: 975, mealLabel: "Café da manhã", occurredAt: receivedAt.toISOString(), items: [coffee, bread] });

    const result = await resumeWhatsappStructuredCoffeePreparation({ userId: 42, target, choice: "without_sugar", receivedAt });

    expect(result).toMatchObject({ action: "llm_intent_add_foods_to_meal", data: expect.objectContaining({ itemCount: 2, coffeePreparationResolved: true }) });
    expect(createMealMock).toHaveBeenCalledTimes(1);
    expect(createMealMock.mock.calls[0][1].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalName: "Café sem açúcar" }),
      expect.objectContaining({ canonicalName: "Pão" }),
    ]));
  });
});
