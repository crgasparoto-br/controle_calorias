import crypto from "node:crypto";
import { getActiveUsagePolicy, replaceUsagePolicy } from "../../repositories/usageGovernancePolicyRepository";
import { FAIR_USE_POLICY, USAGE_RULE_VERSION } from "./service";

export async function configureUsagePolicy(input: {
  scopeType: "global" | "user";
  scopeId: string;
  currency: string;
  expectedBudgetMicros: number;
  alertThresholdPercentages: number[];
  observationStartsAt: Date;
  observationEndsAt: Date;
  reason: string;
  actorUserId: number;
}) {
  if (input.observationEndsAt.getTime() <= input.observationStartsAt.getTime()) {
    throw new Error("usage_policy_observation_range_invalid");
  }
  if (!Number.isInteger(input.expectedBudgetMicros) || input.expectedBudgetMicros <= 0) {
    throw new Error("usage_policy_budget_invalid");
  }
  const thresholds = [...input.alertThresholdPercentages];
  if (thresholds.length !== 3 || thresholds.some((value, index) => !Number.isInteger(value) || value < 1 || value > 100 || (index > 0 && value <= thresholds[index - 1]))) {
    throw new Error("usage_policy_thresholds_invalid");
  }
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("usage_policy_currency_invalid");
  const id = crypto.randomUUID();
  await replaceUsagePolicy({
    ...input,
    id,
    currency,
    alertThresholdPercentages: thresholds,
    ruleVersion: USAGE_RULE_VERSION,
  });
  return { id, scopeType: input.scopeType, scopeId: input.scopeId, alertThresholdPercentages: thresholds, automaticBlockingAtBudgetThreshold: false as const };
}

export async function resolveFairUsePolicy(input: { userId?: number; now?: Date }) {
  const configured = await getActiveUsagePolicy({ userId: input.userId, now: input.now ?? new Date() });
  return {
    ...FAIR_USE_POLICY,
    alertThresholdPercentages: configured?.alertThresholdPercentages.length === 3
      ? configured.alertThresholdPercentages
      : [...FAIR_USE_POLICY.alertThresholdPercentages],
    configuredUsagePolicy: configured,
  };
}
