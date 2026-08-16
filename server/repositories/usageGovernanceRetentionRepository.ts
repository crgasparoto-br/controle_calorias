import { sql } from "drizzle-orm";
import { getDb } from "../db";

async function requireDb() {
  const db = await getDb();
  if (!db || typeof (db as { transaction?: unknown }).transaction !== "function") {
    throw new Error("usage_governance_persistence_unavailable");
  }
  return db as NonNullable<typeof db>;
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
        ON h.revokedAt IS NULL AND h.startsAt <= ${input.now} AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
       AND (h.scopeType='global'
            OR (h.scopeType='user' AND h.scopeId IN (CAST(e.beneficiaryUserId AS CHAR), CAST(e.payerUserId AS CHAR), CAST(e.sponsorUserId AS CHAR)))
            OR (h.scopeType='subscription' AND h.scopeId=e.subscriptionId))
      WHERE e.occurredAt < ${input.detailedCutoff} AND e.legalHold=false AND h.id IS NULL
    `);
    await tx.execute(sql`
      DELETE d FROM billingUsageDailyAggregates d
      LEFT JOIN billingUsageLegalHolds h
        ON h.revokedAt IS NULL AND h.startsAt <= ${input.now} AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
       AND (h.scopeType='global'
            OR (h.scopeType='user' AND h.scopeId IN (CAST(d.beneficiaryUserId AS CHAR), CAST(d.payerUserId AS CHAR), CAST(d.sponsorUserId AS CHAR)))
            OR (h.scopeType='subscription' AND h.scopeId=d.subscriptionId))
      WHERE d.usageDate < DATE(${input.dailyCutoff}) AND h.id IS NULL
    `);
    await tx.execute(sql`
      DELETE m FROM billingEconomicMonthlyAggregates m
      LEFT JOIN billingUsageLegalHolds h
        ON h.revokedAt IS NULL AND h.startsAt <= ${input.now} AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
       AND (h.scopeType='global'
            OR (h.scopeType='user' AND h.scopeId=CAST(m.payerUserId AS CHAR))
            OR (h.scopeType='subscription' AND h.scopeId=m.subscriptionId))
      WHERE m.competenceMonth < DATE(${input.monthlyCutoff}) AND h.id IS NULL
    `);
    await tx.execute(sql`
      INSERT INTO billingUsageRetentionAudit (
        id, runAt, detailedCutoff, dailyCutoff, monthlyCutoff, ruleVersion, status, detail
      ) VALUES (
        ${input.auditId}, ${input.now}, ${input.detailedCutoff}, DATE(${input.dailyCutoff}),
        DATE(${input.monthlyCutoff}), ${input.ruleVersion}, 'success',
        'automatic retention completed with active legal holds preserved across detail and aggregates'
      )
    `);
  });
}
