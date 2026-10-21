/**
 * B2 controlled V1 -> V2 reconciliation entrypoint. Preview is default.
 * It never rewrites meals, deletes V1 records, auto-verifies profiles, nor
 * publishes an unreviewed variant into the active V2 read path.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { foodBrands, foodCatalog, foodSources, foods } from "../../../drizzle/schema";
import { normalizeFoodName } from "../../../scripts/import-foods/normalize_food_name";
import {
  foodNutritionProfiles, foodReviewCases, foodSourceReadGrants,
  foodVariantSources, foodVariants,
} from "../../../drizzle/food-intelligence-v2-schema";
import { canPublishGlobalKnowledge } from "./sourceGrants";
import {
  planLegacyKnowledgeReconciliation,
  type LegacyFoodCandidate,
} from "./legacyReconciliation";
import { getDb } from "../../db";

const hash = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
const MAX_SCAN = 10000;

export type FoodV2ReconciliationMode = "preview" | "stage";

/**
 * stage creates draft V2 variants/provisional profiles only for licensed,
 * traceable V1 food rows. Quarantine is represented by review cases.
 * The administrative review/promotion phase remains separate (#1309).
 */
export async function reconcileLegacyFoodKnowledge(mode: FoodV2ReconciliationMode = "preview") {
  const db = await getDb();
  if (!db) throw new Error("B2 reconciliation requires an available database");
  const [legacyFoods, legacyCatalog, grantedSources, brands] = await Promise.all([
    db.select().from(foods).limit(MAX_SCAN + 1),
    db.select().from(foodCatalog).limit(MAX_SCAN + 1),
    db.select({ source: foodSources, grant: foodSourceReadGrants })
      .from(foodSources)
      .innerJoin(foodSourceReadGrants, eq(foodSourceReadGrants.sourceId, foodSources.id)),
    db.select().from(foodBrands),
  ]);
  if (legacyFoods.length > MAX_SCAN || legacyCatalog.length > MAX_SCAN) {
    throw new Error("B2 reconciliation would be incomplete: dataset requires pagination");
  }

  const sourceMap = new Map(grantedSources.map(row => [row.source.id, row]));
  const byFoodId = new Map(legacyFoods.map(row => [row.id, row]));
  const brandIds = new Map(brands.map(row => [row.normalizedName, row.id]));
  const candidates: LegacyFoodCandidate[] = [
    ...legacyFoods.map(row => ({
      table: "foods" as const,
      id: row.id,
      foodId: row.id,
      name: row.name,
      brandName: row.brandName,
      brandId: row.brandName ? brandIds.get(normalizeFoodName(row.brandName)) ?? null : null,
      ownerUserId: row.ownerUserId,
      sourceId: row.sourceId,
      sourceVersion: row.sourceId ? (sourceMap.get(row.sourceId)?.source.version ?? null) : null,
      sourceCode: row.sourceFoodCode,
      canonicalKey: row.scope === "global" ? row.canonicalKey : null,
      validNutrition: [
        row.caloriesKcalPer100g, row.proteinGramsPer100g,
        row.carbsGramsPer100g, row.fatGramsPer100g,
      ].every(n => Number.isFinite(n) && n >= 0),
    })),
    ...legacyCatalog.map(row => ({
      table: "foodCatalog" as const,
      id: row.id,
      foodId: null, // no direct V1 foreign key to the canonical family
      name: row.name,
      brandName: row.brandName,
      brandId: row.brandName ? brandIds.get(normalizeFoodName(row.brandName)) ?? null : null,
      ownerUserId: row.createdByUserId,
      sourceId: null,
      sourceVersion: null,
      sourceCode: null,
      canonicalKey: null,
      validNutrition: [row.calories, row.protein, row.carbs, row.fat]
        .every(n => Number.isFinite(n) && n >= 0),
    })),
  ];
  const plan = planLegacyKnowledgeReconciliation(
    candidates,
    id => {
      const entry = sourceMap.get(id);
      return entry ? { grant: entry.grant, version: entry.source.version } : null;
    },
    new Date(),
  );
  if (mode === "preview") return plan;

  // Do not stage an inventory unless the operator has reviewed its full plan.
  // No input can bypass the per-source publication and version checks.
  await db.transaction(async tx => {
    for (const decision of plan.decisions) {
      const candidate = decision.source;
      const caseKey = "b2:" + hash([candidate.table, candidate.id]);
      const contentHash = hash([
        candidate.table, candidate.id, candidate.sourceId, candidate.sourceCode,
        candidate.canonicalKey, candidate.validNutrition,
      ]);
      if (candidate.ownerUserId !== null) continue; // personal records never enter global queue
      if (decision.action === "quarantined") {
        await tx.insert(foodReviewCases).values({
          caseKey, caseType: "legacy_reconciliation_quarantine",
          targetArtifactType: candidate.table, targetArtifactId: String(candidate.id),
          targetRevision: 1, targetContentHash: contentHash,
          proposedPayloadJson: JSON.stringify({
            source: candidate.table, sourceId: candidate.sourceId,
            reason: decision.reason,
          }),
          policyVersion: "food-v2-b2",
        }).onDuplicateKeyUpdate({ set: { lastSeenAt: new Date() } });
        continue;
      }
      if (decision.action === "merged") continue;
      const original = byFoodId.get(candidate.id);
      if (!original || candidate.sourceId === null ||
          candidate.sourceVersion === null || !candidate.sourceCode) {
        throw new Error("B2 reconciliation incomplete original lineage");
      }
      // Recheck while staging: preview permission must not be trusted later.
      const [currentGrant] = await tx.select({
        source: foodSources, grant: foodSourceReadGrants,
      }).from(foodSources)
        .innerJoin(foodSourceReadGrants, eq(foodSourceReadGrants.sourceId, foodSources.id))
        .where(eq(foodSources.id, candidate.sourceId)).limit(1);
      if (!currentGrant ||
          !canPublishGlobalKnowledge(currentGrant.grant, currentGrant.source.version, new Date()) ||
          currentGrant.source.version !== candidate.sourceVersion) {
        throw new Error("B2 source approval changed during reconciliation");
      }
      const variantType = original.brandName ? "branded" : "generic";
      // Never expose as ACTIVE or VERIFIED before independent review.
      await tx.insert(foodVariants).values({
        foodId: original.id,
        brandId: candidate.brandId ?? null,
        variantType,
        displayName: original.name,
        normalizedName: original.normalizedName,
        identityKey: decision.identityKey,
        status: "draft",
        governanceStatus: "provisional",
      }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
      const [variant] = await tx.select().from(foodVariants)
        .where(eq(foodVariants.identityKey, decision.identityKey)).limit(1);
      if (!variant || variant.foodId !== original.id) throw new Error("B2 variant identity conflict");

      const sourceIdentityKey = "b2:" + hash([candidate.sourceId, candidate.sourceVersion, candidate.sourceCode]);
      await tx.insert(foodVariantSources).values({
        foodVariantId: variant.id,
        sourceId: candidate.sourceId,
        sourceItemCode: candidate.sourceCode,
        sourceIdentityKey,
        status: "active",
      }).onDuplicateKeyUpdate({ set: { lastSeenAt: new Date() } });
      const [mapping] = await tx.select().from(foodVariantSources)
        .where(eq(foodVariantSources.sourceIdentityKey, sourceIdentityKey)).limit(1);
      if (!mapping || mapping.foodVariantId !== variant.id ||
          mapping.sourceId !== candidate.sourceId ||
          mapping.status !== "active") throw new Error("B2 source identity conflict");

      const nutrition = [
        original.caloriesKcalPer100g, original.proteinGramsPer100g,
        original.carbsGramsPer100g, original.fatGramsPer100g,
      ];
      const nutritionHash = hash([nutrition, candidate.sourceId, candidate.sourceVersion]);
      await tx.insert(foodNutritionProfiles).values({
        foodVariantId: variant.id,
        foodVariantSourceId: mapping.id,
        sourceId: candidate.sourceId,
        profileKey: decision.profileKey,
        version: 1,
        currentSlot: 1,
        status: "provisional",
        basisQuantity: 100,
        basisUnit: "g",
        caloriesKcal: nutrition[0], proteinG: nutrition[1],
        carbG: nutrition[2], fatG: nutrition[3],
        contentHash: nutritionHash,
      }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
      const [profile] = await tx.select().from(foodNutritionProfiles)
        .where(eq(foodNutritionProfiles.profileKey, decision.profileKey)).limit(1);
      if (!profile || profile.contentHash !== nutritionHash ||
          profile.foodVariantId !== variant.id || profile.status !== "provisional") {
        throw new Error("B2 nutrition version conflict; must be reviewed, not overwritten");
      }
      await tx.insert(foodReviewCases).values({
        caseKey, caseType: "legacy_reconciliation",
        targetArtifactType: "food_variants",
        targetArtifactId: String(variant.id), targetRevision: variant.revision,
        targetContentHash: nutritionHash,
        proposedPayloadJson: JSON.stringify({
          foodVariantId: variant.id, profileId: profile.id,
          sourceId: candidate.sourceId, sourceVersion: candidate.sourceVersion,
        }),
        policyVersion: "food-v2-b2",
      }).onDuplicateKeyUpdate({ set: { lastSeenAt: new Date() } });
    }
  });
  return plan;
}
