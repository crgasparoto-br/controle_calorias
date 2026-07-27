/**
 * Common execution boundary for timeout, retry, fallback and error
 * classification. Callbacks receive an AbortSignal and must propagate it to the
 * provider adapter/SDK. A retry/fallback is never started until the previous
 * call has settled; if cancellation is not acknowledged within the grace
 * window, the executor fails closed and suppresses further calls.
 */

import { DEFAULT_ABORT_GRACE_MS } from "./policyDefaults";

export type AiOperationalErrorCode =
  | "timeout"
  | "network"
  | "rate_limit"
  | "empty_output"
  | "invalid_json"
  | "invalid_payload";

export type AiNonRetryableErrorCode =
  | "missing_secret"
  | "authentication"
  | "model_not_found"
  | "incompatible_operation"
  | "safety_block"
  | "invalid_configuration"
  | "functional_result"
  | "abort_not_acknowledged"
  | "unknown";

export class AiOperationalError extends Error {
  readonly kind = "operational" as const;

  constructor(
    message: string,
    readonly cause?: unknown,
    readonly code: AiOperationalErrorCode = "network",
  ) {
    super(message);
    this.name = "AiOperationalError";
  }
}

export class AiNonRetryableError extends Error {
  readonly kind = "non_retryable" as const;

  constructor(
    message: string,
    readonly cause?: unknown,
    readonly code: AiNonRetryableErrorCode = "unknown",
  ) {
    super(message);
    this.name = "AiNonRetryableError";
  }
}

type ErrorShape = {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
};

const RECOVERABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
]);

function readStatus(error: ErrorShape): number | null {
  const candidate = error.status ?? error.statusCode;
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function readErrorCode(error: ErrorShape): string {
  return typeof error.code === "string" ? error.code.toUpperCase() : "";
}

function readMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof (error as ErrorShape | null)?.message === "string") {
    return String((error as ErrorShape).message);
  }
  return "AI provider call failed";
}

/**
 * Maps concrete SDK/HTTP/network errors to the common policy taxonomy. Unknown
 * errors fail closed as non-retryable so they never trigger an unintended
 * second provider call.
 */
export function classifyAiError(error: unknown): AiOperationalError | AiNonRetryableError {
  if (error instanceof AiOperationalError || error instanceof AiNonRetryableError) {
    return error;
  }

  const shape = (typeof error === "object" && error !== null ? error : {}) as ErrorShape;
  const status = readStatus(shape);
  const code = readErrorCode(shape);
  const name = typeof shape.name === "string" ? shape.name : error instanceof Error ? error.name : "";
  const message = readMessage(error);
  const normalizedMessage = message.toLowerCase();

  if (status === 429) {
    return new AiOperationalError(message, error, "rate_limit");
  }
  if (status !== null && RECOVERABLE_STATUS_CODES.has(status)) {
    return new AiOperationalError(message, error, status === 408 ? "timeout" : "network");
  }
  if (NETWORK_ERROR_CODES.has(code) || name === "TimeoutError") {
    return new AiOperationalError(message, error, code === "ETIMEDOUT" ? "timeout" : "network");
  }

  if (status === 401 || normalizedMessage.includes("api key") || normalizedMessage.includes("authentication")) {
    return new AiNonRetryableError(message, error, "authentication");
  }
  if (status === 404 || normalizedMessage.includes("model not found") || normalizedMessage.includes("unknown model")) {
    return new AiNonRetryableError(message, error, "model_not_found");
  }
  if (
    normalizedMessage.includes("safety") ||
    normalizedMessage.includes("blocked") ||
    normalizedMessage.includes("content policy")
  ) {
    return new AiNonRetryableError(message, error, "safety_block");
  }
  if (status !== null && status >= 400 && status < 500) {
    return new AiNonRetryableError(message, error, "invalid_configuration");
  }

  return new AiNonRetryableError(message, error, "unknown");
}

export type AiCallSource = "primary" | "primary_retry" | "fallback";

export type AiPolicyExecutionResult<T> = {
  value: T;
  source: AiCallSource;
  /** Total outbound calls, including the fallback when used. */
  attempts: number;
  usedFallback: boolean;
};

export type AiExecutableState = "ready" | "degraded" | "disabled" | "invalid";

export type AiExecutablePolicy = {
  state: AiExecutableState;
  maxAttempts: number;
  timeoutMs: number;
  fallback: {
    effectivelyEnabled: boolean;
  };
};

export type AiAttemptContext = {
  signal: AbortSignal;
  source: "primary" | "fallback";
  /** One-based primary attempt; fallback receives maxAttempts + 1. */
  attempt: number;
  timeoutMs: number;
};

export type AiPolicyCall<T> = (context: AiAttemptContext) => Promise<T>;
export type AiResultValidator<T> = (value: T) => void;

export type AiPolicyExecutionOptions<T> = {
  /** Additional semantic validation. Throwing marks the result as invalid payload. */
  validateResult?: AiResultValidator<T>;
  /** Maximum time allowed for a callback to settle after AbortSignal is fired. */
  abortGraceMs?: number;
};

/** Prepared for a future explicitly configured quality-escalation policy. */
export type AiQualityEscalationHook<T> = (result: T) => Promise<T> | T;

class AttemptTimeout extends Error {}

function delay(ms: number): Promise<false> {
  return new Promise((resolve) => setTimeout(() => resolve(false), ms));
}

function extractOutputText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "outputText" in value &&
    typeof (value as { outputText?: unknown }).outputText === "string"
  ) {
    return (value as { outputText: string }).outputText;
  }
  return null;
}

