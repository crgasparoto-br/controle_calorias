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
const payload = { barcode: request.barcode, identity: { barcode: request.barcode }, label: "Pao integral" };
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
  id: 10, currentSlot: 1, status: "verified", sourceId: 7,
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
    hasCurrentBarcodeProof(candidate, barcode, 22, 7, reference, 41, now);

  it("accepts exact linked barcode evidence with a valid hash and resource", () => {
    expect(valid(proof)).toBe(true);
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
});

describe("AUD-1302-015: barcode and explicit name must agree", () => {
  it("resolves a valid barcode with a matching governed variant", async () => {
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [proof], [variantRow], [profile], [{ source, grant }], [],
    );
    const result = await createFoodV2KnowledgeRepository().readLocal(request);
    expect(result).toMatchObject({ kind: "match", variantId: 22,
      matchingEvidence: "barcode", nutrition: { caloriesKcal: 250 } });
    expect(select).toHaveBeenCalledTimes(7);
  });

  it("reports conflicting explicit food name before reading any nutrition", async () => {
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [proof], [variantRow],
      [], // no personal alias for the contradictory name
    );
    expect(await createFoodV2KnowledgeRepository().readLocal({
      ...request, normalizedName: "leite integral",
    })).toEqual({ kind: "conflict", reason: "multiple_identities" });
    expect(select).toHaveBeenCalledTimes(5);
  });

  it("does not consult cache or network after a known barcode/name conflict", async () => {
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [proof], [variantRow], [],
    );
    const external = vi.fn();
    expect(await readThroughGovernedKnowledge({ ...request, normalizedName: "leite integral" },
      createFoodV2KnowledgeRepository(), external))
      .toEqual({ kind: "conflict", reason: "multiple_identities" });
    expect(external).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(5);
  });

  it("accepts a separately confirmed personal alias for the same barcode variant", async () => {
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }], [proof], [variantRow], [{ id: 22 }],
      [profile], [{ source, grant }], [],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal({
      ...request, normalizedName: "meu pao",
    })).toMatchObject({ kind: "match", variantId: 22 });
    expect(select).toHaveBeenCalledTimes(8);
  });

  it("does not read a local variant when barcode evidence points to another code", async () => {
    const badPayload = { barcode: "07890000000002" };
    const select = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source, grant }],
      [{ ...proof, payloadJson: JSON.stringify(badPayload),
        contentHash: createHash("sha256").update(JSON.stringify(badPayload)).digest("hex") }],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal(request))
      .toEqual({ kind: "miss", reason: "incompatible_evidence" });
    expect(select).toHaveBeenCalledTimes(3);
  });
});
