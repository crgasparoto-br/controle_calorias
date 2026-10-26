import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import { createFoodV2KnowledgeRepository } from "./repository";
import { readThroughGovernedKnowledge } from "./knowledgeRead";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

const now = new Date("2026-10-21T12:00:00Z");
const grant = {
  sourceVersion: "v1", status: "approved", allowRead: 1, allowPersistEvidence: 1,
  allowGlobalPublication: 1, licenseReference: "https://manufacturer.example/license",
  approvalReference: "approved:1", approvedAt: new Date("2026-10-20T12:00:00Z"),
  validUntil: null, revokedAt: null, retentionDays: 30,
};
const source = { id: 7, version: "v1", sourceUrl: "https://manufacturer.example" };
const request = {
  normalizedName: "meu pao", userId: 41, brand: null, barcode: null,
  policyVersion: "p1", resolverVersion: "v2", now,
};

/** Use the actual repository adapter with a deterministic Drizzle result
 * queue; an incorrect read order or extra ungoverned query breaks the fixture. */
function installResults(...pages: unknown[][]) {
  const selects = vi.fn(() => ({
    from() { return this; },
    innerJoin() { return this; },
    leftJoin() { return this; },
    where() { return this; },
    limit: vi.fn(async () => {
      if (!pages.length) throw new Error("Unexpected governed query");
      return pages.shift();
    }),
  }));
  vi.mocked(getDb).mockResolvedValue({ select: selects } as never);
  return selects;
}

/** Commercial evidence fixtures must prove their nutrient assertions, not just
 * carry a nonempty digest that the real repository now correctly rejects. */
function commercialLabelEvidence(
  mapping: { foodVariantId: number; sourceId: number; sourceItemCode: string; sourceUrl: string },
  nutrition: { caloriesKcal: number; proteinG: number; carbG: number; fatG: number;
    basisQuantity: number; basisUnit: string },
  sourceVersion = "v1",
) {
  const payload = {
    foodVariantId: mapping.foodVariantId, sourceId: mapping.sourceId,
    sourceItemCode: mapping.sourceItemCode, sourceReference: mapping.sourceUrl,
    sourceVersion, nutrition,
  };
  return {
    foodVariantId: mapping.foodVariantId, sourceId: mapping.sourceId, ownerUserId: null,
    evidenceType: "nutrition_label", sourceReference: mapping.sourceUrl,
    payloadJson: JSON.stringify(payload),
    contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    retentionUntil: new Date("2026-11-21T12:00:00Z"),
  };
}

beforeEach(() => { vi.resetAllMocks(); });

