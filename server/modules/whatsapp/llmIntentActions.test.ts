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
      fallbackReason: "low_confidence",
    }));
  });

  it("deixa texto comum de refeicao seguir para inferencia nutricional", async () => {
    interpretWhatsappMessageWithDiagnosticsMock.mockResolvedValue({
      source: "llm",
      validationStatus: "valid",
      intent: interpretedIntent({ intent: "unknown", confidence: 0.34 }),
    });

    const result = await executeWhatsappLlmIntent(42, { text: "almocei arroz, feijão e frango" });

    expect(result).toBeNull();
    expect(recordWhatsappIntentAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "fallback_to_nutrition",
      replyKind: "fallback",
      fallbackReason: "nutrition_fallback",
    }));
  });

  it("lista refeicoes do dia quando a intencao contextual for consulta", async () => {
    listMealsMock.mockResolvedValue([{ id: 10, mealLabel: "Almoço", occurredAt: "2026-06-12T15:00:00.000Z", items: [{ foodName: "Arroz", canonicalName: "Arroz", portionText: "100 g", servings: 1, estimatedGrams: 100, calories: 130, protein: 2.7, carbs: 28, fat: 0.3, confidence: 0.9, source: "catalog" }] }]);
    interpretWhatsappMessageWithDiagnosticsMock.mockResolvedValue({
      source: "llm",
      validationStatus: "valid",
      intent: interpretedIntent({ intent: "list_meal_records", confidence: 0.91, requiresConfirmation: false, possibleIntents: [] }),
    });

    const result = await executeWhatsappLlmIntent(42, { text: "refeições registradas", receivedAt: new Date("2026-06-12T16:00:00.000Z") });

    expect(result).toEqual(expect.objectContaining({
      action: "llm_intent_list_meal_records",
      eventType: "whatsapp.llm_intent.list_meal_records",
    }));
    expect(result?.reply).toContain("Refeicoes registradas hoje");
    expect(result?.reply).toContain("Almoço");
  });
});
