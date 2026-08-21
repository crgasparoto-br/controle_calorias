import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { resultRows } from "./billingRepositorySupport";

async function requireDb() {
  const db = await getDb();
  if (!db || typeof (db as { execute?: unknown }).execute !== "function") {
    throw new Error("usage_governance_persistence_unavailable");
  }
  return db as NonNullable<typeof db>;
}

function asDate(value: unknown) {
  return value instanceof Date ? value : new Date(String(value));
}

export type UsageEventInput = {
  id: string;
  idempotencyKey: string;
  beneficiaryUserId: number;
  patientUserId?: number | null;
  sponsorUserId?: number | null;
  payerUserId: number;
  subscriptionId?: string | null;
  productCode?: string | null;
  versionCode?: string | null;
  billingCycle?: string | null;
  accessSource: string;
  operation: string;
  channel: string;
  provider?: string | null;
  model?: string | null;
  unitType: string;
  unitCount: number;
  estimatedCostMicros?: number | null;
  effectiveCostMicros?: number | null;
  currency?: string | null;
  eventState: string;
  attemptRole: string;
  retryRootKey?: string | null;
  correlationId: string;
  environment: string;
  ruleVersion: string;
  metadata?: Record<string, unknown> | null;
  occurredAt: Date;
};

export async function recordUsageEvent(input: UsageEventInput) {
  const db = await requireDb();
  const canonical = JSON.stringify({
    idempotencyKey: input.idempotencyKey, beneficiaryUserId: input.beneficiaryUserId,
    patientUserId: input.patientUserId ?? null, sponsorUserId: input.sponsorUserId ?? null,
    payerUserId: input.payerUserId, subscriptionId: input.subscriptionId ?? null,
    productCode: input.productCode ?? null, versionCode: input.versionCode ?? null,
    billingCycle: input.billingCycle ?? null, accessSource: input.accessSource,
    operation: input.operation, channel: input.channel, provider: input.provider ?? null,
    model: input.model ?? null, unitType: input.unitType, unitCount: input.unitCount,
    estimatedCostMicros: input.estimatedCostMicros ?? null, effectiveCostMicros: input.effectiveCostMicros ?? null,
    currency: input.currency ?? null, eventState: input.eventState, attemptRole: input.attemptRole,
    retryRootKey: input.retryRootKey ?? null, correlationId: input.correlationId,
    environment: input.environment, ruleVersion: input.ruleVersion,
    metadata: input.metadata ?? null,
  });
  const payloadFingerprint = crypto.createHash("sha256").update(canonical).digest("hex");
  const result = await db.execute(sql`
    INSERT IGNORE INTO billingUsageEvents (
      id, idempotencyKey, payloadFingerprint, beneficiaryUserId, patientUserId, sponsorUserId,
      payerUserId, subscriptionId, productCode, versionCode, billingCycle,
      accessSource, operation, channel, provider, model, unitType, unitCount,
      estimatedCostMicros, effectiveCostMicros, currency, eventState, attemptRole,
      retryRootKey, correlationId, environment, ruleVersion, metadataJson,
      occurredAt, competenceDate
    ) VALUES (
      ${input.id}, ${input.idempotencyKey}, ${payloadFingerprint}, ${input.beneficiaryUserId},
      ${input.patientUserId ?? null}, ${input.sponsorUserId ?? null},
      ${input.payerUserId}, ${input.subscriptionId ?? null},
      ${input.productCode ?? null}, ${input.versionCode ?? null},
      ${input.billingCycle ?? null}, ${input.accessSource}, ${input.operation},
      ${input.channel}, ${input.provider ?? null}, ${input.model ?? null},
      ${input.unitType}, ${input.unitCount}, ${input.estimatedCostMicros ?? null},
      ${input.effectiveCostMicros ?? null}, ${input.currency ?? null},
      ${input.eventState}, ${input.attemptRole}, ${input.retryRootKey ?? null},
      ${input.correlationId}, ${input.environment}, ${input.ruleVersion},
      ${input.metadata ? JSON.stringify(input.metadata) : null}, ${input.occurredAt},
      DATE(${input.occurredAt})
    )
  `);
  const affectedRows = Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
  if (affectedRows > 0) return { created: true };
  const existing = resultRows<Record<string, unknown>>(await db.execute(sql`
    SELECT payloadFingerprint FROM billingUsageEvents WHERE idempotencyKey=${input.idempotencyKey} LIMIT 1
  `))[0];
  if (!existing || String(existing.payloadFingerprint) !== payloadFingerprint) throw new Error("usage_event_idempotency_conflict");
  return { created: false };
}

