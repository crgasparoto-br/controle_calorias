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

/** A reference is usable only when its HTTPS URL has no embedded credentials
 * or fragment. A license document is not nutritional source provenance. */
export function isValidHttpsSourceReference(reference: string | null | undefined): reference is string {
  try {
    const url = new URL(reference ?? "");
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

/** Read/cache permission is bound to the authorized resource, not merely its
 * host. Domain-wide reuse needs a separately modeled and approved grant; B2
 * deliberately fails closed until such a scope is governed. */
export function isAuthorizedSourceReference(
  reference: string | null | undefined,
  approvedUrl: string | null | undefined,
): boolean {
  if (!isValidHttpsSourceReference(reference) || !isValidHttpsSourceReference(approvedUrl)) {
    return false;
  }
  const actual = new URL(reference);
  const source = new URL(approvedUrl);
  return actual.origin === source.origin &&
    actual.pathname === source.pathname &&
    actual.search === source.search;
}
