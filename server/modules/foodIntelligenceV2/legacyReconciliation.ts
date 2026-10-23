/**
 * B2 legacy inventory. Records without independent provenance stay in a
 * governed quarantine plan; no V1 row is copied to a global V2 profile simply
 * because the old table contained a plausible calorie value.
 */
import { createHash } from "node:crypto";
import { normalizeFoodName } from "../../../scripts/import-foods/normalize_food_name";
import { canPublishGlobalKnowledge, isAuthorizedSourceReference, type FoodSourceGrant } from "./sourceGrants";

export type LegacyFoodCandidate = {
  table: "foods" | "foodCatalog";
  id: number;
  foodId: number | null;
  name: string;
  brandName?: string | null;
  brandId?: number | null;
  ownerUserId: number | null;
  privateOrigin?: boolean;
  scope?: "global" | "user" | null;
  sourceId: number | null;
  sourceVersion: string | null;
  sourceCode: string | null;
  canonicalKey: string | null;
  validNutrition: boolean;
  nutritionFingerprint?: string;
  status?: "active" | "deprecated" | "merged";
};

export type ReconciliationReason =
  | "personal_scope" | "source_unlicensed" | "source_untraceable"
  | "family_ambiguous" | "brand_unlinked" | "nutrition_insufficient"
  | "nutrition_conflict" | "deprecated_source" | "duplicate_identity";
export type LegacyFoodDecision =
  | { action: "mapped"; source: LegacyFoodCandidate; identityKey: string; profileKey: string }
  | { action: "merged"; source: LegacyFoodCandidate; identityKey: string }
  | { action: "quarantined"; source: LegacyFoodCandidate; reason: ReconciliationReason };

/** AUD-1302-028: an old row has no implicit revision merely because its
 * source registry now has one. Only specific, hashed evidence can establish
 * the revision of the nutrition originally carried by that legacy row. */
export type LegacySourceRevisionEvidence = {
  subjectKey: string; evidenceType: string; sourceId: number | null;
  ownerUserId: number | null; sourceReference: string | null;
  payloadJson: string; contentHash: string; capturedAt: Date;
  retentionUntil: Date | null;
};

export function provenLegacySourceRevision(
  candidate: LegacyFoodCandidate,
  proofs: readonly LegacySourceRevisionEvidence[],
  approvedUrl: string | null,
  now: Date,
): string | null {
  if (!candidate.sourceId || !candidate.sourceCode?.trim() ||
      !candidate.nutritionFingerprint || !Number.isFinite(now.getTime())) return null;
  const subjectKey = `b2:legacy:${candidate.table}:${candidate.id}`;
  const revisions = new Set<string>();
  for (const proof of proofs) {
    if (proof.subjectKey !== subjectKey || proof.evidenceType !== "official_source" ||
        proof.sourceId !== candidate.sourceId || proof.ownerUserId !== null ||
        !isAuthorizedSourceReference(proof.sourceReference, approvedUrl) ||
        !(proof.capturedAt instanceof Date) || !Number.isFinite(proof.capturedAt.getTime()) ||
        proof.capturedAt > now || !(proof.retentionUntil instanceof Date) ||
        !Number.isFinite(proof.retentionUntil.getTime()) || proof.retentionUntil <= now) continue;
    try {
      const decoded: unknown = JSON.parse(proof.payloadJson);
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) continue;
      const data = decoded as Record<string, unknown>;
      if (data.table !== candidate.table || data.legacyRowId !== candidate.id ||
          data.sourceId !== candidate.sourceId ||
          typeof data.sourceVersion !== "string" || !data.sourceVersion.trim() ||
          data.sourceCode !== candidate.sourceCode ||
          data.nutritionFingerprint !== candidate.nutritionFingerprint ||
          proof.contentHash !== createHash("sha256").update(JSON.stringify(decoded)).digest("hex")) continue;
      revisions.add(data.sourceVersion);
    } catch { /* Invalid legacy provenance is never trusted. */ }
  }
  return revisions.size === 1 ? [...revisions][0] : null;
}

export type SourceGrantLookup = (
  sourceId: number,
) => { grant: FoodSourceGrant; version: string } | null;

