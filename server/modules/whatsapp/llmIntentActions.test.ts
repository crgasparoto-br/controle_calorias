import { beforeEach, describe, expect, it, vi } from "vitest";

const buildWhatsappIntentContextMock = vi.hoisted(() => vi.fn());
const interpretWhatsappMessageWithDiagnosticsMock = vi.hoisted(() => vi.fn());
const recordWhatsappIntentAuditLogMock = vi.hoisted(() => vi.fn());
const listMealsMock = vi.hoisted(() => vi.fn());
const createManualMealMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());

vi.mock("./intentContext", () => ({
  buildWhatsappIntentContext: buildWhatsappIntentContextMock,
}));

vi.mock("./intentInterpreter", () => ({
  interpretWhatsappMessageWithDiagnostics: interpretWhatsappMessageWithDiagnosticsMock,
}));

vi.mock("./intentAuditLog", () => ({
  recordWhatsappIntentAuditLog: recordWhatsappIntentAuditLogMock,
}));

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  createManualMeal: createManualMealMock,
  updateMeal: updateMealMock,
}));

import { executeWhatsappLlmIntent } from "./llmIntentActions";

function interpretedIntent(overrides: Record<string, unknown> = {}) {
  return {
    intent: "unknown",
    confidence: 0.3,
    items: [],
    requiresConfirmation: true,
    possibleIntents: ["add_foods_to_meal"],
    ...overrides,
  };
}

