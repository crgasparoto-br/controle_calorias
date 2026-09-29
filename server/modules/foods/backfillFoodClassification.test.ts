import { describe, expect, it } from "vitest";
import {
  buildDeterministicCatalogIndex,
  planDeterministicBackfill,
  resolveDeterministicCatalogId,
  type CatalogRow,
  type UnclassifiedItemRow,
} from "../../../scripts/backfill-food-classification";

function catalogRow(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    id: 1,
    name: "Melão",
    aliases: JSON.stringify(["melão dino"]),
    status: "active",
    createdByUserId: null,
    ...overrides,
  };
}

function item(overrides: Partial<UnclassifiedItemRow> = {}): UnclassifiedItemRow {
  return {
    id: 10,
    userId: 7,
    foodName: "melão dino",
    canonicalName: "melão dino",
    ...overrides,
  };
}

describe("deterministic food classification backfill", () => {
  it("links a canonical name or alias only to one active visible row", () => {
    const rows = [catalogRow({ id: 11 })];

    expect(resolveDeterministicCatalogId(item(), 7, rows)).toBe(11);
    expect(resolveDeterministicCatalogId(item({ foodName: "não existe", canonicalName: "não existe" }), 7, rows)).toBeNull();
  });

  it("does not choose an arbitrary row when an alias is ambiguous", () => {
    const rows = [
      catalogRow({ id: 11 }),
      catalogRow({ id: 12, name: "Pera", aliases: JSON.stringify(["melão dino"]) }),
    ];

    expect(buildDeterministicCatalogIndex(rows).has("melao dino")).toBe(false);
    expect(resolveDeterministicCatalogId(item(), 7, rows)).toBeNull();
  });

  it("ignores another user's row and deprecated rows", () => {
    const rows = [
      catalogRow({ id: 11, createdByUserId: 8 }),
      catalogRow({ id: 12, status: "deprecated" }),
      catalogRow({ id: 13, createdByUserId: 7 }),
    ];

    expect(resolveDeterministicCatalogId(item(), 7, rows)).toBe(13);
    expect(resolveDeterministicCatalogId(item(), 9, rows)).toBeNull();
  });

  it("plans links by user and catalog row, leaving unresolved names pending", () => {
    const rows = [catalogRow({ id: 11 })];
    const firstRun = planDeterministicBackfill([
      item({ id: 10 }),
      item({ id: 11, userId: 9, foodName: "desconhecido", canonicalName: "desconhecido" }),
    ], rows);

    expect(firstRun.links).toEqual([
      { userId: 7, catalogId: 11, items: [item({ id: 10 })] },
    ]);
    expect(firstRun.pending).toEqual([
      { userId: 9, key: "desconhecido", count: 1 },
    ]);

    const secondRun = planDeterministicBackfill([item({ id: 10, foodCatalogId: 11 })], rows);
    expect(secondRun).toEqual({ links: [], pending: [] });
  });
});