export function planLegacyKnowledgeReconciliation(
  candidates: readonly LegacyFoodCandidate[],
  sourceGrants: SourceGrantLookup,
  now: Date,
): {
  decisions: LegacyFoodDecision[];
  totals: { input: number; mapped: number; merged: number; quarantined: number };
} {
  const seen = new Map<string, string | undefined>();
  const decisions: LegacyFoodDecision[] = [];
  const ordered = [...candidates].sort(
    (a, b) => a.table.localeCompare(b.table) || a.id - b.id,
  );
  for (const source of ordered) {
    let reason: ReconciliationReason | null = null;
    // Only an explicitly global, ownerless row may enter global reconciliation.
    // Unknown scopes are orphaned/private until provenance is proven.
    if (source.ownerUserId !== null || source.scope !== "global" || source.privateOrigin)
      reason = "personal_scope";
    else if (source.status && source.status !== "active") reason = "deprecated_source";
    else if (!source.foodId || !source.canonicalKey?.trim() ||
             !normalizeFoodName(source.name)) reason = "family_ambiguous";
    else if (source.brandName?.trim() && !source.brandId) reason = "brand_unlinked";
    else if (!source.validNutrition) reason = "nutrition_insufficient";
    else if (!source.sourceId || !source.sourceVersion || !source.sourceCode?.trim()) {
      reason = "source_untraceable";
    } else {
      const permission = sourceGrants(source.sourceId);
      if (!permission || permission.version !== source.sourceVersion ||
          !canPublishGlobalKnowledge(permission.grant, permission.version, now)) {
        reason = "source_unlicensed";
      }
    }
    if (reason) {
      decisions.push({ action: "quarantined", source, reason });
      continue;
    }
    const sourceKey = [
      source.foodId!, source.sourceId!, source.sourceVersion!, source.sourceCode!,
      source.canonicalKey!, source.brandId ?? "-",
    ].join("|");
    const identityKey = "legacy:" + createHash("sha256").update(sourceKey).digest("hex");
    const profileKey = "legacy:" + createHash("sha256")
      .update(sourceKey + ":nutrition").digest("hex");
    if (seen.has(identityKey)) {
      if (seen.get(identityKey) !== source.nutritionFingerprint) {
        decisions.push({ action: "quarantined", source, reason: "nutrition_conflict" });
      } else {
        decisions.push({ action: "merged", source, identityKey });
      }
    } else {
      seen.set(identityKey, source.nutritionFingerprint);
      decisions.push({ action: "mapped", source, identityKey, profileKey });
    }
  }
  const totals = {
    input: decisions.length,
    mapped: decisions.filter(d => d.action === "mapped").length,
    merged: decisions.filter(d => d.action === "merged").length,
    quarantined: decisions.filter(d => d.action === "quarantined").length,
  };
  if (totals.input !== totals.mapped + totals.merged + totals.quarantined) {
    throw new Error("B2 reconciliation ledger is incomplete");
  }
  return { decisions, totals };
}


/** Reconcile V1 foodCatalog portions independently of the existing foods
 * portions. A portion is never silently published if the catalog identity,
 * source entitlement or physical measure is missing. */
export type LegacyCatalogPortion = {
  id: number;
  foodCatalogId: number;
  label: string;
  unit: string;
  quantity: number;
  grams: number;
  isDefault?: number;
};

export type LegacyCatalogPortionDecision = {
  portion: LegacyCatalogPortion;
  action: "mapped" | "merged" | "quarantined";
  reason?: "catalog_not_eligible" | "invalid_measure" | "conflicting_measure";
};

export function planLegacyCatalogPortions(
  portions: readonly LegacyCatalogPortion[],
  decisions: readonly LegacyFoodDecision[],
) {
  const byCatalogId = new Map(decisions
    .filter(d => d.source.table === "foodCatalog")
    .map(d => [d.source.id, d]));
  const seen = new Map<string, string>();
  const output: LegacyCatalogPortionDecision[] = [];
  for (const portion of [...portions].sort((a, b) => a.id - b.id)) {
    const parent = byCatalogId.get(portion.foodCatalogId);
    if (!parent || parent.action === "quarantined" ||
        parent.source.scope !== "global" || parent.source.ownerUserId !== null ||
        !parent.source.foodId) {
      output.push({ portion, action: "quarantined", reason: "catalog_not_eligible" });
      continue;
    }
    const label = normalizeFoodName(portion.label);
    if (!label || !portion.unit.trim() ||
        !Number.isFinite(portion.quantity) || portion.quantity <= 0 ||
        !Number.isFinite(portion.grams) || portion.grams <= 0) {
      output.push({ portion, action: "quarantined", reason: "invalid_measure" });
      continue;
    }
    const key = JSON.stringify([parent.source.foodId, label, portion.unit]);
    const fingerprint = JSON.stringify([parent.identityKey, portion.quantity, portion.grams]);
    if (seen.has(key)) {
      output.push(seen.get(key) === fingerprint
        ? { portion, action: "merged" }
        : { portion, action: "quarantined", reason: "conflicting_measure" });
    } else {
      seen.set(key, fingerprint);
      output.push({ portion, action: "mapped" });
    }
  }
  return {
    decisions: output,
    totals: {
      input: output.length,
      mapped: output.filter(d => d.action === "mapped").length,
      merged: output.filter(d => d.action === "merged").length,
      quarantined: output.filter(d => d.action === "quarantined").length,
    },
  };
}
