/**
 * Per-capability AI configuration resolver.
 *
 * Resolution order is adapter first, model second. Provider support is explicit
 * and no decision is inferred from a model name. A non-empty OPENAI_BASE_URL is
 * treated conservatively as an OpenAI-compatible endpoint and therefore uses
 * only operations explicitly validated in AI_OPENAI_COMPATIBLE_OPERATIONS.
 *
 * Since #960, only AI_<CAPABILITY>_* selectors participate in routing. Legacy
 * global/model aliases are intentionally ignored.
 */

import type { AiCapabilityId } from "./capabilities";
import { AI_CAPABILITY_REGISTRY } from "./capabilities";
import {
  DEFAULT_CROSS_PROVIDER_FALLBACK_ENABLED,
  DEFAULT_FALLBACK_ENABLED,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
} from "./policyDefaults";
import {
  findOperationCompatibilityIssues,
  findUnsupportedOperations,
  isKnownProvider,
  type AiProviderId,
} from "./supportMatrix";

export type AiCapabilityState = "ready" | "degraded" | "disabled" | "invalid";

export type ResolvedProviderModel = {
  provider: AiProviderId;
  model: string;
};

export type ResolvedFallbackPolicy = {
  requested: boolean;
  effectivelyEnabled: boolean;
  provider: AiProviderId | null;
  model: string | null;
  crossProviderEnabled: boolean;
};

export type ResolvedCapabilityConfig = {
  capability: AiCapabilityId;
  state: AiCapabilityState;
  primary: ResolvedProviderModel | null;
  timeoutMs: number;
  maxAttempts: number;
  fallback: ResolvedFallbackPolicy;
  /** Sanitized diagnostics: never include secret values, prompts, payloads or media. */
  diagnostics: string[];
  /** Compatibility-neutral result shape retained for existing typed fixtures; always false after #960. */
  usedLegacyVariables: false;
};

type CapabilityDefaults = {
  defaultProvider: AiProviderId;
  defaultModelByProvider: Partial<Record<AiProviderId, string>>;
};

const TEXT_MODEL_DEFAULTS = {
  openai: "gpt-4.1-mini",
  "openai-compatible": "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
} satisfies Partial<Record<AiProviderId, string>>;

const CAPABILITY_DEFAULTS: Record<AiCapabilityId, CapabilityDefaults> = {
  MEAL_TEXT: {
    defaultProvider: "openai",
    defaultModelByProvider: TEXT_MODEL_DEFAULTS,
  },
  MEAL_VISION: {
    defaultProvider: "openai",
    defaultModelByProvider: TEXT_MODEL_DEFAULTS,
  },
  FOOD_CLASSIFICATION: {
    defaultProvider: "openai",
    defaultModelByProvider: TEXT_MODEL_DEFAULTS,
  },
  WHATSAPP_INTENT: {
    defaultProvider: "openai",
    defaultModelByProvider: TEXT_MODEL_DEFAULTS,
  },
  QUESTION: {
    defaultProvider: "openai",
    defaultModelByProvider: TEXT_MODEL_DEFAULTS,
  },
  NUTRITION_SEARCH: {
    defaultProvider: "openai",
    defaultModelByProvider: TEXT_MODEL_DEFAULTS,
  },
  EMBEDDING: {
    defaultProvider: "openai",
    defaultModelByProvider: {
      openai: "text-embedding-3-small",
      "openai-compatible": "text-embedding-3-small",
    },
  },
  TRANSCRIPTION: {
    defaultProvider: "openai",
    defaultModelByProvider: {
      openai: "whisper-1",
      "openai-compatible": "whisper-1",
    },
  },
  IMAGE_ANNOTATION: {
    defaultProvider: "openai",
    defaultModelByProvider: {
      openai: "gpt-image-1",
      "openai-compatible": "gpt-image-1",
    },
  },
};

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

function providerSecretPresent(provider: AiProviderId, env: NodeJS.ProcessEnv): boolean {
  if (provider === "openai" || provider === "openai-compatible") {
    return readTrimmed(env, "OPENAI_API_KEY").length > 0;
  }
  return readTrimmed(env, "GEMINI_API_KEY").length > 0;
}

function parsePositiveInt(raw: string): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : null;
}

function parseBoolean(raw: string): boolean {
  return raw.trim().toLowerCase() === "true";
}

