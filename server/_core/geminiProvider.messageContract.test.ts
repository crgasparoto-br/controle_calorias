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

describe("GeminiProvider message contract", () => {
  afterEach(() => generateContentMock.mockReset());

  it("preserves message boundaries and maps assistant to model", async () => {
    generateContentMock.mockResolvedValue({ text: "ok" });
    await new GeminiProvider("fake-key").createTextResponse({
      model: "gemini-2.5-flash",
      input: [
        { role: "user", content: "pergunta" },
        { role: "assistant", content: "resposta anterior" },
        { role: "user", content: [{ type: "input_text", text: "corrija" }] },
      ],
    });

    expect(generateContentMock.mock.calls[0][0].contents).toEqual([
      { role: "user", parts: [{ text: "pergunta" }] },
      { role: "model", parts: [{ text: "resposta anterior" }] },
      { role: "user", parts: [{ text: "corrija" }] },
    ]);
  });

  it("rejects unsupported message roles before network access", async () => {
    await expect(new GeminiProvider("fake-key").createTextResponse({
      model: "gemini-2.5-flash",
      input: [{ role: "developer", content: "instrucao" }] as never,
    })).rejects.toMatchObject({ code: "incompatible_operation" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it("rejects messages without an explicit role before network access", async () => {
    await expect(new GeminiProvider("fake-key").createTextResponse({
      model: "gemini-2.5-flash",
      input: [{ content: "sem papel" }] as never,
    })).rejects.toMatchObject({ code: "invalid_payload" });
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});
