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
    const evidence = {
      foodVariantId: 22, sourceId: 7, ownerUserId: null,
      evidenceType: "nutrition_label",
      sourceReference: mapping.sourceUrl, contentHash: "evidence-hash",
      retentionUntil: new Date("2026-11-21T12:00:00Z"),
    };
    installResults(
      [{ id: 22 }],                 // confirmed alias points to SKU 22
      [{ id: 99 }],                 // homonymous exact name points elsewhere
      [],                           // unrelated global alias
      [{ id: 99 }],                 // generic would also match if alias lost
      [{ variant: { id: 22, status: "active", governanceStatus: "verified",
          variantType: "branded", displayName: "Panco integral" },
        family: { id: 4, status: "active", scope: "global", ownerUserId: null },
        brand: { name: "Panco" } }],
      [{ id: 10, currentSlot: 1, status: "verified", sourceId: 7,
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
      [{ id: 10, currentSlot: 1, status: "verified", sourceId: 7,
        foodVariantSourceId: mapping.id, validFrom: null, validTo: null,
        caloriesKcal: 200, proteinG: 8, carbG: 37, fatG: 2, basisQuantity: 100, basisUnit: "g" }],
      [{ source, grant: { ...grant, allowGlobalPublication: 0 } }],
      [mapping], [evidence], [],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal({ ...request, brand: "Panco" }))
      .toEqual({ kind: "miss", reason: "not_found" });
  });

  it("allows a personally scoped food with read-only source authorization", async () => {
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
      [{ id: 10, currentSlot: 1, status: "verified", sourceId: 7,
        foodVariantSourceId: mapping.id, validFrom: null, validTo: null,
        caloriesKcal: 210, proteinG: 8, carbG: 37, fatG: 2, basisQuantity: 100, basisUnit: "g" }],
      [{ source, grant: { ...grant, allowGlobalPublication: 0 } }],
      [mapping],
      [{ foodVariantId: 22, sourceId: 7, ownerUserId: null,
        evidenceType: "nutrition_label", sourceReference: mapping.sourceUrl,
        contentHash: "proof", retentionUntil: new Date("2026-11-21T12:00:00Z") }],
      [],
    );
    expect(await createFoodV2KnowledgeRepository().readLocal({ ...request, brand: "Panco" }))
      .toMatchObject({ kind: "match", variantId: 22, nutrition: { caloriesKcal: 210 } });
  });

  it("does not publish a global alias licensed only for source reading", async () => {
    installResults(
      [], // no exact variant
      [{ foodVariantId: 22, governanceStatus: "verified", sourceId: 7 }],
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
    const proofPayload = { barcode: "7890000000001" };
    const contentHash = createHash("sha256").update(JSON.stringify(proofPayload)).digest("hex");
    const selects = installResults(
      [{ foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
      [{ source: { ...source, sourceUrl: reference }, grant: readOnly }], // initial read permission
      [{ id: 17, sourceId: 7, foodVariantId: 22, ownerUserId: null,
        evidenceType: "barcode", retentionUntil: new Date("2026-11-21T12:00:00Z"),
        sourceReference: reference, payloadJson: JSON.stringify(proofPayload), contentHash }],
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
    expect(selects).toHaveBeenCalledTimes(5);
  });

  it("does not renew the first-capture retention on duplicate external evidence", async () => {
    const expired = new Date(Date.now() - 60_000);
    const candidate = {
      sourceId: 7, sourceReference: "https://manufacturer.example/products/sku-1",
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
    // overwrite it with Date.now() + retentionDays.
    const queryChunks = (updatedRetention as { queryChunks?: Array<{ value?: string[] }> })?.queryChunks;
    expect(queryChunks?.some(chunk => chunk.value?.some(part => part.includes("LEAST("))))
      .toBe(true);
  });

  it("rejects cached payload references from a different source origin", async () => {
    const cachePayload = {
      status: "provisional", sourceVersion: "v1", policyVersion: "p1",
      resolverVersion: "v2", sourceReference: "https://other.example/sku-1",
      nutrition: { caloriesKcal: 200, proteinG: 5, carbG: 15,
        fatG: 4, basisQuantity: 100, basisUnit: "g" },
    };
    installResults(
      [{ sourceId: 7, ownerUserId: 41,
        sourceReference: cachePayload.sourceReference, evidenceType: "external_source",
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
      nutrition: { caloriesKcal: 200, proteinG: 5, carbG: 15,
        fatG: 4, basisQuantity: 100, basisUnit: "g" },
    };
    installResults(
      [{ sourceId: 7, ownerUserId: 41,
        sourceReference: "https://manufacturer.example/other-sku",
        retentionUntil: new Date("2026-10-22T12:00:00Z"),
        payloadJson: JSON.stringify(payload) }],
      [{ source, grant }],
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
    installResults(
      [{ id: 22 }], [], // exact, global aliases
      [{ variant: { id: 22, status: "active", governanceStatus: "verified",
          variantType: "generic", displayName: "Pao" },
        family: { id: 4, status: "active", scope: "user", ownerUserId: 41 },
        brand: { name: "Panco" } }],
      [{ id: 10, currentSlot: 1, status: "verified", sourceId: 7,
        foodVariantSourceId: null, validFrom: null, validTo: null,
        caloriesKcal: 210, proteinG: 8, carbG: 37, fatG: 2, basisQuantity: 100, basisUnit: "g" }],
      [{ source: { ...source, sourceUrl: null }, grant }],
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
      nutrition: candidate.nutrition,
    };
    const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    installResults(
      [{ sourceId: 7, contentHash: digest, sourceReference: candidate.sourceReference,
        retentionUntil: new Date("2026-10-22T12:00:00Z"), payloadJson: JSON.stringify(payload) }],
      [{ source: { ...source, sourceUrl: "https://manufacturer.example/products/sku-a" }, grant }],
    );
    expect(await createFoodV2KnowledgeRepository().readPendingEvidence(request)).toBeNull();
  });

  it("rejects a same-origin different SKU before the cache write", async () => {
    const candidate = {
      sourceId: 7, sourceReference: "https://manufacturer.example/products/sku-b",
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
      nutrition: { caloriesKcal: 200, proteinG: 8, carbG: 37, fatG: 2,
        basisQuantity: 100, basisUnit: "g" as const },
    };
    const digest = createHash("sha256").update(JSON.stringify(original)).digest("hex");
    const tampered = { ...original, nutrition: { ...original.nutrition, caloriesKcal: 999 } };
    installResults(
      [{ sourceId: 7, contentHash: digest, sourceReference: original.sourceReference,
        retentionUntil: new Date("2026-10-22T12:00:00Z"), payloadJson: JSON.stringify(tampered) }],
      [{ source: { ...source, sourceUrl: original.sourceReference }, grant }],
    );
    expect(await createFoodV2KnowledgeRepository().readPendingEvidence(request)).toBeNull();
  });

  it("accepts a matching untampered cache entry with exact approved URL", async () => {
    const payload = {
      status: "provisional", sourceVersion: "v1",
      sourceReference: "https://manufacturer.example/products/sku-a",
      resolverVersion: "v2", policyVersion: "p1",
      nutrition: { caloriesKcal: 200, proteinG: 8, carbG: 37, fatG: 2,
        basisQuantity: 100, basisUnit: "g" as const },
    };
    const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    installResults(
      [{ sourceId: 7, contentHash: digest, sourceReference: payload.sourceReference,
        retentionUntil: new Date("2026-10-22T12:00:00Z"), payloadJson: JSON.stringify(payload) }],
      [{ source: { ...source, sourceUrl: payload.sourceReference }, grant }],
    );
    expect(await createFoodV2KnowledgeRepository().readPendingEvidence(request))
      .toMatchObject({ sourceId: 7, sourceReference: payload.sourceReference, nutrition: { caloriesKcal: 200 } });
  });

});