function applyEndpointPolicy(
  capability: AiCapabilityId,
  provider: string,
  env: NodeJS.ProcessEnv,
  diagnostics: string[],
): string {
  if (provider === "openai" && readTrimmed(env, "OPENAI_BASE_URL")) {
    diagnostics.push(
      `capability=${capability} custom OPENAI_BASE_URL configured; applying openai-compatible operation allowlist`,
    );
    return "openai-compatible";
  }
  return provider;
}

function resolveProvider(
  capability: AiCapabilityId,
  env: NodeJS.ProcessEnv,
  diagnostics: string[],
): { provider: string; invalid: boolean } {
  const defaults = CAPABILITY_DEFAULTS[capability];
  const configured = readTrimmed(env, `AI_${capability}_PROVIDER`).toLowerCase();
  const provider = applyEndpointPolicy(
    capability,
    configured || defaults.defaultProvider,
    env,
    diagnostics,
  );
  return { provider, invalid: !isKnownProvider(provider) };
}

function resolveModel(
  capability: AiCapabilityId,
  provider: AiProviderId,
  env: NodeJS.ProcessEnv,
): string {
  const configured = readTrimmed(env, `AI_${capability}_MODEL`);
  if (configured) return configured;
  return CAPABILITY_DEFAULTS[capability].defaultModelByProvider[provider]?.trim() ?? "";
}

function resolveFallbackModel(
  capability: AiCapabilityId,
  provider: AiProviderId,
  primaryProvider: AiProviderId,
  primaryModel: string,
  env: NodeJS.ProcessEnv,
): string {
  const configured = readTrimmed(env, `AI_${capability}_FALLBACK_MODEL`);
  if (configured) return configured;

  const defaultModel = CAPABILITY_DEFAULTS[capability].defaultModelByProvider[provider]?.trim() ?? "";
  if (defaultModel) return defaultModel;
  return provider === primaryProvider ? primaryModel : "";
}

function emptyFallback(requested = false): ResolvedFallbackPolicy {
  return {
    requested,
    effectivelyEnabled: false,
    provider: null,
    model: null,
    crossProviderEnabled: false,
  };
}

