import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { resultRows } from "./billingRepositorySupport";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("usage_governance_persistence_unavailable");
  return db;
}

function jsonRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function createAllowanceGrant(input: { id:string; subjectType:string; subjectId:string; grantType:string; additionalUnits?:number|null; reason:string; startsAt:Date; endsAt:Date; actorUserId:number }) {
  const db=await requireDb();
  await db.execute(sql`INSERT INTO billingUsageAllowanceGrants (id,subjectType,subjectId,grantType,additionalUnits,reason,startsAt,endsAt,state,createdByUserId) VALUES (${input.id},${input.subjectType},${input.subjectId},${input.grantType},${input.additionalUnits??null},${input.reason},${input.startsAt},${input.endsAt},'active',${input.actorUserId})`);
}

export async function revokeAllowanceGrant(id:string, actorUserId:number) {
  const db=await requireDb();
  await db.execute(sql`UPDATE billingUsageAllowanceGrants SET state='revoked',revokedAt=NOW(),revokedByUserId=${actorUserId} WHERE id=${id} AND state='active'`);
}

export async function createAbuseCase(input:{id:string;subjectUserId:number;sponsorUserId?:number|null;signals:string[];evidence:Record<string,number|string|boolean|string[]|null>;actorUserId:number}) {
  const db=await requireDb();
  await db.execute(sql`INSERT INTO billingUsageAbuseCases (id,subjectUserId,sponsorUserId,state,signalsJson,sanitizedEvidenceJson,openedByUserId) VALUES (${input.id},${input.subjectUserId},${input.sponsorUserId??null},'open',${JSON.stringify(input.signals)},${JSON.stringify(input.evidence)},${input.actorUserId})`);
}

export async function approveAbuseReview(input:{id:string;reviewerUserId:number;outcome:string;reason:string;impact:Record<string,unknown>;systemFailuresExcluded:boolean;legitimateGrowthReviewed:boolean}) {
  const db=await requireDb();
  const result = await db.execute(sql`UPDATE billingUsageAbuseCases SET state=${input.outcome === "dismissed" ? "dismissed" : "reviewed"},reviewedByUserId=${input.reviewerUserId},reviewOutcome=${input.outcome},reviewReason=${input.reason},impactJson=${JSON.stringify(input.impact)},systemFailuresExcluded=${input.systemFailuresExcluded},legitimateGrowthReviewed=${input.legitimateGrowthReviewed},reviewedAt=NOW(),closedAt=${input.outcome === "dismissed" ? sql`NOW()` : null} WHERE id=${input.id} AND state='open'`);
  if (Number((result as unknown as [{affectedRows?:number}])[0]?.affectedRows ?? 0) !== 1) throw new Error("usage_abuse_case_not_open");
}

export async function createLimitation(input:{id:string;abuseCaseId:string;subjectUserId:number;operations:string[];reason:string;startsAt:Date;endsAt:Date;emergencySecurity:boolean;approvedByUserId:number;secondApprovedByUserId?:number|null;communicatedAt?:Date|null;appealOfferedAt?:Date|null}) {
  const db=await requireDb();
  return db.transaction(async tx => {
    const abuseCase = resultRows<Record<string,unknown>>(await tx.execute(sql`
      SELECT * FROM billingUsageAbuseCases WHERE id=${input.abuseCaseId} LIMIT 1 FOR UPDATE
    `))[0];
    if (!abuseCase || Number(abuseCase.subjectUserId) !== input.subjectUserId) throw new Error("usage_limitation_abuse_case_required");
    const prior = resultRows<Record<string,unknown>>(await tx.execute(sql`
      SELECT * FROM billingUsageLimitations WHERE abuseCaseId=${input.abuseCaseId} ORDER BY startsAt,id FOR UPDATE
    `));
    let lifecycleKind: "initial"|"extension"|"emergency";
    let originalApprover = input.approvedByUserId;
    let secondApprover: number|null = null;
    if (input.emergencySecurity) {
      if (prior.some(row => String(row.lifecycleKind) === "emergency" || Boolean(row.emergencySecurity))) throw new Error("usage_emergency_limit_already_applied");
      const evidence = jsonRecord(abuseCase.sanitizedEvidenceJson);
      const evidencedOperations = new Set(Array.isArray(evidence.affectedOperations)
        ? evidence.affectedOperations.map(String).map(operation => operation.trim()).filter(Boolean)
        : []);
      if (!evidencedOperations.size) throw new Error("usage_emergency_security_scope_required");
      if (!input.operations.every(operation => evidencedOperations.has(operation))) {
        throw new Error("usage_emergency_security_operation_not_evidenced");
      }
      lifecycleKind = "emergency";
    } else {
      if (String(abuseCase.reviewOutcome) !== "limitation_approved" || !Boolean(abuseCase.systemFailuresExcluded) || !Boolean(abuseCase.legitimateGrowthReviewed)) throw new Error("usage_limitation_human_review_required");
      const impact = typeof abuseCase.impactJson === "string" ? JSON.parse(abuseCase.impactJson) : (abuseCase.impactJson ?? {});
      const reviewedOperations = new Set(Array.isArray(impact.affectedOperations) ? impact.affectedOperations.map(String) : []);
      if (!input.operations.every(operation => reviewedOperations.has(operation))) throw new Error("usage_limitation_operation_not_reviewed");
      const normal = prior.filter(row => !Boolean(row.emergencySecurity));
      if (normal.length === 0) {
        lifecycleKind = "initial";
      } else if (normal.length === 1) {
        const initial = normal[0];
        if (String(initial.state) === "revoked" || initial.revokedAt != null) throw new Error("usage_limitation_extension_initial_not_active");
        if (new Date(String(initial.endsAt)).getTime() !== input.startsAt.getTime()) throw new Error("usage_limitation_extension_must_follow_initial");
        originalApprover = Number(initial.approvedByUserId);
        if (originalApprover === input.approvedByUserId) throw new Error("usage_limitation_second_admin_required");
        secondApprover = input.approvedByUserId;
        lifecycleKind = "extension";
      } else {
        throw new Error("usage_limitation_extension_limit_reached");
      }
    }
    await tx.execute(sql`INSERT INTO billingUsageLimitations (id,abuseCaseId,subjectUserId,operationsJson,reason,startsAt,endsAt,emergencySecurity,lifecycleKind,approvedByUserId,secondApprovedByUserId,communicatedAt,appealOfferedAt,state) VALUES (${input.id},${input.abuseCaseId},${input.subjectUserId},${JSON.stringify(input.operations)},${input.reason},${input.startsAt},${input.endsAt},${input.emergencySecurity},${lifecycleKind},${originalApprover},${secondApprover},${input.communicatedAt??null},${input.appealOfferedAt??null},'active')`);
    return { lifecycleKind, approvedByUserId: originalApprover, secondApprovedByUserId: secondApprover };
  });
}

