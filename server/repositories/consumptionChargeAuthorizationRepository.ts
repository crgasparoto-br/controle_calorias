import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { resultRows } from "./billingRepositorySupport";

export type ConsumptionChargeAuthorizationState = "draft" | "approved" | "active" | "suspended" | "revoked";

type Row = Record<string, unknown>;

const ALLOWED: Record<ConsumptionChargeAuthorizationState, ConsumptionChargeAuthorizationState[]> = {
  draft: ["approved", "revoked"],
  approved: ["active", "revoked"],
  active: ["suspended", "revoked"],
  suspended: ["active", "revoked"],
  revoked: [],
};

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("usage_governance_persistence_unavailable");
  return db;
}

function affectedRows(result: unknown) {
  return Number((result as [{ affectedRows?: number }])?.[0]?.affectedRows ?? 0);
}

function asDate(value: unknown) {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

async function appendTransition(tx: any, input: {
  authorizationId: string;
  fromState: ConsumptionChargeAuthorizationState | null;
  toState: ConsumptionChargeAuthorizationState;
  actorUserId: number;
  reason: string;
  reinforcedConfirmation?: boolean;
}) {
  const id = crypto.randomUUID();
  const payload = JSON.stringify({ ...input, changedAt: new Date().toISOString() });
  await tx.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, payloadJson,
      occurredAt, processedAt, createdAt, updatedAt
    ) VALUES (
      ${id}, 'usage-governance-admin', ${`consumption-charge-transition:${id}`},
      'consumption_charge_authorization_transition', 'processed', ${payload},
      NOW(), NOW(), NOW(), NOW()
    )
  `);
}

export async function createConsumptionChargeAuthorizationDraft(input: {
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
  const db = await requireDb();
  await db.transaction(async tx => {
    await tx.execute(sql`
      INSERT INTO billingConsumptionChargeAuthorizations (
        id,state,policyVersion,reason,pricingJson,affectedPlansJson,effectiveFrom,
        communicationAt,noRetroactive,rollbackJson,authorizedByUserId
      ) VALUES (
        ${input.id},'draft',${input.policyVersion},${input.reason},${JSON.stringify(input.pricing)},
        ${JSON.stringify(input.affectedPlans)},${input.effectiveFrom},${input.communicationAt},true,
        ${JSON.stringify(input.rollback)},${input.actorUserId}
      )
    `);
    await appendTransition(tx, {
      authorizationId: input.id,
      fromState: null,
      toState: "draft",
      actorUserId: input.actorUserId,
      reason: input.reason,
    });
  });
}

export async function transitionConsumptionChargeAuthorization(input: {
  id: string;
  toState: ConsumptionChargeAuthorizationState;
  actorUserId: number;
  reason: string;
  reinforcedConfirmation?: boolean;
}) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [row] = resultRows<Row>(await tx.execute(sql`
      SELECT id,state,effectiveFrom,communicationAt,noRetroactive
      FROM billingConsumptionChargeAuthorizations
      WHERE id=${input.id}
      LIMIT 1 FOR UPDATE
    `));
    if (!row) throw new Error("consumption_charge_authorization_not_found");
    const fromState = String(row.state) as ConsumptionChargeAuthorizationState;
    if (!ALLOWED[fromState]?.includes(input.toState)) throw new Error("consumption_charge_transition_invalid");

    if (input.toState === "active") {
      if (input.reinforcedConfirmation !== true) throw new Error("consumption_charge_reinforced_confirmation_required");
      const now = new Date();
      if (asDate(row.communicationAt).getTime() > now.getTime()) throw new Error("consumption_charge_prior_communication_incomplete");
      if (asDate(row.effectiveFrom).getTime() <= now.getTime()) throw new Error("consumption_charge_retroactive_activation_forbidden");
      if (!(row.noRetroactive === true || row.noRetroactive === 1 || row.noRetroactive === "1")) {
        throw new Error("consumption_charge_retroactive_activation_forbidden");
      }
    }

    const result = input.toState === "revoked"
      ? await tx.execute(sql`
          UPDATE billingConsumptionChargeAuthorizations
          SET state='revoked',revokedAt=NOW(),revokedByUserId=${input.actorUserId},revokeReason=${input.reason}
          WHERE id=${input.id} AND state=${fromState}
        `)
      : await tx.execute(sql`
          UPDATE billingConsumptionChargeAuthorizations
          SET state=${input.toState}
          WHERE id=${input.id} AND state=${fromState}
        `);
    if (affectedRows(result) !== 1) throw new Error("consumption_charge_transition_conflict");
    await appendTransition(tx, {
      authorizationId: input.id,
      fromState,
      toState: input.toState,
      actorUserId: input.actorUserId,
      reason: input.reason,
      reinforcedConfirmation: input.reinforcedConfirmation,
    });
    return { id: input.id, state: input.toState };
  });
}

export async function listConsumptionChargeAuthorizations(limit = 100) {
  const db = await requireDb();
  const authorizations = resultRows<Row>(await db.execute(sql`
    SELECT id,state,policyVersion,reason,pricingJson,affectedPlansJson,effectiveFrom,
      communicationAt,noRetroactive,rollbackJson,authorizedByUserId,revokedByUserId,revokedAt,
      revokeReason,createdAt
    FROM billingConsumptionChargeAuthorizations
    ORDER BY createdAt DESC
    LIMIT ${limit}
  `));
  const transitions = resultRows<Row>(await db.execute(sql`
    SELECT payloadJson,createdAt
    FROM billingProviderEvents
    WHERE provider='usage-governance-admin'
      AND eventType='consumption_charge_authorization_transition'
    ORDER BY createdAt DESC
    LIMIT ${Math.max(limit * 10, 200)}
  `));
  const byId = new Map<string, Array<Record<string, unknown>>>();
  for (const transition of transitions) {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(String(transition.payloadJson ?? "{}")); } catch { payload = {}; }
    const id = String(payload.authorizationId ?? "");
    if (!id) continue;
    const list = byId.get(id) ?? [];
    list.push({ ...payload, createdAt: transition.createdAt });
    byId.set(id, list);
  }
  return authorizations.map(row => ({
    id: String(row.id),
    state: String(row.state) as ConsumptionChargeAuthorizationState,
    policyVersion: String(row.policyVersion),
    reason: String(row.reason),
    pricing: row.pricingJson,
    affectedPlans: row.affectedPlansJson,
    effectiveFrom: asDate(row.effectiveFrom),
    communicationAt: asDate(row.communicationAt),
    noRetroactive: row.noRetroactive === true || row.noRetroactive === 1 || row.noRetroactive === "1",
    rollback: row.rollbackJson,
    authorizedByUserId: Number(row.authorizedByUserId),
    revokedByUserId: row.revokedByUserId == null ? null : Number(row.revokedByUserId),
    revokedAt: row.revokedAt == null ? null : asDate(row.revokedAt),
    revokeReason: row.revokeReason == null ? null : String(row.revokeReason),
    createdAt: asDate(row.createdAt),
    transitions: byId.get(String(row.id)) ?? [],
  }));
}
