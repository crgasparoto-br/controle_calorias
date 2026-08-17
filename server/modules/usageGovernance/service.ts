import crypto from "node:crypto";
import type { AiInferenceEvent } from "../../_core/ai/observability";
import type { AiUsageGateInput, AiUsageGateResult } from "../../_core/ai/usageGate";
import {
  getActiveUsageLimitation,
  listEconomicFactsPage,
  listMonthlyEconomicAggregates,
  listUsageDailyAggregatesPage,
  listUsageEventsPage,
  recordEconomicFact,
  recordUsageEvent,
  refreshUsageDailyAggregates,
  upsertMonthlyEconomicAggregate,
} from "../../repositories/usageGovernanceRepository";
import { hasActiveUsageExemption } from "../../repositories/usageGovernancePolicyRepository";
import { purgeUsageGovernanceRetention } from "../../repositories/usageGovernanceRetentionRepository";
import { billingService } from "../billing/service";

export const USAGE_RULE_VERSION = "2026-08-16.5";
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

  const exempt = await hasActiveUsageExemption({
    userId: input.userId,
    professionalId: sponsored ? access.sponsorUserId! : status.professionalSubscription ? input.userId : null,
    now,
  });
  if (!exempt) {
    const limitations = await getActiveUsageLimitation(input.userId, now);
    const active = limitations.find(item => operationMatches(item.operations, input));
    if (active) {
      throw new AiUsageTemporarilyLimitedError(
        Math.max(1, Math.ceil((active.endsAt.getTime() - now.getTime()) / 1000)),
      );
    }
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
  const units = usageUnits(event);
  const idempotencyKey = `ai:${event.executionId}:${event.callRole}:${event.attemptIndex}`;
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

export type AiProviderUsageReservation = {
  idempotencyKey: string;
  correlationId: string;
};

function testDispatchStates() {
  const key = Symbol.for("controle_calorias.usageProviderDispatchTestState");
  const root = globalThis as Record<PropertyKey, unknown>;
  if (!(root[key] instanceof Map)) root[key] = new Map<string, { state: string }>();
  return root[key] as Map<string, { state: string }>;
}

export async function prepareAiProviderAttemptUsage(input: {
  executionId: string;
  capability: string;
  flow: string;
  origin: string;
  provider: string;
  model: string;
  callRole: "primary" | "retry" | "fallback" | "escalation";
  attemptIndex: number;
  correlation: Record<string, string | number | boolean | null | undefined>;
}) : Promise<AiProviderUsageReservation | null> {
  const beneficiaryUserId = safePositiveInt(input.correlation.beneficiaryUserId ?? input.correlation.userId);
  if (!beneficiaryUserId) return null;
  const payerUserId = safePositiveInt(input.correlation.payerUserId ?? input.correlation.billedUserId) ?? beneficiaryUserId;
  const sponsorUserId = safePositiveInt(input.correlation.sponsorUserId);
  const idempotencyKey = `ai:${input.executionId}:${input.callRole}:${input.attemptIndex}`;
  if (process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE === "memory") {
    testDispatchStates().set(idempotencyKey, { state: "provider_dispatch_started" });
    return { idempotencyKey, correlationId: input.executionId };
  }
  await recordUsageEvent({
    id: crypto.randomUUID(), idempotencyKey, beneficiaryUserId,
    patientUserId: sponsorUserId ? beneficiaryUserId : null, sponsorUserId, payerUserId,
    subscriptionId: typeof input.correlation.subscriptionId === "string" ? input.correlation.subscriptionId : null,
    versionCode: typeof input.correlation.planCode === "string" ? input.correlation.planCode : null,
    billingCycle: typeof input.correlation.billingCycle === "string" ? input.correlation.billingCycle : null,
    accessSource: typeof input.correlation.accessSource === "string" ? input.correlation.accessSource : "unknown",
    operation: input.flow || input.capability, channel: input.origin, provider: input.provider, model: input.model,
    unitType: "operation", unitCount: 1, estimatedCostMicros: null, effectiveCostMicros: null, currency: null,
    eventState: "provider_dispatch_reserved", attemptRole: input.callRole,
    retryRootKey: input.callRole === "primary" ? null : input.executionId,
    correlationId: input.executionId, environment: process.env.NODE_ENV ?? "development", ruleVersion: USAGE_RULE_VERSION,
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
    testDispatchStates().set(reservation.idempotencyKey, { state: event.outcome });
    return { finalized: true as const, state: event.outcome };
  }
  const units = usageUnits(event);
  const { finalizeUsageProviderDispatch } = await import("../../repositories/usageProviderDispatchRepository");
  return finalizeUsageProviderDispatch({
    idempotencyKey: reservation.idempotencyKey,
    eventState: event.outcome,
    operation: event.flow || event.capability,
    attemptRole: event.callRole,
    retryRootKey: event.callRole === "primary" ? null : event.executionId,
    provider: event.effectiveProvider,
    model: event.effectiveModel,
    unitType: units.type,
    unitCount: Math.max(0, Math.round(units.count)),
    estimatedCostMicros: event.estimatedCostUsd == null ? null : Math.max(0, Math.round(event.estimatedCostUsd * 1_000_000)),
    effectiveCostMicros: null,
    currency: event.estimatedCostUsd == null ? null : "USD",
    metadata: {
      capability: event.capability,
      pricingCatalogVersion: event.pricingCatalogVersion,
      pricingEffectiveDate: event.pricingEffectiveDate,
      fallbackKind: event.fallback.kind,
      degradation: event.degradation,
      measurementState: "finalized",
    },
  });
}

export async function recordDirectProcessingUsage(input: {
  userId: number;
  idempotencyKey: string;
  operation: string;
  channel: string;
  unitType: string;
  unitCount: number;
  correlationId: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  eventState?: string;
  provider?: string;
}) {
  if (process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE === "memory") {
    testDispatchStates().set(input.idempotencyKey, { state: "success" });
    return { created: true };
  }
  const status = await billingService.getUserSubscriptionStatus(input.userId);
  const access = status.access;
  const sponsored = access.reason === "sponsored_by_professional" && Boolean(access.sponsorUserId);
  const sponsorUserId = sponsored ? Number(access.sponsorUserId) : null;
  const subscription = sponsored ? status.professionalSubscription : status.subscription;
  return recordUsageEvent({
    id: crypto.randomUUID(), idempotencyKey: input.idempotencyKey,
    beneficiaryUserId: input.userId, patientUserId: sponsorUserId ? input.userId : null,
    sponsorUserId, payerUserId: sponsorUserId ?? input.userId,
    subscriptionId: subscription?.id ?? null,
    versionCode: access.planCode ?? subscription?.planCode ?? null,
    billingCycle: subscription?.billingCycle ?? null,
    accessSource: access.reason, operation: input.operation, channel: input.channel,
    provider: input.provider ?? "local", model: null, unitType: input.unitType,
    unitCount: Math.max(0, Math.round(input.unitCount)), estimatedCostMicros: null,
    effectiveCostMicros: null, currency: null, eventState: input.eventState ?? "success", attemptRole: "primary",
    retryRootKey: null, correlationId: input.correlationId,
    environment: process.env.NODE_ENV ?? "development", ruleVersion: USAGE_RULE_VERSION,
    metadata: { ...(input.metadata ?? {}), pricingState: "unpriced_direct_measurement" },
    occurredAt: input.occurredAt ?? new Date(),
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
  supersedesIdempotencyKey?: string | null;
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
  if (input.competenceEnd.getTime() <= input.competenceStart.getTime()) throw new Error("economic_fact_competence_invalid");
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object" && !(value instanceof Date)) {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]));
    }
    return value instanceof Date ? value.toISOString() : value;
  };
  const payloadFingerprint = crypto.createHash("sha256").update(JSON.stringify(canonicalize({
    idempotencyKey: input.idempotencyKey,
    supersedesIdempotencyKey: input.supersedesIdempotencyKey ?? null,
    subscriptionId: input.subscriptionId ?? null,
    payerUserId: input.payerUserId,
    productCode: input.productCode ?? null,
    versionCode: input.versionCode ?? null,
    billingCycle: input.billingCycle ?? null,
    factType: input.factType,
    amountMinor: input.amountMinor,
    currency: input.currency,
    valueKind: input.valueKind,
    competenceStart: input.competenceStart,
    competenceEnd: input.competenceEnd,
    effectiveAt: input.effectiveAt ?? null,
    reason: input.reason ?? null,
    metadata: input.metadata ?? null,
  }))).digest("hex");
  const recorded = await recordEconomicFact({
    ...input,
    id: crypto.randomUUID(),
    payloadFingerprint,
    effectiveAt: input.effectiveAt ?? new Date(),
    ruleVersion: USAGE_RULE_VERSION,
    correlationId: crypto.randomUUID(),
  });
  await refreshEconomicAggregatesForRange({
    from: input.competenceStart,
    to: input.competenceEnd,
    refreshDailyUsage: false,
  });
  return recorded;
}

async function collectPages(
  read: (cursor: string | null) => Promise<Record<string, unknown>[]>,
  cursorField: string,
) {
  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await read(cursor);
    rows.push(...page);
    if (page.length < 5000) return rows;
    const next = String(page.at(-1)?.[cursorField] ?? "");
    if (!next || next === cursor) throw new Error("usage_analytics_pagination_stalled");
    cursor = next;
  }
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
function normalizeMonthlyRangeEnd(value: Date) {
  const month = startOfMonth(value);
  return value.getTime() === month.getTime() ? month : addMonths(month, 1);
}
function firstFullyRetainedUsageMonth(now: Date) {
  const cutoff = subtractMonths(now, USAGE_RETENTION_POLICY.detailedUsageMonths);
  const month = startOfMonth(cutoff);
  return cutoff.getTime() === month.getTime() ? month : addMonths(month, 1);
}
function monthOrdinal(value: Date) {
  return value.getUTCFullYear() * 12 + value.getUTCMonth();
}

export function allocateMinorUnitsByMonth(amountMinor: number, serviceStart: Date, serviceEnd: Date) {
  if (serviceEnd.getTime() <= serviceStart.getTime()) return [];
  const total = serviceEnd.getTime() - serviceStart.getTime();
  const allocations: Array<{ month: Date; amountMinor: number }> = [];
  let cursor = startOfMonth(serviceStart);
  let exactCumulative = 0;
  let roundedCumulative = 0;

  while (cursor < serviceEnd) {
    const next = addMonths(cursor, 1);
    const overlapStart = Math.max(serviceStart.getTime(), cursor.getTime());
    const overlapEnd = Math.min(serviceEnd.getTime(), next.getTime());
    if (overlapEnd > overlapStart) {
      exactCumulative += amountMinor * ((overlapEnd - overlapStart) / total);
      const nextRounded = Math.round(exactCumulative);
      const value = nextRounded - roundedCumulative;
      roundedCumulative = nextRounded;
      if (value !== 0) allocations.push({ month: new Date(cursor), amountMinor: value });
    }
    cursor = next;
  }
  return allocations;
}

export type EconomicSeriesRow = {
  competenceMonth: Date | string;
  payerUserId: number;
  subscriptionId?: string | null;
  versionCode?: string | null;
  currency: string;
  recognizedContractRevenueMinor: number;
  netEconomicRevenueMinor: number;
  variableCostMicros: number;
  variableCostRatioBps: number | null;
  measurementCoverageBps: number;
};

export function decorateEconomicDecisionSeries(rows: EconomicSeriesRow[]) {
  const groups = new Map<string, EconomicSeriesRow[]>();
  for (const row of rows) {
    const key = [row.payerUserId, row.subscriptionId ?? "", row.versionCode ?? "", row.currency].join("|");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const decorated = new Map<EconomicSeriesRow, {
    rolling3MonthVariableCostRatioBps: number | null;
    rolling3MonthHealth: ReturnType<typeof economicHealthBand> | "mandatory_review";
    mandatoryReviewRequired: boolean;
  }>();

  for (const group of groups.values()) {
    group.sort((a, b) => new Date(a.competenceMonth).getTime() - new Date(b.competenceMonth).getTime());
    const rolling: Array<number | null> = [];
    for (let index = 0; index < group.length; index += 1) {
      const window = group.slice(Math.max(0, index - 2), index + 1);
      const ordinals = window.map(item => monthOrdinal(startOfMonth(new Date(item.competenceMonth))));
      const consecutive = window.length === 3 && ordinals[1] === ordinals[0] + 1 && ordinals[2] === ordinals[1] + 1;
      const currenciesComparable = window.every(item => item.variableCostRatioBps !== null);
      const rollingRatio = consecutive && currenciesComparable
        ? calculateVariableCostRatioBps(
          window.reduce((sum, item) => sum + item.variableCostMicros, 0),
          window.reduce((sum, item) => sum + item.netEconomicRevenueMinor, 0),
        )
        : null;
      rolling[index] = rollingRatio;
      const mandatoryReviewRequired = rollingRatio !== null && rollingRatio > 3000
        && index > 0 && rolling[index - 1] !== null && Number(rolling[index - 1]) > 3000;
      decorated.set(group[index], {
        rolling3MonthVariableCostRatioBps: rollingRatio,
        rolling3MonthHealth: mandatoryReviewRequired ? "mandatory_review" : economicHealthBand(rollingRatio),
        mandatoryReviewRequired,
      });
    }
  }
  return decorated;
}

export async function refreshEconomicAggregatesForRange(input: {
  from: Date;
  to: Date;
  now?: Date;
  refreshDailyUsage?: boolean;
}) {
  const from = startOfMonth(input.from);
  const to = normalizeMonthlyRangeEnd(input.to);
  if (to <= from) return;
  const now = input.now ?? new Date();
  if (input.refreshDailyUsage) await refreshUsageDailyAggregates(from, to, USAGE_RULE_VERSION);
  const facts = await collectPages(
    cursor => listEconomicFactsPage({ from, to, cursor, limit: 5000 }),
    "id",
  );
  const completeDetailFrom = firstFullyRetainedUsageMonth(now);
  const usageFrom = from < completeDetailFrom ? completeDetailFrom : from;
  const usage = usageFrom < to
    ? await collectPages(cursor => listUsageEventsPage({ from: usageFrom, to, cursor, limit: 5000 }), "id")
    : [];
  const historicalTo = to < completeDetailFrom ? to : completeDetailFrom;
  const historicalAggregates = from < historicalTo
    ? await listMonthlyEconomicAggregates({ from, to: historicalTo })
    : [];
  const buckets = new Map<string, Record<string, number | string | null | Date | boolean>>();

  for (const row of historicalAggregates) {
    const month = startOfMonth(new Date(String(row.competenceMonth)));
    const key = [month.toISOString().slice(0, 10), row.payerUserId, row.subscriptionId ?? "", row.versionCode ?? "", row.currency].join("|");
    buckets.set(key, {
      month,
      payerUserId: Number(row.payerUserId),
      subscriptionId: row.subscriptionId ? String(row.subscriptionId) : null,
      productCode: row.productCode ? String(row.productCode) : null,
      versionCode: row.versionCode ? String(row.versionCode) : null,
      billingCycle: row.billingCycle ? String(row.billingCycle) : null,
      currency: String(row.currency),
      contract_revenue: 0,
      discount: 0,
      coupon: 0,
      credit: 0,
      refund: 0,
      chargeback: 0,
      revenue_tax: 0,
      receipt_fee: 0,
      financial_cost: 0,
      estimatedFacts: 0,
      effectiveFacts: 0,
      variableCostMicros: Number(row.variableCostMicros ?? 0),
      hasUnconvertedVariableCost: row.variableCostRatioBps == null && Number(row.netEconomicRevenueMinor ?? 0) > 0,
    });
  }

  for (const fact of facts) {
    const competenceStart = new Date(String(fact.competenceStart));
    const competenceEnd = new Date(String(fact.competenceEnd));
    for (const allocation of allocateMinorUnitsByMonth(Number(fact.amountMinor), competenceStart, competenceEnd)) {
      const month = allocation.month;
      if (month < from || month >= to) continue;
      const value = allocation.amountMinor;
      const key = [month.toISOString().slice(0, 10), fact.payerUserId, fact.subscriptionId ?? "", fact.versionCode ?? "", fact.currency].join("|");
      const bucket = buckets.get(key) ?? {
        month, payerUserId: Number(fact.payerUserId), subscriptionId: fact.subscriptionId ? String(fact.subscriptionId) : null,
        productCode: fact.productCode ? String(fact.productCode) : null, versionCode: fact.versionCode ? String(fact.versionCode) : null,
        billingCycle: fact.billingCycle ? String(fact.billingCycle) : null, currency: String(fact.currency), contract_revenue: 0,
        discount: 0, coupon: 0, credit: 0, refund: 0, chargeback: 0, revenue_tax: 0, receipt_fee: 0, financial_cost: 0,
        estimatedFacts: 0, effectiveFacts: 0, variableCostMicros: 0, hasUnconvertedVariableCost: false,
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
    const monthKey = month.toISOString().slice(0, 10);
    const costMicros = Number(row.effectiveCostMicros ?? row.estimatedCostMicros ?? 0);
    if (costMicros <= 0) continue;
    const usageCurrency = row.currency == null ? null : String(row.currency);
    const usageVersionCode = row.versionCode == null ? null : String(row.versionCode);
    const dimensionCandidates = Array.from(buckets.entries()).filter(([key, bucket]) => {
      if (!key.startsWith(`${monthKey}|${row.payerUserId}|`)) return false;
      if (String(row.subscriptionId ?? "") !== String(bucket.subscriptionId ?? "")) return false;
      if (usageVersionCode && usageVersionCode !== String(bucket.versionCode ?? "")) return false;
      return true;
    });
    const candidateVersions = new Set(
      dimensionCandidates.map(([, bucket]) => String(bucket.versionCode ?? "")),
    );
    const ambiguousVersion = usageVersionCode === null && candidateVersions.size > 1;
    let matchedComparableBucket = false;

    if (ambiguousVersion) {
      for (const [, bucket] of dimensionCandidates) {
        bucket.hasUnconvertedVariableCost = true;
      }
    } else {
      for (const [, bucket] of dimensionCandidates) {
        if (usageCurrency && usageCurrency === String(bucket.currency)) {
          bucket.variableCostMicros = Number(bucket.variableCostMicros) + costMicros;
          matchedComparableBucket = true;
        } else {
          bucket.hasUnconvertedVariableCost = true;
        }
      }
    }

    if (usageCurrency && !matchedComparableBucket) {
      const inferredVersionCode = usageVersionCode
        ?? (candidateVersions.size === 1 ? Array.from(candidateVersions)[0] || null : null);
      const key = [monthKey, row.payerUserId, row.subscriptionId ?? "", inferredVersionCode ?? "", usageCurrency].join("|");
      const bucket = buckets.get(key) ?? {
        month, payerUserId: Number(row.payerUserId), subscriptionId: row.subscriptionId ? String(row.subscriptionId) : null,
        productCode: row.productCode ? String(row.productCode) : null, versionCode: inferredVersionCode,
        billingCycle: row.billingCycle ? String(row.billingCycle) : null, currency: usageCurrency, contract_revenue: 0,
        discount: 0, coupon: 0, credit: 0, refund: 0, chargeback: 0, revenue_tax: 0, receipt_fee: 0, financial_cost: 0,
        estimatedFacts: 0, effectiveFacts: 0, variableCostMicros: 0, hasUnconvertedVariableCost: false,
      };
      bucket.variableCostMicros = Number(bucket.variableCostMicros) + costMicros;
      buckets.set(key, bucket);
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
    const variableCostRatioBps = Boolean(bucket.hasUnconvertedVariableCost)
      ? null
      : calculateVariableCostRatioBps(variableCostMicros, net);
    await upsertMonthlyEconomicAggregate({
      aggregateKey: crypto.createHash("sha256").update(key).digest("hex"), competenceMonth: bucket.month as Date,
      payerUserId: Number(bucket.payerUserId), subscriptionId: bucket.subscriptionId as string | null,
      productCode: bucket.productCode as string | null, versionCode: bucket.versionCode as string | null,
      billingCycle: bucket.billingCycle as string | null, currency: String(bucket.currency),
      recognizedContractRevenueMinor: Number(bucket.contract_revenue), discountMinor: Number(bucket.discount), couponMinor: Number(bucket.coupon),
      creditMinor: Number(bucket.credit), refundMinor: Number(bucket.refund), chargebackMinor: Number(bucket.chargeback), taxMinor: Number(bucket.revenue_tax),
      receiptFeeMinor: Number(bucket.receipt_fee), financialCostMinor: Number(bucket.financial_cost), netEconomicRevenueMinor: net,
      variableCostMicros, variableCostRatioBps,
      estimatedFactCount: estimated, effectiveFactCount: effective, measurementCoverageBps: effective + estimated ? Math.round(effective / (effective + estimated) * 10_000) : 0,
      ruleVersion: USAGE_RULE_VERSION,
    });
  }
}

export async function refreshEconomicAggregates(now = new Date()) {
  return refreshEconomicAggregatesForRange({
    from: addMonths(startOfMonth(now), -2),
    to: addMonths(startOfMonth(now), 1),
    now,
    refreshDailyUsage: true,
  });
}

type UsageDimensionSummary = {
  beneficiaryUserId: number;
  patientUserId: number | null;
  sponsorUserId: number | null;
  payerUserId: number;
  productCode: string | null;
  versionCode: string | null;
  billingCycle: string | null;
  accessSource: string;
  operation: string;
  channel: string;
  provider: string | null;
  model: string | null;
  calls: number;
  units: number;
  estimatedCostMicros: number;
  effectiveCostMicros: number;
  retries: number;
  failures: number;
};

function nullableString(value: unknown) {
  return value == null ? null : String(value);
}

function usageCostMicros(row: Record<string, unknown>) {
  return Number(row.recognizedCostMicros ?? row.effectiveCostMicros ?? row.estimatedCostMicros ?? 0);
}

function percentile(values: number[], quantile: number) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const rank = (ordered.length - 1) * quantile;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return ordered[lower];
  return Math.round(ordered[lower] + (ordered[upper] - ordered[lower]) * (rank - lower));
}

function portfolioRange(activePatients: number) {
  if (activePatients <= 10) return "1-10" as const;
  if (activePatients <= 25) return "11-25" as const;
  if (activePatients <= 50) return "26-50" as const;
  return "51+" as const;
}

function summarizeProfessionalPortfolios(usage: Record<string, unknown>[]) {
  const portfolios = new Map<string, {
    sponsorUserId: number;
    payerUserId: number;
    subscriptionId: string | null;
    versionCode: string | null;
    patientCosts: Map<number, number>;
    totalCostMicros: number;
    calls: number;
  }>();
  for (const row of usage) {
    const sponsorUserId = Number(row.sponsorUserId ?? 0);
    const patientUserId = Number(row.patientUserId ?? 0);
    if (!sponsorUserId || !patientUserId) continue;
    const subscriptionId = nullableString(row.subscriptionId);
    const versionCode = nullableString(row.versionCode);
    const key = `${sponsorUserId}|${subscriptionId ?? ""}|${versionCode ?? ""}`;
    const current = portfolios.get(key) ?? {
      sponsorUserId,
      payerUserId: Number(row.payerUserId),
      subscriptionId,
      versionCode,
      patientCosts: new Map<number, number>(),
      totalCostMicros: 0,
      calls: 0,
    };
    const cost = usageCostMicros(row);
    current.patientCosts.set(patientUserId, (current.patientCosts.get(patientUserId) ?? 0) + cost);
    current.totalCostMicros += cost;
    current.calls += Number(row.eventCount ?? 1);
    portfolios.set(key, current);
  }
  const summaries = Array.from(portfolios.values()).map(portfolio => {
    const patientCosts = Array.from(portfolio.patientCosts.values());
    const activePatientCount = patientCosts.length;
    return {
      sponsorUserId: portfolio.sponsorUserId,
      payerUserId: portfolio.payerUserId,
      subscriptionId: portfolio.subscriptionId,
      versionCode: portfolio.versionCode,
      activePatientCount,
      portfolioRange: portfolioRange(activePatientCount),
      calls: portfolio.calls,
      totalCostMicros: portfolio.totalCostMicros,
      averageCostPerActivePatientMicros: activePatientCount
        ? Math.round(portfolio.totalCostMicros / activePatientCount)
        : 0,
      patientCostPercentilesMicros: {
        p50: percentile(patientCosts, 0.5),
        p75: percentile(patientCosts, 0.75),
        p90: percentile(patientCosts, 0.9),
        p95: percentile(patientCosts, 0.95),
      },
    };
  });
  const distribution = new Map<string, { portfolioRange: string; portfolioCount: number; activePatientCount: number; totalCostMicros: number }>();
  for (const portfolio of summaries) {
    const current = distribution.get(portfolio.portfolioRange) ?? {
      portfolioRange: portfolio.portfolioRange,
      portfolioCount: 0,
      activePatientCount: 0,
      totalCostMicros: 0,
    };
    current.portfolioCount += 1;
    current.activePatientCount += portfolio.activePatientCount;
    current.totalCostMicros += portfolio.totalCostMicros;
    distribution.set(portfolio.portfolioRange, current);
  }
  return { portfolios: summaries, distribution: Array.from(distribution.values()) };
}

export async function getInternalUsageAnalytics(input: { from: Date; to: Date; userId?: number }) {
  const dailyDetailCutoff = subtractMonths(new Date(), USAGE_RETENTION_POLICY.dailyAggregateMonths);
  const usageFrom = input.from < dailyDetailCutoff ? dailyDetailCutoff : input.from;
  const usage = usageFrom < input.to
    ? await collectPages(
        cursor => listUsageDailyAggregatesPage({ from: usageFrom, to: input.to, userId: input.userId, cursor, limit: 5000 }),
        "aggregateKey",
      )
    : [];
  const requestedFrom = startOfMonth(input.from);
  const requestedTo = addMonths(startOfMonth(input.to), 1);
  const economics = await listMonthlyEconomicAggregates({
    from: addMonths(requestedFrom, -3),
    to: requestedTo,
    payerUserId: input.userId,
  });
  const byOperation = new Map<string, { operation: string; channel: string; calls: number; units: number; estimatedCostMicros: number; effectiveCostMicros: number; retries: number; failures: number }>();
  const byDimensions = new Map<string, UsageDimensionSummary>();
  for (const row of usage) {
    const key = `${row.operation}|${row.channel}`;
    const current = byOperation.get(key) ?? { operation: String(row.operation), channel: String(row.channel), calls: 0, units: 0, estimatedCostMicros: 0, effectiveCostMicros: 0, retries: 0, failures: 0 };
    current.calls += Number(row.eventCount ?? 0); current.units += Number(row.unitCount ?? 0); current.estimatedCostMicros += Number(row.estimatedCostMicros ?? 0);
    current.effectiveCostMicros += Number(row.effectiveCostMicros ?? 0); current.retries += Number(row.retryCount ?? 0);
    current.failures += Number(row.failureCount ?? 0); byOperation.set(key, current);

    const dimensions = {
      beneficiaryUserId: Number(row.beneficiaryUserId),
      patientUserId: row.patientUserId == null ? null : Number(row.patientUserId),
      sponsorUserId: row.sponsorUserId == null ? null : Number(row.sponsorUserId),
      payerUserId: Number(row.payerUserId),
      productCode: nullableString(row.productCode),
      versionCode: nullableString(row.versionCode),
      billingCycle: nullableString(row.billingCycle),
      accessSource: String(row.accessSource),
      operation: String(row.operation),
      channel: String(row.channel),
      provider: nullableString(row.provider),
      model: nullableString(row.model),
    };
    const dimensionKey = JSON.stringify(dimensions);
    const dimensionSummary = byDimensions.get(dimensionKey) ?? {
      ...dimensions,
      calls: 0,
      units: 0,
      estimatedCostMicros: 0,
      effectiveCostMicros: 0,
      retries: 0,
      failures: 0,
    };
    dimensionSummary.calls += Number(row.eventCount ?? 0);
    dimensionSummary.units += Number(row.unitCount ?? 0);
    dimensionSummary.estimatedCostMicros += Number(row.estimatedCostMicros ?? 0);
    dimensionSummary.effectiveCostMicros += Number(row.effectiveCostMicros ?? 0);
    dimensionSummary.retries += Number(row.retryCount ?? 0);
    dimensionSummary.failures += Number(row.failureCount ?? 0);
    byDimensions.set(dimensionKey, dimensionSummary);
  }
  const normalized: EconomicSeriesRow[] = economics.map(row => ({
    competenceMonth: new Date(String(row.competenceMonth)),
    payerUserId: Number(row.payerUserId), subscriptionId: row.subscriptionId == null ? null : String(row.subscriptionId),
    versionCode: row.versionCode == null ? null : String(row.versionCode), currency: String(row.currency),
    recognizedContractRevenueMinor: Number(row.recognizedContractRevenueMinor), netEconomicRevenueMinor: Number(row.netEconomicRevenueMinor),
    variableCostMicros: Number(row.variableCostMicros), variableCostRatioBps: row.variableCostRatioBps == null ? null : Number(row.variableCostRatioBps),
    measurementCoverageBps: Number(row.measurementCoverageBps),
  }));
  const decisions = decorateEconomicDecisionSeries(normalized);
  const monthly = normalized
    .filter(row => {
      const month = startOfMonth(new Date(row.competenceMonth));
      return month >= requestedFrom && month < requestedTo;
    })
    .map(row => ({
      ...row,
      health: economicHealthBand(row.variableCostRatioBps),
      ...decisions.get(row),
    }));
  const professionalPortfolio = summarizeProfessionalPortfolios(usage);
  return {
    window: input,
    policy: { fairUse: FAIR_USE_POLICY, retention: USAGE_RETENTION_POLICY },
    coverage: {
      usage: {
        source: "daily_aggregates" as const,
        state: input.from < dailyDetailCutoff ? "partial" as const : "complete" as const,
        requestedFrom: input.from,
        availableFrom: usageFrom,
        availableTo: input.to,
        retentionMonths: USAGE_RETENTION_POLICY.dailyAggregateMonths,
        truncated: false,
      },
      economics: {
        source: "monthly_aggregates" as const,
        state: "complete" as const,
        requestedFrom,
        availableFrom: requestedFrom,
        availableTo: requestedTo,
        retentionYears: USAGE_RETENTION_POLICY.monthlyEconomicYears,
        truncated: false,
      },
      pagination: { internalKeysetPagination: true, pageSize: 5000 },
    },
    byOperation: Array.from(byOperation.values()),
    byDimensions: Array.from(byDimensions.values()),
    professionalPortfolio,
    monthlyEconomics: monthly,
    generatedAt: new Date(),
  };
}

export async function runUsageRetention(now = new Date()) {
  return purgeUsageGovernanceRetention({
    now,
    detailedCutoff: subtractMonths(now, USAGE_RETENTION_POLICY.detailedUsageMonths),
    dailyCutoff: subtractMonths(now, USAGE_RETENTION_POLICY.dailyAggregateMonths),
    monthlyCutoff: subtractMonths(now, USAGE_RETENTION_POLICY.monthlyEconomicYears * 12),
    governanceCutoff: subtractMonths(now, USAGE_RETENTION_POLICY.governanceAuditYears * 12),
    ruleVersion: USAGE_RULE_VERSION,
    auditId: crypto.randomUUID(),
  });
}
