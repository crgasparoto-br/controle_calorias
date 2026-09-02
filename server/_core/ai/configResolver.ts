import { AI_CAPABILITY_REGISTRY, type AiCapabilityId } from "./capabilities";
import {
  resolveCapabilityConfig as resolveCapabilityConfigCore,
  type ResolvedCapabilityConfig,
} from "./configResolverCore";
import { findOperationCompatibilityIssues } from "./supportMatrix";

export * from "./configResolverCore";

const WHATSAPP_INTENT_BASELINE_TIMEOUT_MS = 8_000;
const WHATSAPP_INTENT_BASELINE_MAX_ATTEMPTS = 2;

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

/**
 * Delegates provider/model/fallback resolution to the shared per-capability
 * resolver. WHATSAPP_INTENT keeps its pre-existing timeout/attempt baseline
 * only when the canonical AI_WHATSAPP_INTENT_* policy variables are absent.
 * Legacy OPENAI_* selector/policy aliases are intentionally ignored since #960.
 */
export function resolveCapabilityConfig(
  capability: AiCapabilityId,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedCapabilityConfig {
  const config = resolveCapabilityConfigCore(capability, env);
  if (capability !== "WHATSAPP_INTENT") {
    return applyResolvedModelCompatibility(config, capability, env);
  }

  const timeoutMs = readTrimmed(env, "AI_WHATSAPP_INTENT_TIMEOUT_MS")
    ? config.timeoutMs
    : WHATSAPP_INTENT_BASELINE_TIMEOUT_MS;
  const maxAttempts = readTrimmed(env, "AI_WHATSAPP_INTENT_MAX_ATTEMPTS")
    ? config.maxAttempts
    : WHATSAPP_INTENT_BASELINE_MAX_ATTEMPTS;

  return applyResolvedModelCompatibility(
    {
      ...config,
      timeoutMs,
      maxAttempts,
    },
    capability,
    env,
  );
}

function pushCompatibilityDiagnostics(
  diagnostics: string[],
  capability: AiCapabilityId,
  prefix: string,
  issues: ReturnType<typeof findOperationCompatibilityIssues>,
) {
  for (const issue of issues) {
    const message = `capability=${capability} ${prefix}${issue.message}`;
    if (!diagnostics.includes(message)) diagnostics.push(message);
  }
}

function applyResolvedModelCompatibility(
  config: ResolvedCapabilityConfig,
  capability: AiCapabilityId,
  env: NodeJS.ProcessEnv,
): ResolvedCapabilityConfig {
  const requiredOperations = AI_CAPABILITY_REGISTRY[capability].requiredOperations;
  const diagnostics = [...config.diagnostics];
  let state = config.state;
  let fallback = config.fallback;

  if (config.primary) {
    const primaryIssues = findOperationCompatibilityIssues(
      config.primary.provider,
      config.primary.model,
      requiredOperations,
      env,
    );
    if (primaryIssues.length > 0) {
      pushCompatibilityDiagnostics(diagnostics, capability, "", primaryIssues);
      state = "invalid";
      if (fallback.effectivelyEnabled) {
        fallback = { ...fallback, effectivelyEnabled: false };
      }
    }
  }

  if (
    state !== "invalid"
    && fallback.requested
    && fallback.provider
    && fallback.model
  ) {
    const fallbackIssues = findOperationCompatibilityIssues(
      fallback.provider,
      fallback.model,
      requiredOperations,
      env,
    );
    if (fallbackIssues.length > 0) {
      pushCompatibilityDiagnostics(diagnostics, capability, "fallback ", fallbackIssues);
      fallback = { ...fallback, effectivelyEnabled: false };
      if (state === "ready") state = "degraded";
    }
  }

  return { ...config, state, fallback, diagnostics };
}
