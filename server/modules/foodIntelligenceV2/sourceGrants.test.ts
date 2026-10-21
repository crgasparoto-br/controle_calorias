import { describe, expect, it } from "vitest";
import {
  canPersistProvisionalEvidence, canPublishGlobalKnowledge, canReadFoodSource, isAuthorizedSourceReference,
  type FoodSourceGrant,
} from "./sourceGrants";

const now = new Date("2026-10-21T12:00:00.000Z");
function grant(overrides: Partial<FoodSourceGrant> = {}): FoodSourceGrant {
  return {
    sourceVersion: "release-1", status: "approved",
    allowRead: 1, allowPersistEvidence: 1, allowGlobalPublication: 0,
    licenseReference: "https://publisher.example/license",
    approvalReference: "lgpd-approval:2026-10", approvedAt: new Date("2026-10-20T00:00:00Z"),
    validUntil: new Date("2026-10-22T00:00:00Z"), revokedAt: null,
    retentionDays: 30, ...overrides,
  };
}

describe("B2 source grants: policy is deny-by-default", () => {
  it("no grant or just a URL cannot authorize reading or persistence", () => {
    expect(canReadFoodSource(null, "release-1", now)).toBe(false);
    expect(canReadFoodSource(grant({ approvalReference: null }), "release-1", now)).toBe(false);
    expect(canReadFoodSource(grant({ status: "pending" }), "release-1", now)).toBe(false);
  });
  it("license and governance belong to exact version", () => {
    expect(canReadFoodSource(grant(), "release-1", now)).toBe(true);
    expect(canReadFoodSource(grant(), "release-2", now)).toBe(false);
    expect(canReadFoodSource(grant({ approvedAt: new Date("2026-10-22T00:00:00Z") }), "release-1", now)).toBe(false);
    expect(canReadFoodSource(grant({ approvedAt: new Date("invalid") }), "release-1", now)).toBe(false);
    expect(canReadFoodSource(grant({ validUntil: new Date("invalid") }), "release-1", now)).toBe(false);
  });
  it("revocation and expiry invalidate future reads and cache eligibility", () => {
    expect(canReadFoodSource(grant({ status: "revoked" }), "release-1", now)).toBe(false);
    expect(canReadFoodSource(grant({ revokedAt: new Date("2026-10-21T00:00:00Z") }), "release-1", now)).toBe(false);
    expect(canReadFoodSource(grant({ validUntil: now }), "release-1", now)).toBe(false);
  });
  it("reading permission never implies storage or global publication", () => {
    expect(canReadFoodSource(grant({ allowPersistEvidence: 0 }), "release-1", now)).toBe(true);
    expect(canPersistProvisionalEvidence(grant({ allowPersistEvidence: 0 }), "release-1", now)).toBe(false);
    expect(canPublishGlobalKnowledge(grant(), "release-1", now)).toBe(false);
  });
  it("rejects cached evidence after an authorized origin change or unsafe reference", () => {
    expect(isAuthorizedSourceReference("https://manufacturer.example/sku", "https://manufacturer.example")).toBe(true);
    expect(isAuthorizedSourceReference("https://manufacturer.example/sku", "https://other.example")).toBe(false);
    expect(isAuthorizedSourceReference("http://manufacturer.example/sku", "https://manufacturer.example")).toBe(false);
    expect(isAuthorizedSourceReference("https://manufacturer.example.attacker.test/sku", "https://manufacturer.example")).toBe(false);
    expect(isAuthorizedSourceReference(null, "https://manufacturer.example")).toBe(false);
    expect(isAuthorizedSourceReference("https://manufacturer.example/sku", null)).toBe(false);
  });

  it("evidence retention is bounded and a global grant is separately explicit", () => {
    expect(canPersistProvisionalEvidence(grant(), "release-1", now)).toBe(true);
    expect(canPersistProvisionalEvidence(grant({ retentionDays: null }), "release-1", now)).toBe(false);
    expect(canPersistProvisionalEvidence(grant({ retentionDays: 0 }), "release-1", now)).toBe(false);
    expect(canPersistProvisionalEvidence(grant({ retentionDays: 366 }), "release-1", now)).toBe(false);
    expect(canPublishGlobalKnowledge(grant({ allowGlobalPublication: 1 }), "release-1", now)).toBe(true);
  });
});
