import { describe, expect, it } from "vitest";
import { planLegacyKnowledgeReconciliation, type LegacyFoodCandidate } from "./legacyReconciliation";
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
