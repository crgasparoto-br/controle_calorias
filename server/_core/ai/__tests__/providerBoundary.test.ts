import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../../aiProvider";
import { createNormalizedProviderBoundary } from "../providerBoundary";

function baseProvider(overrides: Partial<AiProvider>): AiProvider {
  return {
    createTextResponse: vi.fn(),
    createEmbeddings: vi.fn(),
    createAudioTranscription: vi.fn(),
    createImageGeneration: vi.fn(),
    ...overrides,
  } as AiProvider;
}

describe("normalized provider boundary", () => {
  it("strips native response and usage raw data while normalizing billable usage", async () => {
    const provider = baseProvider({
      createTextResponse: vi.fn().mockResolvedValue({
        id: "response-1",
        outputText: "ok",
        raw: { prompt: "must-not-cross" },
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          raw: {
            input_tokens_details: { cached_tokens: 40, audio_tokens: 3, image_tokens: 5 },
            output_tokens_details: { reasoning_tokens: 7, audio_tokens: 2, image_tokens: 4 },
          },
        },
      }),
    });

    const result = await createNormalizedProviderBoundary(provider).createTextResponse({
      model: "gpt-4.1-mini",
      input: "hello",
    });

    expect(result).toMatchObject({
      id: "response-1",
      outputText: "ok",
      usage: {
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 20,
        reasoningTokens: 7,
        totalTokens: 120,
        inputAudioTokens: 3,
        outputAudioTokens: 2,
        inputImageTokens: 5,
        outputImageTokens: 4,
      },
    });
    expect(JSON.stringify(result)).not.toContain("must-not-cross");
    expect(JSON.stringify(result)).not.toContain('"raw"');
  });

  it("drops usage entirely when only native raw metadata is available", async () => {
    const provider = baseProvider({
      createTextResponse: vi.fn().mockResolvedValue({
        id: "response-raw-only",
        outputText: "ok",
        usage: { raw: { request: "must-not-cross" } },
      }),
    });

    const result = await createNormalizedProviderBoundary(provider).createTextResponse({
      model: "gpt-4.1-mini",
      input: "hello",
    });

    expect(result).not.toHaveProperty("usage");
    expect(JSON.stringify(result)).not.toContain("must-not-cross");
    expect(JSON.stringify(result)).not.toContain('"raw"');
  });

  it("normalizes Gemini cached and thought tokens", async () => {
    const provider = baseProvider({
      createTextResponse: vi.fn().mockResolvedValue({
        id: "gemini-1",
        outputText: "ok",
        raw: {},
        usage: {
          inputTokens: 200,
          outputTokens: 30,
          totalTokens: 230,
          raw: { cachedContentTokenCount: 50, thoughtsTokenCount: 9 },
        },
      }),
    });

    const result = await createNormalizedProviderBoundary(provider).createTextResponse({
      model: "gemini-2.5-flash",
      input: "hello",
    });

    expect(result.usage).toMatchObject({ cachedInputTokens: 50, reasoningTokens: 9 });
  });

  it("does not expose SDK error messages or causes", async () => {
    const provider = baseProvider({
      createTextResponse: vi.fn().mockRejectedValue(Object.assign(
        new Error("Authorization: Bearer secret-token"),
        { status: 429, response: { body: "private" } },
      )),
    });

    await expect(createNormalizedProviderBoundary(provider).createTextResponse({
      model: "gpt-4.1-mini",
      input: "hello",
    })).rejects.toMatchObject({ code: "rate_limit", message: "AI provider call failed (rate_limit)", cause: undefined });
  });

  it("records audio duration and generated image count without native payloads", async () => {
    const provider = baseProvider({
      createAudioTranscription: vi.fn().mockResolvedValue({
        task: "transcribe",
        text: "arroz",
        duration: 90,
        raw: { requestId: "audio-private" },
      }),
      createImageGeneration: vi.fn().mockResolvedValue({
        b64Json: "AAAA",
        mimeType: "image/png",
        raw: { requestId: "image-private" },
      }),
    });
    const boundary = createNormalizedProviderBoundary(provider);

    const audio = await boundary.createAudioTranscription({
      model: "whisper-1",
      file: new File(["audio"], "meal.ogg", { type: "audio/ogg" }),
    });
    const image = await boundary.createImageGeneration({
      model: "gpt-image-1",
      prompt: "summary",
    });

    expect((audio as unknown as { usage?: { audioSeconds?: number } }).usage?.audioSeconds).toBe(90);
    expect((image as unknown as { usage?: { generatedImages?: number } }).usage?.generatedImages).toBe(1);
    expect(JSON.stringify({ audio, image })).not.toContain("private");
  });
});
