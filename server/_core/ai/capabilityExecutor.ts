import type { AiProvider } from "../aiProvider";
import type { ResolvedCapabilityConfig, ResolvedProviderModel } from "./configResolver";
import {
  AiNonRetryableError,
  classifyAiError,
  executeWithPolicy,
  type AiAttemptCompletion,
  type AiAttemptContext,
  type AiPolicyExecutionOptions,
  type AiPolicyExecutionResult,
} from "./policyExecutor";
import {
  getAiProviderById,
  type AiProviderFactoryMap,
} from "./providerResolver";
import type { AiProviderId } from "./supportMatrix";
import { createNormalizedProviderBoundary } from "./providerBoundary";
import {
  buildAiInferenceEvents,
  emitAiInferenceEvents,
  type AiObservabilityContext,
  type AiObservabilitySink,
} from "./observability";

export type ResolvedCapabilityAttemptContext = AiAttemptContext & {
  provider: AiProvider;
  providerId: AiProviderId;
  model: string;
};

export type ResolvedCapabilityOperation<T> = (
  context: ResolvedCapabilityAttemptContext,
) => Promise<T>;

export type ExecuteResolvedCapabilityOptions<T> = AiPolicyExecutionOptions<T> & {
  providerFactories?: AiProviderFactoryMap;
  observability?: AiObservabilityContext;
  observabilitySink?: AiObservabilitySink | null;
};

export async function observeUnavailableResolvedCapability(
  config: ResolvedCapabilityConfig,
  observability?: AiObservabilityContext,
  sink?: AiObservabilitySink | null,
): Promise<void> {
  const completion: AiAttemptCompletion<never> = {
    context: { source: "primary", attempt: 0, timeoutMs: config.timeoutMs },
    latencyMs: 0,
    result: {
      status: "error",
      error: new AiNonRetryableError(
        `AI capability configuration is not executable (state=${String(config.state)})`,
        undefined,
        "invalid_configuration",
      ),
    },
  };
  await emitAiInferenceEvents(
    buildAiInferenceEvents({ config, attempts: [completion], context: observability, totalLatencyMs: 0 }),
    sink === undefined ? undefined : sink,
  );
}

function requireTarget(
  target: ResolvedProviderModel | null,
  label: "primary" | "fallback",
): ResolvedProviderModel {
  if (!target?.model) {
    throw new AiNonRetryableError(
      `AI capability ${label} provider/model is not executable.`,
      undefined,
      "invalid_configuration",
    );
  }
  return target;
}

/**
 * Canonical execution boundary for a resolved capability. It binds the
 * provider and model selected by `resolveCapabilityConfig` to the adapter used
 * by every primary, retry and fallback attempt, then delegates sequencing to
 * the common policy executor.
 */
export async function executeResolvedCapability<T>(
  config: ResolvedCapabilityConfig,
  operation: ResolvedCapabilityOperation<T>,
  options: ExecuteResolvedCapabilityOptions<T> = {},
): Promise<AiPolicyExecutionResult<T>> {
  const {
    providerFactories,
    observability,
    observabilitySink,
    onAttemptComplete,
    ...policyOptions
  } = options;
  const attemptCompletions: AiAttemptCompletion<T>[] = [];
  const executionStartedAt = performance.now();
  let primaryAdapter: AiProvider | null = null;
  let fallbackAdapter: AiProvider | null = null;

  const primaryCall = async (context: AiAttemptContext): Promise<T> => {
    const target = requireTarget(config.primary, "primary");
    primaryAdapter ??= createNormalizedProviderBoundary(
      getAiProviderById(target.provider, providerFactories),
    );
    return operation({
      ...context,
      provider: primaryAdapter,
      providerId: target.provider,
      model: target.model,
    });
  };

  const fallbackTarget = config.fallback.effectivelyEnabled
    ? requireTarget(
        config.fallback.provider && config.fallback.model
          ? { provider: config.fallback.provider, model: config.fallback.model }
          : null,
        "fallback",
      )
    : null;

  const fallbackCall = fallbackTarget
    ? async (context: AiAttemptContext): Promise<T> => {
        fallbackAdapter ??= createNormalizedProviderBoundary(
          getAiProviderById(fallbackTarget.provider, providerFactories),
        );
        return operation({
          ...context,
          provider: fallbackAdapter,
          providerId: fallbackTarget.provider,
          model: fallbackTarget.model,
        });
      }
    : undefined;

  try {
    return await executeWithPolicy(config, primaryCall, fallbackCall, {
      ...policyOptions,
      onAttemptComplete: async completion => {
        attemptCompletions.push(completion);
        if (onAttemptComplete) await onAttemptComplete(completion);
      },
    });
  } catch (error) {
    if (attemptCompletions.length === 0) {
      attemptCompletions.push({
        context: { source: "primary", attempt: 0, timeoutMs: config.timeoutMs },
        latencyMs: Math.max(0, Math.round(performance.now() - executionStartedAt)),
        result: { status: "error", error: classifyAiError(error) },
      });
    }
    throw error;
  } finally {
    const events = buildAiInferenceEvents({
      config,
      attempts: attemptCompletions,
      context: observability,
      totalLatencyMs: performance.now() - executionStartedAt,
    });
    await emitAiInferenceEvents(events, observabilitySink === undefined ? undefined : observabilitySink);
  }
}
