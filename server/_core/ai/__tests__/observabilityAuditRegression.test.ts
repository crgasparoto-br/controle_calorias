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

function emptyProvider(): AiProvider {
  return {
    createTextResponse: vi.fn(),
    createEmbeddings: vi.fn(),
    createAudioTranscription: vi.fn(),
    createImageGeneration: vi.fn(),
  } as unknown as AiProvider;
}

function factories(provider: AiProvider) {
  return {
    openai: () => provider,
    "openai-compatible": () => provider,
    gemini: () => provider,
  } as const;
}

async function collectEvent(
  provider: AiProvider,
  resolved: ResolvedCapabilityConfig,
  operation: Parameters<typeof executeResolvedCapability>[1],
): Promise<AiInferenceEvent> {
  const events: AiInferenceEvent[] = [];
  await executeResolvedCapability(resolved, operation, {
    providerFactories: factories(provider),
    observabilitySink: event => events.push(event),
  });
  return events[0];
}

describe("issue #926 audit regressions", () => {
  it("captures usage and executed OpenAI tool units before domain projection", async () => {
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

    const event = await collectEvent(provider, config(), async ({ provider: normalized, model }) => {
      const response = await normalized.createTextResponse({ model, input: "synthetic" });
      return { items: JSON.parse(response.outputText).items as unknown[] };
    });

    expect(event).toMatchObject({
      usage: { inputTokens: 1_000, outputTokens: 100 },
      tools: [{ tool: "web_search", executed: true, billableUnits: 1 }],
      estimatedCostUsd: 0.01056,
    });
  });

  it("adds Gemini thinking tokens to billable output", async () => {
    const provider = {
      ...emptyProvider(),
      createTextResponse: vi.fn(async () => ({
        id: "gemini-thinking",
        outputText: "ok",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 200,
          raw: { thoughtsTokenCount: 80 },
        },
        raw: { private: "discarded" },
      })),
    } as unknown as AiProvider;

    const event = await collectEvent(
      provider,
      config({ primary: { provider: "gemini", model: "gemini-2.5-flash" } }),
      ({ provider: normalized, model }) => normalized.createTextResponse({ model, input: "synthetic" }),
    );

    expect(event).toMatchObject({
      usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 80 },
      estimatedCostUsd: 0.00028,
    });
  });

  it("materializes one Gemini grounded-prompt unit without inferring query counts", async () => {
    const provider = {
      ...emptyProvider(),
      createTextResponse: vi.fn(async () => ({
        id: "gemini-grounding",
        outputText: "ok",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        webSearch: { executed: true, sources: [] },
        raw: { private: "discarded" },
      })),
    } as unknown as AiProvider;

    const event = await collectEvent(
      provider,
      config({ primary: { provider: "gemini", model: "gemini-2.5-flash" } }),
      ({ provider: normalized, model }) => normalized.createTextResponse({ model, input: "synthetic" }),
    );

    expect(event).toMatchObject({
      tools: [{ tool: "web_search", executed: true, billableUnits: 1 }],
      estimatedCostUsd: 0.035,
    });
  });

  it("keeps GPT Image usage through the boundary and prices text, image input and output", async () => {
    const provider = {
      ...emptyProvider(),
      createImageGeneration: vi.fn(async () => ({
        b64Json: "AAAA",
        mimeType: "image/png",
        raw: {
          private: "discarded",
          usage: {
            input_tokens: 120,
            output_tokens: 80,
            total_tokens: 200,
            input_tokens_details: { image_tokens: 100 },
          },
        },
      })),
    } as unknown as AiProvider;

    const event = await collectEvent(
      provider,
      config({
        capability: "IMAGE_ANNOTATION",
        primary: { provider: "openai", model: "gpt-image-1" },
      }),
      ({ provider: normalized, model }) =>
        normalized.createImageGeneration({ model, prompt: "synthetic" }),
    );

    expect(event).toMatchObject({
      usage: {
        inputTokens: 120,
        inputImageTokens: 100,
        outputTokens: 80,
        generatedImages: 1,
      },
      estimatedCostUsd: 0.0043,
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

    await expect(executeResolvedCapability(config(), async ({ provider: normalized, model }) => {
      await normalized.createTextResponse({ model, input: "first" });
      try {
        await normalized.createTextResponse({ model, input: "second" });
      } catch {
        // The executor must still fail the attempt.
      }
      return { outputText: "ok" };
    }, {
      providerFactories: factories(provider),
      observabilitySink: event => events.push(event),
    })).rejects.toMatchObject({ code: "incompatible_operation" });

    expect(createTextResponse).toHaveBeenCalledTimes(1);
    expect(events[0]).toMatchObject({
      outcome: "invalid_configuration",
      fallback: { eligibility: "not_eligible", fallbackCalls: 0 },
    });
  });

  it("keeps safety blocks ineligible for configured fallback", async () => {
    const events: AiInferenceEvent[] = [];
    const provider = emptyProvider();
    await expect(executeResolvedCapability(config({
      fallback: {
        requested: true,
        effectivelyEnabled: true,
        provider: "gemini",
        model: "gemini-2.5-flash",
        crossProviderEnabled: true,
      },
    }), async () => {
      throw new AiNonRetryableError("blocked", undefined, "safety_block");
    }, {
      providerFactories: factories(provider),
      observabilitySink: event => events.push(event),
    })).rejects.toThrow("blocked");

    expect(events[0]).toMatchObject({
      outcome: "safety_block",
      fallback: { eligibility: "not_eligible", reason: "safety_block", fallbackCalls: 0 },
    });
  });

  it("marks embedding degradation only when external execution fails", async () => {
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

  it("uses the canonical WhatsApp intent context without callsite options", async () => {
    const event = await collectEvent(
      emptyProvider(),
      config({ capability: "WHATSAPP_INTENT" }),
      async () => ({ intent: "unknown" }),
    );
    expect(event).toMatchObject({ origin: "whatsapp", flow: "whatsapp_intent" });
  });
});
