import crypto from "node:crypto";
import type { AiInferenceEvent } from "../../_core/ai/observability";
import type { AiUsageGateInput, AiUsageGateResult } from "../../_core/ai/usageGate";
import {
  getActiveUsageLimitation,
  listEconomicFacts,
  listMonthlyEconomicAggregates,
  listUsageEvents,
  purgeUsageGovernanceRetention,
  recordEconomicFact,
  recordUsageEvent,
  refreshUsageDailyAggregates,
  upsertMonthlyEconomicAggregate,
} from "../../repositories/usageGovernanceRepository";
import { billingService } from "../billing/service";

export const USAGE_RULE_VERSION = "2026-08-16.2";
export const USAGE_RETENTION_POLICY = {
  detailedUsageMonths: 13,
  dailyAggregateMonths: 24,
  monthlyEconomicYears: 5,
  governanceAuditYears: 5,
  rawConversationalContentStored: false,
  legalHoldSupported: true,
  policyVersion: USAGE_RULE_VERSION,
} as const;
export const FAIR_USE_POLICY = {
  observationDays: 90,
  alertThresholdPercentages: [70, 85, 100] as const,
  automaticBlockingAtBudgetThreshold: false,
  initialLimitationDays: 7,
  extensionDays: 7,
  emergencySecurityHours: 24,
} as const;

export class AiUsageTemporarilyLimitedError extends Error {
  readonly code = "usage_temporarily_limited" as const;
  constructor(readonly retryAfterSeconds: number) {
    super("Algumas operações de processamento estão temporariamente limitadas. O acesso, a consulta, a exportação e os registros manuais permanecem disponíveis.");
    this.name = "AiUsageTemporarilyLimitedError";
  }
}

