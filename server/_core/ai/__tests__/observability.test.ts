import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../../aiProvider";
import {
  executeResolvedCapability,
  observeUnavailableResolvedCapability,
} from "../capabilityExecutor";
import type { ResolvedCapabilityConfig } from "../configResolver";
import type { AiInferenceEvent } from "../observability";
import { sanitizeAiCorrelation, serializeAiInferenceEvent } from "../observability";
import {
  AiNonRetryableError,
  AiOperationalError,
  createJsonOutputValidator,
} from "../policyExecutor";

function config(overrides: Partial<ResolvedCapabilityConfig> = {}): ResolvedCapabilityConfig {
  return {
    capability: "QUESTION",
    state: "ready",
    primary: { provider: "openai", model: "gpt-4.1-mini" },
    timeoutMs: 1_000,
    maxAttempts: 2,
    fallback: {
      requested: true,
      effectivelyEnabled: true,
      provider: "gemini",
      model: "gemini-2.5-flash",
      crossProviderEnabled: true,
    },
    diagnostics: [],
    usedLegacyVariables: false,
    ...overrides,
  };
}

function fakeProvider(): AiProvider {
  return {} as AiProvider;
}

describe("AI observability", () => {
  it("emits one normalized event for each sequential attempt and one fallback", async () => {
    const events: AiInferenceEvent[] = [];
    const operation = vi.fn(async ({ source }) => ({
      outputText: source === "primary" ? "not-json-sensitive" : '{"ok":true}',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      webSearch: { executed: false, sources: [] },
    }));

    const result = await executeResolvedCapability(config(), operation, {
      providerFactories: {
        openai: () => fakeProvider(),
        "openai-compatible": () => fakeProvider(),
        gemini: () => fakeProvider(),
      },
      observability: {
        origin: "whatsapp",
        flow: "question_answer",
        correlation: { requestId: "req-123", prompt: "must-not-be-used" },
      },
      validateResult: createJsonOutputValidator(),
      observabilitySink: event => events.push(event),
    });

    expect(result.source).toBe("fallback");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(events).toHaveLength(3);
    expect(events.map(event => event.callRole)).toEqual(["primary", "retry", "fallback"]);
    expect(events.map(event => event.attemptIndex)).toEqual([1, 2, 3]);
    expect(events.every(event => event.totalAttempts === 3)).toBe(true);
    expect(new Set(events.map(event => event.executionId))).toHaveSize(1);
    expect(events.map(event => event.outcome)).toEqual(["invalid_json", "invalid_json", "success"]);
    expect(events.every(event => event.executionEstimatedCostUsd === 0.000224)).toBe(true);
    expect(events[2]).toMatchObject({
      effectiveProvider: "gemini",
      effectiveModel: "gemini-2.5-flash",
      outcome: "success",
      fallback: {
        kind: "cross_provider",
        primaryAttempts: 2,
        fallbackCalls: 1,
        eligibility: "executed",
      },
    });
    expect(events[0].correlation).toEqual({ requestId: "req-123" });
    expect(serializeAiInferenceEvent(events[0])).not.toContain("not-json-sensitive");
    expect(serializeAiInferenceEvent(events[0])).not.toContain("must-not-be-used");
  });

  it("distinguishes same-provider fallback and an executed tool from an offered tool", async () => {
    const events: AiInferenceEvent[] = [];
    const sameProvider = config({
      maxAttempts: 1,
      fallback: {
        requested: true,
        effectivelyEnabled: true,
        provider: "openai",
        model: "gpt-4.1-mini-2025-04-14",
        crossProviderEnabled: false,
      },
    });

    await executeResolvedCapability(sameProvider, async ({ source }) => {
      if (source === "primary") throw new AiOperationalError("retryable", undefined, "rate_limit");
      return {
        outputText: "ok",
        usage: { inputTokens: 1_000, outputTokens: 100 },
        webSearch: { executed: true, searchCount: 1, sources: [] },
      };
    }, {
      providerFactories: {
        openai: () => fakeProvider(),
        "openai-compatible": () => fakeProvider(),
        gemini: () => fakeProvider(),
      },
      observabilitySink: event => events.push(event),
    });

    expect(events[0].outcome).toBe("rate_limit");
    expect(events[1].fallback.kind).toBe("same_provider");
    expect(events[1].tools).toEqual([{ tool: "web_search", executed: true, billableUnits: 1 }]);
    expect(events[1].estimatedCostUsd).not.toBeNull();
  });

  it("isolates sink failures from the functional result", async () => {
    const result = await executeResolvedCapability(
      config({ maxAttempts: 1, fallback: { ...config().fallback, effectivelyEnabled: false } }),
      async () => ({ outputText: "ok", usage: { inputTokens: 1, outputTokens: 1 } }),
      {
        providerFactories: {
          openai: () => fakeProvider(),
          "openai-compatible": () => fakeProvider(),
          gemini: () => fakeProvider(),
        },
        observabilitySink: async () => {
          throw new Error("telemetry unavailable");
        },
      },
    );

    expect(result.value.outputText).toBe("ok");
    expect(result.attempts).toBe(1);
  });

  it.each([
    ["empty_output", { outputText: "" }, undefined],
    ["invalid_json", { outputText: "not-json" }, "invalid_json"],
    ["invalid_payload", { outputText: "{}" }, "invalid_payload"],
    ["safety_block", null, "safety_block"],
  ] as const)("normalizes %s at the attempt boundary", async (expected, value, forcedCode) => {
    const events: AiInferenceEvent[] = [];
    const singleAttempt = config({
      maxAttempts: 1,
      fallback: { ...config().fallback, effectivelyEnabled: false },
    });

    const operation = forcedCode === "safety_block"
      ? async () => { throw new AiNonRetryableError("blocked", undefined, forcedCode); }
      : async () => value;

    await expect(executeResolvedCapability(singleAttempt, operation, {
      providerFactories: {
        openai: () => fakeProvider(),
        "openai-compatible": () => fakeProvider(),
        gemini: () => fakeProvider(),
      },
      ...(forcedCode && forcedCode !== "safety_block"
        ? { validateResult: () => { throw new AiOperationalError("invalid", undefined, forcedCode); } }
        : {}),
      observabilitySink: event => events.push(event),
    })).rejects.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe(expected);
  });

  it("normalizes timeout after cancellation acknowledgment", async () => {
    const events: AiInferenceEvent[] = [];
    const timeoutConfig = config({
      timeoutMs: 1,
      maxAttempts: 1,
      fallback: { ...config().fallback, effectivelyEnabled: false },
    });

    await expect(executeResolvedCapability(timeoutConfig, ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }), {
      providerFactories: {
        openai: () => fakeProvider(),
        "openai-compatible": () => fakeProvider(),
        gemini: () => fakeProvider(),
      },
      observabilitySink: event => events.push(event),
    })).rejects.toThrow("timed out");

    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe("timeout");
  });

  it("emits a configuration event for consumers that degrade before execution", async () => {
    const events: AiInferenceEvent[] = [];
    await observeUnavailableResolvedCapability(
      config({ state: "disabled", primary: null }),
      { origin: "system", flow: "catalog_embeddings" },
      event => events.push(event),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      attemptIndex: 0,
      totalAttempts: 0,
      outcome: "invalid_configuration",
      flow: "catalog_embeddings",
    });
  });

  it("records invalid configuration without creating a provider attempt", async () => {
    const events: AiInferenceEvent[] = [];
    const invalid = config({ state: "invalid", primary: null });
    const factory = vi.fn(() => fakeProvider());

    await expect(executeResolvedCapability(invalid, vi.fn(), {
      providerFactories: {
        openai: factory,
        "openai-compatible": factory,
        gemini: factory,
      },
      observabilitySink: event => events.push(event),
    })).rejects.toThrow("not executable");

    expect(factory).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      attemptIndex: 0,
      totalAttempts: 0,
      outcome: "invalid_configuration",
      estimatedCostUsd: null,
    });
  });

  it("records a blocked cross-provider fallback without executing it", async () => {
    const events: AiInferenceEvent[] = [];
    const blocked = config({
      maxAttempts: 1,
      fallback: {
        requested: true,
        effectivelyEnabled: false,
        provider: "gemini",
        model: "gemini-2.5-flash",
        crossProviderEnabled: false,
      },
    });
    const operation = vi.fn(async () => {
      throw new AiOperationalError("temporary outage", undefined, "network");
    });

    await expect(executeResolvedCapability(blocked, operation, {
      providerFactories: {
        openai: () => fakeProvider(),
        "openai-compatible": () => fakeProvider(),
        gemini: () => fakeProvider(),
      },
      observabilitySink: event => events.push(event),
    })).rejects.toThrow("temporary outage");

    expect(operation).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      outcome: "external_error",
      fallback: {
        requested: true,
        enabled: false,
        kind: "cross_provider",
        eligibility: "not_eligible",
        reason: "cross_provider_disabled",
        fallbackCalls: 0,
      },
    });
  });


  it("distinguishes quality escalation and local degradation from provider fallback", async () => {
    const events: AiInferenceEvent[] = [];
    await executeResolvedCapability(
      config({
        maxAttempts: 1,
        fallback: { ...config().fallback, requested: false, effectivelyEnabled: false },
      }),
      async () => ({ outputText: "ok", usage: { inputTokens: 1, outputTokens: 1 } }),
      {
        providerFactories: {
          openai: () => fakeProvider(),
          "openai-compatible": () => fakeProvider(),
          gemini: () => fakeProvider(),
        },
        observability: {
          origin: "system",
          flow: "question_answer",
          callRole: "escalation",
          degradation: "local",
        },
        observabilitySink: event => events.push(event),
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      callRole: "escalation",
      degradation: "local",
      fallback: { kind: "none", fallbackCalls: 0 },
    });
  });

  it("bounds correlation cardinality and never includes arbitrary objects", () => {
    const correlation = sanitizeAiCorrelation({
      "request id": "abc 123",
      count: 2,
      allowed: true,
      ignored: undefined,
      object: { secret: "x" } as unknown as string,
      prompt: "private meal text",
      errorMessage: "provider response body",
    });
    expect(correlation).toEqual({
      request_id: "abc_123",
      count: 2,
      allowed: true,
    });
  });
});
