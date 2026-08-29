export * from "./usageGovernanceAdminRepositoryCore";

import {
  createConsumptionChargeAuthorizationDraft,
  transitionConsumptionChargeAuthorization,
} from "./consumptionChargeAuthorizationRepository";

export async function createConsumptionChargeAuthorization(input: {
  id: string;
  policyVersion: string;
  reason: string;
  pricing: Record<string, unknown>;
  affectedPlans: string[];
  effectiveFrom: Date;
  communicationAt: Date;
  rollback: Record<string, unknown>;
  actorUserId: number;
}) {
  return createConsumptionChargeAuthorizationDraft(input);
}

export async function revokeConsumptionChargeAuthorization(id: string, actorUserId: number, reason: string) {
  return transitionConsumptionChargeAuthorization({ id, actorUserId, reason, toState: "revoked" });
}
