import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import { createFoodV2KnowledgeRepository } from "./repository";
import { hasCurrentBarcodeProof } from "./knowledgeEligibility";
import { readThroughGovernedKnowledge } from "./knowledgeRead";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

const now = new Date("2026-10-21T12:00:00Z");
const reference = "https://manufacturer.example/products/sku-a";
const source = { id: 7, version: "v1", sourceUrl: reference };
const barcodeMapping = {
  id: 88, foodVariantId: 22, sourceId: 7, sourceItemCode: "SKU-A",
  status: "active", sourceUrl: reference,
};
const grant = {
  sourceVersion: "v1", status: "approved", allowRead: 1, allowPersistEvidence: 1,
  allowGlobalPublication: 1, licenseReference: "https://manufacturer.example/license",
  approvalReference: "approved:1", approvedAt: new Date("2026-10-20T12:00:00Z"),
  validUntil: null, revokedAt: null, retentionDays: 30,
};
const request = {
  normalizedName: "pao integral", barcode: "07890000000001", userId: 41,
  brand: null, policyVersion: "p1", resolverVersion: "v2", now,
};
const payload = {
  barcode: request.barcode, identity: { barcode: request.barcode },
  foodVariantId: 22, sourceId: 7, sourceItemCode: "SKU-A",
  sourceReference: reference, sourceVersion: "v1", label: "Pao integral",
};
const proof = {
  foodVariantId: 22, sourceId: 7, ownerUserId: null, evidenceType: "barcode",
  sourceReference: reference, payloadJson: JSON.stringify(payload),
  contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  retentionUntil: new Date("2026-11-21T12:00:00Z"),
};
const variantRow = {
  variant: { id: 22, status: "active", governanceStatus: "verified",
    variantType: "generic", normalizedName: "pao integral", displayName: "Pao integral" },
  family: { id: 4, status: "active", scope: "user", ownerUserId: 41,
    normalizedName: "pao" },
  brand: null,
};
const profile = {
  id: 10, currentSlot: 1, status: "verified", sourceId: 7, sourceVersion: "v1",
  foodVariantSourceId: null, validFrom: null, validTo: null,
  caloriesKcal: 250, proteinG: 9, carbG: 48, fatG: 3,
  basisQuantity: 100, basisUnit: "g",
};

function installResults(...pages: unknown[][]) {
  const select = vi.fn(() => ({
    from() { return this; }, innerJoin() { return this; }, leftJoin() { return this; },
    where() { return this; },
    limit: vi.fn(async () => {
      if (!pages.length) throw new Error("Unexpected governed query");
      return pages.shift();
    }),
  }));
  vi.mocked(getDb).mockResolvedValue({ select } as never);
  return select;
}

beforeEach(() => vi.resetAllMocks());