export async function getActiveUsageLimitation(userId: number, now: Date) {
  const db = await requireDb();
  const row = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT id, abuseCaseId, subjectUserId, operationsJson, reason, startsAt,
             endsAt, emergencySecurity, approvedByUserId, secondApprovedByUserId
      FROM billingUsageLimitations
      WHERE subjectUserId = ${userId}
        AND state = 'active'
        AND startsAt <= ${now}
        AND endsAt > ${now}
      ORDER BY emergencySecurity DESC, createdAt DESC
      LIMIT 10
    `),
  );
  return row.map(value => ({
    id: String(value.id),
    abuseCaseId: String(value.abuseCaseId),
    subjectUserId: Number(value.subjectUserId),
    operations: Array.isArray(value.operationsJson)
      ? value.operationsJson.map(String)
      : JSON.parse(String(value.operationsJson ?? "[]")) as string[],
    reason: String(value.reason),
    startsAt: asDate(value.startsAt),
    endsAt: asDate(value.endsAt),
    emergencySecurity: Boolean(value.emergencySecurity),
    approvedByUserId: Number(value.approvedByUserId),
    secondApprovedByUserId: value.secondApprovedByUserId == null ? null : Number(value.secondApprovedByUserId),
  }));
}

export async function recordEconomicFact(input: {
  id: string;
  idempotencyKey: string;
  supersedesIdempotencyKey?: string | null;
  payloadFingerprint: string;
  subscriptionId?: string | null;
  payerUserId: number;
  productCode?: string | null;
  versionCode?: string | null;
  billingCycle?: string | null;
  factType: string;
  amountMinor: number;
  currency: string;
  valueKind: "estimated" | "effective";
  competenceStart: Date;
  competenceEnd: Date;
  effectiveAt: Date;
  ruleVersion: string;
  reason?: string | null;
  actorUserId?: number | null;
  correlationId: string;
  metadata?: Record<string, unknown> | null;
}) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const existingBeforeInsert = resultRows<Record<string, unknown>>(
      await tx.execute(sql`
        SELECT id, payloadFingerprint
        FROM billingEconomicFacts
        WHERE idempotencyKey = ${input.idempotencyKey}
        LIMIT 1 FOR UPDATE
      `),
    )[0];
    if (existingBeforeInsert) {
      if (String(existingBeforeInsert.payloadFingerprint) !== input.payloadFingerprint) {
        throw new Error("economic_fact_idempotency_conflict");
      }
      return { created: false, id: String(existingBeforeInsert.id), superseded: false };
    }
    const predecessorKey = input.supersedesIdempotencyKey ?? null;
    const predecessor = predecessorKey
      ? resultRows<Record<string, unknown>>(
          await tx.execute(sql`
            SELECT id, payerUserId, subscriptionId, productCode, versionCode,
                   billingCycle, factType, currency, valueKind, competenceStart,
                   competenceEnd, supersededAt
            FROM billingEconomicFacts
            WHERE idempotencyKey = ${predecessorKey}
              AND invalidatedAt IS NULL
            LIMIT 1 FOR UPDATE
          `),
        )[0]
      : null;

    if (predecessorKey) {
      const same = input.valueKind === "effective"
        && predecessor
        && String(predecessor.valueKind) === "estimated"
        && predecessor.supersededAt == null
        && Number(predecessor.payerUserId) === input.payerUserId
        && String(predecessor.subscriptionId ?? "") === String(input.subscriptionId ?? "")
        && String(predecessor.productCode ?? "") === String(input.productCode ?? "")
        && String(predecessor.versionCode ?? "") === String(input.versionCode ?? "")
        && String(predecessor.billingCycle ?? "") === String(input.billingCycle ?? "")
        && String(predecessor.factType) === input.factType
        && String(predecessor.currency) === input.currency
        && asDate(predecessor.competenceStart).toISOString().slice(0, 10) === input.competenceStart.toISOString().slice(0, 10)
        && asDate(predecessor.competenceEnd).toISOString().slice(0, 10) === input.competenceEnd.toISOString().slice(0, 10);
      if (!same) throw new Error("economic_fact_supersession_mismatch");
    }

    const result = await tx.execute(sql`
      INSERT IGNORE INTO billingEconomicFacts (
        id, idempotencyKey, supersedesFactId, payloadFingerprint, subscriptionId,
        payerUserId, productCode, versionCode, billingCycle, factType, amountMinor,
        currency, valueKind, competenceStart, competenceEnd, effectiveAt,
        ruleVersion, reason, actorUserId, correlationId, metadataJson
      ) VALUES (
        ${input.id}, ${input.idempotencyKey}, ${predecessor ? String(predecessor.id) : null},
        ${input.payloadFingerprint}, ${input.subscriptionId ?? null}, ${input.payerUserId},
        ${input.productCode ?? null}, ${input.versionCode ?? null}, ${input.billingCycle ?? null},
        ${input.factType}, ${input.amountMinor}, ${input.currency}, ${input.valueKind},
        DATE(${input.competenceStart}), DATE(${input.competenceEnd}), ${input.effectiveAt},
        ${input.ruleVersion}, ${input.reason ?? null}, ${input.actorUserId ?? null},
        ${input.correlationId}, ${input.metadata ? JSON.stringify(input.metadata) : null}
      )
    `);
    const inserted = Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) > 0;
    if (!inserted) {
      const existing = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT id, payloadFingerprint
          FROM billingEconomicFacts
          WHERE idempotencyKey = ${input.idempotencyKey}
          LIMIT 1 FOR UPDATE
        `),
      )[0];
      if (existing && String(existing.payloadFingerprint) === input.payloadFingerprint) {
        return { created: false, id: String(existing.id), superseded: false };
      }
      throw new Error("economic_fact_idempotency_conflict");
    }

    if (predecessor) {
      const updated = await tx.execute(sql`
        UPDATE billingEconomicFacts
        SET supersededByFactId = ${input.id}, supersededAt = ${input.effectiveAt}
        WHERE id = ${String(predecessor.id)} AND supersededAt IS NULL
      `);
      if (Number((updated as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) !== 1) {
        throw new Error("economic_fact_supersession_conflict");
      }
    }
    return { created: true, id: input.id, superseded: Boolean(predecessor) };
  });
}

