import { beforeEach, describe, expect, it, vi } from "vitest";

const buildContextMock = vi.hoisted(() => vi.fn());
const interpretMock = vi.hoisted(() => vi.fn());
const createPreparationMock = vi.hoisted(() => vi.fn());
const processMealInputMock = vi.hoisted(() => vi.fn());
const createMealMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());
const pendingRepo = vi.hoisted(() => ({ getActivePendingOperation: vi.fn() }));

vi.mock("./intentContext", () => ({ buildWhatsappIntentContext: buildContextMock }));
vi.mock("./intentInterpreter", () => ({ interpretWhatsappMessageWithDiagnostics: interpretMock }));
vi.mock("./intentAuditLog", () => ({ recordWhatsappIntentAuditLog: vi.fn() }));
vi.mock("./intentValidation", () => ({ validateWhatsappRuntimeIntentForPersistence: vi.fn(() => ({ valid: true })) }));
vi.mock("../meals/service", () => ({ listMeals: vi.fn(async () => []), createManualMeal: createMealMock, updateMeal: updateMealMock }));
vi.mock("../../db", () => ({ getDb: vi.fn(), getHabitSnapshots: vi.fn(async () => []), logPersistenceWarning: vi.fn() }));
vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({ createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => pendingRepo) }));
vi.mock("../../nutritionEngine", () => ({ MealInferenceError: class extends Error {}, processMealInput: processMealInputMock }));
vi.mock("./foodQuantityClarification", () => ({ requestWhatsappCaloricComplementQuantityClarification: vi.fn() }));
vi.mock("./coffeePreparationClarification", async importOriginal => {
  const actual = await importOriginal<typeof import("./coffeePreparationClarification")>();
  return { ...actual, createWhatsappCoffeePreparationClarification: createPreparationMock };
});
vi.mock("./mealActionReplyComposer", () => ({ composeWhatsAppMealActionReply: vi.fn(async () => "ok") }));
vi.mock("./userMeasurementReplyContext", () => ({ getWhatsAppUserTimeZone: vi.fn(async () => "America/Sao_Paulo") }));

import { tryExecuteWhatsappStructuredCoffeeIntent } from "./structuredCoffeeIntentActions";

const receivedAt = new Date("2026-08-13T13:00:00.000Z");
function interpretation(intent: Record<string, unknown>) {
  return {
    source: "llm" as const,
    validationStatus: "valid" as const,
    operationalTrace: { strategy: "llm_structured" as const, modelName: "gpt-5-mini", latencyMs: 1, estimatedCostUnits: 1 },
    intent,
  };
}
function addCoffeeIntent(overrides: Record<string, unknown> = {}) {
  return {
    intent: "add_foods_to_meal",
    confidence: 0.95,
    date: null,
    meal: { label: "café da manhã", createIfMissing: true },
    items: [{ foodName: "Café", quantity: 3, unit: "xícaras", brand: null, preparation: null }],
    sourceFood: null,
    targetFood: null,
    quantity: null,
    requiresConfirmation: false,
    clarificationQuestion: null,
    possibleIntents: [],
    reason: null,
    ...overrides,
  };
}

describe("issue #974 - clarificação de preparo do café", () => {
  beforeEach(() => {
    for (const mock of [buildContextMock, interpretMock, createPreparationMock, processMealInputMock, createMealMock, updateMealMock, pendingRepo.getActivePendingOperation]) mock.mockReset();
    buildContextMock.mockResolvedValue({ version: "whatsapp-intent-context/v1" });
    pendingRepo.getActivePendingOperation.mockResolvedValue(null);
    createPreparationMock.mockResolvedValue({
      handled: true,
      action: "clarification_needed",
      reply: "Seu café foi sem açúcar ou com açúcar?",
      eventType: "whatsapp.coffee_preparation_clarification.requested",
      detail: "persistido",
      data: { interactionId: "coffee_preparation.sugar_choice", actions: ["without_sugar", "with_sugar"] },
    });
  });

  it("persiste a escolha antes de qualquer mutação", async () => {
    interpretMock.mockResolvedValue(interpretation(addCoffeeIntent()));
    const outcome = await tryExecuteWhatsappStructuredCoffeeIntent(42, { text: "3 xícaras de café", receivedAt, messageId: "wamid-974" });
    expect(outcome).toMatchObject({ matched: true, result: { action: "clarification_needed", data: { interactionId: "coffee_preparation.sugar_choice", actions: ["without_sugar", "with_sugar"] } } });
    expect(createPreparationMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, originalText: "3 xícaras de café", mealLabel: "Café da manhã", ambiguousItemIndexes: [0] }));
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(createMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("bloqueia o fallback quando o contexto estruturado é insuficiente", async () => {
    interpretMock.mockResolvedValue(interpretation(addCoffeeIntent({ intent: "unknown", confidence: 0.34, meal: null, items: [] })));
    const outcome = await tryExecuteWhatsappStructuredCoffeeIntent(42, { text: "3 xícaras de café", receivedAt });
    expect(outcome).toMatchObject({ matched: true, result: { action: "clarification_needed" } });
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(createMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });
});