describe("B2 actual repository governed read", () => {
  it("resolves user-confirmed commercial aliases without brand repetition", async () => {
    const nutrition = {
      caloriesKcal: 250, proteinG: 9, carbG: 48, fatG: 3,
      basisQuantity: 100, basisUnit: "g",
    };
    const mapping = {
      id: 9, status: "active", foodVariantId: 22, sourceId: 7,
      sourceItemCode: "SKU-1", sourceUrl: "https://manufacturer.example/products/sku-1",
    };
    const evidence = commercialLabelEvidence(mapping, nutrition);
    installResults(
      [{ id: 22 }],                 // confirmed alias points to SKU 22
      [{ id: 99 }],                 // homonymous exact name points elsewhere
      [],                           // unrelated global alias
      [{ id: 99 }],                 // generic would also match if alias lost
      [{ variant: { id: 22, status: "active", governanceStatus: "verified",
          variantType: "branded", displayName: "Panco integral" },
        family: { id: 4, status: "active", scope: "global", ownerUserId: null },
        brand: { name: "Panco" } }],
      [{ id: 10, currentSlot: 1, status: "verified", sourceId: 7, sourceVersion: "v1",
        foodVariantSourceId: mapping.id, validFrom: null, validTo: null, ...nutrition }],
      [{ source, grant }],
      [mapping],
      [evidence],
      [],                           // portions
    );
    const result = await createFoodV2KnowledgeRepository().readLocal(request);
    expect(result).toMatchObject({
      kind: "match", matchingEvidence: "personal_alias",
      variantId: 22, governanceStatus: "verified",
      sourceReference: mapping.sourceUrl,
    });
  });


  it("AUD-1302-022: a revoked personal alias never falls through to homonymous macros", async () => {
    const nutrition = {
      caloriesKcal: 250, proteinG: 9, carbG: 48, fatG: 3,
      basisQuantity: 100, basisUnit: "g",
    };
    const select = installResults(
      [{ id: 22 }], // User confirmed SKU variant 22
      [{ id: 99 }], // Same name, unrelated generic variant 99
      [], [{ id: 99 }],
      [{ variant: { id: 22, status: "active", governanceStatus: "verified",
          variantType: "branded", displayName: "Panco integral" },
        family: { id: 4, status: "active", scope: "global", ownerUserId: null },
        brand: { name: "Panco" } }],
      [{ id: 10, currentSlot: 1, status: "verified", sourceId: 7, sourceVersion: "v1",
        foodVariantSourceId: null, validFrom: null, validTo: null, ...nutrition }],
      [{ source, grant: { ...grant, status: "revoked", revokedAt: now } }],
    );
    const external = vi.fn();
    expect(await readThroughGovernedKnowledge(request,
      createFoodV2KnowledgeRepository(), external))
      .toEqual({ kind: "miss", reason: "no_governed_profile" });
    expect(select).toHaveBeenCalledTimes(7);
    expect(external).not.toHaveBeenCalled();
  });

  it("AUD-1302-022: retired personal variant cannot fall back to unrelated nutrition", async () => {
    const select = installResults(
      [{ id: 22 }], [{ id: 99 }], [], [{ id: 99 }],
      [{ variant: { id: 22, status: "active", governanceStatus: "revoked",
          variantType: "branded", displayName: "Panco integral" },
        family: { id: 4, status: "active", scope: "global", ownerUserId: null },
        brand: { name: "Panco" } }],
    );
    const external = vi.fn();
    expect(await readThroughGovernedKnowledge(request,
      createFoodV2KnowledgeRepository(), external))
      .toEqual({ kind: "miss", reason: "no_governed_profile" });
    expect(external).not.toHaveBeenCalled();
    expect(select).toHaveBeenCalledTimes(5); // no homonym or profile read
  });

  it("AUD-1302-022: two confirmed identities stay ambiguous even if one is unusable", async () => {
    const select = installResults(
      [{ id: 22 }, { id: 99 }], // conflicting confirmations
      [{ id: 99 }], [], [{ id: 99 }],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal(request))
      .toEqual({ kind: "conflict", reason: "multiple_identities" });
    expect(select).toHaveBeenCalledTimes(4);
  });

  it("denies globally visible profiles from read-only sources", async () => {
    const mapping = {
      id: 9, status: "active", foodVariantId: 22, sourceId: 7,
      sourceItemCode: "SKU-1", sourceUrl: "https://manufacturer.example/products/sku-1",
    };
    const evidence = {
      foodVariantId: 22, sourceId: 7, ownerUserId: null,
      evidenceType: "nutrition_label", sourceReference: mapping.sourceUrl,
      contentHash: "proof", retentionUntil: new Date("2026-11-21T12:00:00Z"),
    };
    installResults(
      [{ id: 22 }], [],
      [{ variant: { id: 22, status: "active", governanceStatus: "verified",
          variantType: "branded", displayName: "Panco" },
        family: { id: 4, status: "active", scope: "global", ownerUserId: null },
        brand: { name: "Panco" } }],
      [{ id: 10, currentSlot: 1, status: "verified", sourceId: 7, sourceVersion: "v1",
        foodVariantSourceId: mapping.id, validFrom: null, validTo: null,
        caloriesKcal: 200, proteinG: 8, carbG: 37, fatG: 2, basisQuantity: 100, basisUnit: "g" }],
      [{ source, grant: { ...grant, allowGlobalPublication: 0 } }],
      [mapping], [evidence], [],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal({ ...request, brand: "Panco" }))
      .toEqual({ kind: "miss", reason: "not_found" });
  });

  it("allows a personally scoped food with read-only source authorization", async () => {
    const nutrition = {
      caloriesKcal: 210, proteinG: 8, carbG: 37, fatG: 2,
      basisQuantity: 100, basisUnit: "g",
    };
    const mapping = {
      id: 9, status: "active", foodVariantId: 22, sourceId: 7,
      sourceItemCode: "SKU-1", sourceUrl: "https://manufacturer.example/products/sku-1",
    };
    installResults(
      [{ id: 22 }], [],
      [{ variant: { id: 22, status: "active", governanceStatus: "verified",
          variantType: "branded", displayName: "Panco pessoal" },
        family: { id: 4, status: "active", scope: "user", ownerUserId: 41 },
        brand: { name: "Panco" } }],
      [{ id: 10, currentSlot: 1, status: "verified", sourceId: 7, sourceVersion: "v1",
        foodVariantSourceId: mapping.id, validFrom: null, validTo: null,
        ...nutrition }],
      [{ source, grant: { ...grant, allowGlobalPublication: 0 } }],
      [mapping],
      [commercialLabelEvidence(mapping, nutrition)],
      [],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal({ ...request, brand: "Panco" }))
      .toMatchObject({ kind: "match", variantId: 22, nutrition: { caloriesKcal: 210 } });
  });

  it("AUD-1302-021: owner's exact private SKU label is readable but stays provisional", async () => {
    const nutrition = {
      caloriesKcal: 210, proteinG: 8, carbG: 37, fatG: 2,
      basisQuantity: 100, basisUnit: "g" as const,
    };
    const mapping = {
      id: 9, status: "active", foodVariantId: 22, sourceId: 7,
      sourceItemCode: "SKU-1", sourceUrl: "https://manufacturer.example/products/sku-1",
    };
    const evidence = { ...commercialLabelEvidence(mapping, nutrition), ownerUserId: 41 };
    const rows = () => [
      [{ id: 22 }], [], // exact variant and global alias
      [{ variant: { id: 22, status: "active", governanceStatus: "verified",
        variantType: "branded", displayName: "Meu Panco" },
        family: { id: 4, status: "active", scope: "user", ownerUserId: 41 },
        brand: { name: "Panco" } }],
      [{ id: 10, currentSlot: 1, status: "verified", sourceId: 7, sourceVersion: "v1",
        foodVariantSourceId: mapping.id, validFrom: null, validTo: null, ...nutrition }],
      [{ source, grant: { ...grant, allowGlobalPublication: 0 } }],
      [mapping], [evidence], [],
    ];
    installResults(...rows());
    const personal = await createFoodV2KnowledgeRepository().readLocal({ ...request, brand: "Panco" });
    expect(personal).toMatchObject({ kind: "match", variantId: 22,
      governanceStatus: "provisional", nutrition: { caloriesKcal: 210 } });
    installResults(...rows());
    expect(await createFoodV2KnowledgeRepository().readLocal({ ...request, userId: 42, brand: "Panco" }))
      .toEqual({ kind: "miss", reason: "not_found" });
    installResults(...rows());
    expect(await createFoodV2KnowledgeRepository().readLocal({ ...request, userId: null, brand: "Panco" }))
      .toEqual({ kind: "miss", reason: "not_found" });
  });

  it("does not publish a global alias licensed only for source reading", async () => {
    installResults(
      [], // no exact variant
      [{ foodId: 4, foodVariantId: 22, governanceStatus: "verified", sourceId: 7, sourceVersion: "v1" }],
      [{ source, grant: { ...grant, allowGlobalPublication: 0 } }],
      [], // no generic family
    );
    expect(await createFoodV2KnowledgeRepository().readLocal({ ...request, userId: null }))
      .toEqual({ kind: "miss", reason: "not_found" });
  });

  it("rejects a public barcode identity when its own source has read-only permission", async () => {
    // Reading the barcode source is allowed, but its global publication is
    // not: the reader must revalidate that grant before loading nutrition.
    const readOnly = { ...grant, allowGlobalPublication: 0 };
    const reference = "https://manufacturer.example/products/sku-1";
    const proofPayload = {
      barcode: "7890000000001", foodVariantId: 22, sourceId: 7,
      sourceItemCode: "SKU-1", sourceReference: reference,
      sourceVersion: "v1",
    };
    const contentHash = createHash("sha256").update(JSON.stringify(proofPayload)).digest("hex");
    const selects = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source: { ...source, sourceUrl: reference }, grant: readOnly }], // initial read permission
      [{ id: 17, sourceId: 7, foodVariantId: 22, ownerUserId: null,
        evidenceType: "barcode", retentionUntil: new Date("2026-11-21T12:00:00Z"),
        sourceReference: reference, payloadJson: JSON.stringify(proofPayload), contentHash }],
      [{ foodVariantId: 22, sourceId: 7, sourceItemCode: "SKU-1",
        sourceUrl: reference, status: "active" }], // exact authorized SKU proof
      [{ variant: { id: 22, status: "active", governanceStatus: "verified",
          variantType: "generic", displayName: "Pao", normalizedName: "pao" },
        family: { id: 4, status: "active", scope: "global", ownerUserId: null,
          normalizedName: "meu pao" },
        brand: null }],
      [{ source, grant: readOnly }], // public identity permission: denied
    );
    expect(await createFoodV2KnowledgeRepository().readLocal({
      ...request, barcode: "7890000000001",
    })).toEqual({ kind: "miss", reason: "incompatible_evidence" });
    expect(selects).toHaveBeenCalledTimes(6); // reaches the global source grant denial
  });

  it("does not renew the first-capture retention on duplicate external evidence", async () => {
    const expired = new Date(Date.now() - 60_000);
    const candidate = {
      sourceId: 7, sourceReference: "https://manufacturer.example/products/sku-1",
      identity: { name: request.normalizedName },
      nutrition: { caloriesKcal: 200, proteinG: 8, carbG: 37, fatG: 2,
        basisQuantity: 100, basisUnit: "g" as const },
    };
    let updatedRetention: unknown;
    const pages: unknown[][] = [
      [{ source: { ...source, sourceUrl: candidate.sourceReference }, grant }],
      [{ retentionUntil: expired, sourceReference: candidate.sourceReference,
        payloadJson: "original-captured-evidence" }],
    ];
    vi.mocked(getDb).mockResolvedValue({
      select: vi.fn(() => ({
        from() { return this; }, innerJoin() { return this; }, where() { return this; },
        limit: vi.fn(async () => pages.shift() ?? []),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onDuplicateKeyUpdate: vi.fn(async ({ set }: { set: { retentionUntil: unknown } }) => {
            updatedRetention = set.retentionUntil;
          }),
        })),
      })),
    } as never);
    expect(await createFoodV2KnowledgeRepository().stagePendingEvidence(request, candidate))
      .toBe(false);
    // The UPSERT must compare against the old persisted deadline, not
    // overwrite it with Date.now() + retentionDays, and must additionally
    // cap duplicates against the original capture under the current grant.
    const queryChunks = (updatedRetention as { queryChunks?: Array<{ value?: string[] }> })?.queryChunks;
    expect(queryChunks?.some(chunk => chunk.value?.some(part => part.includes("LEAST("))))
      .toBe(true);
    expect(queryChunks?.some(chunk => chunk.value?.some(part => part.includes("DATE_ADD("))))
      .toBe(true);
  });

  it("rejects cached payload references from a different source origin", async () => {
    const cachePayload = {
      status: "provisional", sourceVersion: "v1", policyVersion: "p1",
      resolverVersion: "v2", sourceReference: "https://other.example/sku-1",
      identity: { name: request.normalizedName },
      nutrition: { caloriesKcal: 200, proteinG: 5, carbG: 15,
        fatG: 4, basisQuantity: 100, basisUnit: "g" },
    };
    const digest = createHash("sha256").update(JSON.stringify(cachePayload)).digest("hex");
    installResults(
      [{ sourceId: 7, ownerUserId: 41, contentHash: digest,
        sourceReference: cachePayload.sourceReference, evidenceType: "external_source",
        capturedAt: new Date("2026-10-21T00:00:00Z"),
        retentionUntil: new Date("2026-10-22T12:00:00Z"),
        payloadJson: JSON.stringify(cachePayload) }],
      [{ source, grant }],
    );
    expect(await createFoodV2KnowledgeRepository().readPendingEvidence(request)).toBeNull();
  });

  it("rejects cached evidence when the persisted source reference differs from the payload", async () => {
    const payload = {
      status: "provisional", sourceVersion: "v1", policyVersion: "p1",
      resolverVersion: "v2", sourceReference: "https://manufacturer.example/sku-1",
      identity: { name: request.normalizedName },
      nutrition: { caloriesKcal: 200, proteinG: 5, carbG: 15,
        fatG: 4, basisQuantity: 100, basisUnit: "g" },
    };
    const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    installResults(
      [{ sourceId: 7, ownerUserId: 41, contentHash: digest,
        sourceReference: "https://manufacturer.example/other-sku",
        capturedAt: new Date("2026-10-21T00:00:00Z"),
        retentionUntil: new Date("2026-10-22T12:00:00Z"),
        payloadJson: JSON.stringify(payload) }],
      [{ source: { ...source, sourceUrl: payload.sourceReference }, grant }],
    );
    expect(await createFoodV2KnowledgeRepository().readPendingEvidence(request)).toBeNull();
  });

  it("never contacts the external provider after governed database unavailability", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    const external = vi.fn();
    expect(await readThroughGovernedKnowledge(request,
      createFoodV2KnowledgeRepository(), external))
      .toEqual({ kind: "unavailable", reason: "governed_store_unavailable" });
    expect(external).not.toHaveBeenCalled();
  });
  it("does not use the license reference as nutrition provenance when source URL is absent", async () => {
    const nutrition = { caloriesKcal: 210, proteinG: 8, carbG: 37, fatG: 2,
      basisQuantity: 100, basisUnit: "g" };
    const mapping = { id: 9, status: "active", foodVariantId: 22, sourceId: 7,
      sourceItemCode: "SKU-1", sourceUrl: "https://manufacturer.example/products/sku-1" };
    installResults(
      [{ id: 22 }], [], // exact, global aliases
      [{ variant: { id: 22, status: "active", governanceStatus: "verified",
          variantType: "generic", displayName: "Pao" },
        family: { id: 4, status: "active", scope: "user", ownerUserId: 41 },
        brand: { name: "Panco" } }],
      [{ id: 10, currentSlot: 1, status: "verified", sourceId: 7, sourceVersion: "v1",
        foodVariantSourceId: mapping.id, validFrom: null, validTo: null, ...nutrition }],
      [{ source: { ...source, sourceUrl: null }, grant }],
      [mapping], [commercialLabelEvidence(mapping, nutrition)],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal({ ...request, brand: "Panco" }))
      .toEqual({ kind: "miss", reason: "not_found" });
  });

  it("rejects a same-origin but different SKU on cache read", async () => {
    const candidate = {
      sourceId: 7, sourceReference: "https://manufacturer.example/products/sku-b",
      nutrition: { caloriesKcal: 360, proteinG: 12, carbG: 45,
        fatG: 13, basisQuantity: 100, basisUnit: "g" as const },
    };
    const payload = {
      status: "provisional", sourceVersion: "v1",
      sourceReference: candidate.sourceReference,
      resolverVersion: "v2", policyVersion: "p1",
      identity: { name: request.normalizedName },
      nutrition: candidate.nutrition,
    };
    const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    installResults(
      [{ sourceId: 7, contentHash: digest, sourceReference: candidate.sourceReference,
        capturedAt: new Date("2026-10-21T00:00:00Z"),
        retentionUntil: new Date("2026-10-22T12:00:00Z"), payloadJson: JSON.stringify(payload) }],
      [{ source: { ...source, sourceUrl: "https://manufacturer.example/products/sku-a" }, grant }],
    );
    expect(await createFoodV2KnowledgeRepository().readPendingEvidence(request)).toBeNull();
  });

  it("rejects a same-origin different SKU before the cache write", async () => {
    const candidate = {
      sourceId: 7, sourceReference: "https://manufacturer.example/products/sku-b",
      identity: { name: request.normalizedName },
      nutrition: { caloriesKcal: 360, proteinG: 12, carbG: 45,
        fatG: 13, basisQuantity: 100, basisUnit: "g" as const },
    };
    const selects = installResults(
      [{ source: { ...source, sourceUrl: "https://manufacturer.example/products/sku-a" }, grant }],
    );
    expect(await createFoodV2KnowledgeRepository().stagePendingEvidence(request, candidate)).toBe(false);
    expect(selects).toHaveBeenCalledTimes(1);
  });

  it("rejects tampered nutritional macros even when source, version and URL are valid", async () => {
    const original = {
      status: "provisional", sourceVersion: "v1",
      sourceReference: "https://manufacturer.example/products/sku-a",
      resolverVersion: "v2", policyVersion: "p1",
      identity: { name: request.normalizedName },
      nutrition: { caloriesKcal: 200, proteinG: 8, carbG: 37, fatG: 2,
        basisQuantity: 100, basisUnit: "g" as const },
    };
    const digest = createHash("sha256").update(JSON.stringify(original)).digest("hex");
    const tampered = { ...original, nutrition: { ...original.nutrition, caloriesKcal: 999 } };
    installResults(
      [{ sourceId: 7, contentHash: digest, sourceReference: original.sourceReference,
        capturedAt: new Date("2026-10-21T00:00:00Z"),
        retentionUntil: new Date("2026-10-22T12:00:00Z"), payloadJson: JSON.stringify(tampered) }],
      [{ source: { ...source, sourceUrl: original.sourceReference }, grant }],
    );
    expect(await createFoodV2KnowledgeRepository().readPendingEvidence(request)).toBeNull();
  });


  it("AUD-1302-025: shortening retention invalidates a previously valid cache without replay", async () => {
    const sourceReference = "https://manufacturer.example/products/sku-a";
    const payload = {
      status: "provisional", sourceVersion: "v1",
      sourceReference, resolverVersion: "v2", policyVersion: "p1",
      identity: { name: request.normalizedName },
      nutrition: { caloriesKcal: 200, proteinG: 8, carbG: 37, fatG: 2,
        basisQuantity: 100, basisUnit: "g" as const },
    };
    const capturedAt = new Date("2026-10-18T12:00:00Z");
    const evidence = {
      sourceId: 7, ownerUserId: 41, capturedAt,
      contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      sourceReference, retentionUntil: new Date("2026-11-17T12:00:00Z"),
      payloadJson: JSON.stringify(payload),
    };
    const authorizedSource = { ...source, sourceUrl: sourceReference };
    const approvedAt = new Date("2026-10-17T12:00:00Z");
    // Control: the original 30-day grant accepts this exact cached evidence.
    installResults([evidence], [{
      source: authorizedSource, grant: { ...grant, approvedAt, retentionDays: 30 },
    }]);
    expect(await createFoodV2KnowledgeRepository().readPendingEvidence(request))
      .toMatchObject({ sourceId: 7, nutrition: { caloriesKcal: 200 } });
    // Same row and source version, but the updated 1-day grant must deny it.
    installResults([evidence], [{
      source: authorizedSource, grant: { ...grant, approvedAt, retentionDays: 1 },
    }]);
    expect(await createFoodV2KnowledgeRepository().readPendingEvidence(request)).toBeNull();
    // Missing capture lineage is also denied; a later TTL alone proves nothing.
    installResults([{ ...evidence, capturedAt: null }], [{
      source: authorizedSource, grant: { ...grant, approvedAt, retentionDays: 30 },
    }]);
    expect(await createFoodV2KnowledgeRepository().readPendingEvidence(request)).toBeNull();
  });

  it("accepts a matching untampered cache entry with exact approved URL", async () => {
    const payload = {
      status: "provisional", sourceVersion: "v1",
      sourceReference: "https://manufacturer.example/products/sku-a",
      resolverVersion: "v2", policyVersion: "p1",
      identity: { name: request.normalizedName },
      nutrition: { caloriesKcal: 200, proteinG: 8, carbG: 37, fatG: 2,
        basisQuantity: 100, basisUnit: "g" as const },
    };
    const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    installResults(
      [{ sourceId: 7, contentHash: digest, sourceReference: payload.sourceReference,
        capturedAt: new Date("2026-10-21T00:00:00Z"),
        retentionUntil: new Date("2026-10-22T12:00:00Z"), payloadJson: JSON.stringify(payload) }],
      [{ source: { ...source, sourceUrl: payload.sourceReference }, grant }],
    );
    expect(await createFoodV2KnowledgeRepository().readPendingEvidence(request))
      .toMatchObject({ sourceId: 7, sourceReference: payload.sourceReference, nutrition: { caloriesKcal: 200 } });
  });

});