function opaqueConversationRef(value?: string | null) {
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function operationMatches(operations: string[], input: AiUsageGateInput) {
  const keys = new Set([
    "ai_heavy_processing",
    `capability:${input.capability}`,
    ...(input.flow ? [`flow:${input.flow}`] : []),
  ]);
  return operations.some(operation => keys.has(operation));
}

export async function enforceUsageAllowance(input: AiUsageGateInput): Promise<AiUsageGateResult> {
  const status = await billingService.getUserSubscriptionStatus(input.userId);
  const access = status.access;
  const originalPlanCode = status.subscription?.planCode ?? null;
  const sponsored = access.reason === "sponsored_by_professional" && access.sponsorUserId;
  const effectiveSubscription = sponsored ? status.professionalSubscription : status.subscription;
  const effectivePlanCode = access.planCode ?? effectiveSubscription?.planCode ?? originalPlanCode;
  const conversationRef = opaqueConversationRef(input.conversationId);
  const payerUserId = sponsored ? access.sponsorUserId! : input.userId;
  const now = new Date();

  const limitations = await getActiveUsageLimitation(input.userId, now);
  const active = limitations.find(item => operationMatches(item.operations, input));
  if (active) {
    throw new AiUsageTemporarilyLimitedError(
      Math.max(1, Math.ceil((active.endsAt.getTime() - now.getTime()) / 1000)),
    );
  }

  return {
    correlation: {
      userId: input.userId,
      beneficiaryUserId: input.userId,
      payerUserId,
      billedUserId: payerUserId,
      sponsorUserId: sponsored ? access.sponsorUserId! : 0,
      accessSource: access.reason,
      planCode: effectivePlanCode ?? "none",
      originalPlanCode: originalPlanCode ?? "none",
      subscriptionId: effectiveSubscription?.id ?? "none",
      billingCycle: effectiveSubscription?.billingCycle ?? "none",
      currency: effectiveSubscription?.currency ?? "none",
      ...(conversationRef ? { conversationRef } : {}),
    },
  };
}

function usageUnits(event: AiInferenceEvent) {
  const usage = event.usage;
  if (usage?.audioSeconds !== undefined) return { type: "audio_seconds", count: usage.audioSeconds };
  if (usage?.generatedImages !== undefined) return { type: "generated_images", count: usage.generatedImages };
  if (usage?.totalTokens !== undefined) return { type: "tokens", count: usage.totalTokens };
  const tokenSum = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  if (tokenSum > 0) return { type: "tokens", count: tokenSum };
  return { type: "operation", count: 1 };
}

function safePositiveInt(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function correlationString(event: AiInferenceEvent, key: string) {
  const value = event.correlation[key];
  return typeof value === "string" && value !== "none" ? value : null;
}

export async function recordAiEconomicUsage(event: AiInferenceEvent) {
  const beneficiaryUserId = safePositiveInt(event.correlation.beneficiaryUserId ?? event.correlation.userId);
  if (!beneficiaryUserId) return { created: false, reason: "unattributed" as const };
  const payerUserId = safePositiveInt(event.correlation.payerUserId ?? event.correlation.billedUserId) ?? beneficiaryUserId;
  const sponsorUserId = safePositiveInt(event.correlation.sponsorUserId);
  const conversationRef = correlationString(event, "conversationRef");
  const units = usageUnits(event);
  const idempotencyKey = conversationRef
    ? `ai:${conversationRef}:${event.capability}:${event.callRole}:${event.attemptIndex}`
    : `ai:${event.executionId}:${event.callRole}:${event.attemptIndex}`;
  const costMicros = event.estimatedCostUsd == null ? null : Math.max(0, Math.round(event.estimatedCostUsd * 1_000_000));
  const occurredAt = new Date(event.occurredAt);

  return recordUsageEvent({
    id: crypto.randomUUID(),
    idempotencyKey,
    beneficiaryUserId,
    patientUserId: sponsorUserId ? beneficiaryUserId : null,
    sponsorUserId,
    payerUserId,
    subscriptionId: correlationString(event, "subscriptionId"),
    versionCode: correlationString(event, "planCode"),
    billingCycle: correlationString(event, "billingCycle"),
    accessSource: correlationString(event, "accessSource") ?? "unknown",
    operation: event.flow || event.capability,
    channel: event.origin,
    provider: event.effectiveProvider,
    model: event.effectiveModel,
    unitType: units.type,
    unitCount: Math.max(0, Math.round(units.count)),
    estimatedCostMicros: costMicros,
    currency: costMicros == null ? null : "USD",
    eventState: event.outcome === "success" ? "success" : event.outcome,
    attemptRole: event.callRole,
    retryRootKey: event.callRole === "retry" ? event.executionId : null,
    correlationId: event.executionId,
    environment: process.env.NODE_ENV ?? "development",
    ruleVersion: USAGE_RULE_VERSION,
    metadata: {
      capability: event.capability,
      pricingCatalogVersion: event.pricingCatalogVersion,
      pricingEffectiveDate: event.pricingEffectiveDate,
      fallbackKind: event.fallback.kind,
      degradation: event.degradation,
    },
    occurredAt,
  });
}

export type EconomicFactType =
  | "contract_revenue"
  | "discount"
  | "coupon"
  | "credit"
  | "refund"
  | "chargeback"
  | "revenue_tax"
  | "receipt_fee"
  | "financial_cost"
  | "usage_cost_correction";

export async function registerEconomicFact(input: {
  idempotencyKey: string;
  payerUserId: number;
  subscriptionId?: string | null;
  productCode?: string | null;
  versionCode?: string | null;
  billingCycle?: string | null;
  factType: EconomicFactType;
  amountMinor: number;
  currency: string;
  valueKind: "estimated" | "effective";
  competenceStart: Date;
  competenceEnd: Date;
  effectiveAt?: Date;
  reason?: string | null;
  actorUserId?: number | null;
  metadata?: Record<string, unknown> | null;
}) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0) throw new Error("economic_fact_amount_invalid");
  if (input.competenceEnd.getTime() < input.competenceStart.getTime()) throw new Error("economic_fact_competence_invalid");
  return recordEconomicFact({
    ...input,
    id: crypto.randomUUID(),
    effectiveAt: input.effectiveAt ?? new Date(),
    ruleVersion: USAGE_RULE_VERSION,
    correlationId: crypto.randomUUID(),
  });
}

export function prorateMinorUnits(amountMinor: number, serviceStart: Date, serviceEnd: Date, sliceStart: Date, sliceEnd: Date) {
  const total = Math.max(1, serviceEnd.getTime() - serviceStart.getTime());
  const overlapStart = Math.max(serviceStart.getTime(), sliceStart.getTime());
  const overlapEnd = Math.min(serviceEnd.getTime(), sliceEnd.getTime());
  if (overlapEnd <= overlapStart) return 0;
  return Math.round(amountMinor * ((overlapEnd - overlapStart) / total));
}

