/**
 * Explicit, testable adapter support matrix.
 *
 * Operation support is explicit. Model-specific operation combinations are
 * also validated before network access when a provider documents narrower
 * support for a combined request. `openai-compatible` is fail-closed: an
 * operator must configure OPENAI_BASE_URL and explicitly list every operation
 * validated for that endpoint.
 */
import { AI_OPERATIONS, type AiOperation } from "./capabilities";

export const AI_PROVIDERS = ["openai", "gemini", "openai-compatible"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

const OPENAI_OPERATIONS: readonly AiOperation[] = [
  "text",
  "vision",
  "structured_output",
  "web_search",
  "embeddings",
  "transcription",
  "image_generation",
  "image_edit",
];

const GEMINI_OPERATIONS: readonly AiOperation[] = [
  "text",
  "vision",
  "structured_output",
  "web_search",
];

const OPENAI_IMAGE_MODELS = new Set([
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "gpt-image-1.5-2025-12-16",
  "gpt-image-2",
]);

export type AiOperationCompatibilityIssue = {
  code: "unsupported_operation_combination";
  operations: readonly AiOperation[];
  message: string;
};

function isGeminiThreeSeriesModel(model: string): boolean {
  return /^gemini-3(?:[.-]|$)/iu.test(model.trim());
}

const OPENAI_TRANSCRIPTION_MODELS = new Set([
  "whisper-1",
  "gpt-4o-mini-transcribe",
  "gpt-4o-mini-transcribe-2025-12-15",
  "gpt-4o-transcribe",
]);

function isOpenAiTranscriptionModel(model: string): boolean {
  return OPENAI_TRANSCRIPTION_MODELS.has(model.trim().toLowerCase());
}

function isOpenAiImageModel(model: string): boolean {
  return OPENAI_IMAGE_MODELS.has(model.trim());
}

function requiresImageModelValidation(operations: readonly AiOperation[]): boolean {
  return operations.includes("image_generation") || operations.includes("image_edit");
}

/**
 * Provider operations may be supported individually while their combination
 * is not supported by a specific model. Gemini documents Structured Outputs
 * with built-in tools (including Google Search Grounding) only for Gemini 3
 * series models. Keep that constraint at the resolver boundary so an invalid
 * request is rejected locally instead of consuming a provider call.
 */
export function findOperationCompatibilityIssues(
  provider: AiProviderId,
  model: string,
  operations: readonly AiOperation[],
  env?: NodeJS.ProcessEnv,
): AiOperationCompatibilityIssue[] {
  if (
    provider === "openai"
    && operations.includes("transcription")
    && !isOpenAiTranscriptionModel(model)
  ) {
    return [{
      code: "unsupported_operation_combination",
      operations: ["transcription"],
      message: `provider=openai model=${model || "<empty>"} is not an approved transcription model; configure an explicitly approved Audio API transcription model`,
    }];
  }

  if (
    provider === "gemini"
    && operations.includes("structured_output")
    && operations.includes("web_search")
    && !isGeminiThreeSeriesModel(model)
  ) {
    return [{
      code: "unsupported_operation_combination",
      operations: ["structured_output", "web_search"],
      message: `provider=gemini model=${model || "<empty>"} does not support the required structured_output+web_search combination; configure an explicitly approved Gemini 3 series model`,
    }];
  }

  if (requiresImageModelValidation(operations)) {
    if (provider === "openai" && !isOpenAiImageModel(model)) {
      return [{
        code: "unsupported_operation_combination",
        operations: operations.filter(operation =>
          operation === "image_generation" || operation === "image_edit"),
        message: "provider=openai configured model is not an approved image generation/edit model",
      }];
    }

    if (
      provider === "openai-compatible"
      && env !== undefined
      && !readOpenAiCompatibleValidatedImageModels(env).includes(model.trim())
    ) {
      return [{
        code: "unsupported_operation_combination",
        operations: operations.filter(operation =>
          operation === "image_generation" || operation === "image_edit"),
        message: "provider=openai-compatible configured image model is not explicitly validated in AI_OPENAI_COMPATIBLE_IMAGE_MODELS",
      }];
    }
  }

  return [];
}

function hasOpenAiCompatibleEndpoint(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.OPENAI_BASE_URL?.trim());
}

export function readOpenAiCompatibleValidatedOperations(
  env: NodeJS.ProcessEnv = process.env,
): AiOperation[] {
  if (!hasOpenAiCompatibleEndpoint(env)) return [];

  const raw = env.AI_OPENAI_COMPATIBLE_OPERATIONS?.trim();
  if (!raw) return [];

  const known = new Set<string>(AI_OPERATIONS);
  return [...new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value): value is AiOperation => known.has(value)),
  )];
}

export function readOpenAiCompatibleValidatedImageModels(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (!hasOpenAiCompatibleEndpoint(env)) return [];

  const raw = env.AI_OPENAI_COMPATIBLE_IMAGE_MODELS?.trim();
  if (!raw) return [];

  return [...new Set(
    raw
      .split(",")
      .map(value => value.trim())
      .filter(Boolean),
  )];
}

export function getSupportedOperations(
  provider: AiProviderId,
  env: NodeJS.ProcessEnv = process.env,
): readonly AiOperation[] {
  switch (provider) {
    case "openai":
      return OPENAI_OPERATIONS;
    case "gemini":
      return GEMINI_OPERATIONS;
    case "openai-compatible":
      return readOpenAiCompatibleValidatedOperations(env);
    default:
      return [];
  }
}

export function supportsOperation(
  provider: AiProviderId,
  operation: AiOperation,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getSupportedOperations(provider, env).includes(operation);
}

export function findUnsupportedOperations(
  provider: AiProviderId,
  operations: readonly AiOperation[],
  env: NodeJS.ProcessEnv = process.env,
): AiOperation[] {
  const supported = getSupportedOperations(provider, env);
  return operations.filter((operation) => !supported.includes(operation));
}

export function isKnownProvider(value: string): value is AiProviderId {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}
