import { describe, expect, it } from "vitest";
import {
  appendSugarQuantityToCoffeeText,
  buildCoffeeWithExplicitSugarItem,
  extractCoffeeSugarSpoonRequest,
  extractExplicitSugarQuantity,
  hasUnresolvedMeasuredCoffeeComposite,
  normalizeSweetenedCoffeeDraftItems,
  type CoffeeSugarSpoonMeasures,
} from "./coffeeSugarNutrition";
import { isCoffeeWithAddedSugar } from "./foodSemanticCompatibility";

const segment = "café com 1 colher de chá de açúcar";
const measured = new Map([[segment, {
  quantity: 1,
  sourceUnit: "colher de chá",
  grams: 8,
  kind: "researched_exact",
  sourceUrls: ["https://example.org/verified-sugar"],
  evidence: "1 colher corresponde a 8 g nesta porção",
  referenceCount: 1,
}]]) satisfies CoffeeSugarSpoonMeasures;

describe("#1339 A-003 — açúcar medido sem conversões paralelas", () => {
  it("não atribui automaticamente 4 g ou 12 g a uma colher não validada", () => {
    expect(extractExplicitSugarQuantity(segment)).toBeNull();
    expect(extractExplicitSugarQuantity("café com 1 colher de sopa de açúcar")).toBeNull();
    expect(buildCoffeeWithExplicitSugarItem(segment)).toBeNull();
    expect(extractExplicitSugarQuantity("café com 5 g de açúcar")?.grams).toBe(5);
  });

  it("obtém gramas do componente confirmado e preserva medida/procedência sem dupla contagem", () => {
    const item = buildCoffeeWithExplicitSugarItem(segment, measured)!;
    expect(item).toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      quantity: 1, unit: "xícara", carbs: 8, estimatedGrams: 208,
      calories: 34, source: "heuristic",
      resolution: expect.objectContaining({
        nutritionVerified: false,
        measureResolution: expect.objectContaining({
          componentName: "açúcar", grams: 8, requestedUnit: "colher de chá",
          verified: true, referenceCount: 1,
          sourceUrls: ["https://example.org/verified-sugar"],
        }),
      }),
    }));
    expect(item.portionText).toMatch(/1 colher de chá de açúcar \(8 g\)/);
  });

  it("incorpora somente o café correto no lote e preserva os demais itens", () => {
    const food = { foodName: "Pão", canonicalName: "Pão", source: "heuristic", quantity: 1, unit: "un", calories: 100 };
    const coffee = { foodName: "Café com açúcar", canonicalName: "Café com açúcar", source: "heuristic", quantity: 1, unit: "xícara", calories: 22 };
    const source = `${segment} e 1 pão`;
    const items = normalizeSweetenedCoffeeDraftItems([coffee, food] as never, source, measured);
    expect(items).toHaveLength(2);
    expect(items.find(item => item.canonicalName === "Café com açúcar")?.carbs).toBe(8);
    expect(items.some(item => item.foodName === "Pão")).toBe(true);
  });

  it("aceita numeral por extenso e rejeita referência ambígua sem estimativa", () => {
    expect(isCoffeeWithAddedSugar("café com uma colher de chá de açúcar")).toBe(true);
    expect(extractCoffeeSugarSpoonRequest("café com uma colher de chá de açúcar")).toEqual({
      quantity: 1, unit: "colher de cha",
    });
    expect(extractCoffeeSugarSpoonRequest("café com 1 colher de sopa e 1 colher de chá de açúcar")).toBeNull();
    expect(extractCoffeeSugarSpoonRequest("café com 1 colher de chá de açúcar e 5 g de açúcar")).toBeNull();
  });

  it("rejeita composição adicional desconhecida mesmo com açúcar medido", () => {
    expect(hasUnresolvedMeasuredCoffeeComposite("café com leite e 1 colher de chá de açúcar", [],
      new Map([["café com leite e 1 colher de chá de açúcar", measured.get(segment)!]]))).toBe(true);
  });

  it("substitui quantidade não resolvida pela resposta explícita de clarificação", () => {
    expect(appendSugarQuantityToCoffeeText(segment, 5, "g")).toBe("café com 5 g de açúcar");
  });
});

describe("PR #1339 A-004: syntactic coffee sugar binding", () => {
  it("never interprets milk spoon or explicit sugar negation as a sugar measure", () => {
    expect(extractCoffeeSugarSpoonRequest("caf\u00e9 sem a\u00e7\u00facar com 1 colher de sopa de leite")).toBeNull();
    expect(extractCoffeeSugarSpoonRequest("caf\u00e9 com 5 g de a\u00e7\u00facar e 1 colher de sopa de leite")).toBeNull();
    expect(extractCoffeeSugarSpoonRequest("caf\u00e9 sem a\u00e7\u00facar com 1 colher de ch\u00e1 de a\u00e7\u00facar")).toBeNull();
    expect(extractCoffeeSugarSpoonRequest("caf\u00e9 com uma colher de ch\u00e1 de a\u00e7\u00facar")).toEqual({
      quantity: 1, unit: "colher de cha",
    });
  });
});

describe("PR #1339 A-005: competing sugar measures in numeric and spoken forms", () => {
  it.each([
    ["5 gramas", "cinco gramas"],
    ["1 pacote", "um pacote"],
    ["2 sachês", "dois sachês"],
    ["3 kg", "três quilos"],
    ["4 mg", "quatro miligramas"],
  ] as const)("rejects both equivalent extra amounts (%s / %s)", (numeric, written) => {
    for (const extra of [numeric, written]) {
      expect(extractCoffeeSugarSpoonRequest(
        `café com uma colher de chá de açúcar e ${extra} de açúcar`,
      )).toBeNull();
    }
  });

  it("preserves a single spoken sugar spoon and does not bind another ingredient to sugar", () => {
    expect(extractCoffeeSugarSpoonRequest("café com uma colher de chá de açúcar")).toEqual({
      quantity: 1, unit: "colher de cha",
    });
    expect(extractCoffeeSugarSpoonRequest(
      "café com uma colher de chá de açúcar e cinco gramas de leite",
    )).toEqual({ quantity: 1, unit: "colher de cha" });
    expect(extractCoffeeSugarSpoonRequest(
      "café sem açúcar com uma colher de sopa de leite",
    )).toBeNull();
  });
});
