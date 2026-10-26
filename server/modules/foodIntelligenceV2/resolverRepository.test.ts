/** #1305 audit A-001/A-002: actual repository -> read-through -> resolver.
 * Only SQL result pages are doubled; no GovernedFoodMatch is manufactured. */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import { createFoodV2KnowledgeRepository } from "./repository";
import { resolveFoodObservation } from "./resolver";
import { buildFoodObservationFixture } from "./fixtures";
import { parseFoodResolutionDecision } from "./schemas";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

const now = new Date("2026-10-21T12:00:00Z");
const reference = "https://manufacturer.example/products/sku-a";
const barcode = "07890000000001";
const source = { id: 7, version: "v1", sourceUrl: reference };
const grant = {
  sourceVersion: "v1", status: "approved", allowRead: 1, allowPersistEvidence: 1,
  allowGlobalPublication: 1, licenseReference: "https://manufacturer.example/license",
  approvalReference: "approved:1", approvedAt: new Date("2026-10-20T12:00:00Z"),
  validUntil: null, revokedAt: null, retentionDays: 30,
};
const mapping = { id: 9, status: "active", foodVariantId: 22, sourceId: 7,
  sourceItemCode: "SKU-A", sourceUrl: reference };
const nutrition = { caloriesKcal: 250, proteinG: 9, carbG: 48, fatG: 3,
  basisQuantity: 100, basisUnit: "g" };
const profile = { id: 10, currentSlot: 1, status: "verified", sourceId: 7,
  sourceVersion: "v1", foodVariantSourceId: 9, validFrom: null, validTo: null, ...nutrition };
const context = { traceId: "repository-resolver-1305", userId: 41, now,
  knowledgeRevision: "k1", policyVersion: "p1", resolverVersion: "v2" };

function evidence(evidenceType: string, facts: Record<string, unknown>) {
  const payload = { foodVariantId: 22, sourceId: 7, sourceItemCode: "SKU-A",
    sourceReference: reference, sourceVersion: "v1", ...facts };
  return { foodVariantId: 22, sourceId: 7, ownerUserId: null, evidenceType,
    sourceReference: reference, payloadJson: JSON.stringify(payload),
    contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    retentionUntil: new Date("2026-11-21T12:00:00Z") };
}

function observation(foodName: string | null = "pao", brand: string | null = null,
  code: string | null = null) {
  const seed = buildFoodObservationFixture();
  return buildFoodObservationFixture({
    identityHints: { foodName, brand, barcode: code },
    quantityHints: { value: 30, unit: "g", servingText: "30 g" },
    evidence: [{ ...seed.evidence[0], value: foodName },
      { ...seed.evidence[1], value: 30, unit: "g" }],
  });
}

