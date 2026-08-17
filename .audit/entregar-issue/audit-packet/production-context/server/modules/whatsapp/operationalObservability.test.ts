import { beforeEach, describe, expect, it } from "vitest";
import { buildWhatsappAiToolTrace } from "./aiToolContract";
import { __resetWhatsappIntentAuditLogsForTests, recordWhatsappIntentAuditLog } from "./intentAuditLog";
import {
  __resetWhatsappPipelineObservabilityForTests,
  listWhatsappPipelineTraces,
  recordWhatsappPipelineTrace,
  summarizeWhatsappPipelineObservability,
} from "./operationalObservability";
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

describe("operationalObservability", () => {
  beforeEach(() => {
    __resetWhatsappPipelineObservabilityForTests();
    __resetWhatsappIntentAuditLogsForTests();
  });

  it("registra trace por etapas sem armazenar texto cru", () => {
    const entry = recordWhatsappPipelineTrace({
      userId: 42,
      messageText: "texto sensivel para registrar 100g de arroz",
      messageId: "wamid-123",
      createdAt: new Date("2026-06-15T12:00:00.000Z"),
      intent: "add_foods_to_meal",
      contextVersion: "whatsapp-intent-context/v1",
      schemaVersion: "whatsapp-intent-output/v1",
      promptVersion: "whatsapp-prompt/v1",
      ruleVersion: "whatsapp-router-rules/v1",
      strategy: "llm_structured",
      modelName: "gpt-4.1-mini",
      spans: [
        { stage: "normalization", outcome: "success", latencyMs: 3, version: "whatsapp-normalizer/v1" },
        { stage: "router", outcome: "success", latencyMs: 4, version: "whatsapp-router-rules/v1" },
        { stage: "llm", outcome: "success", latencyMs: 220, estimatedCostUnits: 2, modelName: "gpt-4.1-mini" },
        { stage: "validation", outcome: "success", latencyMs: 2, version: "whatsapp-intent-output/v1" },
        { stage: "nutrition_source", outcome: "success", latencyMs: 5, version: "heuristic-nutrition/v1" },
        { stage: "memory", outcome: "skipped", latencyMs: 0, version: "whatsapp-memory/v1" },
        { stage: "tools", outcome: "success", latencyMs: 8, toolId: "meal_record_create" },
        { stage: "persistence", outcome: "success", latencyMs: 12, toolId: "meal_record_create" },
      ],
    });

    expect(entry.messageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.messageIdHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(entry)).not.toContain("texto sensivel");
    expect(entry.spans.map(span => span.stage)).toEqual([
      "normalization",
      "router",
      "llm",
      "validation",
      "nutrition_source",
      "memory",
      "tools",
      "persistence",
    ]);
    expect(listWhatsappPipelineTraces({
      from: "2026-06-15T00:00:00.000Z",
      to: "2026-06-15T23:59:59.999Z",
      intent: "add_foods_to_meal",
      channel: "whatsapp",
      stage: "llm",
      version: "whatsapp-intent-output/v1",
    })).toHaveLength(1);
  });

  it("agrega latencia, custo estimado, modelo, intencao e etapa", () => {
    recordWhatsappPipelineTrace({
      userId: 42,
      messageText: "registro",
      intent: "list_meal_records",
      strategy: "llm_structured",
      modelName: "gpt-4.1-mini",
      spans: [
        { stage: "router", outcome: "success", latencyMs: 10 },
        { stage: "llm", outcome: "success", latencyMs: 110, estimatedCostUnits: 1, modelName: "gpt-4.1-mini" },
        { stage: "validation", outcome: "success", latencyMs: 4 },
      ],
    });
    recordWhatsappPipelineTrace({
      userId: 42,
      messageText: "resumo do dia",
      intent: "daily_summary",
      strategy: "deterministic",
      spans: [
        { stage: "router", outcome: "success", latencyMs: 6 },
        { stage: "validation", outcome: "skipped", latencyMs: 0 },
      ],
    });

    const summary = summarizeWhatsappPipelineObservability();

    expect(summary.totalMessages).toBe(2);
    expect(summary.totalSpans).toBe(5);
    expect(summary.estimatedCostUnits).toBe(1);
    expect(summary.byIntent.list_meal_records).toEqual({ count: 1, estimatedCostUnits: 1 });
    expect(summary.byIntent.daily_summary).toEqual({ count: 1, estimatedCostUnits: 0 });
    expect(summary.byModel["gpt-4.1-mini"]).toEqual({ count: 1, estimatedCostUnits: 1 });
    expect(summary.byStage.llm).toEqual(expect.objectContaining({
      count: 1,
      averageLatencyMs: 110,
      estimatedCostUnits: 1,
    }));
  });

  it("mede erro de API, timeout, retry, fallback e ferramenta indisponivel", () => {
    recordWhatsappPipelineTrace({
      userId: 42,
      messageText: "registro",
      intent: "ambiguous",
      strategy: "safe_fallback",
      modelName: "gpt-4.1-mini",
      spans: [
        { stage: "router", outcome: "fallback", latencyMs: 2, fallbackReason: "api_error" },
        { stage: "llm", outcome: "failure", latencyMs: 800, estimatedCostUnits: 2, retryCount: 1, modelName: "gpt-4.1-mini", errorCode: "api_error" },
        { stage: "validation", outcome: "failure", latencyMs: 1, errorCode: "invalid_json" },
      ],
    });
    recordWhatsappPipelineTrace({
      userId: 42,
      messageText: "refeições registradas",
      intent: "list_meal_records",
      strategy: "safe_fallback",
      spans: [
        { stage: "tools", outcome: "timeout", latencyMs: 1000, toolId: "meal_records_list", errorCode: "timeout" },
        { stage: "tools", outcome: "failure", latencyMs: 30, toolId: "meal_records_list", errorCode: "ServiceUnavailable" },
      ],
    });

    const summary = summarizeWhatsappPipelineObservability();

    expect(summary.errorCount).toBe(2);
    expect(summary.timeoutCount).toBe(1);
    expect(summary.fallbackCount).toBe(2);
    expect(summary.retryCount).toBe(1);
    expect(summary.byStage.llm).toEqual(expect.objectContaining({ errorCount: 1, retryCount: 1 }));
    expect(summary.byStage.tools).toEqual(expect.objectContaining({ errorCount: 2, timeoutCount: 1 }));
    expect(listWhatsappPipelineTraces({ hasTimeout: true })).toHaveLength(1);
    expect(listWhatsappPipelineTraces({ usedFallback: true })).toHaveLength(2);
  });

  it("gera trace operacional a partir da auditoria de intencao", () => {
    const toolTrace = buildWhatsappAiToolTrace({
      toolId: "meal_records_list",
      intent: "list_meal_records",
      outcome: "failure",
      parameterSummary: { dateWindow: "today" },
      failureReason: "ServiceUnavailable",
    });

    recordWhatsappIntentAuditLog({
      userId: 42,
      messageText: "refeições registradas com texto sensivel",
      intent: buildIntent({ intent: "list_meal_records", confidence: 0.9, requiresConfirmation: false, possibleIntents: [] }),
      validationStatus: "invalid_json",
      action: "clarification_needed",
      replyKind: "clarification",
      operationalTrace: {
        strategy: "safe_fallback",
        modelName: "gpt-4.1-mini",
        latencyMs: 320,
        estimatedCostUnits: 2,
        fallbackReason: "api_error",
      },
      toolTrace: [toolTrace],
      fallbackReason: "api_error",
      errorCode: "api_error",
    });

    const traces = listWhatsappPipelineTraces({ intent: "list_meal_records", usedFallback: true });

    expect(traces).toHaveLength(1);
    expect(JSON.stringify(traces[0])).not.toContain("texto sensivel");
    expect(traces[0].spans.map(span => span.stage)).toEqual(expect.arrayContaining(["router", "llm", "validation", "tools"]));
    expect(traces[0].spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "llm", outcome: "failure", retryCount: 1, errorCode: "api_error" }),
      expect.objectContaining({ stage: "validation", outcome: "failure", errorCode: "invalid_json" }),
      expect.objectContaining({ stage: "tools", outcome: "failure", toolId: "meal_records_list", errorCode: "ServiceUnavailable" }),
    ]));
  });
});