describe("AUD-1302-026: governed profile and portion revisions", () => {
  const query = { ...request, normalizedName: "pao integral", brand: "Panco" };
  const nutrition = (caloriesKcal: number) => ({
    caloriesKcal, proteinG: 8, carbG: 35, fatG: 3,
    basisQuantity: 100, basisUnit: "g",
  });
  const variant = {
    variant: { id: 22, status: "active", governanceStatus: "verified",
      variantType: "generic", displayName: "Pao integral" },
    family: { id: 4, status: "active", scope: "user", ownerUserId: 41 },
    brand: { name: "Panco" },
  };
  // Version/portion scenarios must start with complete same-product proof;
  // otherwise an unrelated commercial-provenance denial masks the oracle.
  const mapping = { id: 9, status: "active", foodVariantId: 22, sourceId: 7,
    sourceItemCode: "SKU-1", sourceUrl: "https://manufacturer.example/products/sku-1" };
  const profile = (version: string | null, kcal: number) => ({
    id: 10, currentSlot: 1, status: "verified", sourceId: 7,
    sourceVersion: version, foodVariantSourceId: mapping.id,
    validFrom: null, validTo: null, ...nutrition(kcal),
  });
  const portion = (version: string | null, foodId = 4) => ({
    foodId, status: "verified", sourceId: 7, sourceVersion: version,
    validFrom: null, validTo: null, grams: 30, label: "fatia",
    unit: "serving", quantity: 1,
  });
  const licensed = (version: string) => ({
    source: { ...source, version },
    grant: { ...grant, sourceVersion: version },
  });
  const stage = (profileVersion: string | null, sourceVersion: string,
    portionVersion?: string | null, kcal = 100) => {
    const pages: unknown[][] = [
      [{ id: 22 }], [], [variant], [profile(profileVersion, kcal)],
      [licensed(sourceVersion)],
    ];
    if (profileVersion === sourceVersion) {
      pages.push([mapping], [commercialLabelEvidence(mapping, nutrition(kcal), sourceVersion)]);
      pages.push(portionVersion === undefined ? [] : [portion(portionVersion)]);
      if (portionVersion != null) pages.push([licensed(sourceVersion)]);
    }
    return installResults(...pages);
  };

  it("accepts a matching v1 profile and portion", async () => {
    const select = stage("v1", "v1", "v1");
    expect(await createFoodV2KnowledgeRepository().readLocal(query)).toMatchObject({
      kind: "match", sourceVersion: "v1",
      nutrition: { caloriesKcal: 100 }, portions: [{ label: "fatia", grams: 30 }],
    });
    expect(select).toHaveBeenCalledTimes(9);
  });

  it("AUD-1302-031: never returns a portion belonging to a different food family", async () => {
    // Deliberately different family identifiers; both portions have valid
    // source/grant revisions and plausible, different physical weights.
    installResults(
      [{ id: 22 }], [], [variant], [profile("v1", 100)], [licensed("v1")],
      [mapping], [commercialLabelEvidence(mapping, nutrition(100))],
      [portion("v1"), { ...portion("v1", 99), label: "pacote", grams: 250 }],
      [licensed("v1")],
    );
    const result = await createFoodV2KnowledgeRepository().readLocal(query);
    expect(result).toMatchObject({
      kind: "match", foodId: 4, variantId: 22,
      portions: [{ label: "fatia", grams: 30 }],
    });
    if (result.kind !== "match") throw new Error("expected governed match");
    expect(result.portions).not.toContainEqual(expect.objectContaining({ grams: 250 }));
  });

  it("AUD-1302-031: a foreign-only serving cannot borrow an authorized variant", async () => {
    installResults(
      [{ id: 22 }], [], [variant], [profile("v1", 100)], [licensed("v1")],
      [mapping], [commercialLabelEvidence(mapping, nutrition(100))],
      [portion("v1", 99)],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal(query))
      .toMatchObject({ kind: "match", portions: [] });
  });

  it("rejects v1 macros after source/grant upgrade to v2", async () => {
    const select = stage("v1", "v2");
    // This scenario asserts the governed repository boundary: a stale V1
    // profile cannot be reported as current V2 nutrition. The orchestrator
    // may separately consult pending evidence after this legitimate miss.
    expect(await createFoodV2KnowledgeRepository().readLocal(query)).toEqual({
      kind: "miss", reason: "not_found",
    });
    expect(select).toHaveBeenCalledTimes(5);
  });

  it("uses revalidated v2 nutrition without silently reusing v1 portions", async () => {
    const select = stage("v2", "v2", "v1", 160);
    expect(await createFoodV2KnowledgeRepository().readLocal(query)).toMatchObject({
      kind: "match", sourceVersion: "v2",
      nutrition: { caloriesKcal: 160 }, portions: [],
    });
    expect(select).toHaveBeenCalledTimes(9);
    stage("v2", "v2", "v2", 160);
    expect(await createFoodV2KnowledgeRepository().readLocal(query)).toMatchObject({
      kind: "match", sourceVersion: "v2",
      nutrition: { caloriesKcal: 160 }, portions: [{ grams: 30 }],
    });
  });

  it("fails closed for unknown legacy source revisions", async () => {
    stage(null, "v2");
    expect(await createFoodV2KnowledgeRepository().readLocal(query))
      .toEqual({ kind: "miss", reason: "not_found" });
    stage("v2", "v2", null, 160);
    expect(await createFoodV2KnowledgeRepository().readLocal(query))
      .toMatchObject({ kind: "match", portions: [] });
  });

  it("does not allow a revoked grant even with matching source versions", async () => {
    installResults([{ id: 22 }], [], [variant], [profile("v2", 160)],
      [{ source: { ...source, version: "v2" },
        grant: { ...grant, sourceVersion: "v2", status: "revoked", revokedAt: now } }]);
    expect(await createFoodV2KnowledgeRepository().readLocal(query))
      .toEqual({ kind: "miss", reason: "not_found" });
  });
});