export async function listEconomicFactsPage(input: { from: Date; to: Date; payerUserId?: number; cursor?: string | null; limit?: number }) {
  const db = await requireDb();
  return resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT * FROM billingEconomicFacts
      WHERE invalidatedAt IS NULL
        AND supersededAt IS NULL
        AND competenceStart < DATE(${input.to})
        AND competenceEnd >= DATE(${input.from})
        ${input.payerUserId === undefined ? sql`` : sql`AND payerUserId = ${input.payerUserId}`}
        ${input.cursor ? sql`AND id > ${input.cursor}` : sql``}
      ORDER BY id
      LIMIT ${Math.min(Math.max(input.limit ?? 5000, 1), 10000)}
    `),
  );
}

export async function listUsageEventsPage(input: { from: Date; to: Date; userId?: number; cursor?: string | null; limit?: number }) {
  const db = await requireDb();
  return resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT * FROM billingUsageEvents
      WHERE invalidatedAt IS NULL
        AND occurredAt >= ${input.from}
        AND occurredAt < ${input.to}
        ${input.userId === undefined ? sql`` : sql`AND beneficiaryUserId = ${input.userId}`}
        ${input.cursor ? sql`AND id > ${input.cursor}` : sql``}
      ORDER BY id
      LIMIT ${Math.min(Math.max(input.limit ?? 5000, 1), 10000)}
    `),
  );
}

