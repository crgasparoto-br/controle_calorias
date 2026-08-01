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


export type AiOperationCompatibilityIssue = {
  code: "unsupported_operation_combination";
  operations: readonly AiOperation[];
  message: string;
};

function isGeminiThreeSeriesModel(model: string): boolean {
  return /^gemini-3(?:[.-]|$)/iu.test(model.trim());
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
): AiOperationCompatibilityIssue[] {
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
