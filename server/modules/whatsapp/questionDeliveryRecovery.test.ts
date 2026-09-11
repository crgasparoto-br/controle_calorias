import { describe, expect, it } from "vitest";
import { isRetryableQuestionDeliveryFailure } from "./questionDeliveryRecovery";

function result(category: "validation" | "config" | "network" | "provider" | "none", providerStatus?: number) {
  return {
    ok: false,
    primaryOk: false,
    primaryEffectiveOk: false,
    recorded: false,
    sends: [{
      message: { type: "text" as const, body: "x" },
      role: "primary" as const,
      originalOk: false,
      usedFallback: false,
      effectiveOk: false,
      category,
      sequenceDecision: "stop" as const,
      providerStatus,
      ok: false,
      detail: "failure",
    }],
  };
}

describe("question delivery recovery", () => {
  it("considera rede e respostas temporarias da Meta retryaveis", () => {
    expect(isRetryableQuestionDeliveryFailure(result("network"))).toBe(true);
    expect(isRetryableQuestionDeliveryFailure(result("provider", 429))).toBe(true);
    expect(isRetryableQuestionDeliveryFailure(result("provider", 503))).toBe(true);
  });

  it("nao repete falhas deterministicas de validacao/configuracao", () => {
    expect(isRetryableQuestionDeliveryFailure(result("validation"))).toBe(false);
    expect(isRetryableQuestionDeliveryFailure(result("config"))).toBe(false);
    expect(isRetryableQuestionDeliveryFailure(result("provider", 400))).toBe(false);
  });
});
