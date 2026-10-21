/**
 * B2 grants are source-version-specific. No grant is generated from a URL,
 * search result, AI output or personal confirmation.
 */
export type FoodSourceGrant = {
  sourceVersion: string;
  status: "pending" | "approved" | "revoked";
  allowRead: number;
  allowPersistEvidence: number;
  allowGlobalPublication: number;
  licenseReference: string | null;
  approvalReference: string | null;
  approvedAt: Date | null;
  validUntil: Date | null;
  revokedAt: Date | null;
  retentionDays: number | null;
};

export function canReadFoodSource(
  grant: FoodSourceGrant | null | undefined,
  actualSourceVersion: string,
  now: Date,
): grant is FoodSourceGrant {
  return !!grant &&
    !Number.isNaN(now.getTime()) &&
    grant.sourceVersion === actualSourceVersion &&
    grant.status === "approved" &&
    grant.allowRead === 1 &&
    !!grant.licenseReference?.trim() &&
    !!grant.approvalReference?.trim() &&
    !!grant.approvedAt &&
    Number.isFinite(grant.approvedAt.getTime()) &&
    grant.approvedAt.getTime() <= now.getTime() &&
    !grant.revokedAt &&
    (!grant.validUntil || (Number.isFinite(grant.validUntil.getTime()) && grant.validUntil.getTime() > now.getTime()));
}

export function canPersistProvisionalEvidence(
  grant: FoodSourceGrant | null | undefined,
  actualSourceVersion: string,
  now: Date,
): boolean {
  return canReadFoodSource(grant, actualSourceVersion, now) &&
    grant.allowPersistEvidence === 1 &&
    Number.isInteger(grant.retentionDays) &&
    grant.retentionDays !== null &&
    grant.retentionDays >= 1 &&
    grant.retentionDays <= 365;
}

export function canPublishGlobalKnowledge(
  grant: FoodSourceGrant | null | undefined,
  actualSourceVersion: string,
  now: Date,
): boolean {
  // This grant is necessary but never sufficient: review and independent
  // nutrition evidence must also be approved by the later governance phase.
  return canReadFoodSource(grant, actualSourceVersion, now) &&
    grant.allowGlobalPublication === 1;
}

/** Revalidate persisted evidence against the current source URL on every hit.
 * Same-host evidence is not SKU certification; commercial profiles separately
 * require their exact mapped product resource. */
export function isAuthorizedSourceReference(
  reference: string | null | undefined,
  approvedUrl: string | null | undefined,
): boolean {
  try {
    const actual = new URL(reference ?? "");
    const source = new URL(approvedUrl ?? "");
    return actual.protocol === "https:" && source.protocol === "https:" &&
      actual.origin === source.origin;
  } catch {
    return false;
  }
}