export async function refreshUsageDailyAggregates(from: Date, to: Date, ruleVersion: string) {
  const db = await requireDb();
  await db.transaction(async tx => {
    await tx.execute(sql`
      DELETE FROM billingUsageDailyAggregates
      WHERE usageDate >= DATE(${from}) AND usageDate < DATE(${to})
    `);
    await tx.execute(sql`
      INSERT INTO billingUsageDailyAggregates (
        aggregateKey, usageDate, beneficiaryUserId, patientUserId, sponsorUserId, payerUserId,
        subscriptionId, productCode, versionCode, billingCycle, accessSource,
        operation, channel, provider, model, currency, eventCount, unitCount,
        successCount, failureCount, retryCount, estimatedCostMicros,
        effectiveCostMicros, recognizedCostMicros, unpricedCount, ruleVersion, updatedAt
      )
      SELECT
        SHA2(CONCAT_WS('|', DATE(occurredAt), beneficiaryUserId, COALESCE(patientUserId, ''), COALESCE(sponsorUserId, ''),
          payerUserId, COALESCE(subscriptionId, ''), COALESCE(versionCode, ''), accessSource,
          operation, channel, COALESCE(provider, ''), COALESCE(model, ''), COALESCE(currency, '')), 256),
        DATE(occurredAt), beneficiaryUserId, patientUserId, sponsorUserId, payerUserId, subscriptionId,
        productCode, versionCode, billingCycle, accessSource, operation, channel, provider,
        model, currency, COUNT(*), SUM(unitCount),
        SUM(CASE WHEN eventState = 'success' THEN 1 ELSE 0 END),
        SUM(CASE WHEN eventState = 'success' THEN 0 ELSE 1 END),
        SUM(CASE WHEN attemptRole = 'retry' THEN 1 ELSE 0 END),
        SUM(COALESCE(estimatedCostMicros, 0)), SUM(COALESCE(effectiveCostMicros, 0)),
        SUM(COALESCE(effectiveCostMicros, estimatedCostMicros, 0)),
        SUM(CASE WHEN estimatedCostMicros IS NULL AND effectiveCostMicros IS NULL THEN 1 ELSE 0 END),
        ${ruleVersion}, NOW()
      FROM billingUsageEvents
      WHERE invalidatedAt IS NULL AND occurredAt >= ${from} AND occurredAt < ${to}
      GROUP BY DATE(occurredAt), beneficiaryUserId, patientUserId, sponsorUserId, payerUserId, subscriptionId,
        productCode, versionCode, billingCycle, accessSource, operation, channel, provider, model, currency
    `);
  });
}

export async function upsertMonthlyEconomicAggregate(input: {
  aggregateKey: string;
  competenceMonth: Date;
  payerUserId: number;
  subscriptionId?: string | null;
  productCode?: string | null;
  versionCode?: string | null;
  billingCycle?: string | null;
  currency: string;
  recognizedContractRevenueMinor: number;
  discountMinor: number;
  couponMinor: number;
  creditMinor: number;
  refundMinor: number;
  chargebackMinor: number;
  taxMinor: number;
  receiptFeeMinor: number;
  financialCostMinor: number;
  netEconomicRevenueMinor: number;
  variableCostMicros: number;
  variableCostRatioBps: number | null;
  estimatedFactCount: number;
  effectiveFactCount: number;
  measurementCoverageBps: number;
  ruleVersion: string;
}) {
  const db = await requireDb();
  await db.execute(sql`
    INSERT INTO billingEconomicMonthlyAggregates (
      aggregateKey, competenceMonth, payerUserId, subscriptionId, productCode,
      versionCode, billingCycle, currency, recognizedContractRevenueMinor,
      discountMinor, couponMinor, creditMinor, refundMinor, chargebackMinor,
      taxMinor, receiptFeeMinor, financialCostMinor, netEconomicRevenueMinor,
      variableCostMicros, variableCostRatioBps, estimatedFactCount,
      effectiveFactCount, measurementCoverageBps, ruleVersion, updatedAt
    ) VALUES (
      ${input.aggregateKey}, DATE(${input.competenceMonth}), ${input.payerUserId},
      ${input.subscriptionId ?? null}, ${input.productCode ?? null}, ${input.versionCode ?? null},
      ${input.billingCycle ?? null}, ${input.currency}, ${input.recognizedContractRevenueMinor},
      ${input.discountMinor}, ${input.couponMinor}, ${input.creditMinor}, ${input.refundMinor},
      ${input.chargebackMinor}, ${input.taxMinor}, ${input.receiptFeeMinor},
      ${input.financialCostMinor}, ${input.netEconomicRevenueMinor}, ${input.variableCostMicros},
      ${input.variableCostRatioBps}, ${input.estimatedFactCount}, ${input.effectiveFactCount},
      ${input.measurementCoverageBps}, ${input.ruleVersion}, NOW()
    ) ON DUPLICATE KEY UPDATE
      recognizedContractRevenueMinor = VALUES(recognizedContractRevenueMinor),
      discountMinor = VALUES(discountMinor), couponMinor = VALUES(couponMinor),
      creditMinor = VALUES(creditMinor), refundMinor = VALUES(refundMinor),
      chargebackMinor = VALUES(chargebackMinor), taxMinor = VALUES(taxMinor),
      receiptFeeMinor = VALUES(receiptFeeMinor), financialCostMinor = VALUES(financialCostMinor),
      netEconomicRevenueMinor = VALUES(netEconomicRevenueMinor), variableCostMicros = VALUES(variableCostMicros),
      variableCostRatioBps = VALUES(variableCostRatioBps), estimatedFactCount = VALUES(estimatedFactCount),
      effectiveFactCount = VALUES(effectiveFactCount), measurementCoverageBps = VALUES(measurementCoverageBps),
      ruleVersion = VALUES(ruleVersion), updatedAt = NOW()
  `);
}

