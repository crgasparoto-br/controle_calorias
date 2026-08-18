import crypto from "node:crypto";
import type { AiInferenceEvent } from "../../_core/ai/observability";
import { recordUsageEvent } from "../../repositories/usageGovernanceRepository";

const PROVIDER_ATTEMPT_RULE_VERSION = "2026-08-16.5";

export type AiProviderUsageReservation = { idempotencyKey: string; correlationId: string };

function positiveInt(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function dispatchStates() {
  const key = Symbol.for("controle_calorias.usageProviderDispatchTestState");
  const root = globalThis as Record<PropertyKey, unknown>;
  if (!(root[key] instanceof Map)) root[key] = new Map<string, { state: string }>();
  return root[key] as Map<string, { state: string }>;
}

function usageUnits(event: AiInferenceEvent) {
  const usage = event.usage;
  if (usage?.audioSeconds !== undefined) return { type: "audio_seconds", count: usage.audioSeconds };
  if (usage?.generatedImages !== undefined) return { type: "generated_images", count: usage.generatedImages };
  if (usage?.totalTokens !== undefined) return { type: "tokens", count: usage.totalTokens };
  const tokenSum = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  return tokenSum > 0 ? { type: "tokens", count: tokenSum } : { type: "operation", count: 1 };
}

export async function prepareAiProviderAttemptUsage(input: {
  executionId: string; capability: string; flow: string; origin: string; provider: string; model: string;
  callRole: "primary" | "retry" | "fallback" | "escalation"; attemptIndex: number;
  correlation: Record<string, string | number | boolean | null | undefined>;
}): Promise<AiProviderUsageReservation | null> {
  const beneficiaryUserId = positiveInt(input.correlation.beneficiaryUserId ?? input.correlation.userId);
  if (!beneficiaryUserId) return null;
  const payerUserId = positiveInt(input.correlation.payerUserId ?? input.correlation.billedUserId) ?? beneficiaryUserId;
  const sponsorUserId = positiveInt(input.correlation.sponsorUserId);
  const idempotencyKey = `ai:${input.executionId}:${input.callRole}:${input.attemptIndex}`;
  if (process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE === "memory") {
    dispatchStates().set(idempotencyKey, { state: "provider_dispatch_started" });
    return { idempotencyKey, correlationId: input.executionId };
  }
  await recordUsageEvent({
    id: crypto.randomUUID(), idempotencyKey, beneficiaryUserId,
    patientUserId: sponsorUserId ? beneficiaryUserId : null, sponsorUserId, payerUserId,
    subscriptionId: typeof input.correlation.subscriptionId === "string" ? input.correlation.subscriptionId : null,
    productCode: typeof input.correlation.productCode === "string" ? input.correlation.productCode : null,
    versionCode: typeof input.correlation.versionCode === "string" ? input.correlation.versionCode : null,
    billingCycle: typeof input.correlation.billingCycle === "string" ? input.correlation.billingCycle : null,
    accessSource: typeof input.correlation.accessSource === "string" ? input.correlation.accessSource : "unknown",
    operation: input.flow || input.capability, channel: input.origin, provider: input.provider, model: input.model,
    unitType: "operation", unitCount: 1, estimatedCostMicros: null, effectiveCostMicros: null, currency: null,
    eventState: "provider_dispatch_reserved", attemptRole: input.callRole,
    retryRootKey: input.callRole === "primary" ? null : input.executionId,
    correlationId: input.executionId, environment: process.env.NODE_ENV ?? "development",
    ruleVersion: PROVIDER_ATTEMPT_RULE_VERSION,
    metadata: { capability: input.capability, measurementState: "reserved_before_provider_call", pricingState: "pending_observation" },
    occurredAt: new Date(),
  });
  const { claimUsageProviderDispatch } = await import("../../repositories/usageProviderDispatchRepository");
  const claim = await claimUsageProviderDispatch(idempotencyKey);
  if (!claim.claimed) throw new Error("usage_provider_dispatch_not_claimed");
  return { idempotencyKey, correlationId: input.executionId };
}

export async function finalizeAiProviderAttemptUsage(reservation: AiProviderUsageReservation, event: AiInferenceEvent) {
  if (process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE === "memory") {
    dispatchStates().set(reservation.idempotencyKey, { state: event.outcome });
    return { finalized: true as const, state: event.outcome };
  }
  const units = usageUnits(event);
  const { finalizeUsageProviderDispatch } = await import("../../repositories/usageProviderDispatchRepository");
  return finalizeUsageProviderDispatch({
    idempotencyKey: reservation.idempotencyKey, eventState: event.outcome,
    operation: event.flow || event.capability, attemptRole: event.callRole,
    retryRootKey: event.callRole === "primary" ? null : event.executionId,
    provider: event.effectiveProvider, model: event.effectiveModel, unitType: units.type,
    unitCount: Math.max(0, Math.round(units.count)),
    estimatedCostMicros: event.estimatedCostUsd == null ? null : Math.max(0, Math.round(event.estimatedCostUsd * 1_000_000)),
    effectiveCostMicros: null, currency: event.estimatedCostUsd == null ? null : "USD",
    metadata: { capability: event.capability, pricingCatalogVersion: event.pricingCatalogVersion,
      pricingEffectiveDate: event.pricingEffectiveDate, fallbackKind: event.fallback.kind,
      degradation: event.degradation, measurementState: "finalized" },
  });
}
