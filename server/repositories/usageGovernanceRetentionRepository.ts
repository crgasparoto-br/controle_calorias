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
  governanceCutoff: Date;
  ruleVersion: string;
  auditId: string;
}) {
  const db = await requireDb();
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`
        UPDATE billingUsageLimitations
        SET state='expired'
        WHERE state='active' AND endsAt <= ${input.now}
      `);
      await tx.execute(sql`
        UPDATE billingUsageAbuseCases
        SET state='dismissed', closedAt=COALESCE(closedAt, reviewedAt)
        WHERE reviewOutcome='dismissed' AND closedAt IS NULL
      `);
      await tx.execute(sql`
        UPDATE billingUsageAbuseCases c
        JOIN (
          SELECT abuseCaseId, MAX(COALESCE(revokedAt, endsAt)) AS terminalAt
          FROM billingUsageLimitations
          GROUP BY abuseCaseId
        ) lifecycle ON lifecycle.abuseCaseId=c.id
        SET c.state='closed', c.closedAt=COALESCE(c.closedAt, lifecycle.terminalAt)
        WHERE c.reviewOutcome='limitation_approved'
          AND c.closedAt IS NULL
          AND lifecycle.terminalAt <= ${input.now}
          AND NOT EXISTS (
            SELECT 1 FROM billingUsageLimitations active
            WHERE active.abuseCaseId=c.id AND active.state='active' AND active.endsAt>${input.now}
          )
          AND NOT EXISTS (
            SELECT 1 FROM billingUsageLimitationAppeals appeal
            WHERE appeal.abuseCaseId=c.id AND appeal.state='pending'
          )
      `);
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
        DELETE p FROM billingUsagePolicies p
        LEFT JOIN billingUsageLegalHolds h
          ON h.revokedAt IS NULL AND h.startsAt <= ${input.now} AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
         AND (h.scopeType='global' OR (h.scopeType=p.scopeType AND h.scopeId=p.scopeId))
        WHERE p.revokedAt < ${input.governanceCutoff} AND h.id IS NULL
      `);
      await tx.execute(sql`
        DELETE g FROM billingUsageAllowanceGrants g
        LEFT JOIN billingUsageLegalHolds h
          ON h.revokedAt IS NULL AND h.startsAt <= ${input.now} AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
         AND (h.scopeType='global'
              OR (h.scopeType='user' AND g.subjectType IN ('user','professional') AND h.scopeId=g.subjectId))
        WHERE COALESCE(g.revokedAt, g.endsAt) < ${input.governanceCutoff} AND h.id IS NULL
      `);
      await tx.execute(sql`
        DELETE appeal FROM billingUsageLimitationAppeals appeal
        LEFT JOIN billingUsageAbuseCases c ON c.id=appeal.abuseCaseId
        LEFT JOIN billingUsageLegalHolds h
          ON h.revokedAt IS NULL AND h.startsAt <= ${input.now} AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
         AND (h.scopeType='global' OR (h.scopeType='user' AND h.scopeId IN (CAST(appeal.subjectUserId AS CHAR), CAST(c.sponsorUserId AS CHAR))))
        WHERE COALESCE(appeal.reviewedAt, appeal.submittedAt) < ${input.governanceCutoff} AND h.id IS NULL
      `);
      await tx.execute(sql`
        DELETE l FROM billingUsageLimitations l
        LEFT JOIN billingUsageAbuseCases c ON c.id=l.abuseCaseId
        LEFT JOIN billingUsageLegalHolds h
          ON h.revokedAt IS NULL AND h.startsAt <= ${input.now} AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
         AND (h.scopeType='global' OR (h.scopeType='user' AND h.scopeId IN (CAST(l.subjectUserId AS CHAR), CAST(c.sponsorUserId AS CHAR))))
        WHERE COALESCE(l.revokedAt, l.endsAt) < ${input.governanceCutoff} AND h.id IS NULL
      `);
      await tx.execute(sql`
        DELETE c FROM billingUsageAbuseCases c
        LEFT JOIN billingUsageLegalHolds h
          ON h.revokedAt IS NULL AND h.startsAt <= ${input.now} AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
         AND (h.scopeType='global' OR (h.scopeType='user' AND h.scopeId IN (CAST(c.subjectUserId AS CHAR), CAST(c.sponsorUserId AS CHAR))))
        WHERE c.closedAt < ${input.governanceCutoff} AND h.id IS NULL
      `);
      await tx.execute(sql`
        DELETE a FROM billingConsumptionChargeAuthorizations a
        LEFT JOIN billingUsageLegalHolds h
          ON h.revokedAt IS NULL AND h.startsAt <= ${input.now} AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
         AND h.scopeType='global'
        WHERE a.revokedAt < ${input.governanceCutoff} AND h.id IS NULL
      `);
      await tx.execute(sql`
        DELETE r FROM billingUsageCostReconciliations r
        LEFT JOIN billingUsageEvents e ON e.id=r.usageEventId
        LEFT JOIN billingUsageLegalHolds h
          ON h.revokedAt IS NULL AND h.startsAt <= ${input.now} AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
         AND (h.scopeType='global'
              OR (h.scopeType='user' AND h.scopeId IN (CAST(e.beneficiaryUserId AS CHAR), CAST(e.payerUserId AS CHAR), CAST(e.sponsorUserId AS CHAR)))
              OR (h.scopeType='subscription' AND h.scopeId=e.subscriptionId))
        WHERE r.createdAt < ${input.governanceCutoff} AND h.id IS NULL
      `);
      await tx.execute(sql`
        DELETE a FROM billingUsageRetentionAudit a
        LEFT JOIN billingUsageLegalHolds h
          ON h.revokedAt IS NULL AND h.startsAt <= ${input.now} AND (h.endsAt IS NULL OR h.endsAt > ${input.now})
         AND h.scopeType='global'
        WHERE a.runAt < ${input.governanceCutoff} AND h.id IS NULL
      `);
      await tx.execute(sql`
        DELETE held FROM billingUsageLegalHolds held
        LEFT JOIN billingUsageLegalHolds globalHold
          ON globalHold.id <> held.id AND globalHold.revokedAt IS NULL
         AND globalHold.startsAt <= ${input.now} AND (globalHold.endsAt IS NULL OR globalHold.endsAt > ${input.now})
         AND globalHold.scopeType='global'
        WHERE COALESCE(held.revokedAt, held.endsAt) < ${input.governanceCutoff} AND globalHold.id IS NULL
      `);
      await tx.execute(sql`
        INSERT INTO billingUsageRetentionAudit (
          id, runAt, detailedCutoff, dailyCutoff, monthlyCutoff, ruleVersion, status, detail
        ) VALUES (
          ${input.auditId}, ${input.now}, ${input.detailedCutoff}, DATE(${input.dailyCutoff}),
          DATE(${input.monthlyCutoff}), ${input.ruleVersion}, 'success',
          'automatic retention completed across detail, aggregates and five-year governance audit records'
        )
      `);
    });
  } catch (error) {
    await db.execute(sql`
      INSERT INTO billingUsageRetentionAudit (
        id, runAt, detailedCutoff, dailyCutoff, monthlyCutoff, ruleVersion, status, detail
      ) VALUES (
        ${input.auditId}, ${input.now}, ${input.detailedCutoff}, DATE(${input.dailyCutoff}),
        DATE(${input.monthlyCutoff}), ${input.ruleVersion}, 'failed',
        'automatic retention failed before completion; manual review or audited reprocessing is required'
      )
      ON DUPLICATE KEY UPDATE
        status='failed',
        detail='automatic retention failed before completion; manual review or audited reprocessing is required'
    `).catch(() => undefined);
    throw error;
  }
}
