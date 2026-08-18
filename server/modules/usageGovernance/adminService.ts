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
  reviewLimitationAppeal,
  submitLimitationAppeal,
} from "../../repositories/usageGovernanceAdminRepository";
import {
  getUsageAbuseSignalValidationError,
  isHeavyUsageOperation,
  normalizeReviewedOperations,
  normalizeUsageAbuseSignals,
  SECURITY_USAGE_ABUSE_SIGNALS,
} from "./abusePolicy";
import { FAIR_USE_POLICY, USAGE_RULE_VERSION } from "./service";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

type UsageAbuseEvidenceValue = number | string | boolean | string[] | null;

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

function getEmergencyEvidenceOperations(evidence: Record<string, unknown>) {
  const operations = normalizeReviewedOperations(jsonStringArray(evidence.affectedOperations));
  if (!operations.length || operations.some(operation => !isHeavyUsageOperation(operation))) {
    throw new Error("usage_emergency_security_scope_required");
  }
  return operations;
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
  evidence: Record<string, UsageAbuseEvidenceValue>;
  actorUserId: number;
}) {
  const signals = normalizeUsageAbuseSignals(input.signals);
  const signalError = getUsageAbuseSignalValidationError(signals, input.evidence);
  if (signalError) throw new Error(signalError);

  const id = crypto.randomUUID();
  await createAbuseCase({ ...input, signals, id });
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

  const affectedOperations = normalizeReviewedOperations(input.impact.affectedOperations);
  if (affectedOperations.some(operation => !isHeavyUsageOperation(operation))) {
    throw new Error("usage_abuse_review_operations_invalid");
  }
  if (input.outcome === "limitation_approved" && !affectedOperations.length) {
    throw new Error("usage_abuse_review_operations_required");
  }

  await approveAbuseReview({
    ...input,
    impact: { ...input.impact, affectedOperations },
  });
  return { id: input.id, state: input.outcome === "dismissed" ? "dismissed" as const : "reviewed" as const, outcome: input.outcome };
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
  const requestedOperations = normalizeReviewedOperations(input.operations);
  if (!requestedOperations.length || requestedOperations.some(operation => !isHeavyUsageOperation(operation))) {
    throw new Error("usage_limitation_operations_invalid");
  }
  const duration = input.endsAt.getTime() - input.startsAt.getTime();
  const abuseCase = await getAbuseCase(input.abuseCaseId);
  if (!abuseCase || Number(abuseCase.subjectUserId) !== input.subjectUserId) {
    throw new Error("usage_limitation_abuse_case_required");
  }
  const priorLimitations = await listUsageLimitationsForCase(input.abuseCaseId);

  if (input.emergencySecurity) {
    if (duration > FAIR_USE_POLICY.emergencySecurityHours * HOUR_MS) throw new Error("usage_emergency_limit_duration_invalid");
    if (priorLimitations.some(item => item.emergencySecurity)) throw new Error("usage_emergency_limit_already_applied");
    const signals = jsonStringArray(abuseCase.signalsJson);
    const evidence = jsonObject(abuseCase.sanitizedEvidenceJson);
    if (!signals.some(signal => SECURITY_USAGE_ABUSE_SIGNALS.has(signal)) || evidence.securityRiskConfirmed !== true) {
      throw new Error("usage_emergency_security_evidence_required");
    }
    const evidencedOperations = new Set(getEmergencyEvidenceOperations(evidence));
    if (requestedOperations.some(operation => !evidencedOperations.has(operation))) {
      throw new Error("usage_emergency_security_operation_not_evidenced");
    }
  } else {
    if (duration > FAIR_USE_POLICY.initialLimitationDays * DAY_MS) throw new Error("usage_limitation_duration_invalid");
    if (String(abuseCase.reviewOutcome) !== "limitation_approved" || !Boolean(abuseCase.systemFailuresExcluded) || !Boolean(abuseCase.legitimateGrowthReviewed)) {
      throw new Error("usage_limitation_human_review_required");
    }
    if (!input.communicatedAt || !input.appealOfferedAt) throw new Error("usage_limitation_communication_required");

    const impact = jsonObject(abuseCase.impactJson);
    const reviewedOperations = normalizeReviewedOperations(jsonStringArray(impact.affectedOperations));
    if (!reviewedOperations.length) throw new Error("usage_limitation_review_scope_missing");
    const reviewedOperationSet = new Set(reviewedOperations);
    if (requestedOperations.some(operation => !reviewedOperationSet.has(operation))) {
      throw new Error("usage_limitation_operation_not_reviewed");
    }

    const normalLimitations = priorLimitations.filter(item => !item.emergencySecurity);
    if (normalLimitations.length >= 2) throw new Error("usage_limitation_extension_limit_reached");
    if (normalLimitations.length === 1) {
      const previous = normalLimitations[0];
      if ((previous.state && previous.state !== "active") || previous.revokedAt) throw new Error("usage_limitation_extension_initial_not_active");
      if (input.startsAt.getTime() !== previous.endsAt.getTime()) throw new Error("usage_limitation_extension_must_follow_initial");
      if (input.approvedByUserId === previous.approvedByUserId) throw new Error("usage_limitation_second_admin_required");
    }
  }
  const id = crypto.randomUUID();
  const admitted = await createLimitation({
    ...input,
    operations: requestedOperations,
    id,
    approvedByUserId: input.approvedByUserId,
  });
  return { id, state: "active" as const, endsAt: input.endsAt, ...admitted };
}

export async function submitUsageLimitationAppeal(input:{limitationId:string;subjectUserId:number;rationale:string}) {
  const rationale=input.rationale.trim();
  if (!rationale) throw new Error("usage_limitation_appeal_rationale_required");
  return submitLimitationAppeal({id:crypto.randomUUID(),limitationId:input.limitationId,subjectUserId:input.subjectUserId,rationale,submittedAt:new Date()});
}

export async function resolveUsageLimitationAppeal(input:{appealId:string;reviewerUserId:number;result:"approved"|"denied";rationale:string}) {
  const rationale=input.rationale.trim();
  if (!rationale) throw new Error("usage_limitation_appeal_review_rationale_required");
  return reviewLimitationAppeal({...input,rationale,reviewedAt:new Date()});
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
  submitUsageLimitationAppeal,
  resolveUsageLimitationAppeal,
  authorizeFutureConsumptionCharging,
  revokeFutureConsumptionCharging,
  placeUsageLegalHold,
  revokeUsageLegalHold: revokeLegalHold,
};
