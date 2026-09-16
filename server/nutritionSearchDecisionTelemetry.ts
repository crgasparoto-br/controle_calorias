import { randomUUID } from "node:crypto";
import { logInferenceEvent } from "./db";
import type { AiObservabilityContext } from "./_core/ai/observability";

export type NutritionSearchDecisionStage =
  | "product_identity"
  | "household_measure";

export type NutritionSearchDecisionReason =
  | "capability_unavailable"
  | "execution_failed"
  | "found_false"
  | "identity_incompatible"
  | "variant_incompatible"
  | "portion_incompatible"
  | "numeric_grounding_insufficient"
  | "source_identity_mismatch"
  | "source_grounding_unavailable"
  | "grounding_conflict"
  | "accepted";

export type NutritionSearchOperationalOutcome =
  | "timeout"
  | "rate_limit"
  | "network"
  | "invalid_json"
  | "invalid_payload"
  | "invalid_configuration"
  | "unknown";

export type NutritionSearchTelemetryContext = {
  userId?: number;
  traceId?: string;
  origin?: AiObservabilityContext["origin"];
};

export type NutritionSearchDecisionGuards = {
  productIdentity: boolean;
  brandIdentity: boolean;
  variant: boolean;
  portion: boolean;
  numericGrounding: boolean;
  sourceGrounding: boolean;
};

export type NutritionSearchDecisionInput = {
  stage: NutritionSearchDecisionStage;
  reason: NutritionSearchDecisionReason;
  traceId: string;
  hasStructuredCandidate: boolean;
  webSearchExecuted: boolean;
  sourceCount: number;
  guards: NutritionSearchDecisionGuards;
  operationalOutcome?: NutritionSearchOperationalOutcome;
};

export function createNutritionSearchTrace(
  context?: NutritionSearchTelemetryContext
) {
  const requestedTraceId = context?.traceId?.trim() ?? "";
  const traceId = /^[a-zA-Z0-9_-]{1,64}$/.test(requestedTraceId)
    ? requestedTraceId
    : randomUUID();
  const userId =
    typeof context?.userId === "number" &&
    Number.isInteger(context.userId) &&
    context.userId > 0
      ? context.userId
      : undefined;
  const origin = context?.origin ?? "system";
  const observability: AiObservabilityContext = {
    origin,
    flow: "nutrition_product_web_search",
    correlation: {
      traceId,
      ...(userId ? { userId } : {}),
    },
  };

  return { traceId, userId, origin, observability };
}

export function nutritionSearchSourceCount(value: unknown) {
  if (!Array.isArray(value)) return 0;
  return Math.min(value.length, 100);
}

export function classifyNutritionSearchOperationalOutcome(
  error: unknown
): NutritionSearchOperationalOutcome {
  const code =
    typeof (error as { code?: unknown } | null)?.code === "string"
      ? String((error as { code: string }).code)
      : "";
  switch (code) {
    case "timeout":
    case "rate_limit":
    case "network":
    case "invalid_json":
    case "invalid_payload":
      return code;
    case "missing_secret":
    case "authentication":
    case "model_not_found":
    case "incompatible_operation":
    case "invalid_configuration":
    case "usage_identity_required":
      return "invalid_configuration";
    default:
      return "unknown";
  }
}

export function logNutritionSearchDecision(
  input: NutritionSearchDecisionInput,
  context?: NutritionSearchTelemetryContext
) {
  try {
    const sourceCount = Number.isFinite(input.sourceCount)
      ? Math.max(0, Math.min(100, Math.trunc(input.sourceCount)))
      : 0;
    const userId =
      typeof context?.userId === "number" &&
      Number.isInteger(context.userId) &&
      context.userId > 0
        ? context.userId
        : undefined;
    const detail = {
      schemaVersion: 1,
      stage: input.stage,
      reason: input.reason,
      traceId: /^[a-zA-Z0-9_-]{1,64}$/.test(input.traceId)
        ? input.traceId
        : "invalid",
      hasStructuredCandidate: Boolean(input.hasStructuredCandidate),
      webSearchExecuted: Boolean(input.webSearchExecuted),
      sourceCount,
      guards: {
        productIdentity: Boolean(input.guards.productIdentity),
        brandIdentity: Boolean(input.guards.brandIdentity),
        variant: Boolean(input.guards.variant),
        portion: Boolean(input.guards.portion),
        numericGrounding: Boolean(input.guards.numericGrounding),
        sourceGrounding: Boolean(input.guards.sourceGrounding),
      },
      ...(input.operationalOutcome
        ? { operationalOutcome: input.operationalOutcome }
        : {}),
    };
    const origin =
      context?.origin === "whatsapp" || context?.origin === "web"
        ? context.origin
        : "admin";
    logInferenceEvent({
      ...(userId ? { userId } : {}),
      origin,
      status: input.reason === "accepted" ? "success" : "warning",
      eventType: "nutrition.search_decision",
      detail: JSON.stringify(detail),
    });
  } catch {
    // Diagnostic telemetry is best effort and must never alter fail-closed behavior.
  }
}
