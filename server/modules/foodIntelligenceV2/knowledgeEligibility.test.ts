import { describe, expect, it } from "vitest";
import {
  hasVerifiedCommercialProfileProof, isGovernedFamilyVisible,
} from "./knowledgeEligibility";

describe("B2 governed family and exact SKU proof", () => {
  it("never turns an orphaned personal food into globally visible knowledge", () => {
    expect(isGovernedFamilyVisible("global", null, 1)).toBe(true);
    expect(isGovernedFamilyVisible("global", 9, 9)).toBe(false);
    expect(isGovernedFamilyVisible("user", 9, 9)).toBe(true);
    expect(isGovernedFamilyVisible("user", 9, 10)).toBe(false);
    expect(isGovernedFamilyVisible("user", null, 9)).toBe(false);
    expect(isGovernedFamilyVisible("user", null, null)).toBe(false);
    expect(isGovernedFamilyVisible(null, null, 9)).toBe(false);
  });

  it("requires source-linked manufacturer/label evidence for a commercial profile", () => {
    const mapping = { foodVariantId: 11, sourceId: 7, status: "active",
      sourceItemCode: "SKU-A", sourceUrl: null };
    const valid = { foodVariantId: 11, sourceId: 7, ownerUserId: null,
      evidenceType: "nutrition_label", sourceReference: "https://manufacturer.example/sku-a",
      contentHash: "hash-a", retentionUntil: new Date("2026-11-01T00:00:00Z") };
    const now = new Date("2026-10-21T12:00:00Z");
    const profile = { variantId: 11, sourceId: 7, mapping,
      sourceUrl: "https://manufacturer.example" };
    expect(hasVerifiedCommercialProfileProof(profile, [valid], now)).toBe(true);
    expect(hasVerifiedCommercialProfileProof({ ...profile, mapping: null }, [valid], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, sourceId: 8 }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, foodVariantId: 12 }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, evidenceType: "external_source" }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, ownerUserId: 41 }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, retentionUntil: now }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, sourceReference: null }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, sourceReference: "https://other.example/sku-a" }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof({ ...profile, sourceUrl: null }, [valid], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, contentHash: "" }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof({ ...profile,
      mapping: { ...mapping, sourceItemCode: null, sourceUrl: null } }, [valid], now)).toBe(false);
  });
});