export async function revokeLimitation(id:string, actorUserId:number, reason:string) {
  const db=await requireDb();
  await db.transaction(async tx => {
    const limitation = resultRows<Record<string,unknown>>(await tx.execute(sql`SELECT * FROM billingUsageLimitations WHERE id=${id} LIMIT 1`))[0];
    if (!limitation) throw new Error("usage_limitation_not_found");
    await tx.execute(sql`SELECT id FROM billingUsageAbuseCases WHERE id=${String(limitation.abuseCaseId)} LIMIT 1 FOR UPDATE`);
    await tx.execute(sql`SELECT id FROM billingUsageLimitations WHERE id=${id} LIMIT 1 FOR UPDATE`);
    const result=await tx.execute(sql`UPDATE billingUsageLimitations SET state='revoked',revokedAt=NOW(),revokedByUserId=${actorUserId},revokeReason=${reason} WHERE id=${id} AND state='active'`);
    if (Number((result as unknown as [{affectedRows?:number}])[0]?.affectedRows ?? 0) !== 1) throw new Error("usage_limitation_not_active");
    const remaining=resultRows<Record<string,unknown>>(await tx.execute(sql`SELECT id FROM billingUsageLimitations WHERE abuseCaseId=${String(limitation.abuseCaseId)} AND state='active' AND id<>${id} AND endsAt>NOW() LIMIT 1`));
    if (!remaining.length) await tx.execute(sql`UPDATE billingUsageAbuseCases SET state='closed',closedAt=NOW() WHERE id=${String(limitation.abuseCaseId)} AND closedAt IS NULL`);
  });
}

export async function submitLimitationAppeal(input:{id:string;limitationId:string;subjectUserId:number;rationale:string;submittedAt:Date}) {
  const db=await requireDb();
  return db.transaction(async tx=>{
    const limitation=resultRows<Record<string,unknown>>(await tx.execute(sql`SELECT * FROM billingUsageLimitations WHERE id=${input.limitationId} LIMIT 1 FOR UPDATE`))[0];
    if (!limitation || Number(limitation.subjectUserId)!==input.subjectUserId) throw new Error("usage_limitation_appeal_not_available");
    if (limitation.appealOfferedAt==null || String(limitation.state)!=="active") throw new Error("usage_limitation_appeal_not_available");
    const inserted=await tx.execute(sql`INSERT IGNORE INTO billingUsageLimitationAppeals (id,limitationId,abuseCaseId,subjectUserId,submittedByUserId,rationale,state,submittedAt) VALUES (${input.id},${input.limitationId},${String(limitation.abuseCaseId)},${input.subjectUserId},${input.subjectUserId},${input.rationale},'pending',${input.submittedAt})`);
    const created=Number((inserted as unknown as [{affectedRows?:number}])[0]?.affectedRows??0)===1;
    const appeal=created?{id:input.id,state:"pending"}:resultRows<Record<string,unknown>>(await tx.execute(sql`SELECT id,state FROM billingUsageLimitationAppeals WHERE limitationId=${input.limitationId} LIMIT 1`))[0];
    await tx.execute(sql`UPDATE billingUsageAbuseCases SET appealStatus='pending' WHERE id=${String(limitation.abuseCaseId)} AND closedAt IS NULL`);
    return {id:String(appeal.id),state:String(appeal.state),created};
  });
}

