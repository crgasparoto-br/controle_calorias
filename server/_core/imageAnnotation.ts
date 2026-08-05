import { createHash } from "node:crypto";
import { storagePut } from "../storage";
import { decodeStrictBase64, StrictBase64Error } from "./imageBase64";
import type {
  AiProvider,
  AiProviderImageGenerationRequest,
  AiProviderRequestOptions,
} from "./aiProvider";
import { executeResolvedCapability } from "./ai/capabilityExecutor";
import { resolveCapabilityConfig } from "./ai/configResolver";
import type { AiProviderFactoryMap } from "./ai/providerResolver";
import {
  AiNonRetryableError,
  AiOperationalError,
} from "./ai/policyExecutor";

export const IMAGE_ANNOTATION_MODES = ["local", "external", "off"] as const;
export type ImageAnnotationMode = (typeof IMAGE_ANNOTATION_MODES)[number];

export const IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODES = ["off", "local"] as const;
export type ImageAnnotationExternalFailureMode =
  (typeof IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODES)[number];

export type ImageAnnotationSource = {
  b64Json: string;
  mimeType?: string;
};

export type ImageAnnotationSkipReason =
  | "no_prompt"
  | "disabled"
  | "no_original_image"
  | "invalid_source"
  | "not_configured"
  | "provider_failed"
  | "local_failed";

export type ImageAnnotationResponse = {
  url?: string;
  storageKey?: string;
  mimeType?: string;
  buffer?: Buffer;
  skippedReason?: ImageAnnotationSkipReason;
  detail?: string;
  artifactKind?: "photo_annotation";
  mode?: ImageAnnotationMode;
  degradation?: "none" | "external_to_local";
  providerSource?: "primary" | "primary_retry" | "fallback";
  attempts?: number;
};

export type ImageAnnotationRuntimeConfig = {
  mode: ImageAnnotationMode;
  externalFailureMode: ImageAnnotationExternalFailureMode;
  diagnostics: string[];
};

export type GenerateExternalImageAnnotationOptions = {
  prompt: string;
  originalImages: ImageAnnotationSource[];
};

export type GenerateExternalImageAnnotationDependencies = {
  env?: NodeJS.ProcessEnv;
  providerFactories?: AiProviderFactoryMap;
  storagePutFn?: typeof storagePut;
};

const DEFAULT_MODE: ImageAnnotationMode = "local";
const DEFAULT_EXTERNAL_FAILURE_MODE: ImageAnnotationExternalFailureMode = "off";
const MAX_PROMPT_LENGTH = 4_000;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_GENERATED_BYTES = 30 * 1024 * 1024;
const ALLOWED_SOURCE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

function isImageAnnotationMode(value: string): value is ImageAnnotationMode {
  return (IMAGE_ANNOTATION_MODES as readonly string[]).includes(value);
}

function isExternalFailureMode(value: string): value is ImageAnnotationExternalFailureMode {
  return (IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODES as readonly string[]).includes(value);
}

export function resolveImageAnnotationRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ImageAnnotationRuntimeConfig {
  const diagnostics: string[] = [];
  const configuredMode = readTrimmed(env, "AI_IMAGE_ANNOTATION_MODE").toLowerCase();
  const configuredFailureMode = readTrimmed(
    env,
    "AI_IMAGE_ANNOTATION_EXTERNAL_FAILURE_MODE",
  ).toLowerCase();

  const mode = configuredMode && isImageAnnotationMode(configuredMode)
    ? configuredMode
    : DEFAULT_MODE;
  if (configuredMode && !isImageAnnotationMode(configuredMode)) {
    diagnostics.push(
      "capability=IMAGE_ANNOTATION invalid mode; safe local mode selected",
    );
  }

  const externalFailureMode = configuredFailureMode
    && isExternalFailureMode(configuredFailureMode)
    ? configuredFailureMode
    : DEFAULT_EXTERNAL_FAILURE_MODE;
  if (configuredFailureMode && !isExternalFailureMode(configuredFailureMode)) {
    diagnostics.push(
      "capability=IMAGE_ANNOTATION invalid external failure mode; local degradation disabled",
    );
  }

  return { mode, externalFailureMode, diagnostics };
}

function sanitizePrompt(prompt: string): string {
  return prompt.trim().slice(0, MAX_PROMPT_LENGTH);
}

function invalidSource(reason: string): AiNonRetryableError {
  return new AiNonRetryableError(
    `IMAGE_ANNOTATION source ${reason}`,
    undefined,
    "invalid_configuration",
  );
}

function normalizeBase64(
  value: string,
  label: string,
  maxBytes: number,
): { compact: string; buffer: Buffer } {
  try {
    return decodeStrictBase64(value, maxBytes);
  } catch (error) {
    if (error instanceof StrictBase64Error) {
      if (error.code === "empty") throw invalidSource(`${label} is empty`);
      if (error.code === "too_large") {
        throw invalidSource(`${label} exceeds the size limit`);
      }
      throw invalidSource(`${label} is malformed`);
    }
    throw error;
  }
}

