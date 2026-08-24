import crypto from "node:crypto";
import { refreshUsageDailyAggregates } from "../../repositories/usageGovernanceRepository";
import { reconcileUsageEventEffectiveCost } from "../../repositories/usageCostReconciliationRepository";
import { refreshEconomicAggregatesForRange, USAGE_RULE_VERSION } from "./service";

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export async function reconcileUsageCost(input: {
  reconciliationKey: string;
  usageIdempotencyKey: string;
  effectiveCostMicros: number;
  currency: string;
  effectiveAt?: Date;
  reason: string;
  actorUserId?: number | null;
}) {
  if (!Number.isInteger(input.effectiveCostMicros) || input.effectiveCostMicros < 0) {
    throw new Error("usage_cost_effective_amount_invalid");
  }
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("usage_cost_currency_invalid");
  const result = await reconcileUsageEventEffectiveCost({
    id: crypto.randomUUID(),
    reconciliationKey: input.reconciliationKey,
    usageIdempotencyKey: input.usageIdempotencyKey,
    effectiveCostMicros: input.effectiveCostMicros,
    currency,
    effectiveAt: input.effectiveAt ?? new Date(),
    reason: input.reason,
    actorUserId: input.actorUserId ?? null,
    ruleVersion: USAGE_RULE_VERSION,
    correlationId: crypto.randomUUID(),
  });
  if (!result.applied) return result;

  const dayStart = startOfUtcDay(result.occurredAt);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  await refreshUsageDailyAggregates(dayStart, dayEnd, USAGE_RULE_VERSION);
  await refreshEconomicAggregatesForRange({
    from: result.occurredAt,
    to: dayEnd,
    refreshDailyUsage: false,
  });
  return result;
}
