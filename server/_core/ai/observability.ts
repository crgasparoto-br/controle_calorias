import { randomUUID } from "node:crypto";
import type { AiWebSearchResult } from "../aiProvider";
import type {
  AiNormalizedUsage,
  AiProviderCallObservation,
} from "./providerBoundary";
import type { AiCapabilityId } from "./capabilities";
import type { ResolvedCapabilityConfig } from "./configResolver";
import {
  AiOperationalError,
  type AiAttemptCompletion,
  type AiCallSource,
} from "./policyExecutor";
import type { AiProviderId } from "./supportMatrix";
import {
  AI_PRICING_CATALOG_EFFECTIVE_DATE,
  AI_PRICING_CATALOG_VERSION,
  estimateAiCallCostUsd,
  sumAiExecutionCostUsd,
  type AiBillableTool,
} from "./pricingCatalog";

export type AiObservabilityOrigin = "web" | "whatsapp" | "admin" | "system";
export type AiObservabilityOutcome =
  | "success"
  | "timeout"
  | "rate_limit"
  | "external_error"
  | "safety_block"
  | "empty_output"
  | "invalid_json"
  | "invalid_payload"
  | "invalid_configuration";

export type AiObservabilityFlow =
  | "meal_text_extraction"
  | "meal_vision_extraction"
  | "whatsapp_intent"
  | "whatsapp_question"
  | "nutrition_product_web_search"
  | "catalog_embeddings"
  | "voice_transcription"
  | "image_annotation"
  | "whatsapp_voice_transcription"
  | "whatsapp_image_annotation"
  | "food_classification"
  | "question_answer";

export type AiObservabilityContext = {
  origin?: AiObservabilityOrigin;
  flow?: AiObservabilityFlow;
  correlation?: Record<string, string | number | boolean | null | undefined>;
  callRole?: "escalation";
  degradation?: "none" | "local";
  /** Applied only when the external attempt fails and the caller degrades locally. */
  degradationOnFailure?: "local";
};

export type AiObservedAttemptCompletion<T> = AiAttemptCompletion<T> & {
  providerCall?: AiProviderCallObservation;
};

export type AiInferenceEvent = {
  schemaVersion: 1;
  occurredAt: string;
  executionId: string;
  capability: AiCapabilityId;
  origin: AiObservabilityOrigin;
  flow: string;
  configuredProvider: AiProviderId | null;
  configuredModel: string | null;
  effectiveProvider: AiProviderId | null;
  effectiveModel: string | null;
  callRole: "primary" | "retry" | "fallback" | "escalation";
  attemptIndex: number;
  totalAttempts: number;
  latencyMs: number;
  totalLatencyMs: number;
  outcome: AiObservabilityOutcome;
  usage?: AiNormalizedUsage;
  tools: AiBillableTool[];
  estimatedCostUsd: number | null;
  executionEstimatedCostUsd: number | null;
  pricingCatalogVersion: string;
  pricingEffectiveDate: string;
  fallback: {
    requested: boolean;
    enabled: boolean;
    kind: "none" | "same_provider" | "cross_provider";
    eligibility: "not_needed" | "eligible" | "not_eligible" | "executed";
    reason: string;
    primaryAttempts: number;
    fallbackCalls: 0 | 1;
  };
  degradation: "none" | "local";
  correlation: Record<string, string | number | boolean | null>;
};

export type AiObservabilitySink = (event: AiInferenceEvent) => void | Promise<void>;

let configuredSink: AiObservabilitySink | null = null;

export function setAiObservabilitySink(sink: AiObservabilitySink | null): void {
  configuredSink = sink;
}

export function getAiObservabilitySink(): AiObservabilitySink | null {
  return configuredSink;
}

function bounded(value: string, max = 80): string {
  return value.trim().replace(/[^a-zA-Z0-9_.:/-]+/g, "_").slice(0, max) || "unknown";
}

const SENSITIVE_CORRELATION_KEY = /(?:prompt|content|text|message|transcript|audio|image|media|payload|error|exception|secret|token|authorization|cookie|header|url)/i;

export function sanitizeAiCorrelation(
  value: AiObservabilityContext["correlation"],
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of Object.entries(value ?? {}).slice(0, 8)) {
    if (SENSITIVE_CORRELATION_KEY.test(rawKey)) continue;
    const key = bounded(rawKey, 48);
    if (rawValue === null) result[key] = null;
    else if (typeof rawValue === "boolean") result[key] = rawValue;
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) result[key] = rawValue;
    else if (typeof rawValue === "string") result[key] = bounded(rawValue, 96);
  }
  return result;
}

