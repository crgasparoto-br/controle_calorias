import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import { requireDb, resultRows } from "../../repositories/billingRepositorySupport";
import type { z } from "zod";
import type {
  billingRolloutGateDecisionSchema,
  billingRolloutIncidentSchema,
  billingRolloutPauseSchema,
  billingRolloutPhaseSchema,
  billingRolloutRollbackSchema,
  billingRolloutSnapshotSchema,
} from "./billingRolloutAdminSchemas";

type Row = Record<string, unknown>;
type Phase = z.infer<typeof billingRolloutPhaseSchema>;
type SnapshotInput = z.infer<typeof billingRolloutSnapshotSchema>;
type GateInput = z.infer<typeof billingRolloutGateDecisionSchema>;
type PauseInput = z.infer<typeof billingRolloutPauseSchema>;
type IncidentInput = z.infer<typeof billingRolloutIncidentSchema>;
type RollbackInput = z.infer<typeof billingRolloutRollbackSchema>;

const ENFORCED_PHASES = new Set<Phase>(["enforced_10", "enforced_25", "enforced_50", "enforced_100"]);
const HARD_BLOCKERS = new Set([
  "duplicate_charge",
  "improper_activation",
  "improper_block",
  "data_loss",
  "sensitive_exposure",
]);

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function jsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function dateOrNull(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function selectDeterministicRolloutCohort(input: {
  candidateUserIds: number[];
  percentage: number;
  ruleVersion: string;
  snapshotKey: string;
}) {
  const unique = Array.from(new Set(input.candidateUserIds)).sort((a, b) => a - b);
  const ranked = unique
    .map(userId => ({
      userId,
      rank: crypto.createHash("sha256").update(`${input.ruleVersion}:${input.snapshotKey}:${userId}`).digest("hex"),
    }))
    .sort((a, b) => a.rank.localeCompare(b.rank) || a.userId - b.userId);
  const count = input.percentage <= 0 ? 0 : Math.ceil((ranked.length * input.percentage) / 100);
  return ranked.slice(0, count).map(item => item.userId).sort((a, b) => a - b);
}

export function rolloutAdvanceBlockers(input: {
  phase: Phase;
  resumeAfterIncident: boolean;
  reinforcedConfirmation: boolean;
  metrics: GateInput["metrics"];
  openIncidents: Array<{ severity: string; type: string }>;
}) {
  const blockers: string[] = [];
  if (input.metrics.processedWithin5mBps < 9500) blockers.push("Menos de 95% dos eventos foram processados em até 5 minutos.");
  if (input.metrics.reconciledWithin30mBps < 10000) blockers.push("Há eventos fora da janela de reconciliação de 30 minutos.");
  if (input.metrics.financialDivergenceBps >= 50) blockers.push("Divergência financeira não está abaixo de 0,5%.");
  if (input.metrics.internalNotificationsPersistedBps < 10000) blockers.push("Nem todas as notificações internas essenciais foram persistidas.");
  if (input.openIncidents.some(item => HARD_BLOCKERS.has(item.type))) blockers.push("Existe incidente absoluto que reprova a etapa independentemente da taxa.");
  if (input.openIncidents.some(item => item.severity === "critical" || item.severity === "high")) blockers.push("Existe incidente crítico ou alto aberto.");
  if ((ENFORCED_PHASES.has(input.phase) || input.resumeAfterIncident) && !input.reinforcedConfirmation) blockers.push("Esta decisão exige confirmação reforçada.");
  return blockers;
}

async function appendEvent(eventType: string, providerEventId: string, payload: Record<string, unknown>) {
  const db = await requireDb(getDb);
  const id = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, occurredAt, processedAt, payloadJson, createdAt, updatedAt
    ) VALUES (
      ${id}, 'billing-admin-rollout', ${providerEventId}, ${eventType}, 'processed', NOW(), NOW(), ${JSON.stringify(payload)}, NOW(), NOW()
    )
  `);
  return { id, ...payload };
}

async function loadEvents(limit = 1000) {
  const db = await requireDb(getDb);
  return resultRows<Row>(await db.execute(sql`
    SELECT id, providerEventId, eventType, status, payloadJson, occurredAt, processedAt, createdAt
    FROM billingProviderEvents
    WHERE provider='billing-admin-rollout'
    ORDER BY createdAt DESC
    LIMIT ${limit}
  `));
}

export async function getBillingRolloutAdminOverview() {
  const events = await loadEvents();
  const incidents = events
    .filter(row => row.eventType === "rollout_incident")
    .map(row => ({ ...jsonObject(row.payloadJson), recordedAt: dateOrNull(row.createdAt) }));
  const latestIncidentById = new Map<string, Record<string, unknown>>();
  for (const item of incidents) {
    const id = String(item.incidentId ?? "");
    if (id && !latestIncidentById.has(id)) latestIncidentById.set(id, item);
  }
  const openIncidents = Array.from(latestIncidentById.values()).filter(item => item.status === "open");
  const latestGate = events.find(row => row.eventType === "rollout_gate_decision");
  const gatePayload = latestGate ? jsonObject(latestGate.payloadJson) : null;
  const latestAdvance = events.find(row => row.eventType === "rollout_gate_decision" && jsonObject(row.payloadJson).decision === "advance");
  const advancePayload = latestAdvance ? jsonObject(latestAdvance.payloadJson) : null;
  const snapshots = events
    .filter(row => row.eventType === "rollout_cohort_snapshot")
    .slice(0, 30)
    .map(row => ({ ...jsonObject(row.payloadJson), recordedAt: dateOrNull(row.createdAt) }));
  const controls = events
    .filter(row => ["rollout_pause_control", "rollout_rollback"].includes(String(row.eventType)))
    .slice(0, 30)
    .map(row => ({ eventType: String(row.eventType), ...jsonObject(row.payloadJson), recordedAt: dateOrNull(row.createdAt) }));
  return {
    runtimeAccessMode: process.env.BILLING_ACCESS_MODE?.trim().toLowerCase() === "enforced" ? "enforced" as const : "open_access" as const,
    currentApprovedPhase: advancePayload?.phase ? String(advancePayload.phase) : "fake",
    latestGate: gatePayload ? { ...gatePayload, recordedAt: dateOrNull(latestGate?.createdAt) } : null,
    snapshots,
    openIncidents,
    recentControls: controls,
    guarantees: {
      noAutomaticProgression: true,
      controlPlaneDoesNotCreateCharges: true,
      rollbackPreservesFinancialFacts: true,
      openAccessSafeDefault: true,
    },
  };
}

export async function createBillingRolloutSnapshot(input: SnapshotInput & { actorUserId: number }) {
  const selectedUserIds = selectDeterministicRolloutCohort(input);
  const providerEventId = `cohort:${input.phase}:${input.snapshotKey}`;
  const db = await requireDb(getDb);
  const existingBefore = resultRows<Row>(await db.execute(sql`
    SELECT payloadJson FROM billingProviderEvents
    WHERE provider='billing-admin-rollout' AND providerEventId=${providerEventId}
    LIMIT 1
  `))[0];
  const payload = {
    phase: input.phase,
    snapshotKey: input.snapshotKey,
    ruleVersion: input.ruleVersion,
    criterion: input.criterion,
    percentage: input.percentage,
    candidateUserIds: Array.from(new Set(input.candidateUserIds)).sort((a, b) => a - b),
    selectedUserIds,
    plannedPopulation: input.candidateUserIds.length,
    effectivePopulation: selectedUserIds.length,
    actorUserId: input.actorUserId,
    reason: input.reason,
    createdAt: new Date().toISOString(),
  };
  if (!existingBefore) {
    await db.execute(sql`
      INSERT IGNORE INTO billingProviderEvents (
        id, provider, providerEventId, eventType, status, occurredAt, processedAt, payloadJson, createdAt, updatedAt
      ) VALUES (
        ${crypto.randomUUID()}, 'billing-admin-rollout', ${providerEventId}, 'rollout_cohort_snapshot', 'processed', NOW(), NOW(), ${JSON.stringify(payload)}, NOW(), NOW()
      )
    `);
  }
  const canonical = resultRows<Row>(await db.execute(sql`
    SELECT payloadJson FROM billingProviderEvents
    WHERE provider='billing-admin-rollout' AND providerEventId=${providerEventId}
    LIMIT 1
  `))[0];
  if (!canonical) throw new Error("billing_rollout_snapshot_persist_failed");
  {
    const persisted = jsonObject(canonical.payloadJson);
    const previousCandidates = jsonArray(persisted.candidateUserIds).map(Number).sort((a, b) => a - b);
    const currentCandidates = Array.from(new Set(input.candidateUserIds)).sort((a, b) => a - b);
    if (JSON.stringify(previousCandidates) !== JSON.stringify(currentCandidates) || persisted.ruleVersion !== input.ruleVersion || Number(persisted.percentage) !== input.percentage || persisted.criterion !== input.criterion) {
      throw new Error("billing_rollout_snapshot_immutable");
    }
    return { idempotent: Boolean(existingBefore), ...persisted };
  }
}

export async function recordBillingRolloutIncident(input: IncidentInput & { actorUserId: number }) {
  return appendEvent("rollout_incident", `incident:${input.incidentId}:${crypto.randomUUID()}`, {
    ...input,
    actorUserId: input.actorUserId,
    recordedAt: new Date().toISOString(),
  });
}

export async function recordBillingRolloutGateDecision(input: GateInput & { actorUserId: number }) {
  const overview = await getBillingRolloutAdminOverview();
  const blockers = rolloutAdvanceBlockers({
    phase: input.phase,
    resumeAfterIncident: input.resumeAfterIncident,
    reinforcedConfirmation: input.reinforcedConfirmation,
    metrics: input.metrics,
    openIncidents: overview.openIncidents.map(item => ({ severity: String(item.severity ?? ""), type: String(item.type ?? "") })),
  });
  if (input.decision === "advance" && blockers.length) throw new Error("billing_rollout_gate_blocked");
  return appendEvent("rollout_gate_decision", `gate:${input.phase}:${crypto.randomUUID()}`, {
    ...input,
    actorUserId: input.actorUserId,
    blockers,
    recordedAt: new Date().toISOString(),
  });
}

export async function setBillingRolloutPause(input: PauseInput & { actorUserId: number }) {
  if (!input.paused && !input.reinforcedConfirmation) throw new Error("billing_rollout_resume_confirmation_required");
  return appendEvent("rollout_pause_control", `pause:${input.phase}:${crypto.randomUUID()}`, {
    ...input,
    actorUserId: input.actorUserId,
    recordedAt: new Date().toISOString(),
  });
}

export async function recordBillingRolloutRollback(input: RollbackInput & { actorUserId: number }) {
  return appendEvent("rollout_rollback", `rollback:${input.phase}:${crypto.randomUUID()}`, {
    ...input,
    targetAccessMode: "open_access",
    preserveFinancialFacts: true,
    preserveSubscriptions: true,
    preserveCapacity: true,
    actorUserId: input.actorUserId,
    recordedAt: new Date().toISOString(),
  });
}
