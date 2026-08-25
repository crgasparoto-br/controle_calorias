import { beforeEach, describe, expect, it, vi } from "vitest";

const buildContextMock = vi.hoisted(() => vi.fn());
const interpretMock = vi.hoisted(() => vi.fn());
const auditMock = vi.hoisted(() => vi.fn());
const listMealsMock = vi.hoisted(() => vi.fn());
const createMealMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());

vi.mock("./intentContext", () => ({ buildWhatsappIntentContext: buildContextMock }));
vi.mock("./intentInterpreter", () => ({ interpretWhatsappMessageWithDiagnostics: interpretMock }));
vi.mock("./intentAuditLog", () => ({ recordWhatsappIntentAuditLog: auditMock }));
vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  createManualMeal: createMealMock,
  updateMeal: updateMealMock,
}));
vi.mock("./userMeasurementReplyContext", () => ({
  getWhatsAppUserTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));

import { executeWhatsappLlmIntent } from "./llmIntentActions";

const trace = {
  strategy: "llm_structured" as const,
  modelName: "test",
  latencyMs: 1,
  estimatedCostUnits: 1,
};

describe("LLM intent explicit meal date", () => {
  beforeEach(() => {
    buildContextMock.mockReset().mockResolvedValue({ version: "whatsapp-intent-context/v1" });
    interpretMock.mockReset();
    auditMock.mockReset();
    createMealMock.mockReset();
    updateMealMock.mockReset();
    listMealsMock.mockReset().mockResolvedValue([
      { id: 90, mealLabel: "Jantar", occurredAt: "2026-06-09T22:00:00.000Z", items: [] },
    ]);
  });

  it.each(["hoje", "ontem", "amanhã"])(
    "não cria refeição ausente para '%s' mesmo se createIfMissing vier true",
    async relativeDate => {
      interpretMock.mockResolvedValue({
        source: "llm",
        validationStatus: "valid",
        operationalTrace: trace,
        intent: {
          intent: "add_foods_to_meal",
          confidence: 0.91,
          requiresConfirmation: false,
          possibleIntents: [],
          meal: { label: "jantar", createIfMissing: true },
          date: null,
          items: [{ foodName: "Arroz", quantity: 100, unit: "g" }],
        },
      });

      const result = await executeWhatsappLlmIntent(42, {
        text: `inclua 100g de arroz no jantar de ${relativeDate}`,
        receivedAt: new Date("2026-06-12T15:00:00.000Z"),
        messageId: `explicit-missing-${relativeDate}`,
      });

      expect(result).toEqual(expect.objectContaining({
        action: "clarification_needed",
        data: expect.objectContaining({ explicitDate: true, mutationBlocked: true }),
      }));
      expect(result && "reply" in result ? result.reply : "").toContain("Nada foi alterado");
      expect(createMealMock).not.toHaveBeenCalled();
      expect(updateMealMock).not.toHaveBeenCalled();
    },
  );
});
