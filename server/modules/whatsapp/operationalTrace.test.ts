import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappOperationalTracesForTests,
  listWhatsappOperationalTraces,
  recordWhatsappOperationalTraceStep,
  startWhatsappOperationalTrace,
  summarizeWhatsappOperationalTraces,
} from "./operationalTrace";

describe("whatsapp operational traces", () => {
  beforeEach(() => {
    __resetWhatsappOperationalTracesForTests();
  });

  it("rastrea etapas, latencia e hash da mensagem sem armazenar texto cru", () => {
    const trace = startWhatsappOperationalTrace({ userId: 42, messageText: "1 banana", messageId: "wamid.1" });

    recordWhatsappOperationalTraceStep(trace, {
      stage: "normalization",
      status: "success",
      durationMs: 12.4,
      ruleVersion: "whatsapp-normalization-v1",
      metadata: { inputModality: "texto" },
    });
    recordWhatsappOperationalTraceStep(trace, {
      stage: "llm_router",
      status: "success",
      durationMs: 30,
      modelName: "gpt-4.1-mini",
      schemaVersion: "whatsapp-intent-v1",
      processingStrategy: "llm_structured",
      intent: "add_foods_to_meal",
      inputChars: 1200,
      outputChars: 400,
    });

    expect(trace.messageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(trace)).not.toContain("1 banana");
    expect(trace).toEqual(expect.objectContaining({
      inputModality: "texto",
      intent: "add_foods_to_meal",
      totalDurationMs: 42,
      statuses: ["success"],
    }));
    expect(trace.totalEstimatedCostUsd).toBeGreaterThan(0);
  });

  it("permite investigar erro, timeout, fallback e ferramenta indisponivel", () => {
    const trace = startWhatsappOperationalTrace({ userId: 42, messageText: "registro" });

    recordWhatsappOperationalTraceStep(trace, {
      stage: "llm_router",
      status: "timeout",
      durationMs: 8000,
      modelName: "gpt-4.1-mini",
      processingStrategy: "llm_error_fallback",
      fallbackReason: "timeout",
      errorCode: "timeout",
      retryCount: 1,
    });
    recordWhatsappOperationalTraceStep(trace, {
      stage: "deterministic_intent",
      status: "fallback",
      durationMs: 2,
      fallbackReason: "llm_timeout_fallback",
    });
    recordWhatsappOperationalTraceStep(trace, {
      stage: "nutrition_persistence",
      status: "error",
      durationMs: 5,
      toolNames: ["meal_create"],
      errorCode: "tool_unavailable",
    });

    expect(listWhatsappOperationalTraces({ hasError: true })).toHaveLength(1);
    expect(listWhatsappOperationalTraces({ status: "timeout" })).toHaveLength(1);
    expect(listWhatsappOperationalTraces({ stage: "nutrition_persistence" })[0].steps.at(-1)).toEqual(expect.objectContaining({
      errorCode: "tool_unavailable",
      toolNames: ["meal_create"],
    }));
  });

  it("resume traces por etapa, custo e erro", () => {
    const trace = startWhatsappOperationalTrace({ userId: 42, messageText: "1 banana" });
    recordWhatsappOperationalTraceStep(trace, { stage: "normalization", status: "success", durationMs: 10 });
    recordWhatsappOperationalTraceStep(trace, {
      stage: "llm_router",
      status: "error",
      durationMs: 100,
      modelName: "gpt-4.1-mini",
      inputChars: 4000,
      outputChars: 0,
      errorCode: "api_error",
    });

    const summary = summarizeWhatsappOperationalTraces();

    expect(summary.traceCount).toBe(1);
    expect(summary.totalDurationMs).toBe(110);
    expect(summary.totalEstimatedCostUsd).toBeGreaterThan(0);
    expect(summary.byStage).toEqual(expect.objectContaining({
      normalization: expect.objectContaining({ count: 1, avgDurationMs: 10, errors: 0 }),
      llm_router: expect.objectContaining({ count: 1, avgDurationMs: 100, errors: 1 }),
    }));
  });
});
