import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiInferenceEvent } from "../../_core/ai/observability";

const { logInferenceEventMock } = vi.hoisted(() => ({
  logInferenceEventMock: vi.fn(),
}));

vi.mock("../../db", () => ({
  logInferenceEvent: logInferenceEventMock,
}));

import {
  getAiObservabilitySink,
  setAiObservabilitySink,
} from "../../_core/ai/observability";
import { configureAiObservabilityLogging } from "./logSink";

function event(overrides: Partial<AiInferenceEvent> = {}): AiInferenceEvent {
  return {
    schemaVersion: 1,
    occurredAt: "2026-09-15T12:00:00.000Z",
    executionId: "execution-1088",
    capability: "MEAL_TEXT",
    origin: "whatsapp",
    flow: "meal_text_extraction",
    configuredProvider: "openai",
    configuredModel: "gpt-4.1-mini",
    effectiveProvider: "openai",
    effectiveModel: "gpt-4.1-mini",
    callRole: "primary",
    attemptIndex: 1,
    totalAttempts: 1,
    latencyMs: 12,
    totalLatencyMs: 12,
    outcome: "success",
    tools: [],
    estimatedCostUsd: 0.001,
    executionEstimatedCostUsd: 0.001,
    pricingCatalogVersion: "2026-08-05.3",
    pricingEffectiveDate: "2026-08-05",
    fallback: {
      requested: false,
      enabled: false,
      kind: "none",
      eligibility: "not_needed",
      reason: "not_requested",
      primaryAttempts: 1,
      fallbackCalls: 0,
    },
    degradation: "none",
    correlation: { userId: 1088 },
    ...overrides,
  };
}

describe("AI observability log sink", () => {
  beforeEach(() => {
    logInferenceEventMock.mockReset();
    setAiObservabilitySink(null);
  });

  afterEach(() => {
    setAiObservabilitySink(null);
  });

  it("persiste cada evento canônico como ai.inference_call sem criar outro sink", async () => {
    configureAiObservabilityLogging();
    const sink = getAiObservabilitySink();
    expect(sink).toBeTypeOf("function");

    await sink!(event());

    expect(logInferenceEventMock).toHaveBeenCalledTimes(1);
    expect(logInferenceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1088,
        origin: "whatsapp",
        status: "success",
        eventType: "ai.inference_call",
      })
    );
    const detail = JSON.parse(logInferenceEventMock.mock.calls[0][0].detail);
    expect(detail).toEqual(
      expect.objectContaining({
        executionId: "execution-1088",
        capability: "MEAL_TEXT",
      })
    );
  });
});