describe("AUD-1302-027/028: global alias family and exact source revision", () => {
  const publicRequest = { ...request, userId: null, normalizedName: "feijao preto" };
  const profile = {
    id: 71, currentSlot: 1, status: "verified", sourceId: 7,
    sourceVersion: "v1", foodVariantSourceId: null, validFrom: null, validTo: null,
    caloriesKcal: 132, proteinG: 9, carbG: 23, fatG: 0.5,
    basisQuantity: 100, basisUnit: "g",
  };
  const alias = { id: 81, foodId: 4, foodVariantId: 22,
    governanceStatus: "verified", sourceId: 7, sourceVersion: "v1" };
  const approved = (version = "v1") => ({
    source: { ...source, version }, grant: { ...grant, sourceVersion: version },
  });
  const variant = (familyId: number) => ({
    variant: { id: 22, foodId: familyId, variantType: "generic", status: "active",
      governanceStatus: "verified", displayName: "Feijao preto", normalizedName: "feijao preto" },
    family: { id: familyId, scope: "global", ownerUserId: null, status: "active" },
    brand: null,
  });

  it("rejects alias family mismatch before reading nutrients from a different food", async () => {
    // Alias points at food 4, but variant 22 really belongs to food 99.
    const query = installResults([], [alias], [approved()], [], [variant(99)]);
    expect(await createFoodV2KnowledgeRepository().readLocal(publicRequest))
      .toEqual({ kind: "miss", reason: "not_found" });
    expect(query).toHaveBeenCalledTimes(5); // No profile lookup for food 99.
  });

  it("accepts an explicitly versioned alias whose family and nutritional source agree", async () => {
    installResults([], [alias], [approved()], [], [variant(4)], [profile], [approved()], []);
    expect(await createFoodV2KnowledgeRepository().readLocal(publicRequest)).toMatchObject({
      kind: "match", matchingEvidence: "global_alias", foodId: 4,
      variantId: 22, nutrition: { caloriesKcal: 132 }, sourceVersion: "v1",
    });
  });

  it("denies an alias approved in v1 after its source changes to v2", async () => {
    const query = installResults([], [alias], [approved("v2")], []);
    expect(await createFoodV2KnowledgeRepository().readLocal(publicRequest))
      .toEqual({ kind: "miss", reason: "not_found" });
    expect(query).toHaveBeenCalledTimes(4); // No stale v1 variant/profile selection.
  });

  it("fails closed for an unversioned legacy alias instead of guessing latest approval", async () => {
    const query = installResults([], [{ ...alias, sourceVersion: null }], []);
    expect(await createFoodV2KnowledgeRepository().readLocal(publicRequest))
      .toEqual({ kind: "miss", reason: "not_found" });
    expect(query).toHaveBeenCalledTimes(3); // No source, variant or profile was read.
  });
});
