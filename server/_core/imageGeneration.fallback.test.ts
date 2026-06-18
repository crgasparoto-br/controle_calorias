import { beforeEach, describe, expect, it, vi } from "vitest";

const storagePutMock = vi.fn(async (key: string, buffer: Buffer, mimeType: string) => ({
  key,
  url: `https://storage.test/${key}`,
  size: buffer.length,
  mimeType,
}));

vi.mock("server/storage", () => ({
  storagePut: storagePutMock,
}));

vi.mock("./openaiClient", () => ({
  isOpenAiConfigured: () => false,
}));

vi.mock("./aiProvider", () => ({
  getAiProvider: () => ({
    createImageGeneration: vi.fn(),
  }),
}));

vi.mock("./env", () => ({
  ENV: {
    openaiImageModel: "gpt-image-test",
  },
}));

const { generateImage } = await import("./imageGeneration");

describe("generateImage fallback", () => {
  beforeEach(() => {
    storagePutMock.mockClear();
  });

  it("gera uma imagem PNG local quando o provider de imagem não está configurado", async () => {
    const result = await generateImage({
      prompt: [
        "Crie uma imagem quadrada com cards nutricionais.",
        "Total: 145 kcal | P 20g | C 6,8g | G 4,7g",
        "Itens:",
        "1. Whey protein: 21 g, 84 kcal, proteína 16,8g, carboidratos 2,1g, gorduras 1,4g",
        "2. Leite integral: 100 ml, 61 kcal, proteína 3,2g, carboidratos 4,7g, gorduras 3,3g",
      ].join("\n"),
    });

    expect(result.url).toMatch(/^https:\/\/storage\.test\/generated\/meal-support\/fallback-/);
    expect(result.storageKey).toMatch(/^generated\/meal-support\/fallback-/);
    expect(result.mimeType).toBe("image/png");
    expect(result.skippedReason).toBeUndefined();
    expect(result.detail).toContain("Provider de imagem não configurado");
    expect(storagePutMock).toHaveBeenCalledOnce();
    const [, buffer, mimeType] = storagePutMock.mock.calls[0];
    expect(mimeType).toBe("image/png");
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});
