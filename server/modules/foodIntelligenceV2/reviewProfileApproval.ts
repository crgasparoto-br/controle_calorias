import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { z } from "zod";
import {
  foodEvidence, foodNutritionProfiles, foodVariants,
} from "../../../drizzle/food-intelligence-v2-schema";
import { foods } from "../../../drizzle/schema";
import { FOOD_CONTRACT_LIMITS } from "./contracts";

const id = z.number().int().min(1).max(2_147_483_647);
const digest = z.string().regex(/^[a-f0-9]{64}$/);

export const profileApprovalTarget = z.strictObject({
  artifactType: z.literal("nutrition_profile"),
  artifactId: z.string().regex(/^[1-9][0-9]{0,9}$/).refine(value => id.safeParse(Number(value)).success),
  revision: id,
  contentHash: digest,
});

export const profileApprovalEvidence = z.array(z.strictObject({ id, contentHash: digest }))
  .min(1).max(FOOD_CONTRACT_LIMITS.collection)
  .refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length);

type Tx = Parameters<Parameters<MySql2Database["transaction"]>[0]>[0];
type Target = z.infer<typeof profileApprovalTarget>;
type Evidence = z.infer<typeof profileApprovalEvidence>;
const proofSchema = z.strictObject({
  actorUserId: id,
  caseId: id,
  reviewCycle: id,
  stateVersion: id,
  target: profileApprovalTarget,
  sourceId: id,
  variantId: id,
  sourceVersion: z.string().min(1).max(80),
  evidence: profileApprovalEvidence,
  policyVersion: z.string().min(1).max(100),
});
type EvidenceScope = z.infer<typeof proofSchema>;

// Unwired. An approved authority must verify relevance, exact source
// revision, permitted access, and sanitized evidence in this transaction.
// SQL existence, an ID, or a generic source license is not such proof.
export type LockProfileApprovalEvidence = (
  read: Pick<Tx, "select">,
  scope: Readonly<Omit<EvidenceScope, "target" | "evidence">> & {
    readonly target: Readonly<Target>;
    readonly evidence: readonly Readonly<Evidence[number]>[];
  }
) => Promise<EvidenceScope | null>;

function identicalProof(left: EvidenceScope, right: EvidenceScope): boolean {
  // Reparse in the same fixed field order before byte comparison.
  return JSON.stringify(proofSchema.parse(left)) === JSON.stringify(proofSchema.parse(right));
}

export async function lockReviewedProfileApproval(
  tx: Tx,
  lockEvidence: LockProfileApprovalEvidence,
  command: Omit<EvidenceScope, "variantId" | "sourceId" | "sourceVersion">,
): Promise<(() => Promise<void>) | null> {
  const profiles = foodNutritionProfiles;
  const profileGuard = and(
    eq(profiles.id, Number(command.target.artifactId)),
    eq(profiles.version, command.target.revision),
    eq(profiles.contentHash, command.target.contentHash),
    eq(profiles.status, "pending_review"),
    isNull(profiles.currentSlot), isNull(profiles.validFrom), isNull(profiles.validTo),
    isNull(profiles.verifiedAt),
  );
  const [profile] = await tx.select({
    variantId: profiles.foodVariantId, sourceId: profiles.sourceId,
    sourceVersion: profiles.sourceVersion, contentHash: profiles.contentHash,
  }).from(profiles)
    .innerJoin(foodVariants, eq(foodVariants.id, profiles.foodVariantId))
    .innerJoin(foods, eq(foods.id, foodVariants.foodId))
    .where(and(profileGuard, eq(foods.scope, "global"), isNull(foods.ownerUserId)))
    .limit(1).for("update");
  // Reject aliases admitted by a case-insensitive SQL collation as well.
  if (!profile?.sourceVersion?.trim() || profile.contentHash !== command.target.contentHash) return null;
  const evidence = command.evidence.toSorted((a, b) => a.id - b.id);
  const now = sql`CURRENT_TIMESTAMP`;
  const rows = await tx.select({ id: foodEvidence.id, contentHash: foodEvidence.contentHash })
    .from(foodEvidence).where(and(
      inArray(foodEvidence.id, evidence.map(entry => entry.id)),
      eq(foodEvidence.foodVariantId, profile.variantId),
      eq(foodEvidence.sourceId, profile.sourceId),
      isNull(foodEvidence.ownerUserId),
      lte(foodEvidence.capturedAt, now),
      or(isNull(foodEvidence.retentionUntil), gt(foodEvidence.retentionUntil, now)),
    )).orderBy(foodEvidence.id).for("update");
  if (rows.length !== evidence.length || rows.some((row, index) =>
    row.id !== evidence[index].id || row.contentHash !== evidence[index].contentHash)) return null;
  const scope: EvidenceScope = {
    ...command, evidence,
    variantId: profile.variantId, sourceId: profile.sourceId, sourceVersion: profile.sourceVersion,
  };
  const proof = proofSchema.safeParse(await lockEvidence(
    Object.freeze({ select: tx.select.bind(tx) }),
    Object.freeze({
      ...scope,
      target: Object.freeze({ ...scope.target }),
      evidence: Object.freeze(evidence.map(entry => Object.freeze({ ...entry }))),
    }),
  ));
  if (!proof.success || !identicalProof(proof.data, scope)) return null;

  return async () => {
    // Verify without publication: never write slot, validity, nutrition,
    // source metadata, predecessor/successor, variant or serving data.
    const [result] = await tx.update(profiles).set({ status: "verified", verifiedAt: now })
      .where(profileGuard);
    if (result?.affectedRows !== 1) throw new Error("Locked profile revision changed");
  };
}
