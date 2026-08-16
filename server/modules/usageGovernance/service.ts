import crypto from "node:crypto";
import type { AiUsageGateInput, AiUsageGateResult } from "../../_core/ai/usageGate";
import { billingService } from "../billing/service";
import {
  listEconomicTelemetry,
  purgeExpiredUsageTelemetry,
  reserveUsageQuota,
} from "../../repositories/usageGovernanceRepository";

export const USAGE_RETENTION_POLICY = {
  quotaReservationsHours: 48,
  detailedEconomicTelemetryDays: 90,
  persistedCostAggregates: false,
  policyVersion: "2026-08-16.1",
} as const;

export class AiUsageLimitExceededError extends Error {
  readonly code = "usage_limit_exceeded" as const;
  constructor(
    readonly retryAfterSeconds: number,
    readonly limit: number,
    readonly windowMs: number,
  ) {
    super("Limite de uso do assistente atingido para esta janela.");
    this.name = "AiUsageLimitExceededError";
  }
}

export class AiUsageGovernanceUnavailableError extends Error {
  readonly code = "usage_governance_unavailable" as const;
  constructor() {
    super("Não foi possível validar o limite de uso do assistente agora.");
    this.name = "AiUsageGovernanceUnavailableError";
  }
}

type Allowance = {
  maxCalls: number;
  windowMs: number;
  key: string;
};

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_ALLOWANCES: Record<string, number> = {
  admin_override: 240,
  sponsored_by_professional: 120,
  active_subscription: 180,
  active_trial: 60,
  transition_access: 30,
  read_only_access: 0,
  free_access: 30,
  no_access: 0,
};

function parseAllowanceOverrides(raw: string | undefined) {
  if (!raw?.trim()) return new Map<string, number>();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return new Map(
      Object.entries(parsed).flatMap(([key, value]) =>
        typeof value === "number" && Number.isInteger(value) && value >= 0
          ? [[key, value] as const]
          : [],
      ),
    );
  } catch {
    return new Map<string, number>();
  }
}

function resolveAllowance(input: {
  accessReason: string;
  planCode: string | null;
  entitlements: string[];
}): Allowance {
  const planOverrides = parseAllowanceOverrides(process.env.AI_USAGE_PLAN_ALLOWANCES_JSON);
  if (input.planCode && planOverrides.has(input.planCode)) {
    return {
      maxCalls: planOverrides.get(input.planCode)!,
      windowMs: DEFAULT_WINDOW_MS,
      key: `plan:${input.planCode}`,
    };
  }

  const entitlementOverrides = parseAllowanceOverrides(
    process.env.AI_USAGE_ENTITLEMENT_ALLOWANCES_JSON,
  );
  for (const entitlement of input.entitlements) {
    if (entitlementOverrides.has(entitlement)) {
      return {
        maxCalls: entitlementOverrides.get(entitlement)!,
        windowMs: DEFAULT_WINDOW_MS,
        key: `entitlement:${entitlement}`,
      };
    }
  }

  return {
    maxCalls: DEFAULT_ALLOWANCES[input.accessReason] ?? 0,
    windowMs: DEFAULT_WINDOW_MS,
    key: `source:${input.accessReason}`,
  };
}

