import crypto from "node:crypto";
import { getAbuseCase } from "../../repositories/usageGovernanceRepository";
import { listUsageLimitationsForCase } from "../../repositories/usageGovernancePolicyRepository";
import {
  approveAbuseReview,
  createAbuseCase,
  createAllowanceGrant,
  createConsumptionChargeAuthorization,
  createLegalHold,
  createLimitation,
  revokeAllowanceGrant,
  revokeConsumptionChargeAuthorization,
  revokeLegalHold,
  revokeLimitation,
} from "../../repositories/usageGovernanceAdminRepository";
import { FAIR_USE_POLICY, USAGE_RULE_VERSION } from "./service";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const HEAVY_OPERATIONS = new Set([
  "ai_heavy_processing",
  "image_processing",
  "audio_processing",
  "whatsapp_processing",
]);
const SECURITY_SIGNALS = new Set([
  "account_sharing",
  "control_bypass_attempt",
  "credential_abuse",
  "security_risk",
]);

function assertFutureRange(startsAt: Date, endsAt: Date) {
  if (endsAt.getTime() <= startsAt.getTime()) throw new Error("usage_governance_range_invalid");
}

function jsonStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function jsonObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function grantTemporaryAllowance(input: {
  subjectType: "user" | "professional";
  subjectId: string;
  grantType: "additional_units" | "temporary_exemption";
  additionalUnits?: number | null;
  reason: string;
  startsAt: Date;
  endsAt: Date;
  actorUserId: number;
}) {
  assertFutureRange(input.startsAt, input.endsAt);
  if (input.grantType === "additional_units" && (!Number.isInteger(input.additionalUnits) || Number(input.additionalUnits) <= 0)) {
    throw new Error("usage_allowance_units_invalid");
  }
  const id = crypto.randomUUID();
  await createAllowanceGrant({ ...input, id });
  return { id, ...input, billingSideEffect: false as const };
}

export async function openUsageAbuseCase(input: {
  subjectUserId: number;
  sponsorUserId?: number | null;
  signals: string[];
  evidence: Record<string, number | string | boolean | null>;
  actorUserId: number;
}) {
  const id = crypto.randomUUID();
  await createAbuseCase({ ...input, id });
  return { id, state: "open" as const };
}

export async function reviewUsageAbuseCase(input: {
  id: string;
  reviewerUserId: number;
  outcome: "dismissed" | "limitation_approved";
  reason: string;
  systemFailuresExcluded: boolean;
  legitimateGrowthReviewed: boolean;
  impact: { affectedOperations: string[]; legitimateGrowthNotes?: string };
}) {
  if (!input.systemFailuresExcluded || !input.legitimateGrowthReviewed) {
    throw new Error("usage_abuse_review_incomplete");
  }
  await approveAbuseReview(input);
  return { id: input.id, state: "reviewed" as const, outcome: input.outcome };
}

