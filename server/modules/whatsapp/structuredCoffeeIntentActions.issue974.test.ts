import { beforeEach, describe, expect, it, vi } from "vitest";

const buildContextMock = vi.hoisted(() => vi.fn());
const interpretMock = vi.hoisted(() => vi.fn());
const recordAuditMock = vi.hoisted(() => vi.fn());
const listMealsMock = vi.hoisted(() => vi.fn());
const createManualMealMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());
const processMealInputMock = vi.hoisted(() => vi.fn());
const getHabitSnapshotsMock = vi.hoisted(() => vi.fn());
const createPreparationClarificationMock = vi.hoisted(() => vi.fn());
const requestSugarClarificationMock = vi.hoisted(() => vi.fn());
const pendingRepositoryMock = vi.hoisted(() => ({
  getActivePendingOperation: vi.fn(),
}));

vi.mock("./intentContext", () => ({
  buildWhatsappIntentContext: buildContextMock,
}));
vi.mock("./intentInterpreter", () => ({
  interpretWhatsappMessageWithDiagnostics: interpretMock,
}));
vi.mock("./intentAuditLog", () => ({
  recordWhatsappIntentAuditLog: recordAuditMock,
}));
vi.mock("./intentValidation", () => ({
  validateWhatsappRuntimeIntentForPersistence: vi.fn(() => ({
    valid: true,
    status: "valid",
    issues: [],
  })),
}));
vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  createManualMeal: createManualMealMock,
  updateMeal: updateMealMock,
}));
vi.mock("../../db", () => ({
  getDb: vi.fn(),
  getHabitSnapshots: getHabitSnapshotsMock,
  logPersistenceWarning: vi.fn(),
}));
vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => pendingRepositoryMock),
}));
vi.mock("../../nutritionEngine", () => {
  class MealInferenceError extends Error {
    code: string;
    context?: { component?: string };

    constructor(message: string, code: string, context?: { component?: string }) {
      super(message);
      this.name = "MealInferenceError";
      this.code = code;
      this.context = context;
    }
  }
  return {
    MealInferenceError,
    processMealInput: processMealInputMock,
  };
});
vi.mock("./foodQuantityClarification", () => ({
  requestWhatsappCaloricComplementQuantityClarification: requestSugarClarificationMock,
}));
vi.mock("./coffeePreparationClarification", async importOriginal => {
  const actual = await importOriginal<typeof import("./coffeePreparationClarification")>();
  return {
    ...actual,
    createWhatsappCoffeePreparationClarification: createPreparationClarificationMock,
  };
});
vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Refeição atualizada."),
}));
vi.mock("./userMeasurementReplyContext", () => ({
  getWhatsAppUserTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));

import { MealInferenceError } from "../../nutritionEngine";
import {
  resumeWhatsappStructuredCoffeePreparation,
  tryExecuteWhatsappStructuredCoffeeIntent,
} from "./structuredCoffeeIntentActions";

const receivedAt = new Date("2026-08-13T10:00:00.000-03:00");

function interpretedIntent(overrides: Record<string, unknown> = {}) {
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

function interpretation(intent: ReturnType<typeof interpretedIntent>) {
  return {
    source: "llm" as const,
    validationStatus: "valid" as const,
    operationalTrace: {
      strategy: "llm_structured" as const,
      modelName: "gpt-5-mini",
      latencyMs: 10,
      estimatedCostUnits: 1,
    },
    intent,
  };
}

function nutritionItem(overrides: Record<string, unknown> = {}) {
  return {
    foodName: "Café sem açúcar",
    canonicalName: "Café sem açúcar",
    portionText: "3 xícaras",
    quantity: 3,
    unit: "xícara",
    servings: 3,
    estimatedGrams: 600,
    calories: 6,
    protein: 0.6,
    carbs: 0,
    fat: 0,
    confidence: 1,
    source: "catalog",
    ...overrides,
  };
}

describe("issue #974 - precedência da clarificação de preparo do café", () => {
  beforeEach(() => {
    buildContextMock.mockReset();
    interpretMock.mockReset();
    recordAuditMock.mockReset();
    listMealsMock.mockReset();
    createManualMealMock.mockReset();
    updateMealMock.mockReset();
    processMealInputMock.mockReset();
    getHabitSnapshotsMock.mockReset();
    createPreparationClarificationMock.mockReset();
    requestSugarClarificationMock.mockReset();
    pendingRepositoryMock.getActivePendingOperation.mockReset();

    buildContextMock.mockResolvedValue({ version: "whatsapp-intent-context/v1" });
    pendingRepositoryMock.getActivePendingOperation.mockResolvedValue(null);
    listMealsMock.mockResolvedValue([]);
    getHabitSnapshotsMock.mockResolvedValue([]);
    createPreparationClarificationMock.mockResolvedValue({
      handled: true,
      action: "clarification_needed",
      reply: "Seu café foi sem açúcar ou com açúcar?",
      eventType: "whatsapp.coffee_preparation_clarification.requested",
      detail: "Contexto persistido.",
      data: { pendingOperationId: 974 },
    });
  });

  it("persiste a escolha de preparo antes de qualquer mutação para 3 xícaras de café", async () => {
    interpretMock.mockResolvedValue(interpretation(interpretedIntent()));

    const outcome = await tryExecuteWhatsappStructuredCoffeeIntent(42, {
      text: "3 xícaras de café",
      receivedAt,
      messageId: "wamid-974-generic",
    });

    expect(outcome).toMatchObject({
      matched: true,
      result: {
        action: "clarification_needed",
        reply: expect.stringContaining("sem açúcar ou com açúcar"),
      },
    });
    expect(createPreparationClarificationMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      originalText: "3 xícaras de café",
      messageId: "wamid-974-generic",
      mealLabel: "Café da manhã",
      createIfMissing: true,
      items: [expect.objectContaining({ quantity: 3, unit: "xícaras" })],
      ambiguousItemIndexes: [0],
    }));
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("resolve café sem açúcar pelo motor canônico e nunca pela composição heurística 150/6/15/5", async () => {
    interpretMock.mockResolvedValue(interpretation(interpretedIntent({
      items: [{ foodName: "Café", quantity: 3, unit: "xícaras", brand: null, preparation: "sem açúcar" }],
    })));
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Café da manhã",
      items: [nutritionItem()],
      totals: { calories: 6, protein: 0.6, carbs: 0, fat: 0 },
      sourceText: "3 xícaras de Café sem açúcar",
    });
    createManualMealMock.mockResolvedValue({
      id: 974,
      mealLabel: "Café da manhã",
      occurredAt: receivedAt.toISOString(),
      items: [nutritionItem()],
    });

    const outcome = await tryExecuteWhatsappStructuredCoffeeIntent(42, {
      text: "3 xícaras de café sem açúcar no café da manhã",
      receivedAt,
      messageId: "wamid-974-no-sugar",
    });

    expect(outcome).toMatchObject({ matched: true, result: { action: "llm_intent_add_foods_to_meal" } });
    expect(createManualMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealLabel: "Café da manhã",
      items: [expect.objectContaining({
        canonicalName: "Café sem açúcar",
        calories: 6,
        carbs: 0,
      })],
    }));
    expect(createManualMealMock.mock.calls[0][1].items[0]).not.toMatchObject({
      calories: 150,
      protein: 6,
      carbs: 15,
      fat: 5,
    });
  });

  it("ao responder com açúcar continua no food_clarification.quantity sem perder refeição nem acompanhantes", async () => {
    const target = {
      contractVersion: 1 as const,
      interactionId: "coffee_preparation.sugar_choice" as const,
      kind: "coffee_preparation_clarification" as const,
      originalText: "3 xícaras de café e 1 pão no café da manhã",
      originalReceivedAt: receivedAt.toISOString(),
      inboundMessageId: "wamid-974-sugar",
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
    processMealInputMock.mockRejectedValue(new MealInferenceError(
      "Informe a quantidade de açúcar.",
      "food_component_quantity_required",
      { component: "açúcar" },
    ));
    requestSugarClarificationMock.mockResolvedValue({
      handled: true,
      action: "food_clarification_requested",
      reply: "Informe a quantidade de açúcar.",
      eventType: "whatsapp.food_clarification.quantity_requested",
      detail: "Quantidade de açúcar pendente.",
      data: { pendingOperationId: 903 },
    });

    const result = await resumeWhatsappStructuredCoffeePreparation({
      userId: 42,
      target,
      choice: "with_sugar",
      receivedAt,
    });

    expect(result).toMatchObject({
      action: "clarification_needed",
      reply: expect.stringContaining("quantidade de açúcar"),
    });
    expect(requestSugarClarificationMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      originalText: target.originalText,
      originalFoodText: expect.stringContaining("Pão"),
      operation: expect.objectContaining({
        kind: "register",
        occurredAt: receivedAt.toISOString(),
      }),
      messageId: "wamid-974-sugar",
    }));
    expect(requestSugarClarificationMock.mock.calls[0][0].originalFoodText).toContain("Café da manhã");
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("retoma café sem açúcar preservando o pão e conclui uma única criação", async () => {
    const target = {
      contractVersion: 1 as const,
      interactionId: "coffee_preparation.sugar_choice" as const,
      kind: "coffee_preparation_clarification" as const,
      originalText: "3 xícaras de café e 1 pão",
      originalReceivedAt: receivedAt.toISOString(),
      inboundMessageId: "wamid-974-composite",
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
    const bread = nutritionItem({
      foodName: "Pão",
      canonicalName: "Pão",
      portionText: "1 unidade",
      quantity: 1,
      unit: "unidade",
      estimatedGrams: 50,
      calories: 135,
      protein: 4,
      carbs: 25,
      fat: 2,
    });
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Café da manhã",
      items: [nutritionItem(), bread],
      totals: { calories: 141, protein: 4.6, carbs: 25, fat: 2 },
      sourceText: "3 xícaras de Café sem açúcar e 1 unidade de Pão",
    });
    createManualMealMock.mockResolvedValue({
      id: 975,
      mealLabel: "Café da manhã",
      occurredAt: receivedAt.toISOString(),
      items: [nutritionItem(), bread],
    });

    const result = await resumeWhatsappStructuredCoffeePreparation({
      userId: 42,
      target,
      choice: "without_sugar",
      receivedAt,
    });

    expect(result).toMatchObject({
      action: "llm_intent_add_foods_to_meal",
      data: expect.objectContaining({ itemCount: 2, coffeePreparationResolved: true }),
    });
    expect(processMealInputMock).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("Café sem açúcar"),
    }));
    expect(createManualMealMock).toHaveBeenCalledTimes(1);
    expect(createManualMealMock.mock.calls[0][1].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalName: "Café sem açúcar" }),
      expect.objectContaining({ canonicalName: "Pão" }),
    ]));
  });

  it("bloqueia o fallback quando café genérico chega sem contexto estruturado suficiente", async () => {
    interpretMock.mockResolvedValue(interpretation(interpretedIntent({
      intent: "unknown",
      confidence: 0.34,
      meal: null,
      items: [],
    })));

    const outcome = await tryExecuteWhatsappStructuredCoffeeIntent(42, {
      text: "3 xícaras de café",
      receivedAt,
    });

    expect(outcome).toMatchObject({
      matched: true,
      result: {
        action: "clarification_needed",
        data: undefined,
      },
    });
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });
});
