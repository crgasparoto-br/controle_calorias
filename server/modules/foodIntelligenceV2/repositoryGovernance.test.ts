import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import { createFoodV2KnowledgeRepository } from "./repository";
import { readThroughGovernedKnowledge } from "./knowledgeRead";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

const now = new Date("2026-10-21T12:00:00Z");
const grant = {
  sourceVersion: "v1", status: "approved", allowRead: 1, allowPersistEvidence: 1,
  allowGlobalPublication: 0, licenseReference: "https://manufacturer.example/license",
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
      [],                           // raw exact name does not match
      [{ id: 22 }],                 // user-confirmed alias
      [],                           // unrelated global alias
      [],                           // unrelated generic family
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
    });
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
});
