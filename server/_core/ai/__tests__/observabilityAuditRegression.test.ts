import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../../aiProvider";
import { executeResolvedCapability } from "../capabilityExecutor";
import type { ResolvedCapabilityConfig } from "../configResolver";
import type { AiInferenceEvent } from "../observability";
import { AiNonRetryableError, AiOperationalError } from "../policyExecutor";

function config(overrides: Partial<ResolvedCapabilityConfig> = {}): ResolvedCapabilityConfig {
  return {
    capability: "QUESTION",
    state: "ready",
    primary: { provider: "openai", model: "gpt-4.1-mini" },
    timeoutMs: 1_000,
    maxAttempts: 1,
    fallback: {
      requested: false,
      effectivelyEnabled: false,
      provider: null,
      model: null,
      crossProviderEnabled: false,
    },
    diagnostics: [],
    usedLegacyVariables: false,
    ...overrides,
  };
}

function factories(provider: AiProvider) {
  return {
    openai: () => provider,
    "openai-compatible": () => provider,
    gemini: () => provider,
  } as const;
}

function emptyProvider(): AiProvider {
  return {
    createTextResponse: vi.fn(),
    createEmbeddings: vi.fn(),
    createAudioTranscription: vi.fn(),
    createImageGeneration: vi.fn(),
  } as unknown as AiProvider;
}

describe("issue #926 audit regressions", () => {
  it("captures usage and tools before the domain projection discards provider metadata", async () => {
    const events: AiInferenceEvent[] = [];
    const provider = {
      ...emptyProvider(),
      createTextResponse: vi.fn(async () => ({
        id: "response-1",
        outputText: '{"items":[]}',
        usage: { inputTokens: 1_000, outputTokens: 100 },
        webSearch: { executed: true, searchCount: 1, sources: [] },
        raw: { private: "discarded" },
      })),
    } as unknown as AiProvider;

    const result = await executeResolvedCapability(
      config(),
      async ({ provider: normalizedProvider, model }) => {
        const response = await normalizedProvider.createTextResponse({ model, input: "synthetic" });
        return { items: JSON.parse(response.outputText).items as unknown[] };
      },
      {
        providerFactories: factories(provider),
        observabilitySink: event => events.push(event),
      },
    );

    expect(result.value).toEqual({ items: [] });
    expect(events[0]).toMatchObject({
      usage: { inputTokens: 1_000, outputTokens: 100 },
      tools: [{ tool: "web_search", executed: true, billableUnits: 1 }],
      estimatedCostUsd: 0.01056,
    });
  });

  it("blocks a second outbound call even when the consumer catches the rejection", async () => {
    const events: AiInferenceEvent[] = [];
    const createTextResponse = vi.fn(async () => ({
      id: "response-1",
      outputText: "ok",
      usage: { inputTokens: 1, outputTokens: 1 },
      raw: {},
    }));
    const provider = { ...emptyProvider(), createTextResponse } as unknown as AiProvider;

    await expect(executeResolvedCapability(
      config(),
      async ({ provider: normalizedProvider, model }) => {
        await normalizedProvider.createTextResponse({ model, input: "first" });
        try {
          await normalizedProvider.createTextResponse({ model, input: "second" });
        } catch {
          // The executor must still fail the attempt.
        }
        return { outputText: "ok" };
      },
      {
        providerFactories: factories(provider),
        observabilitySink: event => events.push(event),
      },
    )).rejects.toMatchObject({ code: "incompatible_operation" });

    expect(createTextResponse).toHaveBeenCalledTimes(1);
    expect(events[0]).toMatchObject({
      outcome: "invalid_configuration",
      fallback: { eligibility: "not_eligible", fallbackCalls: 0 },
    });
  });

  it("keeps safety blocks ineligible when fallback is configured", async () => {
    const events: AiInferenceEvent[] = [];
    const provider = emptyProvider();
    await expect(executeResolvedCapability(
      config({
        fallback: {
          requested: true,
          effectivelyEnabled: true,
          provider: "gemini",
          model: "gemini-2.5-flash",
          crossProviderEnabled: true,
        },
      }),
      async () => {
        throw new AiNonRetryableError("blocked", undefined, "safety_block");
      },
      {
        providerFactories: factories(provider),
        observabilitySink: event => events.push(event),
      },
    )).rejects.toThrow("blocked");

    expect(events[0]).toMatchObject({
      outcome: "safety_block",
      fallback: { eligibility: "not_eligible", reason: "safety_block", fallbackCalls: 0 },
    });
  });

  it("marks embedding degradation only when the external execution ends in failure", async () => {
    const successEvents: AiInferenceEvent[] = [];
    const failureEvents: AiInferenceEvent[] = [];
    const provider = emptyProvider();
    const embeddingConfig = config({
      capability: "EMBEDDING",
      primary: { provider: "openai", model: "text-embedding-3-small" },
    });

    await executeResolvedCapability(embeddingConfig, async () => ({ embeddings: [[0.1]] }), {
      providerFactories: factories(provider),
      observabilitySink: event => successEvents.push(event),
    });
    await expect(executeResolvedCapability(embeddingConfig, async () => {
      throw new AiOperationalError("network", undefined, "network");
    }, {
      providerFactories: factories(provider),
      observabilitySink: event => failureEvents.push(event),
    })).rejects.toThrow("network");

    expect(successEvents[0]).toMatchObject({
      origin: "system",
      flow: "catalog_embeddings",
      degradation: "none",
    });
    expect(failureEvents[0]).toMatchObject({
      origin: "system",
      flow: "catalog_embeddings",
      degradation: "local",
    });
  });

  it("uses the canonical WhatsApp intent context without callsite-specific options", async () => {
    const events: AiInferenceEvent[] = [];
    const provider = emptyProvider();
    await executeResolvedCapability(
      config({ capability: "WHATSAPP_INTENT" }),
      async () => ({ intent: "unknown" }),
      {
        providerFactories: factories(provider),
        observabilitySink: event => events.push(event),
      },
    );

    expect(events[0]).toMatchObject({ origin: "whatsapp", flow: "whatsapp_intent" });
  });
});
