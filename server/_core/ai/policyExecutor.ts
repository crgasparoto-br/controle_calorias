/**
 * Common policy executor: the single reusable boundary for retry / timeout /
 * fallback / error classification / basic telemetry, so that future
 * consumers of the capability resolver do not each reimplement this.
 *
 * Contract:
 * 1. Executes the primary call.
 * 2. Applies only the retries allowed by `maxAttempts` (this is the TOTAL
 *    number of primary calls, including the first one — not "N retries on
 *    top of the first call").
 * 3. After the primary is exhausted, executes AT MOST ONE fallback call, only
 *    if the resolved fallback policy says it is enabled/eligible.
 * 4. Never falls back to the primary again, never chains a third
 *    model/provider, never runs primary and fallback in parallel.
 * 5. Normalizes the result, indicating whether it came from the primary
 *    (first try or a retry) or from the fallback.
 *
 * Error classification (see {@link AiOperationalError} and
 * {@link AiNonRetryableError}) decides what is eligible for retry/fallback:
 * - Operational, recoverable failures (timeout, network, recoverable rate
 *   limit, empty output, invalid JSON, invalid payload) ARE eligible for
 *   retry and fallback.
 * - Non-eligible errors (missing secret, invalid auth, known-nonexistent
 *   model, incompatible operation/adapter combination, safety block, invalid
 *   config, or a valid-but-unwanted functional result) are NEVER retried and
 *   NEVER trigger fallback — they are rethrown immediately.
 *
 * Quality escalation (a distinct policy that would call a *better* model
 * after a functionally valid but low-quality result) is intentionally not
 * implemented here. `AiQualityEscalationHook` is a prepared type/hook only;
 * nothing in this module invokes it. It exists so a future, explicitly
 * configured capability can wire it in without redesigning the executor.
 */

export class AiOperationalError extends Error {
  readonly kind = "operational" as const;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AiOperationalError";
  }
}

export class AiNonRetryableError extends Error {
  readonly kind = "non_retryable" as const;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "AiNonRetryableError";
  }
}

function isOperationalError(error: unknown): boolean {
  return error instanceof AiOperationalError;
}

export type AiCallSource = "primary" | "primary_retry" | "fallback";

export type AiPolicyExecutionResult<T> = {
  value: T;
  source: AiCallSource;
  attempts: number;
  usedFallback: boolean;
};

export type AiExecutablePolicy = {
  maxAttempts: number;
  timeoutMs: number;
  fallback: {
    effectivelyEnabled: boolean;
  };
};

/**
 * Prepared hook for a future, explicitly-configured quality escalation
 * policy. Not invoked anywhere in this executor today — see module docstring.
 */
export type AiQualityEscalationHook<T> = (result: T) => Promise<T> | T;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AiOperationalError(`AI call timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function executeWithPolicy<T>(
  policy: AiExecutablePolicy,
  callPrimary: () => Promise<T>,
  callFallback?: () => Promise<T>,
): Promise<AiPolicyExecutionResult<T>> {
  const maxAttempts = Math.max(1, policy.maxAttempts);
  let attempts = 0;
  let lastError: unknown;

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    attempts += 1;
    try {
      const value = await withTimeout(callPrimary(), policy.timeoutMs);
      return {
        value,
        source: attemptIndex === 0 ? "primary" : "primary_retry",
        attempts,
        usedFallback: false,
      };
    } catch (error) {
      lastError = error;
      if (!isOperationalError(error)) {
        // Not eligible for retry or fallback: rethrow immediately.
        throw error;
      }
      // Operational error: loop continues if attempts remain.
    }
  }

  if (policy.fallback.effectivelyEnabled && callFallback) {
    try {
      const value = await withTimeout(callFallback(), policy.timeoutMs);
      return {
        value,
        source: "fallback",
        attempts: attempts + 1,
        usedFallback: true,
      };
    } catch (fallbackError) {
      // Fallback is a single, terminal attempt: never chain further and
      // never go back to the primary.
      throw fallbackError;
    }
  }

  throw lastError;
}
