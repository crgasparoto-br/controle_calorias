import type { AiProvider } from "../aiProvider";
import type { ResolvedCapabilityConfig, ResolvedProviderModel } from "./configResolver";
import {
  AiNonRetryableError,
  executeWithPolicy,
  type AiAttemptContext,
  type AiPolicyExecutionOptions,
  type AiPolicyExecutionResult,
} from "./policyExecutor";
import {
  getAiProviderById,
  type AiProviderFactoryMap,
} from "./providerResolver";
import type { AiProviderId } from "./supportMatrix";

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
};

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
  const { providerFactories, ...policyOptions } = options;
  let primaryAdapter: AiProvider | null = null;
  let fallbackAdapter: AiProvider | null = null;

  const primaryCall = async (context: AiAttemptContext): Promise<T> => {
    const target = requireTarget(config.primary, "primary");
    primaryAdapter ??= getAiProviderById(target.provider, providerFactories);
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
        fallbackAdapter ??= getAiProviderById(fallbackTarget.provider, providerFactories);
        return operation({
          ...context,
          provider: fallbackAdapter,
          providerId: fallbackTarget.provider,
          model: fallbackTarget.model,
        });
      }
    : undefined;

  return executeWithPolicy(config, primaryCall, fallbackCall, policyOptions);
}