export function calculateNetEconomicRevenueMinor(input: {
  recognizedContractRevenueMinor: number;
  discountMinor: number;
  couponMinor: number;
  creditMinor: number;
  refundMinor: number;
  chargebackMinor: number;
  taxMinor: number;
  receiptFeeMinor: number;
}) {
  return input.recognizedContractRevenueMinor - input.discountMinor - input.couponMinor - input.creditMinor
    - input.refundMinor - input.chargebackMinor - input.taxMinor - input.receiptFeeMinor;
}

export function calculateVariableCostRatioBps(variableCostMicros: number, netRevenueMinor: number) {
  if (netRevenueMinor <= 0) return null;
  const revenueMicros = netRevenueMinor * 10_000;
  return Math.round((variableCostMicros / revenueMicros) * 10_000);
}

export function economicHealthBand(ratioBps: number | null) {
  if (ratioBps == null) return "unavailable" as const;
  if (ratioBps <= 2000) return "healthy" as const;
  if (ratioBps <= 2500) return "attention" as const;
  if (ratioBps <= 3000) return "review" as const;
  return "mandatory_review_candidate" as const;
}

function startOfMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}
function addMonths(value: Date, months: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}
function subtractMonths(value: Date, months: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() - months, value.getUTCDate(), value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds()));
}

export async function refreshEconomicAggregates(now = new Date()) {
  const from = addMonths(startOfMonth(now), -2);
  const to = addMonths(startOfMonth(now), 1);
  await refreshUsageDailyAggregates(from, to, USAGE_RULE_VERSION);
  const facts = await listEconomicFacts({ from, to });
  const usage = await listUsageEvents({ from, to });
  const buckets = new Map<string, Record<string, number | string | null | Date>>();

  for (let month = new Date(from); month < to; month = addMonths(month, 1)) {
    const next = addMonths(month, 1);
    for (const fact of facts) {
      const competenceStart = new Date(String(fact.competenceStart));
      const competenceEnd = new Date(String(fact.competenceEnd));
      const value = prorateMinorUnits(Number(fact.amountMinor), competenceStart, addMonths(startOfMonth(competenceEnd), 1), month, next);
      if (!value) continue;
      const key = [month.toISOString().slice(0, 10), fact.payerUserId, fact.subscriptionId ?? "", fact.versionCode ?? "", fact.currency].join("|");
      const bucket = buckets.get(key) ?? {
        month, payerUserId: Number(fact.payerUserId), subscriptionId: fact.subscriptionId ? String(fact.subscriptionId) : null,
        productCode: fact.productCode ? String(fact.productCode) : null, versionCode: fact.versionCode ? String(fact.versionCode) : null,
        billingCycle: fact.billingCycle ? String(fact.billingCycle) : null, currency: String(fact.currency), contract_revenue: 0,
        discount: 0, coupon: 0, credit: 0, refund: 0, chargeback: 0, revenue_tax: 0, receipt_fee: 0, financial_cost: 0,
        estimatedFacts: 0, effectiveFacts: 0, variableCostMicros: 0,
      };
      const factType = String(fact.factType);
      bucket[factType] = Number(bucket[factType] ?? 0) + value;
      if (String(fact.valueKind) === "effective") bucket.effectiveFacts = Number(bucket.effectiveFacts) + 1;
      else bucket.estimatedFacts = Number(bucket.estimatedFacts) + 1;
      buckets.set(key, bucket);
    }
  }

  for (const row of usage) {
    const month = startOfMonth(new Date(String(row.occurredAt)));
    const keyPrefix = month.toISOString().slice(0, 10);
    for (const [key, bucket] of buckets) {
      if (!key.startsWith(`${keyPrefix}|${row.payerUserId}|`)) continue;
      if (bucket.subscriptionId && String(row.subscriptionId ?? "") !== bucket.subscriptionId) continue;
      bucket.variableCostMicros = Number(bucket.variableCostMicros) + Number(row.effectiveCostMicros ?? row.estimatedCostMicros ?? 0);
    }
  }

  for (const [key, bucket] of buckets) {
    const net = calculateNetEconomicRevenueMinor({
      recognizedContractRevenueMinor: Number(bucket.contract_revenue), discountMinor: Number(bucket.discount),
      couponMinor: Number(bucket.coupon), creditMinor: Number(bucket.credit), refundMinor: Number(bucket.refund),
      chargebackMinor: Number(bucket.chargeback), taxMinor: Number(bucket.revenue_tax), receiptFeeMinor: Number(bucket.receipt_fee),
    });
    const variableCostMicros = Number(bucket.variableCostMicros);
    const estimated = Number(bucket.estimatedFacts);
    const effective = Number(bucket.effectiveFacts);
    await upsertMonthlyEconomicAggregate({
      aggregateKey: crypto.createHash("sha256").update(key).digest("hex"), competenceMonth: bucket.month as Date,
      payerUserId: Number(bucket.payerUserId), subscriptionId: bucket.subscriptionId as string | null,
      productCode: bucket.productCode as string | null, versionCode: bucket.versionCode as string | null,
      billingCycle: bucket.billingCycle as string | null, currency: String(bucket.currency),
      recognizedContractRevenueMinor: Number(bucket.contract_revenue), discountMinor: Number(bucket.discount), couponMinor: Number(bucket.coupon),
      creditMinor: Number(bucket.credit), refundMinor: Number(bucket.refund), chargebackMinor: Number(bucket.chargeback), taxMinor: Number(bucket.revenue_tax),
      receiptFeeMinor: Number(bucket.receipt_fee), financialCostMinor: Number(bucket.financial_cost), netEconomicRevenueMinor: net,
      variableCostMicros, variableCostRatioBps: calculateVariableCostRatioBps(variableCostMicros, net),
      estimatedFactCount: estimated, effectiveFactCount: effective, measurementCoverageBps: effective + estimated ? Math.round(effective / (effective + estimated) * 10_000) : 0,
      ruleVersion: USAGE_RULE_VERSION,
    });
  }
}

