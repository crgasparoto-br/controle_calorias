import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiProvider } from "./aiProvider";
import type { AiProviderFactoryMap } from "./ai/providerResolver";
import { AiOperationalError } from "./ai/policyExecutor";
import {
  generateExternalImageAnnotation,
  resolveImageAnnotationRuntimeConfig,
} from "./imageAnnotation";

function providerWithImage(
  createImageGeneration: AiProvider["createImageGeneration"],
): AiProvider {
  return {
    createImageGeneration,
    createTextResponse: vi.fn(async () => { throw new Error("unexpected text call"); }),
    createEmbeddings: vi.fn(async () => { throw new Error("unexpected embedding call"); }),
    createAudioTranscription: vi.fn(async () => { throw new Error("unexpected audio call"); }),
  };
}

function factories(
  openai: () => AiProvider,
  gemini: () => AiProvider = openai,
): AiProviderFactoryMap {
  return {
    openai,
    "openai-compatible": openai,
    gemini,
  };
}

const source = {
  b64Json: Buffer.from("original-photo").toString("base64"),
  mimeType: "image/jpeg",
};

const successImage = {
  b64Json: Buffer.from("derived-photo").toString("base64"),
  mimeType: "image/png",
  raw: { shouldNotEscape: true },
};

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    OPENAI_API_KEY: "test-key",
    AI_IMAGE_ANNOTATION_PROVIDER: "openai",
    AI_IMAGE_ANNOTATION_MODEL: "gpt-image-1",
    AI_IMAGE_ANNOTATION_MAX_ATTEMPTS: "1",
    AI_IMAGE_ANNOTATION_FALLBACK_ENABLED: "false",
    ...overrides,
  };
}

describe("IMAGE_ANNOTATION runtime configuration", () => {
  it("defaults to local independently from MEAL_VISION", () => {
    expect(resolveImageAnnotationRuntimeConfig({
      AI_VISION_PROVIDER: "gemini",
      AI_MEAL_VISION_PROVIDER: "gemini",
    })).toEqual({
      mode: "local",
      externalFailureMode: "off",
      diagnostics: [],
    });
  });

  it("fails safe to local/off for unknown specialized values", () => {
    const result = resolveImageAnnotationRuntimeConfig({
      AI_IMAGE_ANNOTATION_MODE: "automatic",
      AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE: "provider-chain",
    });

    expect(result.mode).toBe("local");
    expect(result.externalFailureMode).toBe("off");
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.join(" ")).not.toContain("provider-chain");
  });
});