describe("executeWhatsappLlmIntent", () => {
  beforeEach(() => {
    buildWhatsappIntentContextMock.mockReset();
    interpretWhatsappMessageWithDiagnosticsMock.mockReset();
    recordWhatsappIntentAuditLogMock.mockReset();
    listMealsMock.mockReset();
    createManualMealMock.mockReset();
    updateMealMock.mockReset();

    buildWhatsappIntentContextMock.mockResolvedValue({ version: "whatsapp-intent-context/v1" });
    listMealsMock.mockResolvedValue([]);
  });

  it("responde com esclarecimento para baixa confianca e registra auditoria", async () => {
    interpretWhatsappMessageWithDiagnosticsMock.mockResolvedValue({
      source: "llm",
      validationStatus: "valid",
      processingStrategy: "llm_structured",
      durationMs: 12,
      modelName: "gpt-4.1-mini",
      intent: interpretedIntent({ confidence: 0.42, clarificationQuestion: "Você quer registrar ou consultar?" }),
    });

    const result = await executeWhatsappLlmIntent(42, { text: "registro", receivedAt: new Date("2026-06-12T12:00:00.000Z") });

    expect(result).toEqual(expect.objectContaining({
      action: "clarification_needed",
      reply: "Você quer registrar ou consultar?",
    }));
    expect(recordWhatsappIntentAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      messageText: "registro",
      action: "clarification_needed",
      replyKind: "clarification",
      processingStrategy: "llm_structured",
      durationMs: 12,
      modelName: "gpt-4.1-mini",
      fallbackReason: "low_confidence",
      toolNames: undefined,
      autonomyLevel: "requer_confirmacao",
      autonomyOutcome: "clarify",
    }));
  });

  it("deixa texto comum de refeicao seguir para inferencia nutricional", async () => {
    interpretWhatsappMessageWithDiagnosticsMock.mockResolvedValue({
      source: "llm",
      validationStatus: "valid",
      processingStrategy: "llm_structured",
      durationMs: 15,
      intent: interpretedIntent({ intent: "unknown", confidence: 0.34 }),
    });

    const result = await executeWhatsappLlmIntent(42, { text: "almocei arroz, feijão e frango" });

    expect(result).toBeNull();
    expect(recordWhatsappIntentAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "fallback_to_nutrition",
      replyKind: "fallback",
      fallbackReason: "nutrition_fallback",
      processingStrategy: "llm_structured",
      toolNames: undefined,
    }));
  });

  it("lista refeicoes do dia quando a intencao contextual for consulta", async () => {
    listMealsMock.mockResolvedValue([{ id: 10, mealLabel: "Almoço", occurredAt: "2026-06-12T15:00:00.000Z", items: [{ foodName: "Arroz", canonicalName: "Arroz", portionText: "100 g", servings: 1, estimatedGrams: 100, calories: 130, protein: 2.7, carbs: 28, fat: 0.3, confidence: 0.9, source: "catalog" }] }]);
    interpretWhatsappMessageWithDiagnosticsMock.mockResolvedValue({
      source: "llm",
      validationStatus: "valid",
      processingStrategy: "llm_structured",
      durationMs: 20,
      intent: interpretedIntent({ intent: "list_meal_records", confidence: 0.91, requiresConfirmation: false, possibleIntents: [] }),
    });

    const result = await executeWhatsappLlmIntent(42, { text: "refeições registradas", receivedAt: new Date("2026-06-12T16:00:00.000Z") });

    expect(result).toEqual(expect.objectContaining({
      action: "llm_intent_list_meal_records",
      eventType: "whatsapp.llm_intent.list_meal_records",
      toolNames: ["meal_history_read"],
    }));
    expect(result?.reply).toContain("Refeicoes registradas hoje");
    expect(result?.reply).toContain("Almoço");
    expect(recordWhatsappIntentAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "llm_intent_list_meal_records",
      replyKind: "executed",
      toolNames: ["meal_history_read"],
      autonomyLevel: "automatico",
      autonomyOutcome: "execute",
    }));
  });

  it("registra ferramentas de validacao, leitura e escrita ao criar refeicao", async () => {
    createManualMealMock.mockResolvedValue({ id: 22, mealLabel: "Café da manhã", occurredAt: "2026-06-12T12:00:00.000Z" });
    interpretWhatsappMessageWithDiagnosticsMock.mockResolvedValue({
      source: "llm",
      validationStatus: "valid",
      processingStrategy: "llm_structured",
      durationMs: 18,
      intent: interpretedIntent({
        intent: "add_foods_to_meal",
        confidence: 0.88,
        requiresConfirmation: false,
        possibleIntents: [],
        meal: { label: "café da manhã", createIfMissing: true },
        items: [{ foodName: "banana", quantity: 1, unit: "unidade" }],
      }),
    });

    const result = await executeWhatsappLlmIntent(42, { text: "Inclua no café da manhã: 1 banana", receivedAt: new Date("2026-06-12T12:00:00.000Z") });

    expect(result).toEqual(expect.objectContaining({
      action: "llm_intent_add_foods_to_meal",
      toolNames: ["nutrition_measurement_resolve", "meal_history_read", "meal_create"],
    }));
    expect(recordWhatsappIntentAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "llm_intent_add_foods_to_meal",
      toolNames: ["nutrition_measurement_resolve", "meal_history_read", "meal_create"],
      autonomyLevel: "automatico",
      autonomyOutcome: "execute",
    }));
  });

  it("bloqueia gravacao da IA quando alimento nao tem quantidade e unidade validadas", async () => {
    interpretWhatsappMessageWithDiagnosticsMock.mockResolvedValue({
      source: "llm",
      validationStatus: "valid",
      processingStrategy: "llm_structured",
      durationMs: 18,
      intent: interpretedIntent({
        intent: "add_foods_to_meal",
        confidence: 0.9,
        requiresConfirmation: false,
        possibleIntents: [],
        meal: { label: "jantar", createIfMissing: true },
        items: [{ foodName: "pão", quantity: null, unit: null }],
      }),
    });

    const result = await executeWhatsappLlmIntent(42, { text: "Registra pão no jantar" });

    expect(result).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.llm_intent.validation_failed",
    }));
    expect(result?.reply).toContain("quantidade clara");
    expect(listMealsMock).not.toHaveBeenCalled();
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(recordWhatsappIntentAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "clarification_needed",
      replyKind: "clarification",
      fallbackReason: "backend_validation_failed",
      errorCode: "invalid_quantity",
      autonomyLevel: "automatico",
      autonomyOutcome: "execute",
    }));
  });

  it("bloqueia payload estruturado nao validado antes de gravar", async () => {
    interpretWhatsappMessageWithDiagnosticsMock.mockResolvedValue({
      source: "llm",
      validationStatus: "skipped",
      processingStrategy: "llm_structured",
      durationMs: 18,
      intent: interpretedIntent({
        intent: "add_foods_to_meal",
        confidence: 0.9,
        requiresConfirmation: false,
        possibleIntents: [],
        meal: { label: "jantar", createIfMissing: true },
        items: [{ foodName: "arroz", quantity: 100, unit: "g" }],
      }),
    });

    const result = await executeWhatsappLlmIntent(42, { text: "Registra 100g de arroz no jantar" });

    expect(result).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.llm_intent.validation_failed",
    }));
    expect(listMealsMock).not.toHaveBeenCalled();
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(recordWhatsappIntentAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
      fallbackReason: "backend_validation_failed",
      errorCode: "invalid_schema",
    }));
  });

  it("exige confirmacao antes de executar correcao de alimento", async () => {
    interpretWhatsappMessageWithDiagnosticsMock.mockResolvedValue({
      source: "llm",
      validationStatus: "valid",
      processingStrategy: "llm_structured",
      durationMs: 16,
      intent: interpretedIntent({
        intent: "replace_food_in_meal",
        confidence: 0.93,
        requiresConfirmation: false,
        possibleIntents: [],
        sourceFood: "banana da terra",
        targetFood: "batata doce assada",
      }),
    });

    const result = await executeWhatsappLlmIntent(42, { text: "Não é banana da terra e sim batata doce assada" });

    expect(result).toEqual(expect.objectContaining({
      action: "clarification_needed",
      data: expect.objectContaining({
        autonomyLevel: "requer_confirmacao",
        autonomyOutcome: "clarify",
      }),
    }));
    expect(listMealsMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(recordWhatsappIntentAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "clarification_needed",
      replyKind: "clarification",
      fallbackReason: "autonomy_requires_confirmation",
      autonomyLevel: "requer_confirmacao",
      autonomyOutcome: "clarify",
    }));
  });
});
