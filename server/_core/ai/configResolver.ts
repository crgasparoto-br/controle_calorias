/**
 * Per-capability AI configuration resolver.
 *
 * For each capability in the registry, resolves: adapter first, then model;
 * primary provider/model, timeout, attempts and fallback — all independent
 * per capability. Precedence is always: new `AI_<CAPABILITY>_*` variable >
 * legacy compatible variable (when one exists for that capability) > default
 * equivalent to the pre-#921 baseline behavior.
 *
 * The resolver never infers provider from a model name/prefix. It only reads
 * explicit provider identifiers from env variables and the per-capability
 * defaults table below.
 *
 * Output is a `ready` / `degraded` / `disabled` / `invalid` state plus a
 * sanitized diagnostic list — never a secret value, prompt, payload or media.
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
  /** Whether the capability owner asked for a fallback via env. */
  requested: boolean;
  /** Whether the fallback is actually eligible to run (secret present, cross-provider rule satisfied). */
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
  /** Sanitized diagnostics: no secret value, prompt, payload or media is ever included. */
  diagnostics: string[];
  usedLegacyVariables: boolean;
};

type LegacyMapping = {
  /** Legacy env var that selects the provider for this capability, if any existed pre-#921. */
  legacyProviderEnv?: string;
  /** Legacy env var that selects the model for this capability, if any existed pre-#921. */
  legacyModelEnv?: string;
  defaultProvider: AiProviderId;
  defaultModelByProvider: Partial<Record<AiProviderId, string>>;
};

/**
 * Baseline-equivalent legacy mapping per capability. Only capabilities that
 * had an existing, distinguishable legacy configuration path get one here;
 * capabilities without a prior consumer default straight to the OpenAI
 * baseline default, matching pre-#921 behavior of "OpenAI unless told
 * otherwise via AI_VISION_PROVIDER".
 */
const LEGACY_MAPPING: Record<AiCapabilityId, LegacyMapping> = {
  MEAL_TEXT: {
    legacyProviderEnv: "AI_VISION_PROVIDER",
    legacyModelEnv: undefined,
    defaultProvider: "openai",
    defaultModelByProvider: { openai: "gpt-4.1-mini", gemini: "gemini-2.5-flash" },
  },
  MEAL_VISION: {
    legacyProviderEnv: "AI_VISION_PROVIDER",
    legacyModelEnv: undefined,
    defaultProvider: "openai",
    defaultModelByProvider: { openai: "gpt-4.1-mini", gemini: "gemini-2.5-flash" },
  },
  FOOD_CLASSIFICATION: {
    legacyProviderEnv: "AI_VISION_PROVIDER",
    legacyModelEnv: undefined,
    defaultProvider: "openai",
    defaultModelByProvider: { openai: "gpt-4.1-mini", gemini: "gemini-2.5-flash" },
  },
  WHATSAPP_INTENT: {
    legacyModelEnv: "OPENAI_MODEL",
    defaultProvider: "openai",
    defaultModelByProvider: { openai: "gpt-4.1-mini" },
  },
  QUESTION: {
    legacyModelEnv: "OPENAI_MODEL",
    defaultProvider: "openai",
    defaultModelByProvider: { openai: "gpt-4.1-mini" },
  },
  NUTRITION_SEARCH: {
    defaultProvider: "openai",
    defaultModelByProvider: { openai: "text-embedding-3-small" },
  },
  EMBEDDING: {
    defaultProvider: "openai",
    defaultModelByProvider: { openai: "text-embedding-3-small" },
  },
  TRANSCRIPTION: {
    legacyModelEnv: "OPENAI_TRANSCRIPTION_MODEL",
    defaultProvider: "openai",
    defaultModelByProvider: { openai: "whisper-1" },
  },
  IMAGE_ANNOTATION: {
    legacyModelEnv: "OPENAI_IMAGE_MODEL",
    defaultProvider: "openai",
    defaultModelByProvider: { openai: "gpt-image-1" },
  },
};

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

function providerSecretPresent(provider: AiProviderId, env: NodeJS.ProcessEnv): boolean {
  if (provider === "openai" || provider === "openai-compatible") {
    return readTrimmed(env, "OPENAI_API_KEY").length > 0;
  }
  if (provider === "gemini") {
    return readTrimmed(env, "GEMINI_API_KEY").length > 0;
  }
  return false;
}

function parsePositiveInt(raw: string): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

function parseBoolean(raw: string): boolean {
  return raw.trim().toLowerCase() === "true";
}

function resolveProvider(
  capability: AiCapabilityId,
  env: NodeJS.ProcessEnv,
  diagnostics: string[],
): { provider: string; usedLegacy: boolean; invalid: boolean } {
  const mapping = LEGACY_MAPPING[capability];
  const newVar = `AI_${capability}_PROVIDER`;
  const newValue = readTrimmed(env, newVar).toLowerCase();
  if (newValue) {
    return { provider: newValue, usedLegacy: false, invalid: !isKnownProvider(newValue) };
  }

  if (mapping.legacyProviderEnv) {
    const legacyValue = readTrimmed(env, mapping.legacyProviderEnv).toLowerCase();
    if (legacyValue) {
      return { provider: legacyValue, usedLegacy: true, invalid: !isKnownProvider(legacyValue) };
    }
  }

  return { provider: mapping.defaultProvider, usedLegacy: false, invalid: false };
}

