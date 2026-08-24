import { describe, expect, it } from "vitest";
import { buildQuestionLatencyPercentiles } from "./questionLatencyMetrics";

function event(detail: Record<string, unknown>, createdAt: number) {
  return {
    eventType: "whatsapp.ai_question.latency",
    createdAt,
    detail: JSON.stringify({
      capability: "QUESTION",
      flow: "whatsapp_question",
      ...detail,
    }),
  };
}

describe("buildQuestionLatencyPercentiles", () => {
  it("calcula p50/p90/p95 somente sobre sucessos e mantém erros/timeouts separados", () => {
    const logs = Array.from({ length: 20 }, (_, index) => event({
      outcome: "success",
      total_ms: 100 + index * 10,
      error_code: null,
    }, 1_000 + index));
    logs.push(event({ outcome: "error", total_ms: 900, error_code: "provider_timeout" }, 2_000));
    logs.push(event({ outcome: "error", total_ms: 700, error_code: "network" }, 2_100));

    expect(buildQuestionLatencyPercentiles(logs)).toEqual(expect.objectContaining({
      capability: "QUESTION",
      flow: "whatsapp_question",
      sampleSize: 22,
      successfulSamples: 20,
      errors: 2,
      timeouts: 1,
      p50TotalMs: 190,
      p90TotalMs: 270,
      p95TotalMs: 280,
      windowStartAt: 1_000,
      windowEndAt: 2_100,
    }));
  });

  it("ignora eventos de outros fluxos e payloads inválidos", () => {
    const result = buildQuestionLatencyPercentiles([
      { eventType: "other", detail: "{}", createdAt: 1 },
      { eventType: "whatsapp.ai_question.latency", detail: "not-json", createdAt: 2 },
      event({ flow: "another_flow", outcome: "success", total_ms: 1 }, 3),
    ]);

    expect(result).toEqual(expect.objectContaining({
      sampleSize: 0,
      successfulSamples: 0,
      errors: 0,
      timeouts: 0,
      p50TotalMs: null,
      p90TotalMs: null,
      p95TotalMs: null,
    }));
  });
});
