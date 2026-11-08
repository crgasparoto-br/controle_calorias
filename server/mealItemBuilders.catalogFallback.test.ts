import { describe, expect, it } from "vitest";
import {
  hasUnresolvedWrittenCount,
  resolveExactBrandedUnitCatalogGrams,
} from "./foodTextNormalization";
import { buildHeuristicItem } from "./mealItemBuilders";

describe("V1 catalog fallback — numeric and safe canonical units", () => {
  it.each([
    "500 ml de água com gás",
    "100 g de queijo muçarela",
    "50 g de pão integral Wickbold",
    "1 xícara de café sem açúcar",
    "1 bisnaguinha Panco",
  ])("does not mistake numeric quantity for unresolved written numeral: %s", text => {
    expect(hasUnresolvedWrittenCount(text)).toBe(false);
  });

  it.each(["um pouco de arroz", "um sal", "uma pêra packans"])(
    "keeps unsafe written count unresolved: %s",
    text => {
      expect(hasUnresolvedWrittenCount(text)).toBe(true);
    },
  );

  it("preserves the catalog value for explicit water volume", () => {
    expect(buildHeuristicItem("500 ml de água com gás")).toEqual(
      expect.objectContaining({
        canonicalName: "Água com Gás",
        quantity: 500,
        unit: "ml",
        estimatedGrams: 500,
        calories: 0,
        source: "catalog",
      }),
    );
  });

  it.each([
    ["1 bisnaguinha Panco", "1 Bisnaguinha Panco", 1, "1 unidade", 20, 62],
    ["2 bisnaguinhas Panco", "2 Bisnaguinhas Panco", 2, "2 unidades", 40, 124],
  ])("uses exact branded unit serving for %s", (text, foodName, quantity, portionText, grams, calories) => {
    expect(buildHeuristicItem(text)).toEqual(
      expect.objectContaining({
        foodName,
        canonicalName: "Bisnaguinha Panco",
        quantity,
        unit: "un",
        portionText,
        estimatedGrams: grams,
        calories,
        source: "catalog",
      }),
    );
  });

  it.each([
    ["50 g de Pão integral Wickbold", 50, 124],
    ["100 g de Pão integral Wickbold", 100, 248],
  ])("keeps explicit mass authoritative for %s", (text, grams, calories) => {
    expect(buildHeuristicItem(text)).toEqual(
      expect.objectContaining({
        canonicalName: "Pão Integral Wickbold",
        quantity: grams,
        unit: "g",
        estimatedGrams: grams,
        calories,
        source: "catalog",
      }),
    );
  });

  it.each([
    ["bisnaguinha", 1],
    ["Pão integral Wickbold", 1],
    ["um sal", 1],
    ["bisnaguinha Panco", 0],
  ] as const)("does not invent grams without an exact branded unit portion: %s", (name, quantity) => {
    expect(resolveExactBrandedUnitCatalogGrams(name, quantity)).toBeNull();
  });

  it("does not map an uncertain count onto a fuzzy catalog alias", () => {
    const item = buildHeuristicItem("um sal");
    expect(item.canonicalName).toBe("Um Sal");
    expect(item.source).toBe("heuristic");
  });
});