export async function getInternalUsageAnalytics(input: { from: Date; to: Date; userId?: number }) {
  const usage = await listUsageEvents(input);
  const economics = await listMonthlyEconomicAggregates({ from: startOfMonth(input.from), to: addMonths(startOfMonth(input.to), 1), payerUserId: input.userId });
  const byOperation = new Map<string, { operation: string; channel: string; calls: number; units: number; estimatedCostMicros: number; effectiveCostMicros: number; retries: number; failures: number }>();
  for (const row of usage) {
    const key = `${row.operation}|${row.channel}`;
    const current = byOperation.get(key) ?? { operation: String(row.operation), channel: String(row.channel), calls: 0, units: 0, estimatedCostMicros: 0, effectiveCostMicros: 0, retries: 0, failures: 0 };
    current.calls += 1; current.units += Number(row.unitCount ?? 0); current.estimatedCostMicros += Number(row.estimatedCostMicros ?? 0);
    current.effectiveCostMicros += Number(row.effectiveCostMicros ?? 0); if (row.attemptRole === "retry") current.retries += 1;
    if (row.eventState !== "success") current.failures += 1; byOperation.set(key, current);
  }
  const monthly = economics.map(row => ({
    competenceMonth: row.competenceMonth, payerUserId: Number(row.payerUserId), versionCode: row.versionCode, currency: row.currency,
    recognizedContractRevenueMinor: Number(row.recognizedContractRevenueMinor), netEconomicRevenueMinor: Number(row.netEconomicRevenueMinor),
    variableCostMicros: Number(row.variableCostMicros), variableCostRatioBps: row.variableCostRatioBps == null ? null : Number(row.variableCostRatioBps),
    health: economicHealthBand(row.variableCostRatioBps == null ? null : Number(row.variableCostRatioBps)), measurementCoverageBps: Number(row.measurementCoverageBps),
  }));
  return { window: input, policy: { fairUse: FAIR_USE_POLICY, retention: USAGE_RETENTION_POLICY }, byOperation: Array.from(byOperation.values()), monthlyEconomics: monthly, generatedAt: new Date() };
}

export async function runUsageRetention(now = new Date()) {
  return purgeUsageGovernanceRetention({
    now,
    detailedCutoff: subtractMonths(now, USAGE_RETENTION_POLICY.detailedUsageMonths),
    dailyCutoff: subtractMonths(now, USAGE_RETENTION_POLICY.dailyAggregateMonths),
    monthlyCutoff: subtractMonths(now, USAGE_RETENTION_POLICY.monthlyEconomicYears * 12),
    ruleVersion: USAGE_RULE_VERSION,
    auditId: crypto.randomUUID(),
  });
}
