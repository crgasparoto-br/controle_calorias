import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../../aiProvider";
import { generateExternalImageAnnotation } from "../../imageAnnotation";
import { resolveCapabilityConfig } from "../configResolver";
import type { AiProviderFactoryMap } from "../providerResolver";

const source = {
  b64Json: Buffer.from("original-photo").toString("base64"),
  mimeType: "image/jpeg",
};

function providerFactory(createImageGeneration = vi.fn()): AiProviderFactoryMap["openai"] {
  return () => ({
    createImageGeneration,
    createTextResponse: vi.fn(async () => { throw new Error("unexpected text call"); }),
    createEmbeddings: vi.fn(async () => { throw new Error("unexpected embedding call"); }),
    createAudioTranscription: vi.fn(async () => { throw new Error("unexpected audio call"); }),
  });
}

function factories(openai: AiProviderFactoryMap["openai"]): AiProviderFactoryMap {
  return {
    openai,
    "openai-compatible": openai,
    gemini: openai,
  };
}

function nativeEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
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

describe("IMAGE_ANNOTATION model compatibility before outbound", () => {
  it("marks an incompatible native primary model invalid", () => {
    const config = resolveCapabilityConfig("IMAGE_ANNOTATION", nativeEnv({
      AI_IMAGE_ANNOTATION_MODEL: "definitely-not-an-image-model",
    }));

    expect(config.state).toBe("invalid");
    expect(config.diagnostics.join(" ")).not.toContain("definitely-not-an-image-model");
  });

  it("does not create a provider adapter for an incompatible primary model", async () => {
    const factory = vi.fn(providerFactory());

    const result = await generateExternalImageAnnotation(
      { prompt: "Annotate", originalImages: [source] },
      {
        env: nativeEnv({ AI_IMAGE_ANNOTATION_MODEL: "definitely-not-an-image-model" }),
        providerFactories: factories(factory),
      },
    );

    expect(factory).not.toHaveBeenCalled();
    expect(result.skippedReason).toBe("not_configured");
  });

  it("disables an incompatible fallback model before any second provider call", () => {
    const config = resolveCapabilityConfig("IMAGE_ANNOTATION", nativeEnv({
      AI_IMAGE_ANNOTATION_FALLBACK_ENABLED: "true",
      AI_IMAGE_ANNOTATION_FALLBACK_PROVIDER: "openai",
      AI_IMAGE_ANNOTATION_FALLBACK_MODEL: "definitely-not-an-image-model",
    }));

    expect(config.state).toBe("degraded");
    expect(config.fallback.effectivelyEnabled).toBe(false);
  });

  it("keeps an explicitly approved native image model ready", () => {
    const config = resolveCapabilityConfig("IMAGE_ANNOTATION", nativeEnv({
      AI_IMAGE_ANNOTATION_MODEL: "gpt-image-1-mini",
    }));

    expect(config.state).toBe("ready");
  });

  it("fails closed for compatible endpoints until the exact image model is allowlisted", () => {
    const base = nativeEnv({
      OPENAI_BASE_URL: "https://compatible.example/v1",
      AI_OPENAI_COMPATIBLE_OPERATIONS: "image_generation,image_edit",
      AI_IMAGE_ANNOTATION_PROVIDER: "openai-compatible",
      AI_IMAGE_ANNOTATION_MODEL: "vendor/image-v2",
    });

    expect(resolveCapabilityConfig("IMAGE_ANNOTATION", base).state).toBe("invalid");
    expect(resolveCapabilityConfig("IMAGE_ANNOTATION", {
      ...base,
      AI_OPENAI_COMPATIBLE_IMAGE_MODELS: "vendor/image-v2",
    }).state).toBe("ready");
  });
});
