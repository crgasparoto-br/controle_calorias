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
  afterEach(() => {
    generateContentMock.mockReset();
  });

  it("translates plain text input and returns the response text", async () => {
    generateContentMock.mockResolvedValue({ text: "ola" });
    const provider = new GeminiProvider("fake-key");

    const result = await provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: [{ role: "user", content: [{ type: "input_text", text: "oi" }] }],
    });

    expect(result.outputText).toBe("ola");
    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const call = generateContentMock.mock.calls[0][0];
    expect(call.model).toBe("gemini-2.5-flash");
    expect(call.contents[0].parts[0]).toEqual({ text: "oi" });
  });

  it("translates inline base64 image input alongside text", async () => {
    generateContentMock.mockResolvedValue({ text: "{}" });
    const provider = new GeminiProvider("fake-key");

    await provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "descreva" },
            { type: "input_image", image_url: "data:image/jpeg;base64,AAAA" },
          ],
        },
      ],
    });

    const call = generateContentMock.mock.calls[0][0];
    expect(call.contents[0].parts).toEqual([
      { text: "descreva" },
      { inlineData: { mimeType: "image/jpeg", data: "AAAA" } },
    ]);
  });

  it("converts a supported JSON schema into a Gemini structured output schema", async () => {
    generateContentMock.mockResolvedValue({ text: "{}" });
    const provider = new GeminiProvider("fake-key");

    await provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: [{ role: "user", content: "oi" }],
      format: {
        type: "json_schema",
        name: "meal",
        schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            calories: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["name"],
        },
      },
    });

    const call = generateContentMock.mock.calls[0][0];
    expect(call.config.responseMimeType).toBe("application/json");
    expect(call.config.responseSchema.type).toBe("OBJECT");
    expect(call.config.responseSchema.properties.tags.type).toBe("ARRAY");
  });

  it("rejects a schema using an unsupported keyword (oneOf) before calling the SDK", async () => {
    const provider = new GeminiProvider("fake-key");

    await expect(
      provider.createTextResponse({
        model: "gemini-2.5-flash",
        input: [{ role: "user", content: "oi" }],
        format: {
          type: "json_schema",
          name: "invalid",
          schema: { oneOf: [{ type: "string" }, { type: "number" }] },
        },
      }),
    ).rejects.toThrow(/not representable/);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("throws for audio transcription (unsupported by this adapter)", async () => {
    const provider = new GeminiProvider("fake-key");
    await expect(
      provider.createAudioTranscription({ file: new File([], "a.ogg"), model: "whisper-1" }),
    ).rejects.toThrow(/does not support audio transcription/);
  });

  it("throws for image generation (unsupported by this adapter)", async () => {
    const provider = new GeminiProvider("fake-key");
    await expect(
      provider.createImageGeneration({ prompt: "x", model: "gemini-2.5-flash" }),
    ).rejects.toThrow(/does not support image generation/);
  });

  it("throws when no content parts could be extracted", async () => {
    const provider = new GeminiProvider("fake-key");
    await expect(
      provider.createTextResponse({ model: "gemini-2.5-flash", input: [] }),
    ).rejects.toThrow(/no content parts/);
  });
});