export async function applyUsageLimitation(input: {
  abuseCaseId: string;
  subjectUserId: number;
  operations: string[];
  reason: string;
  startsAt: Date;
  endsAt: Date;
  emergencySecurity: boolean;
  approvedByUserId: number;
  communicatedAt?: Date | null;
  appealOfferedAt?: Date | null;
}) {
  assertFutureRange(input.startsAt, input.endsAt);
  if (!input.operations.length || input.operations.some(operation => !HEAVY_OPERATIONS.has(operation) && !operation.startsWith("capability:") && !operation.startsWith("flow:"))) {
    throw new Error("usage_limitation_operations_invalid");
  }
  const duration = input.endsAt.getTime() - input.startsAt.getTime();
  const abuseCase = await getAbuseCase(input.abuseCaseId);
  if (!abuseCase || Number(abuseCase.subjectUserId) !== input.subjectUserId) {
    throw new Error("usage_limitation_abuse_case_required");
  }
  const priorLimitations = await listUsageLimitationsForCase(input.abuseCaseId);
  let originalApproverUserId: number | null = null;
  let extensionApproverUserId: number | null = null;

  if (input.emergencySecurity) {
    if (duration > FAIR_USE_POLICY.emergencySecurityHours * HOUR_MS) throw new Error("usage_emergency_limit_duration_invalid");
    if (priorLimitations.some(item => item.emergencySecurity)) throw new Error("usage_emergency_limit_already_applied");
    const signals = jsonStringArray(abuseCase.signalsJson);
    const evidence = jsonObject(abuseCase.sanitizedEvidenceJson);
    if (!signals.some(signal => SECURITY_SIGNALS.has(signal)) || evidence.securityRiskConfirmed !== true) {
      throw new Error("usage_emergency_security_evidence_required");
    }
  } else {
    if (duration > FAIR_USE_POLICY.initialLimitationDays * DAY_MS) throw new Error("usage_limitation_duration_invalid");
    if (String(abuseCase.reviewOutcome) !== "limitation_approved" || !Boolean(abuseCase.systemFailuresExcluded) || !Boolean(abuseCase.legitimateGrowthReviewed)) {
      throw new Error("usage_limitation_human_review_required");
    }
    if (!input.communicatedAt || !input.appealOfferedAt) throw new Error("usage_limitation_communication_required");

    const normalLimitations = priorLimitations.filter(item => !item.emergencySecurity);
    if (normalLimitations.length >= 2) throw new Error("usage_limitation_extension_limit_reached");
    if (normalLimitations.length === 1) {
      const previous = normalLimitations[0];
      if ((previous.state && previous.state !== "active") || previous.revokedAt) throw new Error("usage_limitation_extension_initial_not_active");
      if (input.startsAt.getTime() !== previous.endsAt.getTime()) throw new Error("usage_limitation_extension_must_follow_initial");
      if (input.approvedByUserId === previous.approvedByUserId) throw new Error("usage_limitation_second_admin_required");
      originalApproverUserId = previous.approvedByUserId;
      extensionApproverUserId = input.approvedByUserId;
    }
  }
  const id = crypto.randomUUID();
  await createLimitation({
    ...input,
    id,
    approvedByUserId: originalApproverUserId ?? input.approvedByUserId,
    secondApprovedByUserId: extensionApproverUserId,
  });
  return { id, state: "active" as const, endsAt: input.endsAt };
}

export async function authorizeFutureConsumptionCharging(input: {
  policyVersion: string;
  reason: string;
  pricing: Record<string, unknown>;
  affectedPlans: string[];
  effectiveFrom: Date;
  communicationAt: Date;
  rollback: Record<string, unknown>;
  actorUserId: number;
}) {
  const now = new Date();
  if (input.effectiveFrom.getTime() <= now.getTime()) throw new Error("consumption_charge_effective_date_must_be_future");
  if (input.communicationAt.getTime() >= input.effectiveFrom.getTime()) throw new Error("consumption_charge_prior_communication_required");
  if (!input.affectedPlans.length) throw new Error("consumption_charge_plans_required");
  if (!Object.keys(input.rollback).length) throw new Error("consumption_charge_rollback_required");
  const id = crypto.randomUUID();
  await createConsumptionChargeAuthorization({ ...input, id });
  return { id, state: "approved" as const, noRetroactive: true as const, measurementPolicyVersion: USAGE_RULE_VERSION };
}

export async function revokeFutureConsumptionCharging(id: string, actorUserId: number, reason: string) {
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new Error("consumption_charge_revoke_reason_required");
  await revokeConsumptionChargeAuthorization(id, actorUserId, normalizedReason);
  return { id, state: "revoked" as const };
}

export async function placeUsageLegalHold(input: {
  scopeType: "global" | "user" | "subscription";
  scopeId: string;
  reason: string;
  startsAt?: Date;
  endsAt?: Date | null;
  actorUserId: number;
}) {
  const startsAt = input.startsAt ?? new Date();
  if (input.endsAt) assertFutureRange(startsAt, input.endsAt);
  const id = crypto.randomUUID();
  await createLegalHold({ ...input, id, startsAt });
  return { id, active: true as const };
}

export const usageGovernanceAdminService = {
  grantTemporaryAllowance,
  revokeTemporaryAllowance: revokeAllowanceGrant,
  openUsageAbuseCase,
  reviewUsageAbuseCase,
  applyUsageLimitation,
  revokeUsageLimitation: revokeLimitation,
  authorizeFutureConsumptionCharging,
  revokeFutureConsumptionCharging,
  placeUsageLegalHold,
  revokeUsageLegalHold: revokeLegalHold,
};
