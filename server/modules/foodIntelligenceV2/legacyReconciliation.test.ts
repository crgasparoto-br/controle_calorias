import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  planLegacyKnowledgeReconciliation, planLegacyCatalogPortions, provenLegacySourceRevision,
  type LegacyFoodCandidate,
} from "./legacyReconciliation";
import type { FoodSourceGrant } from "./sourceGrants";

const now = new Date("2026-10-21T12:00:00Z");
const sourceGrant: FoodSourceGrant = {
  sourceVersion: "1", status: "approved", allowRead: 1,
  allowPersistEvidence: 0, allowGlobalPublication: 1,
  licenseReference: "https://example.org/license",
  approvalReference: "approval-1", approvedAt: new Date("2026-10-20T00:00:00Z"),
  validUntil: null, revokedAt: null, retentionDays: null,
};
const source = (id: number) => id === 7 ? { grant: sourceGrant, version: "1" } : null;
const base: LegacyFoodCandidate = {
  table: "foods", id: 1, foodId: 1, name: "arroz",
  ownerUserId: null, scope: "global", sourceId: 7, sourceVersion: "1",
  sourceCode: "T001", canonicalKey: "arroz", validNutrition: true,
};

describe("B2 reconciliation with governed quarantine", () => {
  it("maps only licensed, traceable families with complete nutrition", () => {
    const result = planLegacyKnowledgeReconciliation([base], source, now);
    expect(result.totals).toEqual({ input: 1, mapped: 1, merged: 0, quarantined: 0 });
    expect(result.decisions[0]).toMatchObject({ action: "mapped", identityKey: expect.any(String), profileKey: expect.any(String) });
  });

  it("does not silently globalize personal food or undocumented catalog items", () => {
    const result = planLegacyKnowledgeReconciliation([
      { ...base, id: 2, ownerUserId: 9 },
      { ...base, id: 3, table: "foodCatalog", foodId: null, sourceId: null, sourceVersion: null },
    ], source, now);
    expect(result.totals).toEqual({ input: 2, mapped: 0, merged: 0, quarantined: 2 });
    expect(result.decisions.map(d => d.action === "quarantined" && d.reason))
      .toEqual(["family_ambiguous", "personal_scope"]);
  });

  it("quarantines orphaned user-scoped rows even with null owner id", () => {
    const r = planLegacyKnowledgeReconciliation([
      { ...base, id: 2, ownerUserId: null, scope: "user" },
      { ...base, id: 3, ownerUserId: null, scope: null },
    ], source, now);
    expect(r.totals.quarantined).toBe(2);
    expect(r.decisions.every(d => d.action === "quarantined" && d.reason === "personal_scope")).toBe(true);
  });

  it("only an explicitly global ownerless row can leave private quarantine", () => {
    const r = planLegacyKnowledgeReconciliation([
      { ...base, id: 10, scope: "global", ownerUserId: null },
      { ...base, id: 11, scope: null, ownerUserId: null },
      { ...base, id: 12, scope: "user", ownerUserId: null },
      { ...base, id: 13, scope: "global", ownerUserId: 41 },
    ], source, now);
    expect(r.totals).toEqual({ input: 4, mapped: 1, merged: 0, quarantined: 3 });
    expect(r.decisions.map(d => d.action === "quarantined" ? d.reason : d.action))
      .toEqual(["mapped", "personal_scope", "personal_scope", "personal_scope"]);
  });

  it("source revocation, version change and missing macro data all quarantine", () => {
    const r = planLegacyKnowledgeReconciliation([
      { ...base, id: 1, sourceId: 999 },
      { ...base, id: 2, sourceVersion: "2" },
      { ...base, id: 3, validNutrition: false },
    ], source, now);
    expect(r.totals.quarantined).toBe(3);
    expect(r.decisions.map(d => d.action === "quarantined" && d.reason))
      .toEqual(["source_unlicensed", "source_unlicensed", "nutrition_insufficient"]);
  });

  it("repeated semantic source identity reconciles as merge, not duplicate", () => {
    const result = planLegacyKnowledgeReconciliation([
      base, { ...base, id: 2 },
    ], source, now);
    expect(result.totals).toEqual({ input: 2, mapped: 1, merged: 1, quarantined: 0 });
  });

  it("conflitos de macros nao sao mesclados pela mesma identidade de origem", () => {
    const r = planLegacyKnowledgeReconciliation([
      { ...base, nutritionFingerprint: "macro-original" },
      { ...base, id: 2, nutritionFingerprint: "macro-divergente" },
    ], source, now);
    expect(r.totals).toEqual({ input: 2, mapped: 1, merged: 0, quarantined: 1 });
    expect(r.decisions[1]).toMatchObject({ action: "quarantined", reason: "nutrition_conflict" });
  });

  it("nao reativa linhas legadas aposentadas", () => {
    const r = planLegacyKnowledgeReconciliation([{ ...base, status: "deprecated" }], source, now);
    expect(r.decisions[0]).toMatchObject({ action: "quarantined", reason: "deprecated_source" });
  });

  it("marca comercial sem vinculo exato continua em quarentena", () => {
    const r = planLegacyKnowledgeReconciliation([
      { ...base, brandName: "Marca A", brandId: null },
    ], source, now);
    expect(r.decisions[0]).toMatchObject({ action: "quarantined", reason: "brand_unlinked" });
  });
  it("no source permission means every row is traceably quarantined", () => {
    const r = planLegacyKnowledgeReconciliation([base], () => null, now);
    expect(r.totals.input).toBe(r.totals.quarantined);
    expect(r.decisions[0]).toMatchObject({ action: "quarantined", reason: "source_unlicensed" });
  });
});


