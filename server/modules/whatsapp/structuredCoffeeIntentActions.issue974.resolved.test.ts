import { beforeEach, describe, expect, it, vi } from "vitest";

const interpretMock = vi.hoisted(() => vi.fn());
const processMock = vi.hoisted(() => vi.fn());
const createMealMock = vi.hoisted(() => vi.fn());
const pendingRepo = vi.hoisted(() => ({ getActivePendingOperation: vi.fn() }));

vi.mock("./intentContext", () => ({ buildWhatsappIntentContext: vi.fn(async () => ({})) }));
vi.mock("./intentInterpreter", () => ({ interpretWhatsappMessageWithDiagnostics: interpretMock }));
vi.mock("./intentAuditLog", () => ({ recordWhatsappIntentAuditLog: vi.fn() }));
vi.mock("./intentValidation", () => ({ validateWhatsappRuntimeIntentForPersistence: vi.fn(() => ({ valid: true })) }));
vi.mock("../meals/service", () => ({ listMeals: vi.fn(async () => []), createManualMeal: createMealMock, updateMeal: vi.fn() }));
vi.mock("../../db", () => ({ getDb: vi.fn(), getHabitSnapshots: vi.fn(async () => []), logPersistenceWarning: vi.fn() }));
vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({ createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => pendingRepo) }));
vi.mock("../../nutritionEngine", () => ({ MealInferenceError: class extends Error {}, processMealInput: processMock }));
vi.mock("./foodQuantityClarification", () => ({ requestWhatsappCaloricComplementQuantityClarification: vi.fn() }));
vi.mock("./mealActionReplyComposer", () => ({ composeWhatsAppMealActionReply: vi.fn(async () => "ok") }));
vi.mock("./userMeasurementReplyContext", () => ({ getWhatsAppUserTimeZone: vi.fn(async () => "America/Sao_Paulo") }));

import { tryExecuteWhatsappStructuredCoffeeIntent } from "./structuredCoffeeIntentActions";

const occurredAt = new Date("2026-08-13T13:00:00.000Z");
const resolvedItem = {
  foodName: "Café sem açúcar",
  canonicalName: "Café sem açúcar",
  portionText: "3 xícaras",
  servings: 3,
  estimatedGrams: 600,
  calories: 6,
  protein: 0.6,
  carbs: 0,
  fat: 0,
  confidence: 1,
  source: "catalog",
};

describe("issue #974 - preparo explícito", () => {
  beforeEach(() => {
    interpretMock.mockReset();
    processMock.mockReset();
    createMealMock.mockReset();
    pendingRepo.getActivePendingOperation.mockReset().mockResolvedValue(null);
  });

  it("resolve café sem açúcar pelo motor nutricional antes de persistir", async () => {
    interpretMock.mockResolvedValue({
      source: "llm",
      validationStatus: "valid",
      operationalTrace: { strategy: "llm_structured", modelName: "test", latencyMs: 1, estimatedCostUnits: 1 },
      intent: {
        intent: "add_foods_to_meal",
        confidence: 0.95,
        date: null,
        meal: { label: "café da manhã", createIfMissing: true },
        items: [{ foodName: "Café", quantity: 3, unit: "xícaras", brand: null, preparation: "sem açúcar" }],
        sourceFood: null, targetFood: null, quantity: null, requiresConfirmation: false,
        clarificationQuestion: null, possibleIntents: [], reason: null,
      },
    });
    processMock.mockResolvedValue({ detectedMealLabel: "Café da manhã", items: [resolvedItem], totals: {}, sourceText: "Café sem açúcar" });
    createMealMock.mockResolvedValue({ id: 1, mealLabel: "Café da manhã", occurredAt: occurredAt.toISOString(), items: [resolvedItem] });

    const outcome = await tryExecuteWhatsappStructuredCoffeeIntent(42, { text: "3 xícaras de café sem açúcar no café da manhã", receivedAt: occurredAt });

    expect(outcome).toMatchObject({ matched: true, result: { action: "llm_intent_add_foods_to_meal" } });
    expect(processMock).toHaveBeenCalledTimes(1);
    expect(createMealMock).toHaveBeenCalledWith(42, expect.objectContaining({ items: [expect.objectContaining({ canonicalName: "Café sem açúcar" })] }));
  });
});
