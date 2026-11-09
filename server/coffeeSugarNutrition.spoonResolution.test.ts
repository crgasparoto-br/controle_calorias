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

describe("PR #1339 A-006/A-007: adversarial quantities", () => {
  it.each([
    "café com 1/2 colher de chá de açúcar",
    "café com 3/4 colher de chá de açúcar",
    "café com 1+2 colheres de chá de açúcar",
    "café com -2 colheres de chá de açúcar",
    "café com 1 / 2 colher de chá de açúcar",
    "café com 1 x 2 colheres de chá de açúcar",
    "café com −2 colheres de chá de açúcar",
    "café com 3×2 colheres de chá de açúcar",
    "café com 1−2 colheres de chá de açúcar",
    "café com 1:2 colheres de chá de açúcar",
    "café com 1 : 2 colheres de chá de açúcar",
    "café com 3x2 colheres de chá de açúcar",
    "café com 1⁄2 colher de chá de açúcar",
    "café com 2·3 colheres de chá de açúcar",
    "café com 1—2 colheres de chá de açúcar",
    "café com 1÷2 colheres de chá de açúcar",
    "café com +2 colheres de chá de açúcar",
  ])("rejects an expression fragment: %s", text => {
    expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
    expect(buildCoffeeWithExplicitSugarItem(text)).toBeNull();
  });
  it.each(["cinco gramas adicionais", "5 gramas adicionais", "5 g extras", "cinco gramas a mais", "2 sachês extras"])("rejects competing sugar %s", extra => {
    expect(extractCoffeeSugarSpoonRequest(`café com uma colher de chá de açúcar e ${extra} de açúcar`)).toBeNull();
  });
  it("keeps a distinct ingredient and one confirmed spoon", () => {
    expect(extractCoffeeSugarSpoonRequest("café com uma colher de chá de açúcar e cinco gramas adicionais de leite")).toEqual({ quantity: 1, unit: "colher de cha" });
  });
});

describe("PR #1339 reauditoria A-007: flexão dos qualificadores", () => {
  it.each([
    "um grama adicional",
    "1 grama adicional",
    "1 g adicional",
    "um sachê adicional",
    "duas gramas adicionais",
    "2 sachês adicionais",
    "1 g extra",
    "dois gramas a mais",
  ])("rejects a second sugar measure described as %s", extra => {
    expect(extractCoffeeSugarSpoonRequest(
      `café com uma colher de chá de açúcar e ${extra} de açúcar`,
    )).toBeNull();
  });

  it.each([
    "café: 2 colheres de chá de açúcar",
    "café com 1,5 colheres de chá de açúcar",
    "café com uma colher de chá de açúcar e um grama adicional de leite",
  ])("keeps unambiguous quantities: %s", text => {
    expect(extractCoffeeSugarSpoonRequest(text)?.quantity).toBeGreaterThan(0);
  });
});

describe("PR #1339 A-008: unknown and elided competing sugar measures", () => {
  it.each([
    "café com uma colher de chá de açúcar e 1 pitada de açúcar",
    "café com uma colher de chá de açúcar e uma pitada de açúcar",
    "café com 1 pitada de açúcar e uma colher de chá de açúcar",
    "café com uma colher de chá de açúcar e cinco gramas adicionais",
    "café com uma colher de chá de açúcar e 5 gramas adicionais",
    "café com uma colher de chá de açúcar e mais 5 g",
    "café com uma colher de chá de açúcar e mais cinco gramas",
    "café com uma colher de chá de açúcar, 5 g",
    "café com uma colher de chá de açúcar e 1 pitada",
    "café com uma colher de chá de açúcar e meio sachê de açúcar",
    "café com uma colher de chá de açúcar e +3g a mais",
    "café com uma colher de chá de açúcar e 5g de açúcar",
    "café com uma colher de chá de açúcar e 1/2 g de açúcar",
    "café com uma colher de chá de açúcar e 1/2 sachê de açúcar",
    "café com uma colher de chá de açúcar e ½ g de açúcar",
    "café com uma colher de chá de açúcar e 1⁄2 g de açúcar",
    "café com uma colher de chá de açúcar e 1∕2 g de açúcar",
    "café com uma colher de chá de açúcar e 2½ g de açúcar",
    "café com uma colher de chá de açúcar e 1/2g de açúcar",
    "café com uma colher de chá de açúcar e +1/2g de açúcar",
    "café com uma colher de chá de açúcar e 1/2 g adicionais",
    "café com uma colher de chá de açúcar e 1/2 g de açúcar.",
    "café com uma colher de chá de açúcar e 1/2 g",
  ])("rejects an extra amount before splitting the source: %s", text => {
    expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
    expect(extractExplicitSugarQuantity(text)).toBeNull();
    expect(buildCoffeeWithExplicitSugarItem(text)).toBeNull();
  });

  it.each([
    "café com uma colher de chá de açúcar",
    "café com uma colher de chá de açúcar e 2 g adicionais de leite",
    "café com uma colher de chá de açúcar e 1 pitada de sal",
    "café com uma colher de chá de açúcar e 100 g de pão",
    "café com uma colher de chá de açúcar e 1 pão",
    "café com uma colher de chá de açúcar e 1/2 g de leite",
    "café com uma colher de chá de açúcar e ½ g de leite",
    "café com uma colher de chá de açúcar e 1/2g de leite",
    "café com uma colher de chá de açúcar e 1/2 sachê de adoçante",
    "café com uma colher de chá de açúcar e 1/2 g de leite.",
  ])("keeps a single sugar spoon when any other quantity is unambiguously separate: %s", text => {
    expect(extractCoffeeSugarSpoonRequest(text)).toEqual({ quantity: 1, unit: "colher de cha" });
  });
});