function normalizeSourceImages(images: ImageAnnotationSource[]): ImageAnnotationSource[] {
  if (!images.length) throw invalidSource("requires an original image");
  return images.slice(0, 1).map((image, index) => {
    const mimeType = (image.mimeType || "image/png").trim().toLowerCase();
    if (!ALLOWED_SOURCE_MIME_TYPES.has(mimeType)) {
      throw invalidSource(`originalImages[${index}] has an unsupported MIME type`);
    }
    const { compact } = normalizeBase64(
      image.b64Json,
      `originalImages[${index}].b64Json`,
      MAX_SOURCE_BYTES,
    );
    return { b64Json: compact, mimeType };
  });
}

function normalizeGeneratedImage(
  b64Json: string,
  mimeType: string,
): { buffer: Buffer; mimeType: string } {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  if (!ALLOWED_SOURCE_MIME_TYPES.has(normalizedMimeType)) {
    throw new AiOperationalError(
      "IMAGE_ANNOTATION provider returned an unsupported image MIME type",
      undefined,
      "invalid_payload",
    );
  }
  try {
    const { buffer } = normalizeBase64(
      b64Json,
      "provider image output",
      MAX_GENERATED_BYTES,
    );
    return { buffer, mimeType: normalizedMimeType };
  } catch (error) {
    throw new AiOperationalError(
      "IMAGE_ANNOTATION provider returned invalid image data",
      error,
      "invalid_payload",
    );
  }
}

async function createDomainExternalImageAnnotation(
  provider: AiProvider,
  request: AiProviderImageGenerationRequest,
  options?: AiProviderRequestOptions,
): Promise<{ b64Json: string; mimeType: string }> {
  const response = await provider.createImageGeneration(request, options);
  return {
    b64Json: response.b64Json,
    mimeType: response.mimeType,
  };
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function sanitizedErrorCode(error: unknown): string {
  if (error instanceof AiOperationalError || error instanceof AiNonRetryableError) {
    return error.code;
  }
  return "unknown";
}

export async function generateExternalImageAnnotation(
  options: GenerateExternalImageAnnotationOptions,
  dependencies: GenerateExternalImageAnnotationDependencies = {},
): Promise<ImageAnnotationResponse> {
  const prompt = sanitizePrompt(options.prompt);
  if (!prompt) return { skippedReason: "no_prompt", mode: "external" };

  let originalImages: ImageAnnotationSource[];
  try {
    originalImages = normalizeSourceImages(options.originalImages);
  } catch {
    return {
      skippedReason: "invalid_source",
      mode: "external",
      detail: "A foto original não pôde ser usada para anotação externa.",
    };
  }

  const env = dependencies.env ?? process.env;
  const config = resolveCapabilityConfig("IMAGE_ANNOTATION", env);
  if (config.state === "disabled" || config.state === "invalid") {
    return {
      skippedReason: "not_configured",
      mode: "external",
      detail: "A anotação externa está indisponível pela configuração atual.",
    };
  }

  try {
    const execution = await executeResolvedCapability(
      config,
      ({ provider, model, signal }) => createDomainExternalImageAnnotation(
        provider,
        {
          prompt,
          model,
          size: "1024x1024",
          quality: "low",
          outputFormat: "png",
          originalImages,
        },
        { signal },
      ),
      { providerFactories: dependencies.providerFactories },
    );

    const generated = normalizeGeneratedImage(
      execution.value.b64Json,
      execution.value.mimeType,
    );
    const digest = createHash("sha256").update(generated.buffer).digest("hex").slice(0, 24);
    const storageKey = `generated/meal-annotations/external-${digest}.${extensionForMimeType(generated.mimeType)}`;
    const storagePutFn = dependencies.storagePutFn ?? storagePut;

    try {
      const upload = await storagePutFn(
        storageKey,
        generated.buffer,
        generated.mimeType,
        { publicRead: true },
      );
      return {
        url: upload.url,
        storageKey: upload.key || storageKey,
        mimeType: generated.mimeType,
        buffer: generated.buffer,
        artifactKind: "photo_annotation",
        mode: "external",
        degradation: "none",
        providerSource: execution.source,
        attempts: execution.attempts,
      };
    } catch {
      console.warn(
        "[ImageAnnotation] External annotation was created but storage upload failed.",
        { code: "storage_upload_failed" },
      );
      return {
        mimeType: generated.mimeType,
        buffer: generated.buffer,
        artifactKind: "photo_annotation",
        mode: "external",
        degradation: "none",
        providerSource: execution.source,
        attempts: execution.attempts,
        detail: "A anotação foi criada, mas o upload do arquivo derivado falhou.",
      };
    }
  } catch (error) {
    console.warn(
      "[ImageAnnotation] External annotation failed without blocking the meal flow.",
      { code: sanitizedErrorCode(error) },
    );
    return {
      skippedReason: "provider_failed",
      mode: "external",
      detail: "A anotação externa falhou sem alterar a foto ou a refeição.",
    };
  }
}
