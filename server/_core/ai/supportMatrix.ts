/**
 * Explicit, testable adapter support matrix.
 *
 * Support is never inferred from provider or model naming. `openai-compatible`
 * is fail-closed: an operator must explicitly list every operation validated
 * for the endpoint configured through OPENAI_BASE_URL.
 */

import { AI_OPERATIONS, type AiOperation } from "./capabilities";

export const AI_PROVIDERS = ["openai", "gemini", "openai-compatible"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

const OPENAI_OPERATIONS: readonly AiOperation[] = [...AI_OPERATIONS];

// This matrix describes methods actually exposed by GeminiProvider today.
// Embeddings must remain unsupported until the adapter implements and tests an
// embedding operation instead of only relying on the upstream SDK capability.
const GEMINI_OPERATIONS: readonly AiOperation[] = [
  "text",
  "vision",
  "structured_output",
];

export function readOpenAiCompatibleValidatedOperations(
  env: NodeJS.ProcessEnv = process.env,
): AiOperation[] {
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
