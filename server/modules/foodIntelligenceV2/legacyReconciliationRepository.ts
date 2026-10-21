/**
 * B2 controlled V1 -> V2 reconciliation entrypoint. Preview is default.
 * It never rewrites meals, deletes V1 records, auto-verifies profiles, nor
 * publishes an unreviewed variant into the active V2 read path.
 */
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { foodAliases, foodBrands, foodCatalog, foodPortions, foodSources, foods, portions as catalogPortions } from "../../../drizzle/schema";
import { normalizeFoodName } from "../../../scripts/import-foods/normalize_food_name";
import {
  foodBarcodes, foodNutritionProfiles, foodReviewCases, foodSourceReadGrants,
  foodVariantSources, foodVariants,
} from "../../../drizzle/food-intelligence-v2-schema";
import { canPublishGlobalKnowledge } from "./sourceGrants";
import {
  planLegacyKnowledgeReconciliation, planLegacyCatalogPortions,
  type LegacyFoodCandidate,
} from "./legacyReconciliation";
import { getDb } from "../../db";
import { validateLegacyCatalogProvenance } from "./legacyCatalogLink";

const hash = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
const MAX_SCAN = 10000;

export type FoodV2ReconciliationMode = "preview" | "stage";

/**
 * stage creates draft V2 variants/provisional profiles only for licensed,
 * traceable V1 food rows. Quarantine is represented by review cases.
 * The administrative review/promotion phase remains separate (#1309).
 */
