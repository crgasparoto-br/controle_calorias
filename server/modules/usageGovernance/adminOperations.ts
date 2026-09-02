import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import { requireDb, resultRows } from "../../repositories/billingRepositorySupport";
import {
  calculateVariableCostRatioBps,
  economicHealthBand,
  runUsageRetention,
} from "./service";

type Row = Record<string, unknown>;

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

function jsonArray(value: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dateOrNull(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthOrdinal(value: Date) {
  return value.getUTCFullYear() * 12 + value.getUTCMonth();
}

function decorateEconomicRows(rows: Row[]) {
  const normalized = rows.map(row => ({
    competenceMonth: new Date(String(row.competenceMonth)),
    payerUserId: Number(row.payerUserId),
    subscriptionId: row.subscriptionId == null ? null : String(row.subscriptionId),
    productCode: row.productCode == null ? null : String(row.productCode),
    versionCode: row.versionCode == null ? null : String(row.versionCode),
    billingCycle: row.billingCycle == null ? null : String(row.billingCycle),
    currency: String(row.currency),
    recognizedContractRevenueMinor: Number(row.recognizedContractRevenueMinor ?? 0),
    discountMinor: Number(row.discountMinor ?? 0),
    couponMinor: Number(row.couponMinor ?? 0),
    creditMinor: Number(row.creditMinor ?? 0),
    refundMinor: Number(row.refundMinor ?? 0),
    chargebackMinor: Number(row.chargebackMinor ?? 0),
    taxMinor: Number(row.taxMinor ?? 0),
    receiptFeeMinor: Number(row.receiptFeeMinor ?? 0),
    financialCostMinor: Number(row.financialCostMinor ?? 0),
    netEconomicRevenueMinor: Number(row.netEconomicRevenueMinor ?? 0),
    variableCostMicros: Number(row.variableCostMicros ?? 0),
    variableCostRatioBps: row.variableCostRatioBps == null ? null : Number(row.variableCostRatioBps),
    measurementCoverageBps: Number(row.measurementCoverageBps ?? 0),
    ruleVersion: String(row.ruleVersion ?? "unknown"),
    updatedAt: dateOrNull(row.updatedAt),
  }));
  const groups = new Map<string, typeof normalized>();
  for (const row of normalized) {
    const key = `${row.payerUserId}|${row.subscriptionId ?? ""}|${row.versionCode ?? ""}|${row.currency}`;
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  const rolling = new Map<(typeof normalized)[number], number | null>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.competenceMonth.getTime() - b.competenceMonth.getTime());
    for (let index = 0; index < group.length; index += 1) {
      const window = group.slice(Math.max(0, index - 2), index + 1);
      const consecutive = window.length === 3
        && monthOrdinal(window[1].competenceMonth) === monthOrdinal(window[0].competenceMonth) + 1
        && monthOrdinal(window[2].competenceMonth) === monthOrdinal(window[1].competenceMonth) + 1;
      const comparable = window.every(item => item.variableCostRatioBps !== null);
      rolling.set(group[index], consecutive && comparable
        ? calculateVariableCostRatioBps(
            window.reduce((sum, item) => sum + item.variableCostMicros, 0),
            window.reduce((sum, item) => sum + item.netEconomicRevenueMinor, 0),
          )
        : null);
    }
  }
  return normalized
    .map(row => ({
      ...row,
      health: economicHealthBand(row.variableCostRatioBps),
      rolling3MonthVariableCostRatioBps: rolling.get(row) ?? null,
      rolling3MonthHealth: economicHealthBand(rolling.get(row) ?? null),
      indirectCostStatus: "not_attributed" as const,
    }))
    .sort((a, b) => b.competenceMonth.getTime() - a.competenceMonth.getTime());
}

export async function getUsageGovernanceAdminOverview(limit = 100) {
  const db = await requireDb(getDb);
  const [cases, limitations, appeals, holds, retention, reprocesses, economic] = await Promise.all([
    db.execute(sql`SELECT * FROM billingUsageAbuseCases ORDER BY createdAt DESC LIMIT ${limit}`),
    db.execute(sql`SELECT * FROM billingUsageLimitations ORDER BY createdAt DESC LIMIT ${Math.min(limit * 3, 500)}`),
    db.execute(sql`SELECT * FROM billingUsageLimitationAppeals ORDER BY submittedAt DESC LIMIT ${Math.min(limit * 3, 500)}`),
    db.execute(sql`SELECT * FROM billingUsageLegalHolds ORDER BY createdAt DESC LIMIT ${limit}`),
    db.execute(sql`SELECT * FROM billingUsageRetentionAudit ORDER BY runAt DESC LIMIT ${limit}`),
    db.execute(sql`
      SELECT payloadJson, status, occurredAt, processedAt, createdAt
      FROM billingProviderEvents
      WHERE provider='usage-governance-admin' AND eventType IN ('abuse_case_assignment','retention_reprocess')
      ORDER BY createdAt DESC LIMIT ${Math.min(limit * 5, 1000)}
    `),
    db.execute(sql`SELECT * FROM billingEconomicMonthlyAggregates ORDER BY competenceMonth DESC, updatedAt DESC LIMIT ${Math.min(limit * 4, 500)}`),
  ]);
  const controlRows = resultRows<Row>(reprocesses);
  const assignments = new Map<string, { assignedToUserId: number; reason: string; actorUserId: number; assignedAt: Date | null }>();
  const retentionReprocesses: Array<Record<string, unknown>> = [];
  for (const row of controlRows) {
    const payload = jsonObject(row.payloadJson);
    if (payload.caseId && !assignments.has(String(payload.caseId))) {
      assignments.set(String(payload.caseId), {
        assignedToUserId: Number(payload.assignedToUserId),
        reason: String(payload.reason ?? ""),
        actorUserId: Number(payload.actorUserId),
        assignedAt: dateOrNull(row.createdAt),
      });
    }
    if (payload.sourceAuditId) {
      retentionReprocesses.push({
        sourceAuditId: String(payload.sourceAuditId),
        reason: String(payload.reason ?? ""),
        actorUserId: Number(payload.actorUserId),
        resultAuditId: payload.resultAuditId == null ? null : String(payload.resultAuditId),
        status: String(row.status),
        createdAt: dateOrNull(row.createdAt),
        processedAt: dateOrNull(row.processedAt),
      });
    }
  }
  return {
    abuseCases: resultRows<Row>(cases).map(row => ({
      id: String(row.id),
      subjectUserId: Number(row.subjectUserId),
      sponsorUserId: row.sponsorUserId == null ? null : Number(row.sponsorUserId),
      state: String(row.state),
      signals: jsonArray(row.signalsJson).map(String),
      evidence: jsonObject(row.sanitizedEvidenceJson),
      systemFailuresExcluded: Boolean(row.systemFailuresExcluded),
      legitimateGrowthReviewed: Boolean(row.legitimateGrowthReviewed),
      impact: jsonObject(row.impactJson),
      openedByUserId: Number(row.openedByUserId),
      reviewedByUserId: row.reviewedByUserId == null ? null : Number(row.reviewedByUserId),
      reviewOutcome: row.reviewOutcome == null ? null : String(row.reviewOutcome),
      reviewReason: row.reviewReason == null ? null : String(row.reviewReason),
      appealStatus: row.appealStatus == null ? null : String(row.appealStatus),
      appealResolution: row.appealResolution == null ? null : String(row.appealResolution),
      assignment: assignments.get(String(row.id)) ?? null,
      createdAt: dateOrNull(row.createdAt),
      reviewedAt: dateOrNull(row.reviewedAt),
      closedAt: dateOrNull(row.closedAt),
    })),
    limitations: resultRows<Row>(limitations).map(row => ({
      id: String(row.id),
      abuseCaseId: String(row.abuseCaseId),
      subjectUserId: Number(row.subjectUserId),
      operations: jsonArray(row.operationsJson).map(String),
      reason: String(row.reason),
      startsAt: dateOrNull(row.startsAt),
      endsAt: dateOrNull(row.endsAt),
      emergencySecurity: Boolean(row.emergencySecurity),
      lifecycleKind: String(row.lifecycleKind),
      approvedByUserId: Number(row.approvedByUserId),
      secondApprovedByUserId: row.secondApprovedByUserId == null ? null : Number(row.secondApprovedByUserId),
      communicatedAt: dateOrNull(row.communicatedAt),
      appealOfferedAt: dateOrNull(row.appealOfferedAt),
      state: String(row.state),
      revokedAt: dateOrNull(row.revokedAt),
      revokedByUserId: row.revokedByUserId == null ? null : Number(row.revokedByUserId),
      revokeReason: row.revokeReason == null ? null : String(row.revokeReason),
    })),
    appeals: resultRows<Row>(appeals).map(row => ({
      id: String(row.id),
      limitationId: String(row.limitationId),
      abuseCaseId: String(row.abuseCaseId),
      subjectUserId: Number(row.subjectUserId),
      rationale: String(row.rationale),
      state: String(row.state),
      result: row.result == null ? null : String(row.result),
      reviewRationale: row.reviewRationale == null ? null : String(row.reviewRationale),
      submittedAt: dateOrNull(row.submittedAt),
      reviewedAt: dateOrNull(row.reviewedAt),
    })),
    legalHolds: resultRows<Row>(holds).map(row => ({
      id: String(row.id), scopeType: String(row.scopeType), scopeId: String(row.scopeId), reason: String(row.reason),
      startsAt: dateOrNull(row.startsAt), endsAt: dateOrNull(row.endsAt), revokedAt: dateOrNull(row.revokedAt),
      createdByUserId: Number(row.createdByUserId), revokedByUserId: row.revokedByUserId == null ? null : Number(row.revokedByUserId),
    })),
    retentionAudits: resultRows<Row>(retention).map(row => ({
      id: String(row.id), runAt: dateOrNull(row.runAt), detailedCutoff: dateOrNull(row.detailedCutoff),
      dailyCutoff: dateOrNull(row.dailyCutoff), monthlyCutoff: dateOrNull(row.monthlyCutoff), ruleVersion: String(row.ruleVersion),
      status: String(row.status), detail: row.detail == null ? null : String(row.detail),
    })),
    retentionReprocesses,
    economicRows: decorateEconomicRows(resultRows<Row>(economic)).slice(0, limit),
    generatedAt: new Date(),
  };
}

export async function assignUsageAbuseCase(input: {
  caseId: string;
  assignedToUserId: number;
  reason: string;
  actorUserId: number;
}) {
  const db = await requireDb(getDb);
  const [abuseCase] = resultRows<Row>(await db.execute(sql`SELECT id FROM billingUsageAbuseCases WHERE id=${input.caseId} LIMIT 1`));
  if (!abuseCase) throw new Error("usage_abuse_case_not_found");
  const id = crypto.randomUUID();
  const payload = JSON.stringify(input);
  await db.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, payloadJson,
      occurredAt, processedAt, createdAt, updatedAt
    ) VALUES (
      ${id}, 'usage-governance-admin', ${`abuse-case-assignment:${id}`}, 'abuse_case_assignment',
      'processed', ${payload}, NOW(), NOW(), NOW(), NOW()
    )
  `);
  return { caseId: input.caseId, assignedToUserId: input.assignedToUserId };
}

export async function reprocessUsageRetention(input: {
  sourceAuditId: string;
  reason: string;
  actorUserId: number;
}) {
  const db = await requireDb(getDb);
  const [source] = resultRows<Row>(await db.execute(sql`SELECT id FROM billingUsageRetentionAudit WHERE id=${input.sourceAuditId} LIMIT 1`));
  if (!source) throw new Error("usage_retention_audit_not_found");
  const id = crypto.randomUUID();
  const payload = JSON.stringify({ ...input, requestedAt: new Date().toISOString() });
  await db.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, payloadJson,
      occurredAt, createdAt, updatedAt
    ) VALUES (
      ${id}, 'usage-governance-admin', ${`retention-reprocess:${id}`}, 'retention_reprocess',
      'received', ${payload}, NOW(), NOW(), NOW()
    )
  `);
  try {
    await runUsageRetention(new Date());
    const [latest] = resultRows<Row>(await db.execute(sql`SELECT id FROM billingUsageRetentionAudit ORDER BY runAt DESC LIMIT 1`));
    const resultAuditId = latest?.id == null ? null : String(latest.id);
    await db.execute(sql`
      UPDATE billingProviderEvents
      SET status='processed', processedAt=NOW(),
          payloadJson=JSON_SET(COALESCE(payloadJson, JSON_OBJECT()), '$.resultAuditId', ${resultAuditId}),
          updatedAt=NOW()
      WHERE id=${id}
    `);
    return { reprocessed: true as const, sourceAuditId: input.sourceAuditId, resultAuditId };
  } catch (error) {
    await db.execute(sql`UPDATE billingProviderEvents SET status='failed', processedAt=NOW(), updatedAt=NOW() WHERE id=${id}`).catch(() => undefined);
    throw error;
  }
}
