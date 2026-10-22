import { createHash } from "node:crypto";
import { isAuthorizedSourceReference } from "./sourceGrants";
import { isNutritionFacts, type NutritionFacts } from "./knowledgeRead";

/**
 * B2 read eligibility. A missing owner is never evidence of global consent:
 * V1 deletion can SET NULL on owner_user_id while leaving scope='user'.
 */
export function isGovernedFamilyVisible(
  scope: "global" | "user" | null,
  ownerUserId: number | null,
  userId: number | null,
): boolean {
  if (scope === "global") return ownerUserId === null;
  return scope === "user" && ownerUserId !== null &&
    userId !== null && ownerUserId === userId;
}

/** A user-confirmed alias already identifies a specific branded variant; raw
 * text and global aliases do not. Barcode selection is independently exact. */
export function isTrustedBrandlessSelection(
  matchingEvidence: "barcode" | "exact_variant" | "personal_alias" | "global_alias" | "generic_family",
  barcode: string | null | undefined,
): boolean {
  return matchingEvidence === "personal_alias" ||
    (matchingEvidence === "barcode" && !!barcode?.trim());
}


type BarcodeProof = {
  foodVariantId: number | null;
  sourceId: number | null;
  ownerUserId: number | null;
  evidenceType: string;
  sourceReference: string | null;
  payloadJson: string;
  contentHash: string;
  retentionUntil: Date | null;
};

/** Barcode identity is only exact when its linked evidence states the same
 * code. A generic manufacturer URL, nonempty hash or linked evidence ID alone
 * does not prove the barcode or the current payload's integrity. */
export function hasCurrentBarcodeProof(
  proof: BarcodeProof | null | undefined,
  barcode: string,
  variantId: number,
  sourceId: number,
  approvedSourceUrl: string | null,
  userId: number | null,
  now: Date,
): boolean {
  if (!proof || !["barcode", "nutrition_label", "manufacturer"].includes(proof.evidenceType) ||
      proof.foodVariantId !== variantId || proof.sourceId !== sourceId ||
      (proof.ownerUserId !== null && proof.ownerUserId !== userId) ||
      (proof.ownerUserId !== null && !proof.retentionUntil) ||
      (proof.retentionUntil !== null && proof.retentionUntil.getTime() <= now.getTime()) ||
      !isAuthorizedSourceReference(proof.sourceReference, approvedSourceUrl) ||
      typeof proof.payloadJson !== "string") return false;
  try {
    const payload: unknown = JSON.parse(proof.payloadJson);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const record = payload as Record<string, unknown>;
    // Preserve leading zeroes and never infer the code from a URL or SKU ID.
    if (typeof record.barcode !== "string" || record.barcode !== barcode) return false;
    // A nested identity must not contradict the primary barcode assertion.
    if (record.identity !== undefined) {
      const identity = record.identity;
      if (!identity || typeof identity !== "object" || Array.isArray(identity) ||
          (identity as Record<string, unknown>).barcode !== barcode) return false;
    }
    const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    return proof.contentHash === digest;
  } catch { return false; }
}

type CommercialMapping = {
  foodVariantId: number;
  sourceId: number;
  status: string;
  sourceItemCode: string | null;
  sourceUrl?: string | null;
} | null | undefined;
type CommercialEvidence = {
  foodVariantId: number | null;
  sourceId: number | null;
  ownerUserId: number | null;
  evidenceType: string;
  sourceReference: string | null;
  payloadJson: string;
  contentHash: string;
  retentionUntil: Date | null;
};

type CommercialProfile = {
  variantId: number;
  sourceId: number;
  mapping: CommercialMapping;
  sourceUrl: string | null;
  nutrition: NutritionFacts;
};

/** A nonempty digest or an exact product URL alone cannot prove nutrition.
 * The normalized payload and SHA-256 must bind the same SKU, source, URL and
 * all nutritional values as the selected governed profile. */
