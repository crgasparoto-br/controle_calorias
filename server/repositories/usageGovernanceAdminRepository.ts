import { sql } from "drizzle-orm";
import { getDb } from "../db";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("usage_governance_persistence_unavailable");
  return db;
}

export async function createAllowanceGrant(input: { id:string; subjectType:string; subjectId:string; grantType:string; additionalUnits?:number|null; reason:string; startsAt:Date; endsAt:Date; actorUserId:number }) {
  const db=await requireDb();
  await db.execute(sql`INSERT INTO billingUsageAllowanceGrants (id,subjectType,subjectId,grantType,additionalUnits,reason,startsAt,endsAt,state,createdByUserId) VALUES (${input.id},${input.subjectType},${input.subjectId},${input.grantType},${input.additionalUnits??null},${input.reason},${input.startsAt},${input.endsAt},'active',${input.actorUserId})`);
}

export async function revokeAllowanceGrant(id:string, actorUserId:number) {
  const db=await requireDb();
  await db.execute(sql`UPDATE billingUsageAllowanceGrants SET state='revoked',revokedAt=NOW(),revokedByUserId=${actorUserId} WHERE id=${id} AND state='active'`);
}

export async function createAbuseCase(input:{id:string;subjectUserId:number;sponsorUserId?:number|null;signals:string[];evidence:Record<string,number|string|boolean|null>;actorUserId:number}) {
  const db=await requireDb();
  await db.execute(sql`INSERT INTO billingUsageAbuseCases (id,subjectUserId,sponsorUserId,state,signalsJson,sanitizedEvidenceJson,openedByUserId) VALUES (${input.id},${input.subjectUserId},${input.sponsorUserId??null},'open',${JSON.stringify(input.signals)},${JSON.stringify(input.evidence)},${input.actorUserId})`);
}

export async function approveAbuseReview(input:{id:string;reviewerUserId:number;outcome:string;reason:string;impact:Record<string,unknown>;systemFailuresExcluded:boolean;legitimateGrowthReviewed:boolean}) {
  const db=await requireDb();
  await db.execute(sql`UPDATE billingUsageAbuseCases SET state='reviewed',reviewedByUserId=${input.reviewerUserId},reviewOutcome=${input.outcome},reviewReason=${input.reason},impactJson=${JSON.stringify(input.impact)},systemFailuresExcluded=${input.systemFailuresExcluded},legitimateGrowthReviewed=${input.legitimateGrowthReviewed},reviewedAt=NOW() WHERE id=${input.id} AND state='open'`);
}

export async function createLimitation(input:{id:string;abuseCaseId:string;subjectUserId:number;operations:string[];reason:string;startsAt:Date;endsAt:Date;emergencySecurity:boolean;approvedByUserId:number;secondApprovedByUserId?:number|null;communicatedAt?:Date|null;appealOfferedAt?:Date|null}) {
  const db=await requireDb();
  await db.execute(sql`INSERT INTO billingUsageLimitations (id,abuseCaseId,subjectUserId,operationsJson,reason,startsAt,endsAt,emergencySecurity,approvedByUserId,secondApprovedByUserId,communicatedAt,appealOfferedAt,state) VALUES (${input.id},${input.abuseCaseId},${input.subjectUserId},${JSON.stringify(input.operations)},${input.reason},${input.startsAt},${input.endsAt},${input.emergencySecurity},${input.approvedByUserId},${input.secondApprovedByUserId??null},${input.communicatedAt??null},${input.appealOfferedAt??null},'active')`);
}

export async function revokeLimitation(id:string, actorUserId:number, reason:string) {
  const db=await requireDb();
  await db.execute(sql`UPDATE billingUsageLimitations SET state='revoked',revokedAt=NOW(),revokedByUserId=${actorUserId},revokeReason=${reason} WHERE id=${id} AND state='active'`);
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
