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

describe("GeminiProvider external image URI contract", () => {
  afterEach(() => generateContentMock.mockReset());

  it.each([
    "https://cdn.example.test/photo.png",
    "gs://bucket/photo.webp",
    "file:///tmp/photo.jpg",
  ])("rejects unsupported external image URI %s before network access", async imageUrl => {
    const provider = new GeminiProvider("fake-key");

    await expect(provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: "descreva" },
          { type: "input_image", image_url: imageUrl },
        ],
      }],
    })).rejects.toMatchObject({ code: "incompatible_operation" });

    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("continues accepting inline images with their declared MIME type", async () => {
    generateContentMock.mockResolvedValue({ text: "ok" });
    const provider = new GeminiProvider("fake-key");

    await provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: [{
        role: "user",
        content: [{
          type: "input_image",
          image_url: "data:image/webp;base64,AAAA",
        }],
      }],
    });

    expect(generateContentMock.mock.calls[0][0].contents[0].parts).toEqual([
      { inlineData: { mimeType: "image/webp", data: "AAAA" } },
    ]);
  });
});
