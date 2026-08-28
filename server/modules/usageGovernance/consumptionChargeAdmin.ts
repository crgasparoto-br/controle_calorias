import crypto from "node:crypto";
import {
  createConsumptionChargeAuthorizationDraft,
  transitionConsumptionChargeAuthorization,
} from "../../repositories/consumptionChargeAuthorizationRepository";
import { USAGE_RULE_VERSION } from "./service";

export async function draftFutureConsumptionCharging(input: {
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
  const reason = input.reason.trim();
  if (!reason) throw new Error("consumption_charge_reason_required");
  if (input.effectiveFrom.getTime() <= now.getTime()) throw new Error("consumption_charge_effective_date_must_be_future");
  if (input.communicationAt.getTime() >= input.effectiveFrom.getTime()) throw new Error("consumption_charge_prior_communication_required");
  if (!input.affectedPlans.length) throw new Error("consumption_charge_plans_required");
  if (!Object.keys(input.rollback).length) throw new Error("consumption_charge_rollback_required");
  const id = crypto.randomUUID();
  await createConsumptionChargeAuthorizationDraft({ ...input, reason, id });
  return { id, state: "draft" as const, noRetroactive: true as const, measurementPolicyVersion: USAGE_RULE_VERSION };
}

export const authorizeFutureConsumptionCharging = draftFutureConsumptionCharging;

async function transition(input: {
  id: string;
  toState: "approved" | "active" | "suspended" | "revoked";
  actorUserId: number;
  reason: string;
  reinforcedConfirmation?: boolean;
}) {
  const reason = input.reason.trim();
  if (!reason) throw new Error(input.toState === "revoked" ? "consumption_charge_revoke_reason_required" : "consumption_charge_transition_reason_required");
  return transitionConsumptionChargeAuthorization({ ...input, reason });
}

export const approveFutureConsumptionCharging = (id: string, actorUserId: number, reason: string) =>
  transition({ id, actorUserId, reason, toState: "approved" });

export const activateFutureConsumptionCharging = (id: string, actorUserId: number, reason: string, reinforcedConfirmation: boolean) =>
  transition({ id, actorUserId, reason, toState: "active", reinforcedConfirmation });

export const suspendFutureConsumptionCharging = (id: string, actorUserId: number, reason: string) =>
  transition({ id, actorUserId, reason, toState: "suspended" });

export const revokeFutureConsumptionCharging = (id: string, actorUserId: number, reason: string) =>
  transition({ id, actorUserId, reason, toState: "revoked" });
