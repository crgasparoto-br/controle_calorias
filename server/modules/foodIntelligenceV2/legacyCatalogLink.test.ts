import { describe, expect, it } from "vitest";
import { findTraceableCatalogFamily } from "./legacyCatalogLink";

const family = {
  id: 42, name: "Alimento X", normalizedName: "alimento x", brandName: null,
  status: "active",
  scope: "global" as const, ownerUserId: null, sourceId: 7,
  sourceFoodCode: "ITEM-1", canonicalKey: "family-x",
  caloriesKcalPer100g: 200, proteinGramsPer100g: 10,
  carbsGramsPer100g: 30, fatGramsPer100g: 4,
};
const catalog = {
  name: "Alimento X", brandName: null, createdByUserId: null, isUserCreated: 0,
  status: "active", dataSource: "reference", researchIdentityKey: "ITEM-1",
  sourceUrls: JSON.stringify(["https://reference.example/products/ITEM-1"]),
  sourceVerifiedAt: new Date("2026-10-20T12:00:00Z"),
  gramsPerServing: 50, calories: 100, protein: 5, carbs: 15, fat: 2,
};
const sources = new Map([[7, { source: {
  id: 7, slug: "reference", version: "1", sourceUrl: "https://reference.example",
} }]]);
describe("B2 catalog reconciliation provenance", () => {
  it("links only a unique, source-bound and nutrition-equivalent legacy family", () => {
    expect(findTraceableCatalogFamily(catalog, [family], sources)?.id).toBe(42);
    expect(findTraceableCatalogFamily(catalog, [family, { ...family, id: 43 }], sources)).toBeNull();
  });
  it("quarantines no source, mismatched code, URL, macros, name, brand and scope", () => {
    for (const diff of [
      { researchIdentityKey: "OTHER" }, { sourceUrls: "[]" },
      { calories: 99 }, { name: "Another food" }, { brandName: "Other" },
      { createdByUserId: 44 }, { isUserCreated: 1 }, { sourceVerifiedAt: null },
    ]) expect(findTraceableCatalogFamily({ ...catalog, ...diff }, [family], sources)).toBeNull();
    expect(findTraceableCatalogFamily(catalog, [{ ...family, scope: "user" as const }], sources)).toBeNull();
    expect(findTraceableCatalogFamily(catalog, [{ ...family, status: "deprecated" }], sources)).toBeNull();
    expect(findTraceableCatalogFamily(catalog, [{ ...family, sourceFoodCode: null }], sources)).toBeNull();
  });
});