export async function listMonthlyEconomicAggregates(input: { from: Date; to: Date; payerUserId?: number }) {
  const db = await requireDb();
  return resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT * FROM billingEconomicMonthlyAggregates
      WHERE competenceMonth >= DATE(${input.from}) AND competenceMonth < DATE(${input.to})
        ${input.payerUserId === undefined ? sql`` : sql`AND payerUserId = ${input.payerUserId}`}
      ORDER BY competenceMonth, payerUserId, currency
    `),
  );
}

export async function listUsageDailyAggregatesPage(input: {
  from: Date;
  to: Date;
  userId?: number;
  cursor?: string | null;
  limit?: number;
}) {
  const db = await requireDb();
  return resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT * FROM billingUsageDailyAggregates
      WHERE usageDate >= DATE(${input.from}) AND usageDate < DATE(${input.to})
        ${input.userId === undefined ? sql`` : sql`AND beneficiaryUserId = ${input.userId}`}
        ${input.cursor ? sql`AND aggregateKey > ${input.cursor}` : sql``}
      ORDER BY aggregateKey
      LIMIT ${Math.min(Math.max(input.limit ?? 5000, 1), 10000)}
    `),
  );
}

export async function getAbuseCase(id: string) {
  const db = await requireDb();
  return resultRows<Record<string, unknown>>(
    await db.execute(sql`SELECT * FROM billingUsageAbuseCases WHERE id=${id} LIMIT 1`),
  )[0] ?? null;
}

export async function purgeUsageGovernanceRetention(input: {
  now: Date;
  detailedCutoff: Date;
  dailyCutoff: Date;
  monthlyCutoff: Date;
  ruleVersion: string;
  auditId: string;
}) {
  const db = await requireDb();
  await db.transaction(async tx => {
    await tx.execute(sql`
      DELETE e FROM billingUsageEvents e
      LEFT JOIN billingUsageLegalHolds h
        ON h.revokedAt IS NULL AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
       AND (h.scopeType='global' OR (h.scopeType='user' AND h.scopeId=CAST(e.beneficiaryUserId AS CHAR))
            OR (h.scopeType='subscription' AND h.scopeId=e.subscriptionId))
      WHERE e.occurredAt < ${input.detailedCutoff} AND e.legalHold=false AND h.id IS NULL
    `);
    await tx.execute(sql`
      DELETE FROM billingUsageDailyAggregates
      WHERE usageDate < DATE(${input.dailyCutoff})
    `);
    await tx.execute(sql`
      DELETE m FROM billingEconomicMonthlyAggregates m
      LEFT JOIN billingUsageLegalHolds h
        ON h.revokedAt IS NULL AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
       AND (h.scopeType='global' OR (h.scopeType='subscription' AND h.scopeId=m.subscriptionId))
      WHERE m.competenceMonth < DATE(${input.monthlyCutoff}) AND h.id IS NULL
    `);
    await tx.execute(sql`
      INSERT INTO billingUsageRetentionAudit (
        id, runAt, detailedCutoff, dailyCutoff, monthlyCutoff, ruleVersion, status, detail
      ) VALUES (
        ${input.auditId}, ${input.now}, ${input.detailedCutoff}, DATE(${input.dailyCutoff}),
        DATE(${input.monthlyCutoff}), ${input.ruleVersion}, 'success',
        'automatic retention completed with active legal holds preserved'
      )
    `);
  });
}
