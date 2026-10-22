import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hasVerifiedCommercialProfileProof, eligibleCommercialProfileProofScope, isGovernedFamilyVisible, isTrustedBrandlessSelection,
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

  it("accepts a confirmed personal alias for its exact commercial variant only", () => {
    expect(isTrustedBrandlessSelection("personal_alias", null)).toBe(true);
    expect(isTrustedBrandlessSelection("barcode", "789000")).toBe(true);
    expect(isTrustedBrandlessSelection("barcode", null)).toBe(false);
    expect(isTrustedBrandlessSelection("exact_variant", null)).toBe(false);
    expect(isTrustedBrandlessSelection("global_alias", null)).toBe(false);
    expect(isTrustedBrandlessSelection("generic_family", null)).toBe(false);
  });

  it("requires source-linked manufacturer/label evidence for a commercial profile", () => {
    const mapping = { foodVariantId: 11, sourceId: 7, status: "active",
      sourceItemCode: "SKU-A", sourceUrl: "https://manufacturer.example/sku-a" };
    const nutrition = {
      caloriesKcal: 250, proteinG: 9, carbG: 48, fatG: 3,
      basisQuantity: 100, basisUnit: "g" as const,
    };
    const payload = {
      foodVariantId: 11, sourceId: 7, sourceItemCode: "SKU-A",
      sourceReference: "https://manufacturer.example/sku-a", nutrition,
    };
    const digest = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const valid = { foodVariantId: 11, sourceId: 7, ownerUserId: null,
      evidenceType: "nutrition_label", sourceReference: "https://manufacturer.example/sku-a",
      payloadJson: JSON.stringify(payload), contentHash: digest(payload),
      retentionUntil: new Date("2026-11-01T00:00:00Z") };
    const now = new Date("2026-10-21T12:00:00Z");
    const profile = { variantId: 11, sourceId: 7, mapping,
      sourceUrl: "https://manufacturer.example", nutrition };
    expect(hasVerifiedCommercialProfileProof(profile, [valid], now)).toBe(true);
    expect(hasVerifiedCommercialProfileProof({ ...profile, mapping: null }, [valid], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, sourceId: 8 }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, foodVariantId: 12 }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, evidenceType: "external_source" }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, ownerUserId: 41 }], now)).toBe(false);
    // A private label is usable only for its owner, within current retention;
    // it never becomes global approval or verified nutritional knowledge.
    expect(eligibleCommercialProfileProofScope(profile, [{ ...valid, ownerUserId: 41 }], now, "user", 41)).toBe("personal");
    expect(eligibleCommercialProfileProofScope(profile, [{ ...valid, ownerUserId: 41 }], now, "user", 42)).toBeNull();
    expect(eligibleCommercialProfileProofScope(profile, [{ ...valid, ownerUserId: 41 }], now, "global", 41)).toBeNull();
    expect(eligibleCommercialProfileProofScope(profile, [{ ...valid, ownerUserId: 41, retentionUntil: null }], now, "user", 41)).toBeNull();
    expect(eligibleCommercialProfileProofScope(profile, [{ ...valid, ownerUserId: 41, retentionUntil: now }], now, "user", 41)).toBeNull();
    expect(eligibleCommercialProfileProofScope(profile, [{ ...valid, ownerUserId: 41,
      contentHash: "tampered" }], now, "user", 41)).toBeNull();
    expect(eligibleCommercialProfileProofScope(profile, [valid], now, "user", 41)).toBe("global");
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, retentionUntil: now }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, sourceReference: null }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, sourceReference: "https://other.example/sku-a" }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof({ ...profile, sourceUrl: null }, [valid], now)).toBe(false);
    // Same manufacturer's website is not evidence for another product.
    expect(hasVerifiedCommercialProfileProof(profile, [{
      ...valid, sourceReference: "https://manufacturer.example/sku-b",
    }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{
      ...valid, sourceReference: "https://manufacturer.example/sku-a?variant=b",
    }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof({
      ...profile, mapping: { ...mapping, sourceUrl: null },
    }, [valid], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof({
      ...profile, mapping: { ...mapping, sourceUrl: "https://manufacturer.example" },
    }, [{ ...valid, sourceReference: "https://manufacturer.example" }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, contentHash: "" }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, contentHash: "hash-a" }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, payloadJson: "{}" }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{ ...valid, payloadJson: "not-json" }], now)).toBe(false);
    const changedMacros = { ...payload, nutrition: { ...nutrition, caloriesKcal: 400 } };
    expect(hasVerifiedCommercialProfileProof(profile, [{
      ...valid, payloadJson: JSON.stringify(changedMacros),
    }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof(profile, [{
      ...valid, payloadJson: JSON.stringify(changedMacros), contentHash: digest(changedMacros),
    }], now)).toBe(false);
    const siblingSku = { ...payload, sourceItemCode: "SKU-B" };
    expect(hasVerifiedCommercialProfileProof(profile, [{
      ...valid, payloadJson: JSON.stringify(siblingSku), contentHash: digest(siblingSku),
    }], now)).toBe(false);
    const siblingVariant = { ...payload, foodVariantId: 12 };
    expect(hasVerifiedCommercialProfileProof(profile, [{
      ...valid, payloadJson: JSON.stringify(siblingVariant), contentHash: digest(siblingVariant),
    }], now)).toBe(false);
    const wrongBasis = { ...payload, nutrition: { ...nutrition, basisQuantity: 50 } };
    expect(hasVerifiedCommercialProfileProof(profile, [{
      ...valid, payloadJson: JSON.stringify(wrongBasis), contentHash: digest(wrongBasis),
    }], now)).toBe(false);
    const wrongRef = { ...payload, sourceReference: "https://manufacturer.example/sku-b" };
    expect(hasVerifiedCommercialProfileProof(profile, [{
      ...valid, payloadJson: JSON.stringify(wrongRef), contentHash: digest(wrongRef),
    }], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof({
      ...profile, nutrition: { ...nutrition, proteinG: 12 },
    }, [valid], now)).toBe(false);
    expect(hasVerifiedCommercialProfileProof({ ...profile,
      mapping: { ...mapping, sourceItemCode: null, sourceUrl: null } }, [valid], now)).toBe(false);
  });
});
