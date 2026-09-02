import { beforeEach, describe, expect, it, vi } from "vitest";

const createImageGenerationMock = vi.fn().mockResolvedValue({
  b64Json: Buffer.from("canonical-image").toString("base64"),
  mimeType: "image/png",
  raw: {},
});
const storagePutMock = vi.fn(async (key: string, buffer: Buffer, mimeType: string) => ({
  key,
  url: `https://storage.test/${key}`,
  size: buffer.length,
  mimeType,
}));
const resolveCapabilityConfigMock = vi.fn(() => ({
  capability: "IMAGE_ANNOTATION",
  state: "ready",
  primary: { provider: "openai", model: "gpt-image-canonical" },
  timeoutMs: 30_000,
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
}));

type ImageAttemptContext = {
  provider: { createImageGeneration: typeof createImageGenerationMock };
  providerId: "openai";
  model: string | undefined;
  source: "primary";
  attempt: number;
  timeoutMs: number;
  signal: AbortSignal;
};

const executeResolvedCapabilityMock = vi.fn(async (
  config: ReturnType<typeof resolveCapabilityConfigMock>,
  operation: (context: ImageAttemptContext) => Promise<unknown>,
) => {
  const value = await operation({
    provider: { createImageGeneration: createImageGenerationMock },
    providerId: "openai",
    model: config.primary?.model,
    source: "primary",
    attempt: 1,
    timeoutMs: config.timeoutMs,
    signal: new AbortController().signal,
  });
  return { value, source: "primary", attempts: 1 };
});

vi.mock("server/storage", () => ({ storagePut: storagePutMock }));
vi.mock("./ai/configResolver", () => ({ resolveCapabilityConfig: resolveCapabilityConfigMock }));
vi.mock("./ai/capabilityExecutor", () => ({
  observeUnavailableResolvedCapability: vi.fn(),
  executeResolvedCapability: executeResolvedCapabilityMock,
}));

const { generateImage } = await import("./imageGeneration");

describe("generateImage canonical capability routing", () => {
  beforeEach(() => {
    createImageGenerationMock.mockClear();
    storagePutMock.mockClear();
    resolveCapabilityConfigMock.mockClear();
    executeResolvedCapabilityMock.mockClear();
  });

  it("uses the provider/model resolved for IMAGE_ANNOTATION", async () => {
    const result = await generateImage({ prompt: "Resumo visual da refeição" });

    expect(resolveCapabilityConfigMock).toHaveBeenCalledWith("IMAGE_ANNOTATION");
    expect(executeResolvedCapabilityMock).toHaveBeenCalledOnce();
    expect(createImageGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Resumo visual da refeição",
        model: "gpt-image-canonical",
        size: "1024x1024",
        quality: "low",
        outputFormat: "png",
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.url).toMatch(/^https:\/\/storage\.test\/generated\/meal-support\//);
    expect(result.mimeType).toBe("image/png");
  });
});
