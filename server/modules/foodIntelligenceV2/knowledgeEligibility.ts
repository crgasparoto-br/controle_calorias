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
function sameAuthoritativeOrigin(reference: string | null, sourceUrl: string): boolean {
  try {
    const referenceUrl = new URL(reference ?? "");
    const approvedUrl = new URL(sourceUrl);
    return referenceUrl.protocol === "https:" && approvedUrl.protocol === "https:" &&
      referenceUrl.origin === approvedUrl.origin;
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
  if (!mapping || !approvedSourceUrl || mapping.status !== "active" ||
      mapping.foodVariantId !== profile.variantId ||
      mapping.sourceId !== profile.sourceId ||
      (!mapping.sourceItemCode?.trim() && !mapping.sourceUrl?.trim())) return false;
  return evidence.some(proof =>
    sameAuthoritativeOrigin(proof.sourceReference, approvedSourceUrl) &&
    proof.foodVariantId === profile.variantId &&
    proof.sourceId === profile.sourceId &&
    proof.ownerUserId === null &&
    (proof.evidenceType === "manufacturer" || proof.evidenceType === "nutrition_label") &&
    !!proof.contentHash?.trim() &&
    !!proof.sourceReference?.startsWith("https://") &&
    (!proof.retentionUntil || proof.retentionUntil.getTime() > now.getTime())
  );
}
