import { beforeEach, describe, expect, it } from "vitest";
import { __resetWhatsappIntentAuditLogsForTests, listWhatsappIntentAuditLogs, recordWhatsappIntentAuditLog } from "./intentAuditLog";
import type { WhatsappInterpretedIntent } from "./intentSchema";

function buildIntent(overrides: Partial<WhatsappInterpretedIntent> = {}): WhatsappInterpretedIntent {
  return {
    intent: "unknown",
    confidence: 0.3,
    items: [],
    requiresConfirmation: true,
    possibleIntents: ["add_foods_to_meal"],
    ...overrides,
  };
}

describe("intentAuditLog", () => {
  beforeEach(() => {
    __resetWhatsappIntentAuditLogsForTests();
  });

  it("registra auditoria sem armazenar texto cru da mensagem", () => {
    const entry = recordWhatsappIntentAuditLog({
      userId: 42,
      messageText: "texto sensivel do usuario",
      intent: buildIntent({ intent: "list_meal_records", confidence: 0.91, requiresConfirmation: false, possibleIntents: [] }),
      validationStatus: "valid",
      action: "llm_intent_list_meal_records",
      replyKind: "executed",
    });

    expect(entry.messageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(entry)).not.toContain("texto sensivel do usuario");
    expect(entry.payloadSummary).toEqual(expect.objectContaining({
      itemCount: 0,
      requiresConfirmation: false,
    }));
    expect(entry.operationalTrace).toEqual({
      strategy: "deterministic",
      modelName: null,
      latencyMs: 0,
      estimatedCostUnits: 0,
    });
  });

  it("registra rastro operacional de modelo, custo, latencia e fallback", () => {
    const entry = recordWhatsappIntentAuditLog({
      userId: 42,
      messageText: "registro",
      intent: buildIntent({ intent: "ambiguous", confidence: 0.41 }),
      validationStatus: "invalid_json",
      action: "clarification_needed",
      replyKind: "clarification",
      operationalTrace: {
        strategy: "safe_fallback",
        modelName: "gpt-4.1-mini",
        latencyMs: 12.6,
        estimatedCostUnits: 1,
        fallbackReason: "invalid_json",
      },
      fallbackReason: "invalid_json",
      errorCode: "invalid_json",
    });

    expect(entry.operationalTrace).toEqual({
      strategy: "safe_fallback",
      modelName: "gpt-4.1-mini",
      latencyMs: 13,
      estimatedCostUnits: 1,
      fallbackReason: "invalid_json",
    });
  });

  it("filtra por intencao, erro, baixa confianca, motivo de fallback e estrategia", () => {
    recordWhatsappIntentAuditLog({
      userId: 42,
      messageText: "refeições registradas",
      intent: buildIntent({ intent: "list_meal_records", confidence: 0.9, requiresConfirmation: false, possibleIntents: [] }),
      validationStatus: "valid",
      action: "llm_intent_list_meal_records",
      replyKind: "executed",
      operationalTrace: { strategy: "deterministic" },
    });
    recordWhatsappIntentAuditLog({
      userId: 42,
      messageText: "registro",
      intent: buildIntent({ intent: "ambiguous", confidence: 0.41 }),
      validationStatus: "invalid_json",
      action: "clarification_needed",
      replyKind: "clarification",
      operationalTrace: {
        strategy: "safe_fallback",
        modelName: "gpt-4.1-mini",
        estimatedCostUnits: 1,
        fallbackReason: "invalid_json",
      },
      fallbackReason: "invalid_json",
      errorCode: "invalid_json",
    });

    expect(listWhatsappIntentAuditLogs({ intent: "list_meal_records" })).toHaveLength(1);
    expect(listWhatsappIntentAuditLogs({ hasError: true })).toHaveLength(1);
    expect(listWhatsappIntentAuditLogs({ lowConfidence: true })).toHaveLength(1);
    expect(listWhatsappIntentAuditLogs({ fallbackReason: "invalid_json" })).toHaveLength(1);
    expect(listWhatsappIntentAuditLogs({ strategy: "deterministic" })).toHaveLength(1);
    expect(listWhatsappIntentAuditLogs({ strategy: "safe_fallback" })).toHaveLength(1);
  });
});