describe("B2 legacy foodCatalog portions", () => {
  const catalog: LegacyFoodCandidate = {
    ...base, table: "foodCatalog", id: 50, foodId: 1,
  };
  const portion = { id: 100, foodCatalogId: 50, label: "2 fatias",
    unit: "serving", quantity: 2, grams: 50 };

  it("keeps traceable portions in the catalog staging inventory", () => {
    const parent = planLegacyKnowledgeReconciliation([catalog], source, now);
    const plan = planLegacyCatalogPortions([portion], parent.decisions);
    expect(plan.totals).toEqual({ input: 1, mapped: 1, merged: 0, quarantined: 0 });
    expect(plan.decisions[0]).toMatchObject({ action: "mapped" });
  });

  it("quarantines unlicensed/personal catalog portions and malformed measures", () => {
    const privateParent = planLegacyKnowledgeReconciliation([
      { ...catalog, ownerUserId: 41, scope: "user" },
    ], source, now);
    const p = planLegacyCatalogPortions([portion], privateParent.decisions);
    expect(p.decisions[0]).toMatchObject({ action: "quarantined", reason: "catalog_not_eligible" });
    const approved = planLegacyKnowledgeReconciliation([catalog], source, now);
    const q = planLegacyCatalogPortions([
      { ...portion, id: 101, grams: 0 },
      { ...portion, id: 102, label: "" },
      { ...portion, id: 103, foodCatalogId: 999 },
    ], approved.decisions);
    expect(q.totals.quarantined).toBe(3);
  });

  it("deduplicates equal physical portions and quarantines conflicting gram weights", () => {
    const parent = planLegacyKnowledgeReconciliation([catalog], source, now);
    const plan = planLegacyCatalogPortions([
      portion, { ...portion, id: 101 },
      { ...portion, id: 102, grams: 60 },
    ], parent.decisions);
    expect(plan.decisions.map(d => d.action)).toEqual(["mapped", "merged", "quarantined"]);
    expect(plan.decisions[2]).toMatchObject({ reason: "conflicting_measure" });
    expect(plan.totals.input).toBe(plan.totals.mapped + plan.totals.merged + plan.totals.quarantined);
  });

  it("does not merge equal measures from different source-identified variants", () => {
    const parents = planLegacyKnowledgeReconciliation([
      catalog, { ...catalog, id: 51, sourceCode: "ITEM-OTHER" },
    ], source, now);
    const plan = planLegacyCatalogPortions([
      portion, { ...portion, id: 101, foodCatalogId: 51 },
    ], parents.decisions);
    expect(plan.decisions.map(d => d.action)).toEqual(["mapped", "quarantined"]);
    expect(plan.decisions[1]).toMatchObject({ reason: "conflicting_measure" });
  });
});
 
describe("AUD-1302-028: revision provenance belongs to the legacy row", () => {
  const legacy: LegacyFoodCandidate = { ...base, sourceVersion: null,
    nutritionFingerprint: "macro-v1" };
  const url = "https://source.example/catalog/v1";
  const payload = { table: "foods", legacyRowId: 1, sourceId: 7,
    sourceVersion: "1", sourceCode: "T001", nutritionFingerprint: "macro-v1" };
  const proof = { subjectKey: "b2:legacy:foods:1", evidenceType: "official_source",
    sourceId: 7, ownerUserId: null, sourceReference: url,
    payloadJson: JSON.stringify(payload),
    contentHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    capturedAt: new Date("2026-10-20T12:00:00Z"),
    retentionUntil: new Date("2026-11-20T12:00:00Z") };
  it("keeps old food unversioned and quarantined without per-row proof", () => {
    expect(provenLegacySourceRevision(legacy, [], url, now)).toBeNull();
    expect(planLegacyKnowledgeReconciliation([legacy], source, now).decisions[0])
      .toMatchObject({ action: "quarantined", reason: "source_untraceable" });
  });
  it("requires exact URL, row, owner, expiry, digest and valid source revision", () => {
    expect(provenLegacySourceRevision(legacy, [proof], url, now)).toBe("1");
    expect(planLegacyKnowledgeReconciliation(
      [{ ...legacy, sourceVersion: provenLegacySourceRevision(legacy, [proof], url, now) }],
      source, now).decisions[0]).toMatchObject({ action: "mapped" });
    expect(provenLegacySourceRevision(legacy, [proof], "https://source.example/catalog/v2", now))
      .toBeNull();
    expect(provenLegacySourceRevision(legacy, [{ ...proof, ownerUserId: 5 }], url, now))
      .toBeNull();
    expect(provenLegacySourceRevision(legacy, [{ ...proof, contentHash: "0".repeat(64) }], url, now))
      .toBeNull();
    expect(provenLegacySourceRevision(legacy, [{ ...proof, retentionUntil: now }], url, now))
      .toBeNull();
    expect(provenLegacySourceRevision({ ...legacy, id: 2 }, [proof], url, now))
      .toBeNull();
  });
  it("does not relabel an old version after a grant/source upgrade", () => {
    const older = { ...payload, sourceVersion: "0" };
    const oldProof = { ...proof, payloadJson: JSON.stringify(older),
      contentHash: createHash("sha256").update(JSON.stringify(older)).digest("hex") };
    expect(provenLegacySourceRevision(legacy, [oldProof], url, now)).toBe("0");
    expect(planLegacyKnowledgeReconciliation([{ ...legacy, sourceVersion: "0" }],
      source, now).decisions[0]).toMatchObject({ action: "quarantined", reason: "source_unlicensed" });
    expect(provenLegacySourceRevision(legacy, [proof, oldProof], url, now)).toBeNull();
  });
});
