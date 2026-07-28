import type { AiCapabilityId } from "./capabilities";
import {
  resolveCapabilityConfig as resolveCapabilityConfigCore,
  type ResolvedCapabilityConfig,
} from "./configResolverCore";

export * from "./configResolverCore";

const WHATSAPP_INTENT_BASELINE_TIMEOUT_MS = 8_000;
const WHATSAPP_INTENT_BASELINE_MAX_ATTEMPTS = 2;
const MAX_LEGACY_WHATSAPP_INTENT_RETRIES = 2;

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

function readPositiveInteger(env: NodeJS.ProcessEnv, name: string): number | null {
  const value = Number(readTrimmed(env, name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function readLegacyRetryCount(env: NodeJS.ProcessEnv): number | null {
  const raw = readTrimmed(env, "OPENAI_WHATSAPP_INTENT_RETRIES");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), MAX_LEGACY_WHATSAPP_INTENT_RETRIES)
    : null;
}

/**
 * Preserves the pre-#922 WhatsApp intent defaults while delegating all provider,
 * capability, support-matrix and fallback resolution to the shared resolver.
 * Other capabilities are returned byte-for-byte from the core implementation.
 */
export function resolveCapabilityConfig(
  capability: AiCapabilityId,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedCapabilityConfig {
  const config = resolveCapabilityConfigCore(capability, env);
  if (capability !== "WHATSAPP_INTENT") return config;

  const diagnostics = [...config.diagnostics];
  let usedLegacyVariables = config.usedLegacyVariables;
  let primary = config.primary;

  const hasNewModel = Boolean(readTrimmed(env, "AI_WHATSAPP_INTENT_MODEL"));
  const specificLegacyModel = readTrimmed(env, "OPENAI_WHATSAPP_INTENT_MODEL");
  const legacyTextModel = readTrimmed(env, "OPENAI_TEXT_MODEL");
  const usesOpenAiWire = primary?.provider === "openai" || primary?.provider === "openai-compatible";

  if (primary && usesOpenAiWire && !hasNewModel) {
    const legacyModel = specificLegacyModel || legacyTextModel;
    const legacyEnv = specificLegacyModel
      ? "OPENAI_WHATSAPP_INTENT_MODEL"
      : legacyTextModel
        ? "OPENAI_TEXT_MODEL"
        : null;
    if (legacyModel && legacyEnv) {
      primary = { ...primary, model: legacyModel };
      usedLegacyVariables = true;
      diagnostics.push(
        `[deprecated] capability=WHATSAPP_INTENT resolved model via legacy variable ${legacyEnv}; migrate to AI_WHATSAPP_INTENT_MODEL`,
      );
    }
  }

  const hasNewTimeout = Boolean(readTrimmed(env, "AI_WHATSAPP_INTENT_TIMEOUT_MS"));
  const legacyTimeout = hasNewTimeout
    ? null
    : readPositiveInteger(env, "OPENAI_WHATSAPP_INTENT_TIMEOUT_MS");
  const timeoutMs = hasNewTimeout
    ? config.timeoutMs
    : legacyTimeout ?? WHATSAPP_INTENT_BASELINE_TIMEOUT_MS;
  if (legacyTimeout !== null) {
    usedLegacyVariables = true;
    diagnostics.push(
      "[deprecated] capability=WHATSAPP_INTENT resolved timeout via legacy variable OPENAI_WHATSAPP_INTENT_TIMEOUT_MS; migrate to AI_WHATSAPP_INTENT_TIMEOUT_MS",
    );
  }

  const hasNewMaxAttempts = Boolean(readTrimmed(env, "AI_WHATSAPP_INTENT_MAX_ATTEMPTS"));
  const legacyRetries = hasNewMaxAttempts ? null : readLegacyRetryCount(env);
  const maxAttempts = hasNewMaxAttempts
    ? config.maxAttempts
    : legacyRetries !== null
      ? legacyRetries + 1
      : WHATSAPP_INTENT_BASELINE_MAX_ATTEMPTS;
  if (legacyRetries !== null) {
    usedLegacyVariables = true;
    diagnostics.push(
      "[deprecated] capability=WHATSAPP_INTENT resolved attempts via legacy variable OPENAI_WHATSAPP_INTENT_RETRIES; migrate to AI_WHATSAPP_INTENT_MAX_ATTEMPTS",
    );
  }

  return {
    ...config,
    primary,
    timeoutMs,
    maxAttempts,
    diagnostics,
    usedLegacyVariables,
  };
}