function validateCommonResult<T>(value: T, validateResult?: AiResultValidator<T>): void {
  if (value === null || value === undefined) {
    throw new AiOperationalError("AI provider returned an invalid empty payload", undefined, "invalid_payload");
  }

  const outputText = extractOutputText(value);
  if (outputText !== null && outputText.trim().length === 0) {
    throw new AiOperationalError("AI provider returned empty output", undefined, "empty_output");
  }

  if (validateResult) {
    try {
      validateResult(value);
    } catch (error) {
      if (error instanceof AiOperationalError || error instanceof AiNonRetryableError) {
        throw error;
      }
      throw new AiOperationalError("AI provider returned an invalid payload", error, "invalid_payload");
    }
  }
}

/** Validates and parses JSON text from a string or `{ outputText }` response. */
export function parseJsonOutput(value: unknown): unknown {
  const outputText = extractOutputText(value);
  if (outputText === null) {
    throw new AiOperationalError("AI response does not expose textual JSON output", undefined, "invalid_payload");
  }
  if (!outputText.trim()) {
    throw new AiOperationalError("AI provider returned empty output", undefined, "empty_output");
  }
  try {
    return JSON.parse(outputText) as unknown;
  } catch (error) {
    throw new AiOperationalError("AI provider returned invalid JSON", error, "invalid_json");
  }
}

export function createJsonOutputValidator<T>(
  validateParsed?: (parsed: unknown) => parsed is T,
): AiResultValidator<unknown> {
  return (value: unknown) => {
    const parsed = parseJsonOutput(value);
    if (validateParsed && !validateParsed(parsed)) {
      throw new AiOperationalError("AI provider returned JSON with an invalid payload", undefined, "invalid_payload");
    }
  };
}

function assertExecutablePolicy<T>(
  policy: AiExecutablePolicy,
  callFallback?: AiPolicyCall<T>,
): void {
  if (policy.state !== "ready" && policy.state !== "degraded") {
    throw new AiNonRetryableError(
      `AI capability configuration is not executable (state=${String(policy.state)})`,
      undefined,
      "invalid_configuration",
    );
  }
  if (!Number.isFinite(policy.timeoutMs) || !Number.isInteger(policy.timeoutMs) || policy.timeoutMs <= 0) {
    throw new AiNonRetryableError(
      "AI capability timeout must be a positive integer",
      undefined,
      "invalid_configuration",
    );
  }
  if (!Number.isFinite(policy.maxAttempts) || !Number.isInteger(policy.maxAttempts) || policy.maxAttempts <= 0) {
    throw new AiNonRetryableError(
      "AI capability maxAttempts must be a positive integer",
      undefined,
      "invalid_configuration",
    );
  }
  if (policy.fallback.effectivelyEnabled && !callFallback) {
    throw new AiNonRetryableError(
      "AI capability fallback is enabled but no fallback callback was provided",
      undefined,
      "invalid_configuration",
    );
  }
}

async function executeAttempt<T>(
  call: AiPolicyCall<T>,
  context: Omit<AiAttemptContext, "signal">,
  options: AiPolicyExecutionOptions<T>,
): Promise<T> {
  const controller = new AbortController();
  const abortGraceMs = Math.max(0, options.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const operation = Promise.resolve().then(() => call({ ...context, signal: controller.signal }));
  const settled = operation.then(
    () => true,
    () => true,
  );
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AttemptTimeout()), context.timeoutMs);
  });

  try {
    const value = await Promise.race([operation, timeout]);
    validateCommonResult(value, options.validateResult);
    return value;
  } catch (error) {
    if (error instanceof AttemptTimeout) {
      controller.abort();
      const cancellationAcknowledged = await Promise.race([settled, delay(abortGraceMs)]);
      if (!cancellationAcknowledged) {
        throw new AiNonRetryableError(
          `AI call timed out after ${context.timeoutMs}ms and did not acknowledge cancellation; retry/fallback suppressed`,
          error,
          "abort_not_acknowledged",
        );
      }
      throw new AiOperationalError(
        `AI call timed out after ${context.timeoutMs}ms`,
        error,
        "timeout",
      );
    }
    throw classifyAiError(error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function executeWithPolicy<T>(
  policy: AiExecutablePolicy,
  callPrimary: AiPolicyCall<T>,
  callFallback?: AiPolicyCall<T>,
  options: AiPolicyExecutionOptions<T> = {},
): Promise<AiPolicyExecutionResult<T>> {
  assertExecutablePolicy(policy, callFallback);
  const { maxAttempts, timeoutMs } = policy;
  let attempts = 0;
  let lastOperationalError: AiOperationalError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts += 1;
    try {
      const value = await executeAttempt(
        callPrimary,
        { source: "primary", attempt, timeoutMs },
        options,
      );
      return {
        value,
        source: attempt === 1 ? "primary" : "primary_retry",
        attempts,
        usedFallback: false,
      };
    } catch (error) {
      const classified = classifyAiError(error);
      if (classified instanceof AiNonRetryableError) throw classified;
      lastOperationalError = classified;
    }
  }

  if (policy.fallback.effectivelyEnabled && callFallback) {
    attempts += 1;
    const value = await executeAttempt(
      callFallback,
      { source: "fallback", attempt: attempts, timeoutMs },
      options,
    );
    return {
      value,
      source: "fallback",
      attempts,
      usedFallback: true,
    };
  }

  throw lastOperationalError ?? new AiNonRetryableError(
    "AI execution ended without a result or classified error",
    undefined,
    "unknown",
  );
}
