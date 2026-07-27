import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("GeminiProvider (@google/genai)", () => {
  afterEach(() => generateContentMock.mockReset());

  it("translates text input and returns normalized usage metadata", async () => {
    generateContentMock.mockResolvedValue({
      text: "ola",
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      },
    });
    const result = await new GeminiProvider("fake-key").createTextResponse({
      model: "gemini-2.5-flash",
      input: [{ role: "user", content: [{ type: "input_text", text: "oi" }] }],
    });
    expect(result.outputText).toBe("ola");
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(generateContentMock.mock.calls[0][0].contents[0].parts[0]).toEqual({ text: "oi" });
  });

  it("propagates AbortSignal to generateContent config", async () => {
    generateContentMock.mockResolvedValue({ text: "ok" });
    const controller = new AbortController();
    await new GeminiProvider("fake-key").createTextResponse(
      {
        model: "gemini-2.5-flash",
        input: [{ role: "user", content: "oi" }],
      },
      { signal: controller.signal },
    );
    expect(generateContentMock.mock.calls[0][0].config.abortSignal).toBe(controller.signal);
  });

  it("translates inline base64 image input", async () => {
    generateContentMock.mockResolvedValue({ text: "{}" });
    await new GeminiProvider("fake-key").createTextResponse({
      model: "gemini-2.5-flash",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: "descreva" },
          { type: "input_image", image_url: "data:image/jpeg;base64,AAAA" },
        ],
      }],
    });
    expect(generateContentMock.mock.calls[0][0].contents[0].parts).toEqual([
      { text: "descreva" },
      { inlineData: { mimeType: "image/jpeg", data: "AAAA" } },
    ]);
  });

  it("passes the project's JSON Schema features without lossy conversion", async () => {
    generateContentMock.mockResolvedValue({ text: "{}" });
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        brand: { type: ["string", "null"] },
        calories: { type: "number", minimum: 0, maximum: 10000 },
        tags: { type: "array", minItems: 0, items: { type: "string" } },
      },
      required: ["brand", "calories", "tags"],
    };

    await new GeminiProvider("fake-key").createTextResponse({
      model: "gemini-2.5-flash",
      input: [{ role: "user", content: "oi" }],
      format: { type: "json_schema", name: "meal", schema, strict: true },
    });

    const config = generateContentMock.mock.calls[0][0].config;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseJsonSchema).toEqual(schema);
    expect(config.responseSchema).toBeUndefined();
  });

  it.each(["patternProperties", "minLength", "exclusiveMinimum"])(
    "rejects unsupported JSON Schema keyword %s before network access",
    async keyword => {
      const provider = new GeminiProvider("fake-key");
      await expect(provider.createTextResponse({
        model: "gemini-2.5-flash",
        input: [{ role: "user", content: "oi" }],
        format: {
          type: "json_schema",
          name: "invalid",
          schema: {
            type: "object",
            properties: {
              value: { type: "string", [keyword]: keyword === "minLength" ? 1 : {} },
            },
          },
        },
      })).rejects.toMatchObject({ code: "incompatible_operation" });
      expect(generateContentMock).not.toHaveBeenCalled();
    },
  );

  it("rejects oneOf because Gemini weakens it to anyOf", async () => {
    const provider = new GeminiProvider("fake-key");
    await expect(provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: [{ role: "user", content: "oi" }],
      format: {
        type: "json_schema",
        name: "invalid",
        schema: {
          oneOf: [{ type: "string" }, { type: "number" }],
        },
      },
    })).rejects.toMatchObject({ code: "incompatible_operation" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects non-$ siblings next to $ref before network access", async () => {
    const provider = new GeminiProvider("fake-key");
    await expect(provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: [{ role: "user", content: "oi" }],
      format: {
        type: "json_schema",
        name: "invalid",
        schema: {
          $defs: { value: { type: "string" } },
          properties: {
            value: { $ref: "#/$defs/value", description: "not allowed with $ref" },
          },
        },
      },
    })).rejects.toMatchObject({ code: "incompatible_operation" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects tools before network access until an explicit Google Search translation exists", async () => {
    const provider = new GeminiProvider("fake-key");
    await expect(provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: [{ role: "user", content: "preço atual" }],
      tools: [{ type: "web_search_preview" }],
    })).rejects.toThrow(/tools are not representable/);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported adapter operations locally", async () => {
    const provider = new GeminiProvider("fake-key");
    await expect(provider.createEmbeddings({
      input: "banana",
      model: "text-embedding-3-small",
    })).rejects.toThrow(/does not support embeddings/);
    await expect(provider.createAudioTranscription({
      file: new File([], "audio.ogg"),
      model: "whisper-1",
    })).rejects.toThrow(/does not support audio transcription/);
    await expect(provider.createImageGeneration({
      prompt: "x",
      model: "gemini-2.5-flash",
    })).rejects.toThrow(/does not support image generation/);
  });

  it("rejects requests without representable content", async () => {
    await expect(new GeminiProvider("fake-key").createTextResponse({
      model: "gemini-2.5-flash",
      input: [],
    })).rejects.toThrow(/no content parts/);
  });
});
