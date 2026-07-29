import { afterEach, describe, expect, it, vi } from "vitest";
import { executeWithPolicy } from "./ai/policyExecutor";
import { GeminiProvider } from "./geminiProvider";

const generateContentMock = vi.fn();

vi.mock("@google/genai", async () => {
  const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
  return {
    ...actual,
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: { generateContent: generateContentMock },
    })),
  };
});

const executablePolicy = {
  state: "ready" as const,
  maxAttempts: 2,
  timeoutMs: 1000,
  fallback: { effectivelyEnabled: true },
};

async function expectIncompatibleOperation(call: () => Promise<unknown>) {
  const fallback = vi.fn(async () => "must-not-run");
  await expect(executeWithPolicy(
    executablePolicy,
    call,
    fallback,
  )).rejects.toMatchObject({ code: "incompatible_operation" });
  expect(fallback).not.toHaveBeenCalled();
}

describe("GeminiProvider common adapter contract", () => {
  afterEach(() => generateContentMock.mockReset());

  it("accepts direct string input from AiProviderTextRequest", async () => {
    generateContentMock.mockResolvedValue({ text: "ok" });
    const provider = new GeminiProvider("fake-key");

    await provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: "texto direto",
    });

    expect(generateContentMock).toHaveBeenCalledWith(expect.objectContaining({
      contents: [{ role: "user", parts: [{ text: "texto direto" }] }],
    }));
  });

  it("classifies unsupported tools before network access", async () => {
    const provider = new GeminiProvider("fake-key");
    await expectIncompatibleOperation(() => provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: "preço atual",
      tools: [{ type: "web_search" }],
    }));
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("classifies an unsupported schema before network access", async () => {
    const provider = new GeminiProvider("fake-key");
    await expectIncompatibleOperation(() => provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: "oi",
      format: {
        type: "json_schema",
        name: "invalid",
        schema: { type: "object", patternProperties: { "^x": { type: "string" } } },
      },
    }));
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("classifies every unsupported adapter family as incompatible_operation", async () => {
    const provider = new GeminiProvider("fake-key");

    await expectIncompatibleOperation(() => provider.createEmbeddings({
      model: "text-embedding-004",
      input: "banana",
    }));
    await expectIncompatibleOperation(() => provider.createAudioTranscription({
      model: "whisper-1",
      file: new File([], "audio.ogg"),
    }));
    await expectIncompatibleOperation(() => provider.createImageGeneration({
      model: "gemini-2.5-flash",
      prompt: "banana",
    }));
  });
});
