export const USAGE_ABUSE_SIGNAL_VALUES = [
  "high_cost",
  "volume_anomaly",
  "repetitive_heavy_automation",
  "client_retry_anomaly",
  "account_sharing",
  "control_bypass_attempt",
  "incompatible_usage_pattern",
  "credential_abuse",
  "security_risk",
] as const;

export type UsageAbuseSignal = typeof USAGE_ABUSE_SIGNAL_VALUES[number];

const USAGE_ABUSE_SIGNAL_SET = new Set<string>(USAGE_ABUSE_SIGNAL_VALUES);

export const SECURITY_USAGE_ABUSE_SIGNALS = new Set<string>([
  "account_sharing",
  "control_bypass_attempt",
  "credential_abuse",
  "security_risk",
]);

const HEAVY_USAGE_OPERATIONS = new Set([
  "ai_heavy_processing",
  "image_processing",
  "audio_processing",
  "whatsapp_processing",
]);

export function isHeavyUsageOperation(operation: string) {
  return HEAVY_USAGE_OPERATIONS.has(operation)
    || (operation.startsWith("capability:") && operation.length > "capability:".length)
    || (operation.startsWith("flow:") && operation.length > "flow:".length);
}

export function normalizeUsageAbuseSignals(signals: readonly string[]) {
  return Array.from(new Set(signals.map(signal => signal.trim()).filter(Boolean)));
}

export function getUsageAbuseSignalValidationError(
  signals: readonly string[],
  evidence: Record<string, unknown>,
): string | null {
  const normalized = normalizeUsageAbuseSignals(signals);
  if (!normalized.length) return "usage_abuse_signals_required";
  if (normalized.some(signal => !USAGE_ABUSE_SIGNAL_SET.has(signal))) return "usage_abuse_signal_invalid";

  // Cost is an economic observation, not proof of abuse. It may accompany a
  // behavioral/security signal, but it can never open a case by itself.
  if (normalized.every(signal => signal === "high_cost")) {
    return "usage_abuse_high_cost_not_sufficient";
  }

  const hasConfirmedSecuritySignal = normalized.some(signal => SECURITY_USAGE_ABUSE_SIGNALS.has(signal))
    && evidence.securityRiskConfirmed === true;

  // Normal review cases require a combination of distinct signals. A proven
  // security condition is the only single-signal exception because the same
  // evidence is required by the bounded 24-hour emergency protection path.
  if (normalized.length < 2 && !hasConfirmedSecuritySignal) {
    return "usage_abuse_signal_combination_required";
  }

  return null;
}

export function normalizeReviewedOperations(operations: readonly string[]) {
  return Array.from(new Set(operations.map(operation => operation.trim()).filter(Boolean)));
}