function opaqueConversationRef(value?: string | null) {
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function originForLog(origin: AiUsageGateInput["origin"]): "web" | "whatsapp" | "admin" {
  if (origin === "whatsapp") return "whatsapp";
  if (origin === "web") return "web";
  return "admin";
}

export async function enforceUsageAllowance(
  input: AiUsageGateInput,
): Promise<AiUsageGateResult> {
  const status = await billingService.getUserSubscriptionStatus(input.userId);
  const access = status.access;
  const originalSubscriptionPlanCode = status.subscription?.planCode ?? null;
  const effectivePlanCode = access.planCode ?? originalSubscriptionPlanCode;
  const allowance = resolveAllowance({
    accessReason: access.reason,
    planCode: effectivePlanCode,
    entitlements: access.entitlements,
  });
  const now = new Date();
  const windowStart = new Date(now.getTime() - allowance.windowMs);
  const conversationRef = opaqueConversationRef(input.conversationId);
  const billedUserId = access.reason === "sponsored_by_professional" && access.sponsorUserId
    ? access.sponsorUserId
    : input.userId;

  let reservation;
  try {
    reservation = await reserveUsageQuota({
      userId: input.userId,
      capability: input.capability,
      origin: originForLog(input.origin),
      windowStart,
      maxCalls: allowance.maxCalls,
      detail: {
        capability: input.capability,
        flow: input.flow ?? null,
        conversationRef,
        accessSource: access.reason,
        effectivePlanCode,
        originalSubscriptionPlanCode,
        entitlementKeys: access.entitlements,
        allowanceKey: allowance.key,
        allowanceMaxCalls: allowance.maxCalls,
        allowanceWindowMs: allowance.windowMs,
        billedUserId,
        policyVersion: USAGE_RETENTION_POLICY.policyVersion,
      },
    });
  } catch {
    throw new AiUsageGovernanceUnavailableError();
  }

  if (!reservation.allowed) {
    throw new AiUsageLimitExceededError(
      Math.max(1, Math.ceil(allowance.windowMs / 1000)),
      allowance.maxCalls,
      allowance.windowMs,
    );
  }

  return {
    correlation: {
      userId: input.userId,
      billedUserId,
      accessSource: access.reason,
      planCode: effectivePlanCode ?? "none",
      originalPlanCode: originalSubscriptionPlanCode ?? "none",
      allowanceKey: allowance.key,
      allowanceLimit: allowance.maxCalls,
      ...(conversationRef ? { conversationRef } : {}),
    },
  };
}

type SafeInferenceEvent = {
  capability?: string;
  origin?: string;
  flow?: string;
  callRole?: string;
  outcome?: string;
  estimatedCostUsd?: number | null;
  usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
  pricingCatalogVersion?: string;
  correlation?: Record<string, string | number | boolean | null>;
};

function parseSafeInferenceEvent(detail: string): SafeInferenceEvent | null {
  try {
    const parsed = JSON.parse(detail) as SafeInferenceEvent;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function tokensFrom(event: SafeInferenceEvent) {
  const usage = event.usage;
  if (!usage) return 0;
  if (typeof usage.totalTokens === "number") return usage.totalTokens;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

export async function getInternalUsageAnalytics(input: {
  from: Date;
  to: Date;
  userId?: number;
}) {
  const rows = await listEconomicTelemetry(input);
  const groups = new Map<string, {
    feature: string;
    planCode: string;
    accessSource: string;
    calls: number;
    tokens: number;
    estimatedCostUsd: number;
    retries: number;
    fallbacks: number;
    timeouts: number;
    limitExceeded: number;
  }>();
  const pressure = new Map<number, { calls: number; estimatedCostUsd: number; limitExceeded: number }>();
  let retryTimeoutCostUsd = 0;

  for (const row of rows) {
    if (row.eventType === "ai.usage_limit_exceeded") {
      if (row.userId !== null) {
        const current = pressure.get(row.userId) ?? { calls: 0, estimatedCostUsd: 0, limitExceeded: 0 };
        current.limitExceeded += 1;
        pressure.set(row.userId, current);
      }
      continue;
    }

    const event = parseSafeInferenceEvent(row.detail);
    if (!event) continue;
    const feature = event.flow ?? event.capability ?? "unknown";
    const planCode = String(event.correlation?.planCode ?? "unknown");
    const accessSource = String(event.correlation?.accessSource ?? "unknown");
    const key = `${feature}\u0000${planCode}\u0000${accessSource}`;
    const current = groups.get(key) ?? {
      feature,
      planCode,
      accessSource,
      calls: 0,
      tokens: 0,
      estimatedCostUsd: 0,
      retries: 0,
      fallbacks: 0,
      timeouts: 0,
      limitExceeded: 0,
    };
    const cost = typeof event.estimatedCostUsd === "number" ? event.estimatedCostUsd : 0;
    current.calls += 1;
    current.tokens += tokensFrom(event);
    current.estimatedCostUsd += cost;
    if (event.callRole === "retry") current.retries += 1;
    if (event.callRole === "fallback") current.fallbacks += 1;
    if (event.outcome === "timeout") current.timeouts += 1;
    if (event.callRole === "retry" || event.callRole === "fallback" || event.outcome === "timeout") {
      retryTimeoutCostUsd += cost;
    }
    groups.set(key, current);

    if (row.userId !== null) {
      const user = pressure.get(row.userId) ?? { calls: 0, estimatedCostUsd: 0, limitExceeded: 0 };
      user.calls += 1;
      user.estimatedCostUsd += cost;
      pressure.set(row.userId, user);
    }
  }

  return {
    window: { from: input.from, to: input.to },
    retentionPolicy: USAGE_RETENTION_POLICY,
    totals: {
      calls: Array.from(groups.values()).reduce((sum, item) => sum + item.calls, 0),
      tokens: Array.from(groups.values()).reduce((sum, item) => sum + item.tokens, 0),
      estimatedCostUsd: Array.from(groups.values()).reduce((sum, item) => sum + item.estimatedCostUsd, 0),
      retryTimeoutCostUsd,
    },
    byFeatureAndPlan: Array.from(groups.values()).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
    pressureUsers: Array.from(pressure.entries())
      .map(([userId, value]) => ({ userId, ...value }))
      .sort((a, b) => b.calls - a.calls || b.estimatedCostUsd - a.estimatedCostUsd)
      .slice(0, 50),
    generatedAt: new Date(),
  };
}

export function runUsageRetention(now = new Date()) {
  return purgeExpiredUsageTelemetry(now);
}