function resolveModel(
  capability: AiCapabilityId,
  provider: AiProviderId,
  env: NodeJS.ProcessEnv,
): { model: string; usedLegacy: boolean } {
  const mapping = LEGACY_MAPPING[capability];
  const newVar = `AI_${capability}_MODEL`;
  const newValue = readTrimmed(env, newVar);
  if (newValue) {
    return { model: newValue, usedLegacy: false };
  }

  if (mapping.legacyModelEnv) {
    const legacyValue = readTrimmed(env, mapping.legacyModelEnv);
    if (legacyValue) {
      return { model: legacyValue, usedLegacy: true };
    }
  }

  return { model: mapping.defaultModelByProvider[provider] ?? "", usedLegacy: false };
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
      fallback: {
        requested: false,
        effectivelyEnabled: false,
        provider: null,
        model: null,
        crossProviderEnabled: false,
      },
      diagnostics,
      usedLegacyVariables,
    };
  }

  const provider = providerResolution.provider as AiProviderId;
  const modelResolution = resolveModel(capability, provider, env);
  if (modelResolution.usedLegacy) {
    usedLegacyVariables = true;
    diagnostics.push(
      `[deprecated] capability=${capability} resolved model via legacy variable ${LEGACY_MAPPING[capability].legacyModelEnv}; migrate to AI_${capability}_MODEL`,
    );
  }

  const unsupported = findUnsupportedOperations(provider, definition.requiredOperations, env);
  if (unsupported.length > 0) {
    diagnostics.push(
      `capability=${capability} provider=${provider} does not support required operation(s): ${unsupported.join(", ")}`,
    );
    return {
      capability,
      state: "invalid",
      primary: { provider, model: modelResolution.model },
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      fallback: {
        requested: false,
        effectivelyEnabled: false,
        provider: null,
        model: null,
        crossProviderEnabled: false,
      },
      diagnostics,
      usedLegacyVariables,
    };
  }

  const timeoutRaw = readTrimmed(env, `AI_${capability}_TIMEOUT_MS`);
  const timeoutParsed = parsePositiveInt(timeoutRaw);
  if (timeoutRaw && timeoutParsed === null) {
    diagnostics.push(`capability=${capability} invalid AI_${capability}_TIMEOUT_MS value`);
  }
  const timeoutMs = timeoutParsed ?? DEFAULT_TIMEOUT_MS;

  const attemptsRaw = readTrimmed(env, `AI_${capability}_MAX_ATTEMPTS`);
  const attemptsParsed = parsePositiveInt(attemptsRaw);
  if (attemptsRaw && attemptsParsed === null) {
    diagnostics.push(`capability=${capability} invalid AI_${capability}_MAX_ATTEMPTS value`);
  }
  const maxAttempts = attemptsParsed ?? DEFAULT_MAX_ATTEMPTS;

  const fallbackEnabledRaw = readTrimmed(env, `AI_${capability}_FALLBACK_ENABLED`);
  const fallbackRequested = fallbackEnabledRaw
    ? parseBoolean(fallbackEnabledRaw)
    : DEFAULT_FALLBACK_ENABLED;

  let fallback: ResolvedFallbackPolicy = {
    requested: fallbackRequested,
    effectivelyEnabled: false,
    provider: null,
    model: null,
    crossProviderEnabled: false,
  };

  let state: AiCapabilityState = "ready";

  const primarySecretPresent = providerSecretPresent(provider, env);
  if (!primarySecretPresent) {
    diagnostics.push(`capability=${capability} provider=${provider} missing required secret`);
    state = "disabled";
  }

  if (fallbackRequested) {
    const fallbackProviderRaw = readTrimmed(env, `AI_${capability}_FALLBACK_PROVIDER`).toLowerCase();
    const fallbackProvider = (fallbackProviderRaw || provider) as string;
    const fallbackModelRaw = readTrimmed(env, `AI_${capability}_FALLBACK_MODEL`);
    const crossProviderEnabled = parseBoolean(
      readTrimmed(env, `AI_${capability}_CROSS_PROVIDER_FALLBACK_ENABLED`) ||
        String(DEFAULT_CROSS_PROVIDER_FALLBACK_ENABLED),
    );

    if (!isKnownProvider(fallbackProvider)) {
      diagnostics.push(`capability=${capability} fallback provider identifier unknown`);
      fallback = {
        requested: true,
        effectivelyEnabled: false,
        provider: null,
        model: null,
        crossProviderEnabled,
      };
      if (state === "ready") state = "degraded";
    } else if (fallbackProvider !== provider && !crossProviderEnabled) {
      // Cross-provider fallback requires explicit opt-in; never send data to
      // the second provider without it. The config stays degraded: primary
      // still runs, fallback is not eligible.
      diagnostics.push(
        `capability=${capability} fallback provider=${fallbackProvider} differs from primary=${provider} but AI_${capability}_CROSS_PROVIDER_FALLBACK_ENABLED is not true; fallback disabled`,
      );
      fallback = {
        requested: true,
        effectivelyEnabled: false,
        provider: fallbackProvider,
        model: fallbackModelRaw || null,
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
      const fallbackModel =
        fallbackModelRaw || LEGACY_MAPPING[capability].defaultModelByProvider[fallbackProvider] || modelResolution.model;

      if (!fallbackSecretPresent) {
        diagnostics.push(`capability=${capability} fallback provider=${fallbackProvider} missing required secret`);
      }
      if (fallbackUnsupported.length > 0) {
        diagnostics.push(
          `capability=${capability} fallback provider=${fallbackProvider} does not support required operation(s): ${fallbackUnsupported.join(", ")}`,
        );
      }

      const fallbackEligible = fallbackSecretPresent && fallbackUnsupported.length === 0;
      fallback = {
        requested: true,
        effectivelyEnabled: fallbackEligible,
        provider: fallbackProvider,
        model: fallbackModel,
        crossProviderEnabled: fallbackProvider !== provider ? crossProviderEnabled : false,
      };

      if (!fallbackEligible && state === "ready") {
        state = "degraded";
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