export async function reconcileLegacyFoodKnowledge(mode: FoodV2ReconciliationMode = "preview") {
  if (mode !== "preview" && mode !== "stage") {
    throw new Error("B2 reconciliation mode must be preview or stage");
  }
  const db = await getDb();
  if (!db) throw new Error("B2 reconciliation requires an available database");
  const [legacyFoods, legacyCatalog, grantedSources, brands, aliases, portions, legacyCatalogPortions] = await Promise.all([
    db.select().from(foods).limit(MAX_SCAN + 1),
    db.select().from(foodCatalog).limit(MAX_SCAN + 1),
    db.select({ source: foodSources, grant: foodSourceReadGrants })
      .from(foodSources)
      .innerJoin(foodSourceReadGrants, eq(foodSourceReadGrants.sourceId, foodSources.id)),
    db.select().from(foodBrands),
    db.select().from(foodAliases).limit(MAX_SCAN + 1),
    db.select().from(foodPortions).limit(MAX_SCAN + 1),
    db.select().from(catalogPortions).limit(MAX_SCAN + 1),
  ]);
  if (legacyFoods.length > MAX_SCAN || legacyCatalog.length > MAX_SCAN ||
      aliases.length > MAX_SCAN || portions.length > MAX_SCAN ||
      legacyCatalogPortions.length > MAX_SCAN) {
    throw new Error("B2 reconciliation would be incomplete: dataset requires pagination");
  }

  const sourceMap = new Map(grantedSources.map(row => [row.source.id, row]));
  const byFoodId = new Map(legacyFoods.map(row => [row.id, row]));
  const brandIds = new Map(brands.map(row => [row.normalizedName, row.id]));
  const linkedCatalog = new Map(legacyCatalog.map(row => [
    row.id, validateLegacyCatalogProvenance(row, legacyFoods, sourceMap),
  ]));
  const aliasesByFood = new Map<number, typeof aliases>();
  for (const alias of aliases) {
    const current = aliasesByFood.get(alias.foodId) ?? [];
    current.push(alias);
    aliasesByFood.set(alias.foodId, current);
  }
  const portionsByFood = new Map<number, typeof portions>();
  for (const portion of portions) {
    const current = portionsByFood.get(portion.foodId) ?? [];
    current.push(portion);
    portionsByFood.set(portion.foodId, current);
  }
  const candidates: LegacyFoodCandidate[] = [
    ...legacyFoods.map(row => ({
      table: "foods" as const,
      id: row.id,
      foodId: row.id,
      name: row.name,
      status: row.status,
      scope: row.scope,
      nutritionFingerprint: hash([row.caloriesKcalPer100g, row.proteinGramsPer100g, row.carbsGramsPer100g, row.fatGramsPer100g]),
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
      foodId: linkedCatalog.get(row.id)?.id ?? null,
      name: row.name,
      status: row.status,
      scope: linkedCatalog.get(row.id) ? "global" as const : null,
      nutritionFingerprint: linkedCatalog.get(row.id)
        ? hash([
          linkedCatalog.get(row.id)!.caloriesKcalPer100g,
          linkedCatalog.get(row.id)!.proteinGramsPer100g,
          linkedCatalog.get(row.id)!.carbsGramsPer100g,
          linkedCatalog.get(row.id)!.fatGramsPer100g,
        ])
        : hash([row.calories, row.protein, row.carbs, row.fat]),
      brandName: row.brandName,
      brandId: row.brandName ? brandIds.get(normalizeFoodName(row.brandName)) ?? null : null,
      ownerUserId: row.createdByUserId,
      sourceId: linkedCatalog.get(row.id)?.sourceId ?? null,
      sourceVersion: linkedCatalog.get(row.id)?.sourceId
        ? sourceMap.get(linkedCatalog.get(row.id)!.sourceId!)?.source.version ?? null : null,
      sourceCode: linkedCatalog.get(row.id)?.sourceFoodCode ?? null,
      canonicalKey: linkedCatalog.get(row.id)?.canonicalKey ?? null,
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
  const portionPlan = planLegacyCatalogPortions(legacyCatalogPortions, plan.decisions);
  const report = { ...plan, catalogPortions: portionPlan };
  if (mode === "preview") return report;
  const portionDecisionsByCatalog = new Map<number, typeof portionPlan.decisions>();
  for (const decision of portionPlan.decisions) {
    const items = portionDecisionsByCatalog.get(decision.portion.foodCatalogId) ?? [];
    items.push(decision);
    portionDecisionsByCatalog.set(decision.portion.foodCatalogId, items);
  }

  // Do not stage an inventory unless the operator has reviewed its full plan.
  // No input can bypass the per-source publication and version checks.
  await db.transaction(async tx => {
    async function reviewChild(
      kind: "legacy_alias_quarantine" | "legacy_portion_quarantine" | "legacy_barcode_review",
      id: string, variantId: number, reason: string,
    ) {
      const key = "b2child:" + hash([kind, id]);
      await tx.insert(foodReviewCases).values({
        caseKey: key, caseType: kind,
        targetArtifactType: kind === "legacy_alias_quarantine" ? "food_aliases" :
          kind === "legacy_portion_quarantine" ? "food_portions" : "food_barcodes",
        targetArtifactId: id, targetRevision: 1, targetContentHash: hash([kind, id, variantId, reason]),
        proposedPayloadJson: JSON.stringify({ variantId, reason }),
        policyVersion: "food-v2-b2",
      }).onDuplicateKeyUpdate({ set: { lastSeenAt: new Date() } });
    }

    async function quarantineCatalogPortion(portionId: number, reason: string) {
      await tx.insert(foodReviewCases).values({
        caseKey: "b2catalogportion:" + hash(portionId),
        caseType: "legacy_catalog_portion_quarantine",
        targetArtifactType: "portions", targetArtifactId: String(portionId),
        targetRevision: 1, targetContentHash: hash([portionId, reason]),
        proposedPayloadJson: JSON.stringify({ reason }),
        policyVersion: "food-v2-b2",
      }).onDuplicateKeyUpdate({ set: { lastSeenAt: new Date() } });
    }

    async function stageLinkedCatalogPortions(catalogId: number, variantId: number, foodId: number, sourceId: number) {
      for (const decision of portionDecisionsByCatalog.get(catalogId) ?? []) {
        const portion = decision.portion;
        if (decision.action === "quarantined") {
          await quarantineCatalogPortion(portion.id, decision.reason ?? "catalog_not_eligible");
          continue;
        }
        if (decision.action === "merged") continue; // Equal physical measure already mapped.
        const normalizedLabel = normalizeFoodName(portion.label);
        // The V2 table also has a family-level unique constraint; do not
        // silently overwrite a different measure or another source's row.
        const [existing] = await tx.select().from(foodPortions)
          .where(and(
            eq(foodPortions.foodId, foodId),
            eq(foodPortions.normalizedLabel, normalizedLabel),
            eq(foodPortions.unit, portion.unit),
          )).limit(1);
        const sourcePortionCode = "b2:catalog:" + portion.id;
        if (existing) {
          if (existing.foodVariantId === variantId && existing.sourceId === sourceId &&
              existing.sourcePortionCode === sourcePortionCode &&
              existing.quantity === portion.quantity && existing.grams === portion.grams) continue;
          await quarantineCatalogPortion(portion.id, "conflicting_existing_portion");
          continue;
        }
        await tx.insert(foodPortions).values({
          foodId, foodVariantId: variantId, label: portion.label,
          normalizedLabel, unit: portion.unit, quantity: portion.quantity,
          grams: portion.grams, sourceId, sourcePortionCode,
          status: "provisional", isDefault: portion.isDefault,
        });
      }
    }

    async function stageLinkedCatalogBarcode(catalogId: number, variantId: number, sourceId: number) {
      const catalog = legacyCatalog.find(row => row.id === catalogId);
      if (!catalog?.barcode?.trim()) return;
      const barcode = catalog.barcode.trim();
      // Barcode is indexed for later review, NOT activated as SKU evidence.
      await tx.insert(foodBarcodes).values({
        foodVariantId: variantId, barcode, sourceId, status: "revoked",
      }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
      const [stored] = await tx.select().from(foodBarcodes)
        .where(eq(foodBarcodes.barcode, barcode)).limit(1);
      if (!stored || stored.foodVariantId !== variantId ||
          stored.sourceId !== sourceId || stored.status !== "revoked") {
        throw new Error("B2 barcode conflict requires manual review");
      }
      // Review targets the persisted barcode ID, not the unrelated legacy catalog ID.
      await reviewChild("legacy_barcode_review", String(stored.id), variantId, "await_exact_sku_evidence");
    }

    for (const decision of plan.decisions) {
      const candidate = decision.source;
      const caseKey = "b2:" + hash([candidate.table, candidate.id]);
      const contentHash = hash([
        candidate.table, candidate.id, candidate.sourceId, candidate.sourceCode,
        candidate.canonicalKey, candidate.validNutrition,
      ]);
      if (candidate.ownerUserId !== null) continue; // personal records never enter global queue
      if (decision.action === "quarantined") {
        if (candidate.table === "foodCatalog") {
          for (const child of portionDecisionsByCatalog.get(candidate.id) ?? []) {
            await quarantineCatalogPortion(child.portion.id, child.reason ?? "catalog_not_eligible");
          }
        }
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
      if (decision.action === "merged") {
        if (candidate.table === "foodCatalog") {
          const [variant] = await tx.select().from(foodVariants)
            .where(eq(foodVariants.identityKey, decision.identityKey)).limit(1);
          if (!variant || candidate.sourceId === null) {
            throw new Error("B2 merged catalog has no staged variant");
          }
          const [approval] = await tx.select({
            source: foodSources, grant: foodSourceReadGrants,
          }).from(foodSources)
            .innerJoin(foodSourceReadGrants, eq(foodSourceReadGrants.sourceId, foodSources.id))
            .where(eq(foodSources.id, candidate.sourceId)).limit(1);
          if (!approval || approval.source.version !== candidate.sourceVersion ||
              !canPublishGlobalKnowledge(approval.grant, approval.source.version, new Date())) {
            throw new Error("B2 source approval changed during merged catalog staging");
          }
          await stageLinkedCatalogBarcode(candidate.id, variant.id, candidate.sourceId);
          await stageLinkedCatalogPortions(candidate.id, variant.id, candidate.foodId!, candidate.sourceId);
        }
        continue;
      }
      const original = byFoodId.get(candidate.foodId ?? -1);
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

      const nutritionHash = hash([
        original.caloriesKcalPer100g, original.proteinGramsPer100g,
        original.carbsGramsPer100g, original.fatGramsPer100g,
        candidate.sourceId, candidate.sourceVersion,
      ]);
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
        caloriesKcal: original.caloriesKcalPer100g,
        proteinG: original.proteinGramsPer100g,
        carbG: original.carbsGramsPer100g,
        fatG: original.fatGramsPer100g,
        contentHash: nutritionHash,
      }).onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });
      const [profile] = await tx.select().from(foodNutritionProfiles)
        .where(eq(foodNutritionProfiles.profileKey, decision.profileKey)).limit(1);
      if (!profile || profile.contentHash !== nutritionHash ||
          profile.foodVariantId !== variant.id || profile.status !== "provisional") {
        throw new Error("B2 nutrition version conflict; must be reviewed, not overwritten");
      }
      for (const alias of aliasesByFood.get(original.id) ?? []) {
        if (alias.status !== "active" || alias.governanceStatus !== "verified" ||
            alias.sourceId !== candidate.sourceId ||
            (alias.foodVariantId !== null && alias.foodVariantId !== variant.id)) {
          await reviewChild("legacy_alias_quarantine", String(alias.id), variant.id, "missing_exact_approved_alias_provenance");
          continue;
        }
        await tx.update(foodAliases).set({ foodVariantId: variant.id })
          .where(and(
            eq(foodAliases.id, alias.id), eq(foodAliases.foodId, original.id),
            eq(foodAliases.status, "active"), eq(foodAliases.governanceStatus, "verified"),
            eq(foodAliases.sourceId, candidate.sourceId),
            alias.foodVariantId === null ? isNull(foodAliases.foodVariantId) : eq(foodAliases.foodVariantId, variant.id),
          ));
        const [linked] = await tx.select().from(foodAliases)
          .where(eq(foodAliases.id, alias.id)).limit(1);
        if (linked?.foodVariantId !== variant.id) throw new Error("B2 alias changed during staging");
      }
      for (const portion of portionsByFood.get(original.id) ?? []) {
        if (portion.status !== "verified" && portion.status !== "provisional" ||
            portion.sourceId !== candidate.sourceId || !Number.isFinite(portion.grams) ||
            portion.grams <= 0 || portion.validTo && portion.validTo <= new Date() ||
            (portion.foodVariantId !== null && portion.foodVariantId !== variant.id)) {
          await reviewChild("legacy_portion_quarantine", String(portion.id), variant.id, "missing_compatible_portion_provenance");
          continue;
        }
        await tx.update(foodPortions).set({ foodVariantId: variant.id })
          .where(and(
            eq(foodPortions.id, portion.id), eq(foodPortions.foodId, original.id),
            eq(foodPortions.sourceId, candidate.sourceId),
            portion.foodVariantId === null ? isNull(foodPortions.foodVariantId) : eq(foodPortions.foodVariantId, variant.id),
          ));
        const [linked] = await tx.select().from(foodPortions)
          .where(eq(foodPortions.id, portion.id)).limit(1);
        if (linked?.foodVariantId !== variant.id) throw new Error("B2 portion changed during staging");
      }
      if (candidate.table === "foodCatalog") {
        await stageLinkedCatalogBarcode(candidate.id, variant.id, candidate.sourceId);
        await stageLinkedCatalogPortions(candidate.id, variant.id, original.id, candidate.sourceId);
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
  return report;
}