describe("AUD-1302-016: barcode evidence integrity", () => {
  const valid = (candidate: typeof proof, barcode = request.barcode) =>
    hasCurrentBarcodeProof(candidate, barcode, 22, 7, reference, barcodeMapping, 41, now, "v1");

  it("accepts exact linked barcode evidence with a valid hash and resource", () => {
    expect(valid(proof)).toBe(true);
    expect(hasCurrentBarcodeProof(proof, request.barcode, 22, 7,
      reference, barcodeMapping, 41, now, "v2")).toBe(false);
    const upgraded = { ...payload, sourceVersion: "v2" };
    expect(hasCurrentBarcodeProof({ ...proof, payloadJson: JSON.stringify(upgraded),
      contentHash: createHash("sha256").update(JSON.stringify(upgraded)).digest("hex") },
      request.barcode, 22, 7, reference, barcodeMapping, 41, now, "v2")).toBe(true);
  });

  it("rejects a sibling barcode and nested-identity contradiction", () => {
    expect(valid(proof, "07890000000002")).toBe(false);
    const incompatible = { ...payload, identity: { barcode: "07890000000002" } };
    expect(valid({ ...proof, payloadJson: JSON.stringify(incompatible),
      contentHash: createHash("sha256").update(JSON.stringify(incompatible)).digest("hex") })).toBe(false);
  });

  it("rejects absent, malformed or adulterated evidence", () => {
    expect(valid({ ...proof, payloadJson: "{}" })).toBe(false);
    expect(valid({ ...proof, payloadJson: "not-json" })).toBe(false);
    expect(valid({ ...proof, contentHash: "0".repeat(64) })).toBe(false);
    expect(valid({ ...proof, evidenceType: "external_source" })).toBe(false);
  });

  it("rejects another product URL, wrong owner/source/variant and expired proof", () => {
    expect(valid({ ...proof, sourceReference: "https://manufacturer.example/products/sku-b" })).toBe(false);
    expect(valid({ ...proof, ownerUserId: 42 })).toBe(false);
    expect(valid({ ...proof, ownerUserId: 41, retentionUntil: null })).toBe(false);
    expect(valid({ ...proof, sourceId: 8 })).toBe(false);
    expect(valid({ ...proof, foodVariantId: 23 })).toBe(false);
    expect(valid({ ...proof, retentionUntil: now })).toBe(false);
  });

  it("AUD-1302-023: refuses a generic source URL or mismatched SKU link", () => {
    const generic = "https://manufacturer.example/";
    const genericPayload = { ...payload, sourceReference: generic };
    const digest = createHash("sha256").update(JSON.stringify(genericPayload)).digest("hex");
    const genericProof = { ...proof, sourceReference: generic,
      payloadJson: JSON.stringify(genericPayload), contentHash: digest };
    expect(hasCurrentBarcodeProof(genericProof, request.barcode, 22, 7,
      generic, { ...barcodeMapping, sourceUrl: generic }, 41, now, "v1")).toBe(false);
    expect(hasCurrentBarcodeProof(proof, request.barcode, 22, 7,
      reference, { ...barcodeMapping, sourceItemCode: "SKU-B" }, 41, now, "v1")).toBe(false);
    expect(hasCurrentBarcodeProof(proof, request.barcode, 22, 7,
      reference, { ...barcodeMapping, sourceUrl: "https://manufacturer.example/products/sku-b" }, 41, now, "v1")).toBe(false);
    expect(hasCurrentBarcodeProof(proof, request.barcode, 22, 7,
      reference, { ...barcodeMapping, status: "revoked" }, 41, now, "v1")).toBe(false);
    // Approved source may be an origin, but the *linked product URL* must be exact.
    expect(hasCurrentBarcodeProof(proof, request.barcode, 22, 7,
      "https://manufacturer.example/", barcodeMapping, 41, now, "v1")).toBe(true);
  });
});

describe("AUD-1302-018: commercial proof through governed repository", () => {
  it("accepts exact nutritional evidence and rejects incorrect macros even with a valid hash", async () => {
    const commercialVariant = {
      ...variantRow,
      variant: { ...variantRow.variant, variantType: "branded" },
      brand: { name: "Panco" },
    };
    const commercialMapping = {
      id: 88, foodVariantId: 22, sourceId: 7, sourceItemCode: "SKU-A",
      status: "active", sourceUrl: reference,
    };
    const nutrition = {
      caloriesKcal: 250, proteinG: 9, carbG: 48, fatG: 3,
      basisQuantity: 100, basisUnit: "g" as const,
    };
    const labelPayload = {
      foodVariantId: 22, sourceId: 7, sourceItemCode: "SKU-A",
      sourceReference: reference, sourceVersion: "v1", nutrition,
    };
    const digest = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const labelProof = {
      ...proof, evidenceType: "nutrition_label",
      payloadJson: JSON.stringify(labelPayload), contentHash: digest(labelPayload),
    };
    const commercialProfile = { ...profile, foodVariantSourceId: 88 };
    const installCommercial = (nutritionProof: typeof labelProof) => installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [proof], [barcodeMapping], [commercialVariant],
      [commercialProfile], [{ source, grant }], [commercialMapping], [nutritionProof], [],
    );
    const branded = { ...request, brand: "Panco" };
    let select = installCommercial(labelProof);
    expect(await createFoodV2KnowledgeRepository().readLocal(branded))
      .toMatchObject({ kind: "match", variantId: 22, nutrition });
    expect(select).toHaveBeenCalledTimes(10);

    const changed = { ...labelPayload, nutrition: { ...nutrition, caloriesKcal: 400 } };
    select = installCommercial({
      ...labelProof, payloadJson: JSON.stringify(changed), contentHash: digest(changed),
    });
    expect(await createFoodV2KnowledgeRepository().readLocal(branded))
      .toEqual({ kind: "miss", reason: "incompatible_evidence" });
    expect(select).toHaveBeenCalledTimes(9);
  });
});

