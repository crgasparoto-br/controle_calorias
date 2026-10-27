/** #1305 audit A-001/A-002: actual repository -> read-through -> resolver.
 * Only SQL result pages are doubled; no GovernedFoodMatch is manufactured. */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import { createFoodV2KnowledgeRepository } from "./repository";
import { resolveFoodObservation } from "./resolver";
import { buildFoodObservationFixture } from "./fixtures";
import { parseFoodResolutionDecision, type FoodObservation } from "./schemas";

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

type Mode = "brand" | "barcode" | "personal_alias" | "global_alias" | "generic_family";
function installKnowledge(mode: Mode, invalid?: "brand" | "barcode" | "source" | "commercial_profile") {
  const generic = mode === "global_alias" || mode === "generic_family";
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
  else if (mode === "generic_family") pages = [[], [], [], [{ id: 22 }], ...tail];
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
  if (invalid === "commercial_profile") {
    row.variant.variantType = "generic";
    pages[mode === "brand" ? 6 : 8] = [];
  }
  return installPages(pages);
}

function installPages(pages: unknown[][]) {
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

  it.each(["brand", "barcode"] as const)("does not let %s certify a generic profile without same-product nutrition proof", async mode => {
    installKnowledge(mode, "commercial_profile");
    const current = await resolveFoodObservation(observation("pao de forma",
      mode === "brand" ? "Panco" : null, mode === "barcode" ? barcode : null),
      context, createFoodV2KnowledgeRepository());
    expect(current.nextAction).not.toBe("propose");
    expect(current.nutrition.consumed).toBeNull();
    expect(current.nutrition.verified).toBe(false);
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
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

describe("A-002: accepted governed identities remain monotonic", () => {
  it.each(["personal_alias", "global_alias", "generic_family", "barcode"] as const)(
    "preserves %s through serialization, equivalent names and database unavailability", async mode => {
      installKnowledge(mode);
      const store = createFoodV2KnowledgeRepository();
      const code = mode === "barcode" ? barcode : null;
      const original = await resolveFoodObservation(observation("pao", null, code), context, store);
      expect(original.status).toBe("resolved");
      const previous = JSON.parse(JSON.stringify(original)) as typeof original;
      const frozen = JSON.stringify(previous);
      vi.mocked(getDb).mockRejectedValue(new Error("temporarily unavailable"));
      for (const name of ["pao", " PAO ", "Pao de forma", null]) {
        const current = await resolveFoodObservation(observation(name, null, code),
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

// The SQL adapter is doubled, but the repository, read-through, resolver and
// Zod decision boundary are all real, including independent portion sources.
function installPortionKnowledge(options: {
  variantId?: number; name?: string; grams?: number; portionStatus?: string;
  portionVersion?: string; sourceVersion?: string; sourceRevoked?: boolean;
  updatedAt?: Date; portionExists?: boolean; measureKind?: "exact" | "usual_average";
} = {}) {
  const id = options.variantId ?? 22;
  const name = options.name ?? "Pao de forma";
  const portionSource = { id: 19, version: options.sourceVersion ?? "portion-v1",
    sourceUrl: "https://manufacturer.example/portions/slice" };
  const row = { variant: { id, status: "active", governanceStatus: "verified",
    variantType: "generic", normalizedName: name.toLowerCase(), displayName: name },
    family: { id: 4, status: "active", scope: "global", ownerUserId: null }, brand: null };
  const portion = { id: 31, foodId: 4, foodVariantId: id, label: "fatia", unit: "fatia",
    quantity: 1, grams: options.grams ?? 20, status: options.portionStatus ?? "verified",
    measureKind: options.measureKind ?? "exact", confidence: 0.8, evidenceId: 55,
    sourceId: 19, sourceVersion: options.portionVersion ?? "portion-v1",
    sourcePortionCode: "SLICE-31", validFrom: null, validTo: null,
    updatedAt: options.updatedAt ?? now };
  return installPages([
    [], [{ id }], [], [], [row],
    [{ ...profile, foodVariantSourceId: null, caloriesKcal: 100 }], [{ source, grant }],
    options.portionExists === false ? [] : [portion],
    [{ source: portionSource, grant: { ...grant, sourceVersion: portionSource.version,
      status: options.sourceRevoked ? "revoked" : "approved",
      revokedAt: options.sourceRevoked ? now : null } }],
  ]);
}

function sliceObservation(name = "Pao de forma", quantity: number | null = 1) {
  const seed = observation(name);
  return { ...seed,
    quantityHints: { ...seed.quantityHints, value: quantity,
      unit: quantity === null ? null : "fatia", servingText: null },
    evidence: [seed.evidence[0], ...(quantity === null ? [] :
      [{ ...seed.evidence[1], value: quantity, unit: "fatia" }])],
  };
}

/** A correction is a new user turn, not another claim on the same surface.
 * The generic fixture defaults to turn:1:text for every observation. */
function fromNextTurn(value: FoodObservation): FoodObservation {
  const sourceRef = "turn:2:text";
  return { ...value, surfaceSpan: { ...value.surfaceSpan, sourceRef },
    evidence: value.evidence.map(item => ({ ...item, anchor: { ...item.anchor, sourceRef } })) };
}

describe("F-1305-001/002: variant-bound portions through the actual repository", () => {
  it.each([false, true])("replaces 20g with the new variant's 45g; omitted count=%s", async omitted => {
    installPortionKnowledge();
    const store = createFoodV2KnowledgeRepository();
    const first = await resolveFoodObservation(sliceObservation(), context, store);
    expect(first.status).toBe("resolved");
    expect(first.quantity.grams).toBe(20);
    expect(first.nutrition.consumed?.calories).toBe(20);
    const previous = JSON.parse(JSON.stringify(first)) as typeof first;
    const frozen = JSON.stringify(previous);
    installPortionKnowledge({ variantId: 23, name: "Pao integral", grams: 45 });
    const current = await resolveFoodObservation(fromNextTurn(sliceObservation("Pao integral", omitted ? null : 1)),
      { ...context, previousDecision: previous }, store);
    expect(current.status).toBe("resolved");
    expect(current.nextAction).toBe("propose");
    expect(current.identity.variantId).toBe(23);
    expect(current.quantity).toMatchObject({ value: 1, unit: "fatia", grams: 45,
      portionId: 31, portionSnapshot: { variantId: 23, grams: 45 } });
    expect(current.nutrition.consumed?.calories).toBe(45);
    expect(current.evidence.some(item => item.field === "quantity.grams" && item.value === 20)).toBe(false);
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
    expect(JSON.stringify(previous)).toBe(frozen);
  });

  it("does not reuse the old conversion when the new identity has no eligible portion", async () => {
    installPortionKnowledge();
    const store = createFoodV2KnowledgeRepository();
    const previous = await resolveFoodObservation(sliceObservation(), context, store);
    installPortionKnowledge({ variantId: 23, name: "Pao integral", portionExists: false });
    const current = await resolveFoodObservation(fromNextTurn(sliceObservation("Pao integral", null)),
      { ...context, previousDecision: previous }, store);
    expect(current.status).toBe("partially_resolved");
    expect(current.nextAction).toBe("clarify");
    expect(current.quantity).toMatchObject({ value: 1, unit: "fatia", grams: null,
      portionId: null, portionSnapshot: null });
    expect(current.nutrition.consumed).toBeNull();
    expect(current.reasonCodes).toContain("quantity_conversion_unproven");
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
  });

  it("keeps independent measured mass across an identity change", async () => {
    installPortionKnowledge();
    const store = createFoodV2KnowledgeRepository();
    const previous = await resolveFoodObservation(observation("Pao de forma"), context, store);
    installPortionKnowledge({ variantId: 23, name: "Pao integral", grams: 45 });
    const current = await resolveFoodObservation(fromNextTurn(observation("Pao integral")),
      { ...context, previousDecision: previous }, store);
    expect(current.status).toBe("resolved");
    expect(current.quantity).toEqual(previous.quantity);
    expect(current.quantity.grams).toBe(30);
    expect(current.quantity.portionSnapshot).toBeNull();
    expect(current.nutrition.consumed?.calories).toBe(30);
  });

  it("a contradictory name on the same surface is never silently accepted via a reused evidenceId", async () => {
    installPortionKnowledge();
    const store = createFoodV2KnowledgeRepository();
    const previous = await resolveFoodObservation(sliceObservation(), context, store);
    expect(previous.status).toBe("resolved");
    installPortionKnowledge({ variantId: 23, name: "Pao integral", grams: 45 });
    // Deliberately keep turn:1:text and ev-ident: two competing statements
    // on the same surface are not a verified user correction.
    const current = await resolveFoodObservation(sliceObservation("Pao integral"),
      { ...context, previousDecision: previous }, store);
    expect(current.status).toBe("unknown");
    expect(current.nextAction).toBe("clarify");
    expect(current.reasonCodes).toContain("source_conflict");
    expect(current.nutrition.consumed).toBeNull();
    expect(current.evidence.some(item => item.value === "Pao de forma" && item.origin === "text")).toBe(true);
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
  });

  it("retains the actual portion source, evidence, version and non-exact measure kind", async () => {
    const select = installPortionKnowledge({ measureKind: "usual_average" });
    const current = await resolveFoodObservation(sliceObservation(), context, createFoodV2KnowledgeRepository());
    expect(current.status).toBe("resolved");
    expect(current.quantity).toMatchObject({ portionId: 31, measureKind: "usual_average", confidence: 0.8,
      portionSnapshot: { portionId: 31, foodEntityId: 4, variantId: 22, sourceId: 19,
        sourceVersion: "portion-v1", sourcePortionCode: "SLICE-31", evidenceId: 55,
        sourceReference: "https://manufacturer.example/portions/slice",
        updatedAt: now.toISOString(), status: "verified", grams: 20 } });
    expect(current.nutrition.sourceId).toBe(7);
    const proof = current.evidence.filter(item => current.quantity.evidenceIds.includes(item.evidenceId) &&
      (item.field === "quantity.grams" || item.field === "quantity.portionId"));
    expect(proof).toHaveLength(2);
    expect(proof.every(item => item.sourceId === 19 && item.verified && item.origin === "catalog" &&
      item.anchor.sourceRef.startsWith("food-portion:31:") && item.anchor.span === null)).toBe(true);
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
    expect(select).toHaveBeenCalledTimes(9);
  });

  it("preserves the same accepted portion after serialization during database unavailability", async () => {
    installPortionKnowledge();
    const store = createFoodV2KnowledgeRepository();
    const first = await resolveFoodObservation(sliceObservation(), context, store);
    const previous = JSON.parse(JSON.stringify(first)) as typeof first;
    vi.mocked(getDb).mockRejectedValue(new Error("temporarily unavailable"));
    const current = await resolveFoodObservation(sliceObservation("Pao de forma", null),
      { ...context, previousDecision: previous }, store);
    expect(current.status).toBe("resolved");
    expect(current.quantity).toEqual(first.quantity);
    expect(current.nutrition).toEqual(first.nutrition);
    expect(parseFoodResolutionDecision(current).ok).toBe(true);
    expect(getDb).toHaveBeenCalledTimes(1);
  });

  it.each(["edited", "revoked", "source-revoked", "source-stale"] as const)(
    "revalidates same-ID portion on a new knowledge revision: %s", async change => {
      installPortionKnowledge();
      const store = createFoodV2KnowledgeRepository();
      const first = await resolveFoodObservation(sliceObservation(), context, store);
      const frozen = JSON.stringify(first);
      installPortionKnowledge({ grams: 45, updatedAt: new Date("2026-10-21T12:01:00Z"),
        portionStatus: change === "revoked" ? "revoked" : "verified",
        sourceRevoked: change === "source-revoked",
        sourceVersion: change === "source-stale" ? "portion-v2" : "portion-v1" });
      const current = await resolveFoodObservation(sliceObservation("Pao de forma", null),
        { ...context, knowledgeRevision: "k2", previousDecision: first }, store);
      expect(current.quantity.value).toBe(1);
      if (change === "edited") {
        expect(current.status).toBe("resolved");
        expect(current.quantity.grams).toBe(45);
        expect(current.nutrition.consumed?.calories).toBe(45);
        expect(current.nutrition.snapshotHash).not.toBe(first.nutrition.snapshotHash);
      } else {
        expect(current.nextAction).not.toBe("propose");
        expect(current.quantity.grams).toBeNull();
        expect(current.quantity.portionSnapshot).toBeNull();
        expect(current.nutrition.consumed).toBeNull();
      }
      expect(current.knowledgeRevision).toBe("k2");
      expect(parseFoodResolutionDecision(current).ok).toBe(true);
      expect(JSON.stringify(first)).toBe(frozen);
    },
  );
});

const temporalStart = new Date("2026-10-26T10:00:00Z");
const temporalBoundary = new Date("2026-10-26T10:01:00Z");
type TemporalDependency = "profile" | "nutrition-source" | "portion-source";
function installTemporalKnowledge(which: TemporalDependency, instant: Date) {
  const row = { variant: { id: 22, status: "active", governanceStatus: "verified", variantType: "generic",
    normalizedName: "mortadela", displayName: "Mortadela" },
    family: { id: 4, status: "active", scope: "global", ownerUserId: null }, brand: null };
  const currentProfile = { ...profile, foodVariantSourceId: null, validTo: which === "profile" ? temporalBoundary : null };
  const portionSource = { id: 19, version: "portion-v1", sourceUrl: "https://example.org/portions/31" };
  const portion = { id: 31, foodId: 4, foodVariantId: 22, label: "fatia", unit: "fatia", quantity: 1,
    grams: 20, status: "verified", measureKind: "exact", confidence: null, evidenceId: 55,
    sourceId: 19, sourceVersion: "portion-v1", sourcePortionCode: "slice-31",
    validFrom: null, validTo: null, updatedAt: now };
  // An authenticated request queries personal aliases before the exact variant.
  const pages: unknown[][] = [[], [{ id: 22 }], [], [], [row], [currentProfile]];
  if (which !== "profile" || instant < temporalBoundary) {
    pages.push([{ source, grant: { ...grant, validUntil: which === "nutrition-source" ? temporalBoundary : null } }]);
    if (which !== "nutrition-source" || instant < temporalBoundary) {
      pages.push([portion], [{ source: portionSource, grant: { ...grant, sourceVersion: "portion-v1",
        validUntil: which === "portion-source" ? temporalBoundary : null } }]);
    }
  }
  return installPages(pages);
}

describe("source validity bounds pending resolver proposals", () => {
  it.each(["profile", "nutrition-source", "portion-source"] as const)(
    "revalidates at and after %s expiry, with unchanged knowledge revision", async which => {
      const scoped = { ...context, userId: context.userId, now: temporalStart };
      const input = buildFoodObservationFixture();
      installTemporalKnowledge(which, temporalStart);
      const first = await resolveFoodObservation(input, scoped, createFoodV2KnowledgeRepository());
      expect(first.status).toBe("resolved");
      expect(first.knowledgeValidity).toEqual({ checkedAt: temporalStart.toISOString(),
        validUntil: temporalBoundary.toISOString(), userId: context.userId, resolverVersion: context.resolverVersion });
      const frozen = JSON.stringify(first);
      // Eligible reuse survives temporary SQL unavailability before the boundary.
      vi.mocked(getDb).mockRejectedValue(new Error("temporarily unavailable"));
      const live = await resolveFoodObservation(input, { ...scoped,
        now: new Date("2026-10-26T10:00:59Z"), previousDecision: JSON.parse(frozen) },
        createFoodV2KnowledgeRepository());
      expect(live.status).toBe("resolved");
      expect(live.nutrition).toEqual(first.nutrition);
      for (const instant of [temporalBoundary, new Date("2026-10-26T10:02:00Z")]) {
        const queries = installTemporalKnowledge(which, instant);
        const next = await resolveFoodObservation(input,
          { ...scoped, now: instant, previousDecision: JSON.parse(frozen) }, createFoodV2KnowledgeRepository());
        expect(queries).toHaveBeenCalled();
        expect(next.nextAction).not.toBe("propose");
        expect(next.nutrition.consumed).toBeNull();
        expect(parseFoodResolutionDecision(next).ok).toBe(true);
        installTemporalKnowledge(which, instant);
        const fresh = await resolveFoodObservation(input, { ...scoped, now: instant }, createFoodV2KnowledgeRepository());
        expect(fresh.nextAction).toBe(next.nextAction);
        expect(fresh.reasonCodes).toEqual(next.reasonCodes);
      }
      expect(JSON.stringify(first)).toBe(frozen);
    });

  it.each(["same-variant", "later-candidate"] as const)(
    "expires reuse when a future profile becomes eligible: %s", async selection => {
    const row = { variant: { id: 22, status: "active", governanceStatus: "verified", variantType: "generic",
      normalizedName: "mortadela", displayName: "Mortadela" },
      family: { id: 4, status: "active", scope: "global", ownerUserId: null }, brand: null };
    const firstProfile = { ...profile, profileKey: "variant:22/source:7/g:100", foodVariantSourceId: null };
    // Distinct sources/profile keys can coexist in the current slots.
    const futureProfile = { ...firstProfile, id: 11, sourceId: 20,
      profileKey: "variant:22/source:20/g:100", validFrom: temporalBoundary, caloriesKcal: 500 };
    const futureSource = { ...source, id: 20, sourceUrl: "https://other-source.example/profile/22" };
    const laterRow = { ...row, variant: { ...row.variant, id: 23 } };
    const pages = (at: Date) => selection === "same-variant"
      ? [[{ id: 22 }], [], [], [row], [firstProfile, futureProfile], [{ source, grant }],
        ...(at >= temporalBoundary ? [[{ source: futureSource, grant }]] : [[]])]
      : [[{ id: 22 }, { id: 23 }], [], [], [row], [firstProfile], [{ source, grant }], [],
        [laterRow], [{ ...futureProfile, profileKey: "variant:23/source:20/g:100" }],
        ...(at >= temporalBoundary ? [[{ source: futureSource, grant }], []] : [])];
    const scoped = { ...context, userId: null };
    const input = observation("mortadela");
    installPages(pages(temporalStart));
    const first = await resolveFoodObservation(input, { ...scoped, now: temporalStart }, createFoodV2KnowledgeRepository());
    expect(first.status).toBe("resolved");
    expect(first.knowledgeValidity?.validUntil).toBe(temporalBoundary.toISOString());
    const frozen = JSON.stringify(first);
    for (const previousDecision of [undefined, JSON.parse(frozen)]) {
      installPages(pages(temporalBoundary));
      const current = await resolveFoodObservation(input,
        { ...scoped, now: temporalBoundary, previousDecision }, createFoodV2KnowledgeRepository());
      expect(current.nextAction).not.toBe("propose");
      expect(current.reasonCodes).toContain("source_conflict");
      expect(current.nutrition.consumed).toBeNull();
    }
    expect(JSON.stringify(first)).toBe(frozen);
  });
});

describe("F-1305-006: correção de usuário atravessa a leitura SQL governada", () => {
  function genericDb(name: string, foodId: number, variantId: number, profileId: number) {
    const row = {
      variant: { id: variantId, status: "active", governanceStatus: "verified",
        variantType: "generic", normalizedName: name, displayName: name },
      family: { id: foodId, status: "active", scope: "global", ownerUserId: null,
        normalizedName: name }, brand: null,
    };
    const pages: unknown[][] = [
      [], [{ id: variantId }], [], [{ id: variantId }], [row],
      [{ ...profile, id: profileId, foodVariantSourceId: null,
        caloriesKcal: name === "pao" ? 250 : 180 }],
      [{ source, grant }], [],
    ];
    const select = vi.fn(() => ({
      from() { return this; }, innerJoin() { return this; }, leftJoin() { return this; },
      where() { return this; },
      limit: vi.fn(async () => {
        if (!pages.length) throw new Error("Unexpected governed read");
        return pages.shift();
      }),
    }));
    return { select };
  }

  it.each([false, true] as const)(
    "substitui evidência textual anterior sem apagar fonte independente (independente=%s)",
    async independent => {
      const db1 = genericDb("pao", 4, 22, 10);
      const db2 = genericDb("presunto", 5, 23, 11);
      vi.mocked(getDb).mockResolvedValueOnce(db1 as never).mockResolvedValueOnce(db2 as never);
      const seed = buildFoodObservationFixture();
      const firstAnchor = { sourceRef: "turn:1:text", span: { start: 0, end: 8 }, region: null };
      const firstEvidence: ReturnType<typeof buildFoodObservationFixture>["evidence"] = [
        { ...seed.evidence[0], evidenceId: "turn:1:name", value: "pao", anchor: firstAnchor },
        { ...seed.evidence[1], evidenceId: "turn:1:quantity", value: 30, unit: "g", anchor: firstAnchor },
      ];
      if (independent) firstEvidence.push({
        ...seed.evidence[0], evidenceId: "catalog:validated-name", origin: "catalog",
        value: "pao", sourceId: 7,
        anchor: { sourceRef: "catalog:source-7", span: null, region: null },
      });
      const firstInput = buildFoodObservationFixture({
        rawInput: "pao 30 g", normalizedInput: "pao 30 g", normalizationPath: [],
        surfaceSpan: firstAnchor, identityHints: { foodName: "pao" },
        quantityHints: { value: 30, unit: "g", servingText: "30 g" }, evidence: firstEvidence,
      });
      const store = createFoodV2KnowledgeRepository();
      const first = await resolveFoodObservation(firstInput, context, store);
      expect(first.status).toBe("resolved");
      const frozen = JSON.stringify(first);
      const secondAnchor = { sourceRef: "turn:2:text", span: { start: 0, end: 8 }, region: null };
      const secondInput = buildFoodObservationFixture({
        rawInput: "presunto", normalizedInput: "presunto", normalizationPath: [],
        surfaceSpan: secondAnchor, identityHints: { foodName: "presunto" },
        quantityHints: { value: null, unit: null, servingText: null }, evidence: [],
      });
      secondInput.evidence = [{ ...seed.evidence[0], evidenceId: "turn:2:name",
        value: "presunto", anchor: secondAnchor }];
      const second = await resolveFoodObservation(secondInput,
        { ...context, previousDecision: first }, store);
      expect(db1.select).toHaveBeenCalled();
      expect(db2.select).toHaveBeenCalled();
      expect(second.quantity.value).toBe(30);
      expect(second.quantity.unit).toBe("g");
      expect(second.evidence.map(item => item.evidenceId)).not.toContain("turn:1:name");
      expect(second.evidence.map(item => item.evidenceId)).toContain("turn:1:quantity");
      if (independent) {
        expect(second.status).toBe("unknown");
        expect(second.reasonCodes).toContain("source_conflict");
        expect(second.evidence.map(item => item.evidenceId)).toContain("catalog:validated-name");
        expect(second.nutrition.consumed).toBeNull();
      } else {
        expect(second.status).toBe("resolved");
        expect(second.nextAction).toBe("propose");
        expect(second.identity.variantId).toBe(23);
        expect(second.nutrition.profileId).toBe(11);
        expect(second.nutrition.consumed?.calories).toBe(54);
      }
      expect(parseFoodResolutionDecision(second).ok).toBe(true);
      expect(JSON.stringify(first)).toBe(frozen);
    },
  );
});
