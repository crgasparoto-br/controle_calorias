import { randomUUID } from "node:crypto";
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
import {
  createNormalizedProviderBoundary,
  type AiProviderCallObservation,
} from "./providerBoundary";
import {
  buildAiInferenceEvents,
  emitAiInferenceEvents,
  type AiObservedAttemptCompletion,
  type AiObservabilityContext,
  type AiObservabilitySink,
} from "./observability";
import { enforceAiUsageGate, getAiUsageGate } from "./usageGate";
import { getCurrentAiUsageScope } from "./usageContext";

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

async function applyUsageGovernance(
  config: ResolvedCapabilityConfig,
  observability?: AiObservabilityContext,
): Promise<AiObservabilityContext | undefined> {
  const rawCorrelation = observability?.correlation ?? {};
  const scoped = getCurrentAiUsageScope();
  const candidateUserId = rawCorrelation.userId ?? scoped?.userId;
  if (!getAiUsageGate()) return observability;
  if (
    typeof candidateUserId !== "number" ||
    !Number.isInteger(candidateUserId) ||
    candidateUserId <= 0
  ) {
    throw new AiNonRetryableError(
      "AI provider execution requires an attributed usage identity",
      undefined,
      "usage_identity_required",
    );
  }

  const rawConversationId = rawCorrelation.conversationId ?? scoped?.conversationId;
  const usage = await enforceAiUsageGate({
    userId: candidateUserId,
    capability: config.capability,
    origin: observability?.origin,
    flow: observability?.flow,
    conversationId:
      typeof rawConversationId === "string" && rawConversationId.trim()
        ? rawConversationId
        : null,
  });

  const { conversationId: _discardedConversationId, ...safeCorrelation } = rawCorrelation;
  return {
    ...observability,
    correlation: {
      ...safeCorrelation,
      userId: candidateUserId,
      ...(usage?.correlation ?? {}),
    },
  };
}

/**
 * Canonical execution boundary for a resolved capability. It binds the
 * provider and model selected by `resolveCapabilityConfig` to the adapter used
 * by every primary, retry and fallback attempt, then delegates sequencing to
 * the common policy executor. When a user attribution is present, the shared
 * usage gate runs before any provider adapter is created or called.
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
  const effectiveObservability = await applyUsageGovernance(config, observability);
  const attemptCompletions: AiObservedAttemptCompletion<T>[] = [];
  const providerCalls = new Map<string, AiProviderCallObservation>();
  const executionStartedAt = performance.now();
  const usageExecutionId = randomUUID();
  const usageReservations = new Map<string, import("../../modules/usageGovernance/service").AiProviderUsageReservation>();
  let executionSucceeded = false;
  let primaryAdapter: AiProvider | null = null;
  let fallbackAdapter: AiProvider | null = null;

  const executeAttemptOperation = async (
    context: AiAttemptContext,
    adapter: AiProvider,
    providerId: AiProviderId,
    model: string,
  ): Promise<T> => {
    const key = `${context.source}:${context.attempt}`;
    let observation: AiProviderCallObservation | undefined;
    let callLimitExceeded = false;
    const normalizedProvider = createNormalizedProviderBoundary(adapter, {
      maxCalls: 1,
      onCallLimitExceeded: () => {
        callLimitExceeded = true;
      },
      onCallCompleted: current => {
        observation ??= current;
      },
    });

    const callRole = effectiveObservability?.callRole === "escalation"
      ? "escalation" as const
      : context.source === "fallback"
        ? "fallback" as const
        : context.attempt > 1 ? "retry" as const : "primary" as const;
    const { prepareAiProviderAttemptUsage } = await import("../../modules/usageGovernance/service");
    const reservation = await prepareAiProviderAttemptUsage({
      executionId: usageExecutionId,
      capability: config.capability,
      flow: effectiveObservability?.flow ?? config.capability.toLowerCase(),
      origin: effectiveObservability?.origin ?? "system",
      provider: providerId,
      model,
      callRole,
      attemptIndex: context.source === "fallback" ? config.maxAttempts + 1 : context.attempt,
      correlation: effectiveObservability?.correlation ?? {},
    });
    if (reservation) usageReservations.set(key, reservation);

    try {
      const value = await operation({
        ...context,
        provider: normalizedProvider,
        providerId,
        model,
      });
      if (callLimitExceeded) {
        throw new AiNonRetryableError(
          "AI capability attempt performed more than one provider call.",
          undefined,
          "incompatible_operation",
        );
      }
      return value;
    } finally {
      if (observation) providerCalls.set(key, observation);
    }
  };

  const primaryCall = async (context: AiAttemptContext): Promise<T> => {
    const target = requireTarget(config.primary, "primary");
    primaryAdapter ??= getAiProviderById(target.provider, providerFactories);
    return executeAttemptOperation(
      context,
      primaryAdapter,
      target.provider,
      target.model,
    );
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
        fallbackAdapter ??= getAiProviderById(fallbackTarget.provider, providerFactories);
        return executeAttemptOperation(
          context,
          fallbackAdapter,
          fallbackTarget.provider,
          fallbackTarget.model,
        );
      }
    : undefined;

  try {
    const result = await executeWithPolicy(config, primaryCall, fallbackCall, {
      ...policyOptions,
      onAttemptComplete: async completion => {
        const key = `${completion.context.source}:${completion.context.attempt}`;
        attemptCompletions.push({
          ...completion,
          ...(providerCalls.get(key) ? { providerCall: providerCalls.get(key) } : {}),
        });
        const reservation = usageReservations.get(key);
        if (reservation) {
          const events = buildAiInferenceEvents({
            config,
            attempts: attemptCompletions,
            context: effectiveObservability,
            totalLatencyMs: performance.now() - executionStartedAt,
            executionId: usageExecutionId,
          });
          const event = events.at(-1);
          if (event) {
            const { finalizeAiProviderAttemptUsage } = await import("../../modules/usageGovernance/service");
            await finalizeAiProviderAttemptUsage(reservation, event);
          }
        }
        if (onAttemptComplete) await onAttemptComplete(completion);
      },
    });
    executionSucceeded = true;
    return result;
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
      context: effectiveObservability && executionSucceeded && effectiveObservability.degradationOnFailure
        ? { ...effectiveObservability, degradationOnFailure: undefined }
        : effectiveObservability,
      totalLatencyMs: performance.now() - executionStartedAt,
      executionId: usageExecutionId,
    });
    await emitAiInferenceEvents(events, observabilitySink === undefined ? undefined : observabilitySink);
  }
}