export function resolveCapabilityConfig(
  capability: AiCapabilityId,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedCapabilityConfig {
  const diagnostics: string[] = [];
  const definition = AI_CAPABILITY_REGISTRY[capability];

  const providerResolution = resolveProvider(capability, env, diagnostics);
  if (providerResolution.invalid) {
    diagnostics.push(`capability=${capability} unknown provider identifier configured`);
    return {
      capability,
      state: "invalid",
      primary: null,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      fallback: emptyFallback(),
      diagnostics,
      usedLegacyVariables: false,
    };
  }

  const provider = providerResolution.provider as AiProviderId;
  const model = resolveModel(capability, provider, env);

  let state: AiCapabilityState = "ready";
  if (!model) {
    diagnostics.push(`capability=${capability} provider=${provider} has no model configured`);
    state = "invalid";
  }

  const unsupported = findUnsupportedOperations(provider, definition.requiredOperations, env);
  if (unsupported.length > 0) {
    diagnostics.push(
      `capability=${capability} provider=${provider} does not support required operation(s): ${unsupported.join(", ")}`,
    );
    state = "invalid";
  }

  const primaryCompatibilityIssues = findOperationCompatibilityIssues(
    provider,
    model,
    definition.requiredOperations,
  );
  for (const issue of primaryCompatibilityIssues) {
    diagnostics.push(`capability=${capability} ${issue.message}`);
    state = "invalid";
  }

  const timeoutRaw = readTrimmed(env, `AI_${capability}_TIMEOUT_MS`);
  const timeoutParsed = parsePositiveInt(timeoutRaw);
  if (timeoutRaw && timeoutParsed === null) {
    diagnostics.push(`capability=${capability} invalid AI_${capability}_TIMEOUT_MS value`);
    state = "invalid";
  }
  const timeoutMs = timeoutParsed ?? DEFAULT_TIMEOUT_MS;

  const attemptsRaw = readTrimmed(env, `AI_${capability}_MAX_ATTEMPTS`);
  const attemptsParsed = parsePositiveInt(attemptsRaw);
  if (attemptsRaw && attemptsParsed === null) {
    diagnostics.push(`capability=${capability} invalid AI_${capability}_MAX_ATTEMPTS value`);
    state = "invalid";
  }
  const maxAttempts = attemptsParsed ?? DEFAULT_MAX_ATTEMPTS;

  const primarySecretPresent = providerSecretPresent(provider, env);
  if (!primarySecretPresent) {
    diagnostics.push(`capability=${capability} provider=${provider} missing required secret`);
    if (state !== "invalid") state = "disabled";
  }

  const fallbackEnabledRaw = readTrimmed(env, `AI_${capability}_FALLBACK_ENABLED`);
  const fallbackRequested = fallbackEnabledRaw
    ? parseBoolean(fallbackEnabledRaw)
    : DEFAULT_FALLBACK_ENABLED;

  let fallback = emptyFallback(fallbackRequested);
  if (fallbackRequested) {
    const rawFallbackProvider =
      readTrimmed(env, `AI_${capability}_FALLBACK_PROVIDER`).toLowerCase() || provider;
    const normalizedFallbackProvider = applyEndpointPolicy(
      capability,
      rawFallbackProvider,
      env,
      diagnostics,
    );
    const crossProviderEnabled = parseBoolean(
      readTrimmed(env, `AI_${capability}_CROSS_PROVIDER_FALLBACK_ENABLED`) ||
        String(DEFAULT_CROSS_PROVIDER_FALLBACK_ENABLED),
    );

    if (!isKnownProvider(normalizedFallbackProvider)) {
      diagnostics.push(`capability=${capability} fallback provider identifier unknown`);
      fallback = {
        ...emptyFallback(true),
        crossProviderEnabled,
      };
      if (state === "ready") state = "degraded";
    } else {
      const fallbackProvider = normalizedFallbackProvider;
      const isCrossProvider = fallbackProvider !== provider;
      const fallbackModel = resolveFallbackModel(
        capability,
        fallbackProvider,
        provider,
        model,
        env,
      );
      const productionCrossProviderBlocked =
        isCrossProvider && readTrimmed(env, "NODE_ENV").toLowerCase() === "production";

      if (isCrossProvider && !crossProviderEnabled) {
        diagnostics.push(
          `capability=${capability} fallback provider=${fallbackProvider} differs from primary=${provider} but AI_${capability}_CROSS_PROVIDER_FALLBACK_ENABLED is not true; fallback disabled`,
        );
        fallback = {
          requested: true,
          effectivelyEnabled: false,
          provider: fallbackProvider,
          model: fallbackModel || null,
          crossProviderEnabled: false,
        };
        if (state === "ready") state = "degraded";
      } else if (productionCrossProviderBlocked) {
        diagnostics.push(
          `capability=${capability} cross-provider fallback remains disabled in production; comparison, privacy review and authorized rollout are tracked per capability in issue #962`,
        );
        fallback = {
          requested: true,
          effectivelyEnabled: false,
          provider: fallbackProvider,
          model: fallbackModel || null,
          crossProviderEnabled: true,
        };
        if (state === "ready") state = "degraded";
      } else {
        const fallbackSecretPresent = providerSecretPresent(fallbackProvider, env);
        const fallbackUnsupported = findUnsupportedOperations(
          fallbackProvider,
          definition.requiredOperations,
          env,
        );
        const fallbackCompatibilityIssues = findOperationCompatibilityIssues(
          fallbackProvider,
          fallbackModel,
          definition.requiredOperations,
        );

        if (!fallbackModel) {
          diagnostics.push(
            `capability=${capability} fallback provider=${fallbackProvider} has no model configured`,
          );
        }
        if (!fallbackSecretPresent) {
          diagnostics.push(
            `capability=${capability} fallback provider=${fallbackProvider} missing required secret`,
          );
        }
        if (fallbackUnsupported.length > 0) {
          diagnostics.push(
            `capability=${capability} fallback provider=${fallbackProvider} does not support required operation(s): ${fallbackUnsupported.join(", ")}`,
          );
        }
        for (const issue of fallbackCompatibilityIssues) {
          diagnostics.push(`capability=${capability} fallback ${issue.message}`);
        }

        const primaryRunnable = state === "ready";
        const fallbackEligible =
          primaryRunnable &&
          Boolean(fallbackModel) &&
          fallbackSecretPresent &&
          fallbackUnsupported.length === 0 &&
          fallbackCompatibilityIssues.length === 0;

        fallback = {
          requested: true,
          effectivelyEnabled: fallbackEligible,
          provider: fallbackProvider,
          model: fallbackModel || null,
          crossProviderEnabled: isCrossProvider ? crossProviderEnabled : false,
        };

        if (!fallbackEligible && state === "ready") state = "degraded";
      }
    }
  }

  return {
    capability,
    state,
    primary: { provider, model },
    timeoutMs,
    maxAttempts,
    fallback,
    diagnostics,
    usedLegacyVariables: false,
  };
}
