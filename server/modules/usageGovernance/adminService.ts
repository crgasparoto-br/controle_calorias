import crypto from "node:crypto";
import { getAbuseCase } from "../../repositories/usageGovernanceRepository";
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

function assertFutureRange(startsAt: Date, endsAt: Date) {
  if (endsAt.getTime() <= startsAt.getTime()) throw new Error("usage_governance_range_invalid");
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
  secondApprovedByUserId?: number | null;
  communicatedAt?: Date | null;
  appealOfferedAt?: Date | null;
}) {
  assertFutureRange(input.startsAt, input.endsAt);
  if (!input.operations.length || input.operations.some(operation => !HEAVY_OPERATIONS.has(operation) && !operation.startsWith("capability:") && !operation.startsWith("flow:"))) {
    throw new Error("usage_limitation_operations_invalid");
  }
  const duration = input.endsAt.getTime() - input.startsAt.getTime();
  if (input.emergencySecurity) {
    if (duration > FAIR_USE_POLICY.emergencySecurityHours * HOUR_MS) throw new Error("usage_emergency_limit_duration_invalid");
  } else {
    if (duration > FAIR_USE_POLICY.initialLimitationDays * DAY_MS) throw new Error("usage_limitation_duration_invalid");
    const abuseCase = await getAbuseCase(input.abuseCaseId);
    if (!abuseCase || String(abuseCase.reviewOutcome) !== "limitation_approved" || !Boolean(abuseCase.systemFailuresExcluded) || !Boolean(abuseCase.legitimateGrowthReviewed)) {
      throw new Error("usage_limitation_human_review_required");
    }
    if (!input.communicatedAt || !input.appealOfferedAt) throw new Error("usage_limitation_communication_required");
  }
  const id = crypto.randomUUID();
  await createLimitation({ ...input, id });
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
  const id = crypto.randomUUID();
  await createConsumptionChargeAuthorization({ ...input, id });
  return { id, state: "approved" as const, noRetroactive: true as const, measurementPolicyVersion: USAGE_RULE_VERSION };
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
  revokeFutureConsumptionCharging: revokeConsumptionChargeAuthorization,
  placeUsageLegalHold,
  revokeUsageLegalHold: revokeLegalHold,
};