type Mode = "brand" | "barcode" | "personal_alias" | "global_alias";
function installKnowledge(mode: Mode, invalid?: "brand" | "barcode" | "source") {
  const generic = mode === "global_alias";
  const row = {
    variant: { id: 22, status: "active", governanceStatus: "verified",
      variantType: generic ? "generic" : "branded",
      normalizedName: "pao de forma", displayName: "Pao de forma" },
    family: { id: 4, status: "active", scope: generic ? "global" : "user",
      ownerUserId: generic ? null : 41, normalizedName: "pao" },
    brand: generic ? null : { name: "Panco" },
  };
  const approval = [{ source, grant }];
  const tail = [[row], [profile], approval, [mapping],
    ...(!generic ? [[evidence("nutrition_label", { nutrition })]] : []), []];
  let pages: unknown[][];
  if (mode === "brand") pages = [[{ id: 22 }], [], ...tail];
  else if (mode === "barcode") pages = [
    [{ barcode, foodVariantId: 22, status: "active", sourceId: 7, evidenceId: 17 }],
    approval, [evidence("barcode", { barcode, identity: { barcode } })], [mapping], ...tail,
  ];
  else if (mode === "personal_alias") pages = [[{ id: 22 }], [], [], [], ...tail];
  else pages = [[], [], [{ foodId: 4, foodVariantId: 22, status: "active",
    governanceStatus: "verified", sourceId: 7, sourceVersion: "v1" }], approval, [], ...tail];
  if (invalid === "brand") pages = pages.slice(0, 3).concat([[]]);
  if (invalid === "barcode") {
    pages = pages.slice(0, 4).concat([[]]);
    pages[2] = [evidence("barcode", {
      barcode: "07890000000002", identity: { barcode: "07890000000002" },
    })];
  }
  if (invalid === "source") {
    pages = pages.slice(0, 2).concat([[]]);
    pages[1] = [{ source: { ...source, version: "v2" }, grant }];
  }
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

describe("A-001: commercial proof through the actual repository", () => {
  it.each(["brand", "barcode"] as const)("propagates validated %s, not request assertions", async mode => {
    const select = installKnowledge(mode);
    const store = createFoodV2KnowledgeRepository();
    const read = vi.spyOn(store, "readLocal");
    const current = await resolveFoodObservation(observation("pao de forma",
      mode === "brand" ? "PANCO" : null, mode === "barcode" ? barcode : null), context, store);
    const produced = await read.mock.results[0].value;
    expect(produced).toMatchObject({ kind: "match", matchedBrand: "Panco",
      matchedBarcode: mode === "barcode" ? barcode : null, variantId: 22,
      sourceId: 7, sourceVersion: "v1", sourceReference: reference });
    expect(current.status).toBe("resolved");
    expect(current.nextAction).toBe("propose");
    expect(current.identity.variantId).toBe(22);
    expect(current.nutrition.profileId).toBe(10);
    expect(current.nutrition.consumed?.calories).toBe(75);
    expect(current.nutrition.verified).toBe(true);
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
    expect(select).toHaveBeenCalledTimes(mode === "brand" ? 8 : 10);
  });

  it.each(["brand", "barcode", "source"] as const)("rejects incompatible %s proof", async invalid => {
    installKnowledge(invalid === "brand" ? "brand" : "barcode", invalid);
    const current = await resolveFoodObservation(observation("pao de forma",
      invalid === "brand" ? "Outra marca" : null,
      invalid === "brand" ? null : barcode), context, createFoodV2KnowledgeRepository());
    expect(current.nextAction).not.toBe("propose");
    expect(current.nutrition.consumed).toBeNull();
    expect(current.nutrition.verified).toBe(false);
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
  });
});

describe("A-002: accepted governed aliases remain monotonic", () => {
  it.each(["personal_alias", "global_alias"] as const)(
    "preserves %s through serialization, equivalent names and database unavailability", async mode => {
      installKnowledge(mode);
      const store = createFoodV2KnowledgeRepository();
      const original = await resolveFoodObservation(observation(), context, store);
      expect(original.status).toBe("resolved");
      const previous = JSON.parse(JSON.stringify(original)) as typeof original;
      const frozen = JSON.stringify(previous);
      vi.mocked(getDb).mockRejectedValue(new Error("temporarily unavailable"));
      for (const name of ["pao", " PAO ", "Pao de forma", null]) {
        const current = await resolveFoodObservation(observation(name),
          { ...context, previousDecision: previous }, store);
        expect(current.status).toBe("resolved");
        expect(current.nextAction).toBe("propose");
        expect(current.identity).toEqual(original.identity);
        expect(current.quantity).toEqual(original.quantity);
        expect(current.nutrition).toEqual(original.nutrition);
        expect(current.revision).toBe(original.revision + 1);
        expect(parseFoodResolutionDecision(current).ok).toBe(true);
      }
      expect(JSON.stringify(previous)).toBe(frozen);
      expect(getDb).toHaveBeenCalledTimes(1);
    },
  );

  it("records an accepted alias even when observation identity evidence is absent", async () => {
    installKnowledge("personal_alias");
    const seed = observation();
    const input = { ...seed, evidence: seed.evidence.filter(item => item.field.startsWith("quantity.")) };
    const store = createFoodV2KnowledgeRepository();
    const original = await resolveFoodObservation(input, context, store);
    expect(original.status).toBe("resolved");
    vi.mocked(getDb).mockRejectedValue(new Error("temporarily unavailable"));
    const current = await resolveFoodObservation(input, { ...context, previousDecision: original }, store);
    expect(current.status).toBe("resolved");
    expect(current.nutrition).toEqual(original.nutrition);
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
    expect(getDb).toHaveBeenCalledTimes(1);
  });

  it("does not hide new name, brand, barcode, qualifier or evidence assertions behind an alias", async () => {
    installKnowledge("global_alias");
    const store = createFoodV2KnowledgeRepository();
    const seed = observation();
    const original = await resolveFoodObservation(seed, context, store);
    vi.mocked(getDb).mockRejectedValue(new Error("temporarily unavailable"));
    const inputs = [observation("presunto"), observation("pao", "Outra marca"),
      observation("pao", null, "07890000000002"),
      { ...seed, identityHints: { ...seed.identityHints, qualifiers: [
        { value: "sem gluten", attributeCode: null, role: null, confidence: null },
      ] } },
      { ...seed, evidence: [...seed.evidence, { ...seed.evidence[0],
        evidenceId: "conflicting-name", value: "presunto" }] },
    ];
    for (const input of inputs) {
      const current = await resolveFoodObservation(input, { ...context, previousDecision: original }, store);
      expect(current.nextAction).not.toBe("propose");
      expect(current.nutrition.consumed).toBeNull();
      expect(parseFoodResolutionDecision(current).ok).toBe(true);
    }
    expect(getDb).toHaveBeenCalledTimes(1 + inputs.length);
  });

  it("does not accept an unbound name from the evidence envelope", async () => {
    installKnowledge("global_alias");
    const store = createFoodV2KnowledgeRepository();
    const seed = observation();
    const original = await resolveFoodObservation(seed, context, store);
    const previous = { ...original, evidence: [...original.evidence, { ...seed.evidence[0],
      evidenceId: "unbound-name", value: "presunto", origin: "catalog" as const }] };
    expect(parseFoodResolutionDecision(previous).ok).toBe(true);
    vi.mocked(getDb).mockRejectedValue(new Error("temporarily unavailable"));
    const current = await resolveFoodObservation(observation("presunto"),
      { ...context, previousDecision: previous }, store);
    expect(current.nextAction).not.toBe("propose");
    expect(current.nutrition.consumed).toBeNull();
    expect(getDb).toHaveBeenCalledTimes(2);
  });

  it("does not reuse an alias across a changed knowledge revision", async () => {
    installKnowledge("global_alias");
    const store = createFoodV2KnowledgeRepository();
    const original = await resolveFoodObservation(observation(), context, store);
    vi.mocked(getDb).mockRejectedValue(new Error("temporarily unavailable"));
    const current = await resolveFoodObservation(observation(),
      { ...context, knowledgeRevision: "changed-knowledge", previousDecision: original }, store);
    expect(current.nextAction).not.toBe("propose");
    expect(current.nutrition.consumed).toBeNull();
    expect(getDb).toHaveBeenCalledTimes(2);
  });
});