describe("generateExternalImageAnnotation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses IMAGE_ANNOTATION provider/model through one governed attempt", async () => {
    const createImage = vi.fn(async (
      request: Parameters<AiProvider["createImageGeneration"]>[0],
    ) => {
      expect(request.model).toBe("gpt-image-1");
      expect(request.originalImages).toEqual([source]);
      return successImage;
    });
    const storagePutFn = vi.fn(async (key: string) => ({
      url: `https://cdn.test/${key}`,
      key,
    }));

    const result = await generateExternalImageAnnotation(
      { prompt: "Adicione apenas a legenda.", originalImages: [source] },
      {
        env: baseEnv({ AI_VISION_PROVIDER: "gemini" }),
        providerFactories: factories(() => providerWithImage(createImage)),
        storagePutFn,
      },
    );

    expect(createImage).toHaveBeenCalledTimes(1);
    expect(storagePutFn).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      artifactKind: "photo_annotation",
      mode: "external",
      degradation: "none",
      providerSource: "primary",
      attempts: 1,
      mimeType: "image/png",
    });
    expect(result.buffer?.toString()).toBe("derived-photo");
    expect(result).not.toHaveProperty("raw");
  });

  it("does not send to a second provider when cross-provider is not explicitly enabled", async () => {
    const primaryCall = vi.fn(async () => {
      throw new AiOperationalError("temporary failure", undefined, "network");
    });
    const fallbackCall = vi.fn(async () => successImage);

    const result = await generateExternalImageAnnotation(
      { prompt: "Annotate", originalImages: [source] },
      {
        env: baseEnv({
          GEMINI_API_KEY: "test-gemini-key",
          AI_IMAGE_ANNOTATION_FALLBACK_ENABLED: "true",
          AI_IMAGE_ANNOTATION_FALLBACK_PROVIDER: "gemini",
          AI_IMAGE_ANNOTATION_FALLBACK_MODEL: "gemini-image",
          AI_IMAGE_ANNOTATION_CROSS_PROVIDER_FALLBACK_ENABLED: "false",
        }),
        providerFactories: factories(
          () => providerWithImage(primaryCall),
          () => providerWithImage(fallbackCall),
        ),
      },
    );

    expect(primaryCall).toHaveBeenCalledTimes(1);
    expect(fallbackCall).not.toHaveBeenCalled();
    expect(result.skippedReason).toBe("provider_failed");
  });

  it("retries through the common executor when the provider returns malformed image data", async () => {
    const createImage = vi.fn()
      .mockResolvedValueOnce({ b64Json: "%%%", mimeType: "image/png" })
      .mockResolvedValueOnce(successImage);

    const result = await generateExternalImageAnnotation(
      { prompt: "Annotate", originalImages: [source] },
      {
        env: baseEnv({ AI_IMAGE_ANNOTATION_MAX_ATTEMPTS: "2" }),
        providerFactories: factories(() => providerWithImage(createImage)),
        storagePutFn: vi.fn(async (key: string) => ({
          url: `https://cdn.test/${key}`,
          key,
        })),
      },
    );

    expect(createImage).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      providerSource: "primary_retry",
      attempts: 2,
      artifactKind: "photo_annotation",
    });
  });

  it("uses one configured fallback when the primary returns an invalid image payload", async () => {
    const primaryCall = vi.fn(async () => ({
      b64Json: Buffer.from("not-used").toString("base64"),
      mimeType: "text/plain",
      raw: {},
    }));
    const fallbackCall = vi.fn(async () => successImage);
    const adapters = [
      providerWithImage(primaryCall),
      providerWithImage(fallbackCall),
    ];
    const openaiFactory = vi.fn(() => {
      const adapter = adapters.shift();
      if (!adapter) throw new Error("unexpected third adapter");
      return adapter;
    });

    const result = await generateExternalImageAnnotation(
      { prompt: "Annotate", originalImages: [source] },
      {
        env: baseEnv({
          AI_IMAGE_ANNOTATION_FALLBACK_ENABLED: "true",
          AI_IMAGE_ANNOTATION_FALLBACK_PROVIDER: "openai",
          AI_IMAGE_ANNOTATION_FALLBACK_MODEL: "gpt-image-1-mini",
        }),
        providerFactories: factories(openaiFactory),
        storagePutFn: vi.fn(async (key: string) => ({
          url: `https://cdn.test/${key}`,
          key,
        })),
      },
    );

    expect(primaryCall).toHaveBeenCalledTimes(1);
    expect(fallbackCall).toHaveBeenCalledTimes(1);
    expect(openaiFactory).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      providerSource: "fallback",
      attempts: 2,
      artifactKind: "photo_annotation",
    });
  });

  it("executes at most one configured same-provider fallback without a chain", async () => {
    const primaryCall = vi.fn(async () => {
      throw new AiOperationalError("temporary failure", undefined, "network");
    });
    const fallbackCall = vi.fn(async () => successImage);
    const adapters = [
      providerWithImage(primaryCall),
      providerWithImage(fallbackCall),
    ];
    const openaiFactory = vi.fn(() => {
      const adapter = adapters.shift();
      if (!adapter) throw new Error("unexpected third adapter");
      return adapter;
    });

    const result = await generateExternalImageAnnotation(
      { prompt: "Annotate", originalImages: [source] },
      {
        env: baseEnv({
          AI_IMAGE_ANNOTATION_FALLBACK_ENABLED: "true",
          AI_IMAGE_ANNOTATION_FALLBACK_PROVIDER: "openai",
          AI_IMAGE_ANNOTATION_FALLBACK_MODEL: "gpt-image-1-mini",
        }),
        providerFactories: factories(openaiFactory),
        storagePutFn: vi.fn(async (key: string) => ({
          url: `https://cdn.test/${key}`,
          key,
        })),
      },
    );

    expect(primaryCall).toHaveBeenCalledTimes(1);
    expect(fallbackCall).toHaveBeenCalledTimes(1);
    expect(openaiFactory).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      providerSource: "fallback",
      attempts: 2,
    });
  });

  it("rejects invalid original input before creating a provider adapter", async () => {
    const providerFactory = vi.fn(() => providerWithImage(
      vi.fn(async () => successImage),
    ));

    const result = await generateExternalImageAnnotation(
      {
        prompt: "Annotate",
        originalImages: [{ b64Json: "%%%", mimeType: "image/jpeg" }],
      },
      {
        env: baseEnv(),
        providerFactories: factories(providerFactory),
      },
    );

    expect(providerFactory).not.toHaveBeenCalled();
    expect(result.skippedReason).toBe("invalid_source");
  });

  it("keeps provider errors sanitized in logs and response", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const createImage = vi.fn(async () => {
      throw new AiOperationalError(
        "request contained sk-secret and meal payload",
        undefined,
        "network",
      );
    });

    const result = await generateExternalImageAnnotation(
      { prompt: "sensitive meal prompt", originalImages: [source] },
      {
        env: baseEnv(),
        providerFactories: factories(() => providerWithImage(createImage)),
      },
    );

    expect(result.detail).not.toContain("sk-secret");
    expect(result.detail).not.toContain("sensitive meal prompt");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sk-secret");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive meal prompt");
  });
});
