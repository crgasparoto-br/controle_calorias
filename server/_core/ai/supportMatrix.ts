/**
 * Adapter support matrix.
 *
 * Each provider adapter declares, explicitly and testably, which
 * {@link AiOperation}s it supports. Nothing here infers support from a
 * provider name or a model name/prefix — support must be declared as data.
 *
 * `openai-compatible` represents a deployment where `OPENAI_BASE_URL` points
 * at a non-OpenAI API that speaks (a subset of) the OpenAI wire format. In
 * that case we only mark the operations that have been explicitly configured
 * as validated for that endpoint via {@link OPENAI_COMPATIBLE_VALIDATED_OPERATIONS};
 * everything else (Structured Outputs, web search, embeddings, audio, image)
 * is treated as unsupported by default, since the compatible endpoint may not
 * implement it.
 */

import type { AiOperation } from "./capabilities";

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
  "embeddings",
];

/**
 * Operations explicitly validated for the configured OPENAI_BASE_URL
 * compatible endpoint. Empty by default: an operator must opt in per
 * operation once they have verified the compatible endpoint implements it.
 * Read from AI_OPENAI_COMPATIBLE_OPERATIONS (comma-separated list of
 * {@link AiOperation} values), e.g. "text,structured_output".
 */
export function readOpenAiCompatibleValidatedOperations(
  env: NodeJS.ProcessEnv = process.env,
): AiOperation[] {
  const raw = env.AI_OPENAI_COMPATIBLE_OPERATIONS?.trim();
  if (!raw) return [];

  const known = new Set<string>(["text", "vision", "structured_output", "web_search", "embeddings", "transcription", "image_generation", "image_edit"]);

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is AiOperation => known.has(value));
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

/**
 * Returns the subset of `operations` that `provider` does NOT support.
 * Empty array means the provider is compatible with all required operations.
 */
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