export async function reviewLimitationAppeal(input:{appealId:string;reviewerUserId:number;result:"approved"|"denied";rationale:string;reviewedAt:Date}) {
  const db=await requireDb();
  return db.transaction(async tx=>{
    const appeal=resultRows<Record<string,unknown>>(await tx.execute(sql`SELECT * FROM billingUsageLimitationAppeals WHERE id=${input.appealId} LIMIT 1 FOR UPDATE`))[0];
    if (!appeal || String(appeal.state)!=="pending") throw new Error("usage_limitation_appeal_not_pending");
    if (Number(appeal.submittedByUserId)===input.reviewerUserId) throw new Error("usage_limitation_appeal_reviewer_must_differ");
    const limitation=resultRows<Record<string,unknown>>(await tx.execute(sql`SELECT * FROM billingUsageLimitations WHERE id=${String(appeal.limitationId)} LIMIT 1 FOR UPDATE`))[0];
    await tx.execute(sql`SELECT id FROM billingUsageAbuseCases WHERE id=${String(appeal.abuseCaseId)} LIMIT 1 FOR UPDATE`);
    await tx.execute(sql`UPDATE billingUsageLimitationAppeals SET state='resolved',reviewedByUserId=${input.reviewerUserId},reviewRationale=${input.rationale},result=${input.result},reviewedAt=${input.reviewedAt} WHERE id=${input.appealId} AND state='pending'`);
    if (input.result==="approved" && limitation) {
      await tx.execute(sql`UPDATE billingUsageLimitations SET state='revoked',revokedAt=${input.reviewedAt},revokedByUserId=${input.reviewerUserId},revokeReason='appeal_approved' WHERE abuseCaseId=${String(appeal.abuseCaseId)} AND state='active'`);
      await tx.execute(sql`UPDATE billingUsageAbuseCases SET state='closed',appealStatus='approved',appealResolution=${input.rationale},closedAt=${input.reviewedAt} WHERE id=${String(appeal.abuseCaseId)}`);
    } else {
      await tx.execute(sql`UPDATE billingUsageAbuseCases SET appealStatus='denied',appealResolution=${input.rationale} WHERE id=${String(appeal.abuseCaseId)}`);
    }
    return {id:input.appealId,state:"resolved" as const,result:input.result,limitationReversed:input.result==="approved"};
  });
}

export async function createConsumptionChargeAuthorization(input:{id:string;policyVersion:string;reason:string;pricing:Record<string,unknown>;affectedPlans:string[];effectiveFrom:Date;communicationAt:Date;rollback:Record<string,unknown>;actorUserId:number}) {
  const db=await requireDb();
  await db.execute(sql`INSERT INTO billingConsumptionChargeAuthorizations (id,state,policyVersion,reason,pricingJson,affectedPlansJson,effectiveFrom,communicationAt,noRetroactive,rollbackJson,authorizedByUserId) VALUES (${input.id},'approved',${input.policyVersion},${input.reason},${JSON.stringify(input.pricing)},${JSON.stringify(input.affectedPlans)},${input.effectiveFrom},${input.communicationAt},true,${JSON.stringify(input.rollback)},${input.actorUserId})`);
}

export async function revokeConsumptionChargeAuthorization(id:string, actorUserId:number, reason:string) {
  const db=await requireDb();
  await db.execute(sql`UPDATE billingConsumptionChargeAuthorizations SET state='revoked',revokedAt=NOW(),revokedByUserId=${actorUserId},revokeReason=${reason} WHERE id=${id} AND state='approved'`);
}

export async function createLegalHold(input:{id:string;scopeType:string;scopeId:string;reason:string;startsAt:Date;endsAt?:Date|null;actorUserId:number}) {
  const db=await requireDb();
  const activeScopeKey=`${input.scopeType}:${input.scopeId}`;
  await db.execute(sql`INSERT INTO billingUsageLegalHolds (id,scopeType,scopeId,reason,startsAt,endsAt,activeScopeKey,createdByUserId) VALUES (${input.id},${input.scopeType},${input.scopeId},${input.reason},${input.startsAt},${input.endsAt??null},${activeScopeKey},${input.actorUserId})`);
}

export async function revokeLegalHold(id:string, actorUserId:number) {
  const db=await requireDb();
  await db.execute(sql`UPDATE billingUsageLegalHolds SET activeScopeKey=NULL,revokedAt=NOW(),revokedByUserId=${actorUserId} WHERE id=${id} AND revokedAt IS NULL`);
}
