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
  contentHash: string;
  retentionUntil: Date | null;
};

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

export function hasVerifiedCommercialProfileProof(
  profile: { variantId: number; sourceId: number; mapping: CommercialMapping; sourceUrl: string | null },
  evidence: readonly CommercialEvidence[],
  now: Date,
): boolean {
  const mapping = profile.mapping;
  const approvedSourceUrl = profile.sourceUrl;
  if (!mapping || !approvedSourceUrl || !mapping.sourceUrl || mapping.status !== "active" ||
      mapping.foodVariantId !== profile.variantId ||
      mapping.sourceId !== profile.sourceId ||
      (!mapping.sourceItemCode?.trim() && !mapping.sourceUrl?.trim())) return false;
  return evidence.some(proof =>
    sameExactProductResource(proof.sourceReference, mapping.sourceUrl, approvedSourceUrl) &&
    proof.foodVariantId === profile.variantId &&
    proof.sourceId === profile.sourceId &&
    proof.ownerUserId === null &&
    (proof.evidenceType === "manufacturer" || proof.evidenceType === "nutrition_label") &&
    !!proof.contentHash?.trim() &&
    // The exact product resource and source origin have already been checked.
    (!proof.retentionUntil || proof.retentionUntil.getTime() > now.getTime())
  );
}
