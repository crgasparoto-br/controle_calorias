/**
 * Per-capability AI configuration resolver.
 *
 * Resolution order is adapter first, model second. Provider support is explicit
 * and no decision is inferred from a model name. A non-empty OPENAI_BASE_URL is
 * treated conservatively as an OpenAI-compatible endpoint and therefore uses
 * only operations explicitly validated in AI_OPENAI_COMPATIBLE_OPERATIONS.
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
  usedLegacyVariables: boolean;
};

type LegacyMapping = {
  legacyProviderEnv?: string;
  legacyModelEnvByProvider?: Partial<Record<AiProviderId, string>>;
  defaultProvider: AiProviderId;
  defaultModelByProvider: Partial<Record<AiProviderId, string>>;
};

const TEXT_MODEL_DEFAULTS = {
  openai: "gpt-4.1-mini",
  "openai-compatible": "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
} satisfies Partial<Record<AiProviderId, string>>;

const TEXT_MODEL_LEGACY_ENVS = {
  openai: "OPENAI_MODEL",
  "openai-compatible": "OPENAI_MODEL",
  gemini: "GEMINI_MODEL",
} satisfies Partial<Record<AiProviderId, string>>;

const LEGACY_MAPPING: Record<AiCapabilityId, LegacyMapping> = {
  MEAL_TEXT: {
    legacyProviderEnv: "AI_VISION_PROVIDER",
    legacyModelEnvByProvider: TEXT_MODEL_LEGACY_ENVS,
    defaultProvider: "openai",
    defaultModelByProvider: TEXT_MODEL_DEFAULTS,
  },
  MEAL_VISION: {
    legacyProviderEnv: "AI_VISION_PROVIDER",
    legacyModelEnvByProvider: TEXT_MODEL_LEGACY_ENVS,
    defaultProvider: "openai",
    defaultModelByProvider: TEXT_MODEL_DEFAULTS,
  },
  FOOD_CLASSIFICATION: {
    legacyProviderEnv: "AI_VISION_PROVIDER",
    legacyModelEnvByProvider: TEXT_MODEL_LEGACY_ENVS,
    defaultProvider: "openai",
    defaultModelByProvider: TEXT_MODEL_DEFAULTS,
  },
  WHATSAPP_INTENT: {
    legacyProviderEnv: "AI_VISION_PROVIDER",
    legacyModelEnvByProvider: TEXT_MODEL_LEGACY_ENVS,
    defaultProvider: "openai",
    defaultModelByProvider: TEXT_MODEL_DEFAULTS,
  },
  QUESTION: {
    legacyModelEnvByProvider: TEXT_MODEL_LEGACY_ENVS,
    defaultProvider: "openai",
    defaultModelByProvider: TEXT_MODEL_DEFAULTS,
  },
  NUTRITION_SEARCH: {
    legacyProviderEnv: "AI_VISION_PROVIDER",
    legacyModelEnvByProvider: TEXT_MODEL_LEGACY_ENVS,
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
    legacyModelEnvByProvider: {
      openai: "OPENAI_TRANSCRIPTION_MODEL",
      "openai-compatible": "OPENAI_TRANSCRIPTION_MODEL",
    },
    defaultProvider: "openai",
    defaultModelByProvider: {
      openai: "whisper-1",
      "openai-compatible": "whisper-1",
    },
  },
  IMAGE_ANNOTATION: {
    legacyModelEnvByProvider: {
      openai: "OPENAI_IMAGE_MODEL",
      "openai-compatible": "OPENAI_IMAGE_MODEL",
    },
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
): { provider: string; usedLegacy: boolean; invalid: boolean } {
  const mapping = LEGACY_MAPPING[capability];
  const newValue = readTrimmed(env, `AI_${capability}_PROVIDER`).toLowerCase();

  let provider = newValue;
  let usedLegacy = false;
  if (!provider && mapping.legacyProviderEnv) {
    provider = readTrimmed(env, mapping.legacyProviderEnv).toLowerCase();
    usedLegacy = Boolean(provider);
  }
  if (!provider) provider = mapping.defaultProvider;

  provider = applyEndpointPolicy(capability, provider, env, diagnostics);
  return { provider, usedLegacy, invalid: !isKnownProvider(provider) };
}

function resolveModel(
  capability: AiCapabilityId,
  provider: AiProviderId,
  env: NodeJS.ProcessEnv,
): { model: string; usedLegacy: boolean; legacyEnv?: string } {
  const mapping = LEGACY_MAPPING[capability];
  const newValue = readTrimmed(env, `AI_${capability}_MODEL`);
  if (newValue) return { model: newValue, usedLegacy: false };

  const legacyEnv = mapping.legacyModelEnvByProvider?.[provider];
  if (legacyEnv) {
    const legacyValue = readTrimmed(env, legacyEnv);
    if (legacyValue) return { model: legacyValue, usedLegacy: true, legacyEnv };
  }

  return {
    model: mapping.defaultModelByProvider[provider]?.trim() ?? "",
    usedLegacy: false,
  };
}

function resolveFallbackModel(
  capability: AiCapabilityId,
  provider: AiProviderId,
  primaryProvider: AiProviderId,
  primaryModel: string,
  env: NodeJS.ProcessEnv,
): { model: string; usedLegacy: boolean; legacyEnv?: string } {
  const explicitModel = readTrimmed(env, `AI_${capability}_FALLBACK_MODEL`);
  if (explicitModel) return { model: explicitModel, usedLegacy: false };

  const mapping = LEGACY_MAPPING[capability];
  const legacyEnv = mapping.legacyModelEnvByProvider?.[provider];
  if (legacyEnv) {
    const legacyModel = readTrimmed(env, legacyEnv);
    if (legacyModel) return { model: legacyModel, usedLegacy: true, legacyEnv };
  }

  const defaultModel = mapping.defaultModelByProvider[provider]?.trim() ?? "";
  if (defaultModel) return { model: defaultModel, usedLegacy: false };

  return {
    model: provider === primaryProvider ? primaryModel : "",
    usedLegacy: false,
  };
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
  let usedLegacyVariables = false;
  const definition = AI_CAPABILITY_REGISTRY[capability];

  const providerResolution = resolveProvider(capability, env, diagnostics);
  if (providerResolution.usedLegacy) {
    usedLegacyVariables = true;
    diagnostics.push(
      `[deprecated] capability=${capability} resolved provider via legacy variable ${LEGACY_MAPPING[capability].legacyProviderEnv}; migrate to AI_${capability}_PROVIDER`,
    );
  }

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
      usedLegacyVariables,
    };
  }

  const provider = providerResolution.provider as AiProviderId;
  const modelResolution = resolveModel(capability, provider, env);
  if (modelResolution.usedLegacy) {
    usedLegacyVariables = true;
    diagnostics.push(
      `[deprecated] capability=${capability} resolved model via legacy variable ${modelResolution.legacyEnv}; migrate to AI_${capability}_MODEL`,
    );
  }

  let state: AiCapabilityState = "ready";
  if (!modelResolution.model) {
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
      const fallbackModelResolution = resolveFallbackModel(
        capability,
        fallbackProvider,
        provider,
        modelResolution.model,
        env,
      );
      const fallbackModel = fallbackModelResolution.model;

      if (fallbackModelResolution.usedLegacy) {
        usedLegacyVariables = true;
        diagnostics.push(
          `[deprecated] capability=${capability} resolved fallback model via legacy variable ${fallbackModelResolution.legacyEnv}; migrate to AI_${capability}_FALLBACK_MODEL`,
        );
      }

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
      } else {
        const fallbackSecretPresent = providerSecretPresent(fallbackProvider, env);
        const fallbackUnsupported = findUnsupportedOperations(
          fallbackProvider,
          definition.requiredOperations,
          env,
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

        const primaryRunnable = state === "ready";
        const fallbackEligible =
          primaryRunnable &&
          Boolean(fallbackModel) &&
          fallbackSecretPresent &&
          fallbackUnsupported.length === 0;

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
    primary: { provider, model: modelResolution.model },
    timeoutMs,
    maxAttempts,
    fallback,
    diagnostics,
    usedLegacyVariables,
  };
}