function hasMatchingCommercialNutritionProof(
  profile: CommercialProfile,
  mapping: NonNullable<CommercialMapping>,
  proof: CommercialEvidence,
): boolean {
  if (typeof proof.payloadJson !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(proof.payloadJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const payload = parsed as Record<string, unknown>;
    if (!isNutritionFacts(payload.nutrition) ||
        payload.foodVariantId !== profile.variantId ||
        payload.sourceId !== profile.sourceId ||
        payload.sourceItemCode !== (mapping.sourceItemCode?.trim() || null) ||
        payload.sourceReference !== proof.sourceReference) return false;
    const actual = payload.nutrition;
    const expected = profile.nutrition;
    return (
      actual.basisQuantity === expected.basisQuantity &&
      actual.basisUnit === expected.basisUnit &&
      actual.caloriesKcal === expected.caloriesKcal &&
      actual.proteinG === expected.proteinG &&
      actual.carbG === expected.carbG &&
      actual.fatG === expected.fatG &&
      proof.contentHash === createHash("sha256").update(JSON.stringify(parsed)).digest("hex")
    );
  } catch {
    return false;
  }
}

/** A generic source, shared approval or external candidate does not prove a
 * commercial product's exact nutritional profile. Proof must bind this SKU,
 * source and the manufacturer/label artifact to the same variant. */
function sameExactProductResource(
  reference: string | null,
  productUrl: string,
  approvedSourceUrl: string,
): boolean {
  try {
    const proof = new URL(reference ?? "");
    const product = new URL(productUrl);
    const approved = new URL(approvedSourceUrl);
    // Domain identity is insufficient: two SKUs often share one manufacturer.
    // A site home page is not an exact product artifact.
    return proof.protocol === "https:" && product.protocol === "https:" &&
      approved.protocol === "https:" && proof.origin === approved.origin &&
      product.origin === approved.origin &&
      (product.pathname !== "/" || !!product.search) &&
      proof.pathname === product.pathname && proof.search === product.search;
  } catch {
    return false;
  }
}

/** A proof attached to a user's private variant is valid only for that
 * authenticated owner, with finite and current retention. It never licenses
 * publication or verification of the global variant. A nonpersonal proof can
 * support a private variant, but personal proof is always only provisional. */
export function eligibleCommercialProfileProofScope(
  profile: CommercialProfile,
  evidence: readonly CommercialEvidence[],
  now: Date,
  familyScope: "global" | "user",
  userId: number | null,
): "global" | "personal" | null {
  const mapping = profile.mapping;
  const approvedSourceUrl = profile.sourceUrl;
  const productUrl = mapping?.sourceUrl;
  if (!mapping || !approvedSourceUrl || !productUrl || mapping.status !== "active" ||
      mapping.foodVariantId !== profile.variantId ||
      mapping.sourceId !== profile.sourceId ||
      (!mapping.sourceItemCode?.trim() && !mapping.sourceUrl?.trim()) ||
      !Number.isFinite(now.getTime())) return null;
  let personalProof = false;
  for (const proof of evidence) {
    if (!sameExactProductResource(proof.sourceReference, productUrl, approvedSourceUrl) ||
        proof.foodVariantId !== profile.variantId ||
        proof.sourceId !== profile.sourceId ||
        (proof.evidenceType !== "manufacturer" && proof.evidenceType !== "nutrition_label") ||
        (proof.retentionUntil && (!Number.isFinite(proof.retentionUntil.getTime()) || proof.retentionUntil <= now)) ||
        !hasMatchingCommercialNutritionProof(profile, mapping, proof)) continue;
    if (proof.ownerUserId === null) return "global";
    if (familyScope === "user" && userId !== null && proof.ownerUserId === userId &&
        proof.retentionUntil !== null && Number.isFinite(proof.retentionUntil.getTime()) &&
        proof.retentionUntil > now) personalProof = true;
  }
  return personalProof ? "personal" : null;
}

/** Global independent proof: personal labels never certify a shared SKU. */
export function hasVerifiedCommercialProfileProof(
  profile: CommercialProfile,
  evidence: readonly CommercialEvidence[],
  now: Date,
): boolean {
  return eligibleCommercialProfileProofScope(profile, evidence, now, "global", null) === "global";
}
