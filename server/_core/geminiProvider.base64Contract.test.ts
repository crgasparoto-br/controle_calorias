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

describe("GeminiProvider inline image base64 contract", () => {
  afterEach(() => generateContentMock.mockReset());

  it.each([
    ["invalid characters", "data:image/png;base64,%%%"],
    ["invalid padding", "data:image/jpeg;base64,A==="],
    ["impossible base64 length", "data:image/webp;base64,A"],
  ])("rejects %s before network access", async (_name, imageUrl) => {
    const provider = new GeminiProvider("fake-key");

    await expect(provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: [{
        role: "user",
        content: [{ type: "input_image", image_url: imageUrl }],
      }],
    })).rejects.toMatchObject({ code: "invalid_payload" });

    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("accepts valid unpadded base64 and sends canonical data", async () => {
    generateContentMock.mockResolvedValue({ text: "ok" });
    const provider = new GeminiProvider("fake-key");

    await provider.createTextResponse({
      model: "gemini-2.5-flash",
      input: [{
        role: "user",
        content: [{ type: "input_image", image_url: "data:image/png;base64,QUJDRA" }],
      }],
    });

    expect(generateContentMock.mock.calls[0][0].contents[0].parts).toEqual([
      { inlineData: { mimeType: "image/png", data: "QUJDRA" } },
    ]);
  });
});