function usageFrom(value: unknown): AiNormalizedUsage | undefined {
  if (!value || typeof value !== "object" || !("usage" in value)) return undefined;
  const usage = (value as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  const number = (key: Extract<keyof AiNormalizedUsage, string>): number | undefined => {
    const candidate = record[key];
    return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : undefined;
  };
  const normalized: AiNormalizedUsage = {
    inputTokens: number("inputTokens"),
    cachedInputTokens: number("cachedInputTokens"),
    outputTokens: number("outputTokens"),
    reasoningTokens: number("reasoningTokens"),
    totalTokens: number("totalTokens"),
    audioSeconds: number("audioSeconds"),
    inputAudioTokens: number("inputAudioTokens"),
    outputAudioTokens: number("outputAudioTokens"),
    inputImageTokens: number("inputImageTokens"),
    outputImageTokens: number("outputImageTokens"),
    generatedImages: number("generatedImages"),
  };
  const compact = Object.fromEntries(
    Object.entries(normalized).filter(([, candidate]) => candidate !== undefined),
  ) as AiNormalizedUsage;
  return Object.keys(compact).length ? compact : undefined;
}

function toolsFrom(value: unknown): AiBillableTool[] {
  if (!value || typeof value !== "object" || !("webSearch" in value)) return [];
  const webSearch = (value as { webSearch?: AiWebSearchResult }).webSearch;
  if (!webSearch) return [];
  return [{
    tool: "web_search",
    executed: webSearch.executed,
    ...(typeof webSearch.searchCount === "number" && webSearch.searchCount >= 0
      ? { billableUnits: webSearch.searchCount }
      : {}),
  }];
}

function outcomeFrom(completion: AiAttemptCompletion<unknown>): AiObservabilityOutcome {
  if (completion.result.status === "success") return "success";
  const code = completion.result.error.code;
  if (code === "timeout") return "timeout";
  if (code === "rate_limit") return "rate_limit";
  if (code === "safety_block") return "safety_block";
  if (code === "empty_output") return "empty_output";
  if (code === "invalid_json") return "invalid_json";
  if (code === "invalid_payload") return "invalid_payload";
  if (code === "invalid_configuration" || code === "missing_secret" || code === "authentication" || code === "model_not_found" || code === "incompatible_operation") {
    return "invalid_configuration";
  }
  return "external_error";
}

function fallbackEligibility(
  config: ResolvedCapabilityConfig,
  completion: AiAttemptCompletion<unknown>,
  isFallback: boolean,
): AiInferenceEvent["fallback"]["eligibility"] {
  if (isFallback) return "executed";
  if (completion.result.status === "success") return "not_needed";
  return config.fallback.effectivelyEnabled && completion.result.error instanceof AiOperationalError
    ? "eligible"
    : "not_eligible";
}

function roleFrom(source: AiCallSource): AiInferenceEvent["callRole"] {
  if (source === "fallback") return "fallback";
  if (source === "primary_retry") return "retry";
  return "primary";
}

function fallbackKind(config: ResolvedCapabilityConfig): AiInferenceEvent["fallback"]["kind"] {
  if (!config.fallback.requested || !config.primary || !config.fallback.provider) return "none";
  return config.primary.provider === config.fallback.provider ? "same_provider" : "cross_provider";
}

function fallbackReason(
  config: ResolvedCapabilityConfig,
  completion: AiAttemptCompletion<unknown>,
  isFallback: boolean,
): string {
  if (isFallback) {
    return completion.result.status === "success"
      ? "fallback_executed"
      : completion.result.error.code;
  }
  if (completion.result.status === "success") return "primary_succeeded";
  if (config.fallback.effectivelyEnabled) return completion.result.error.code;
  if (!config.fallback.requested) return "fallback_not_configured";
  if (
    config.primary
    && config.fallback.provider
    && config.primary.provider !== config.fallback.provider
    && !config.fallback.crossProviderEnabled
  ) {
    return "cross_provider_disabled";
  }
  return "fallback_disabled";
}

function defaultObservabilityContext(
  capability: AiCapabilityId,
): Required<Pick<AiObservabilityContext, "origin" | "flow">> &
  Pick<AiObservabilityContext, "degradationOnFailure"> {
  switch (capability) {
    case "MEAL_TEXT":
      return { origin: "system", flow: "meal_text_extraction" };
    case "MEAL_VISION":
      return { origin: "system", flow: "meal_vision_extraction" };
    case "WHATSAPP_INTENT":
      return { origin: "whatsapp", flow: "whatsapp_intent" };
    case "QUESTION":
      return { origin: "whatsapp", flow: "whatsapp_question" };
    case "NUTRITION_SEARCH":
      return { origin: "system", flow: "nutrition_product_web_search" };
    case "EMBEDDING":
      return {
        origin: "system",
        flow: "catalog_embeddings",
        degradationOnFailure: "local",
      };
    case "TRANSCRIPTION":
      return { origin: "system", flow: "voice_transcription" };
    case "IMAGE_ANNOTATION":
      return { origin: "system", flow: "image_annotation" };
    case "FOOD_CLASSIFICATION":
      return { origin: "system", flow: "food_classification" };
  }
}

export function buildAiInferenceEvents<T>(input: {
  config: ResolvedCapabilityConfig;
  attempts: readonly AiObservedAttemptCompletion<T>[];
  context?: AiObservabilityContext;
  totalLatencyMs?: number;
  executionId?: string;
}): AiInferenceEvent[] {
  const { config, attempts } = input;
  const defaultContext = defaultObservabilityContext(config.capability);
  const context: AiObservabilityContext = {
    ...defaultContext,
    ...input.context,
  };
  const executionId = bounded(input.executionId ?? randomUUID(), 80);
  const totalAttempts = attempts.filter(item => item.context.attempt > 0).length;
  const primaryAttempts = attempts.filter(
    item => item.context.source === "primary" && item.context.attempt > 0,
  ).length;
  const fallbackCalls = attempts.some(item => item.context.source === "fallback") ? 1 : 0;
  const kind = fallbackKind(config);
  const normalizedAttempts = attempts.map((completion, index) => {
    const isFallback = completion.context.source === "fallback";
    const source: AiCallSource = isFallback
      ? "fallback"
      : completion.context.attempt > 1 ? "primary_retry" : "primary";
    const target = isFallback && config.fallback.provider && config.fallback.model
      ? { provider: config.fallback.provider, model: config.fallback.model }
      : config.primary;
    const value = "value" in completion.result ? completion.result.value : undefined;
    const usage = completion.providerCall?.usage ?? usageFrom(value);
    const tools = completion.providerCall?.tools ?? toolsFrom(value);
    const estimatedCostUsd = target
      ? estimateAiCallCostUsd({ provider: target.provider, model: target.model, usage, tools })
      : null;
    return { completion, index, isFallback, source, target, usage, tools, estimatedCostUsd };
  });
  const executionEstimatedCostUsd = sumAiExecutionCostUsd(
    normalizedAttempts.map(item => item.estimatedCostUsd),
  );

  return normalizedAttempts.map(({
    completion,
    index,
    isFallback,
    source,
    target,
    usage,
    tools,
    estimatedCostUsd,
  }) => ({
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    executionId,
    capability: config.capability,
    origin: context.origin ?? "system",
    flow: bounded(context.flow ?? config.capability.toLowerCase(), 64),
    configuredProvider: config.primary?.provider ?? null,
    configuredModel: config.primary?.model ? bounded(config.primary.model, 120) : null,
    effectiveProvider: target?.provider ?? null,
    effectiveModel: target?.model ? bounded(target.model, 120) : null,
    callRole: context.callRole === "escalation"
      ? "escalation"
      : roleFrom(source),
    attemptIndex: completion.context.attempt > 0 ? index + 1 : 0,
    totalAttempts,
    latencyMs: completion.latencyMs,
    totalLatencyMs: Math.max(0, Math.round(input.totalLatencyMs ?? completion.latencyMs)),
    outcome: outcomeFrom(completion as AiAttemptCompletion<unknown>),
    ...(usage ? { usage } : {}),
    tools,
    estimatedCostUsd,
    executionEstimatedCostUsd,
    pricingCatalogVersion: AI_PRICING_CATALOG_VERSION,
    pricingEffectiveDate: AI_PRICING_CATALOG_EFFECTIVE_DATE,
    fallback: {
      requested: config.fallback.requested,
      enabled: config.fallback.effectivelyEnabled,
      kind,
      eligibility: fallbackEligibility(
        config,
        completion as AiAttemptCompletion<unknown>,
        isFallback,
      ),
      reason: fallbackReason(
        config,
        completion as AiAttemptCompletion<unknown>,
        isFallback,
      ),
      primaryAttempts,
      fallbackCalls: fallbackCalls as 0 | 1,
    },
    degradation: completion.result.status === "error" && context.degradationOnFailure === "local"
      ? "local"
      : context.degradation ?? "none",
    correlation: sanitizeAiCorrelation(context.correlation),
  }));
}

export async function emitAiInferenceEvents(
  events: readonly AiInferenceEvent[],
  sink?: AiObservabilitySink | null,
): Promise<void> {
  const resolvedSink = sink === undefined ? configuredSink : sink;
  if (!resolvedSink) return;
  for (const event of events) {
    try {
      await resolvedSink(event);
    } catch {
      // Observability is best effort and must not alter inference behavior.
    }
  }
}

export function serializeAiInferenceEvent(event: AiInferenceEvent): string {
  return JSON.stringify(event);
}