describe("AUD-1302-015: barcode and explicit name must agree", () => {

  it("AUD-1302-024: a personal proof never certifies a globally shared barcode", async () => {
    const globalVariant = {
      ...variantRow, family: { ...variantRow.family, scope: "global", ownerUserId: null },
    };
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [{ ...proof, ownerUserId: 41 }],
      [barcodeMapping], [globalVariant],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal(request))
      .toEqual({ kind: "miss", reason: "incompatible_evidence" });
    expect(select).toHaveBeenCalledTimes(5); // no profile or nutrients accessed
  });

  it("AUD-1302-024: globally sourced barcode proof remains readable with a publication grant", async () => {
    const globalVariant = {
      ...variantRow, family: { ...variantRow.family, scope: "global", ownerUserId: null },
    };
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [proof], [barcodeMapping], [globalVariant],
      [{ source, grant }], [profile], [{ source, grant }], [],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal(request))
      .toMatchObject({ kind: "match", matchingEvidence: "barcode", variantId: 22 });
    expect(select).toHaveBeenCalledTimes(9);
  });

  it("AUD-1302-024: the owner can still use personal proof for a private barcode", async () => {
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [{ ...proof, ownerUserId: 41 }],
      [barcodeMapping], [variantRow], [profile], [{ source, grant }], [],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal(request))
      .toMatchObject({ kind: "match", matchingEvidence: "barcode", variantId: 22 });
    expect(select).toHaveBeenCalledTimes(8);
  });
  it("resolves a valid barcode with a matching governed variant", async () => {
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [proof], [barcodeMapping], [variantRow], [profile], [{ source, grant }], [],
    );
    const result = await createFoodV2KnowledgeRepository().readLocal(request);
    expect(result).toMatchObject({ kind: "match", variantId: 22,
      matchingEvidence: "barcode", nutrition: { caloriesKcal: 250 } });
    expect(select).toHaveBeenCalledTimes(8);
  });

  it("AUD-1302-023: generic manufacturer page is not a barcode identity", async () => {
    const generic = "https://manufacturer.example/";
    const genericPayload = { ...payload, sourceReference: generic };
    const genericProof = {
      ...proof, sourceReference: generic, payloadJson: JSON.stringify(genericPayload),
      contentHash: createHash("sha256").update(JSON.stringify(genericPayload)).digest("hex"),
    };
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source: { ...source, sourceUrl: generic }, grant }],
      [genericProof],
      [{ ...barcodeMapping, sourceUrl: generic }],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal(request))
      .toEqual({ kind: "miss", reason: "incompatible_evidence" });
    expect(select).toHaveBeenCalledTimes(4); // no variant/profile reads
  });

  it("AUD-1302-023: sibling SKU link fails before reading nutrients", async () => {
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [proof],
      [{ ...barcodeMapping, sourceUrl: "https://manufacturer.example/products/sku-b" }],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal(request))
      .toEqual({ kind: "miss", reason: "incompatible_evidence" });
    expect(select).toHaveBeenCalledTimes(4);
  });

  it("reports conflicting explicit food name before reading any nutrition", async () => {
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [proof], [barcodeMapping], [variantRow],
      [], // no personal alias for the contradictory name
    );
    expect(await createFoodV2KnowledgeRepository().readLocal({
      ...request, normalizedName: "leite integral",
    })).toEqual({ kind: "conflict", reason: "multiple_identities" });
    expect(select).toHaveBeenCalledTimes(6);
  });

  it("does not consult cache or network after a known barcode/name conflict", async () => {
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [proof], [barcodeMapping], [variantRow], [],
    );
    const external = vi.fn();
    expect(await readThroughGovernedKnowledge({ ...request, normalizedName: "leite integral" },
      createFoodV2KnowledgeRepository(), external))
      .toEqual({ kind: "conflict", reason: "multiple_identities" });
    expect(external).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(6);
  });

  it("accepts a separately confirmed personal alias for the same barcode variant", async () => {
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [proof], [barcodeMapping], [variantRow], [{ id: 22 }],
      [profile], [{ source, grant }], [],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal({
      ...request, normalizedName: "meu pao",
    })).toMatchObject({ kind: "match", variantId: 22 });
    expect(select).toHaveBeenCalledTimes(9);
  });

  it("does not read a local variant when barcode evidence points to another code", async () => {
    const badPayload = { barcode: "07890000000002" };
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }],
      [{ ...proof, payloadJson: JSON.stringify(badPayload),
        contentHash: createHash("sha256").update(JSON.stringify(badPayload)).digest("hex") }],
      [barcodeMapping],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal(request))
      .toEqual({ kind: "miss", reason: "incompatible_evidence" });
    expect(select).toHaveBeenCalledTimes(4);
  });
});
