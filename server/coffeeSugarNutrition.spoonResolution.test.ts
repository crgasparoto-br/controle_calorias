import {
  A1339_133908_NEGATIVE,
  A1339_133911_NEGATIVE,
  A1339_133912_POSITIVE,
  A1339_133909_POSITIVE,
  A1339_NEW03_AUDIT_NEGATIVE,
  A1339_133905_NEGATIVE,
  A1339_133906_NEGATIVE,
  A1339_133906_POSITIVE,
  A1339_133907_NEGATIVE,
  A1339_133907_POSITIVE,
  A1339_133905_POSITIVE,
  A1339_NEW03_AUDIT_POSITIVE,
  A1339_NEW03_METAMORPHIC_NEGATIVE,
  A1339_NEW03_METAMORPHIC_POSITIVE,
} from "./coffeeSugarNutrition.spoonQuantityRemediation.fixture";
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
    "café com uma colher de chá de açúcar e 1/2 g a mais de açúcar",
    "café com uma colher de chá de açúcar e ½ sachê a mais",
    "café com uma colher de chá de açúcar e 1/2 g",
    "café com uma colher de chá de açúcar e mais meia de açúcar",
    "café com uma colher de chá de açúcar e duas de açúcar",
    "café com uma colher de chá de açúcar e 5 de açúcar",
    "café com uma colher de chá de açúcar e 1/2 de açúcar",
    "café com uma colher de chá de açúcar e meia a mais",
    "café com uma colher de chá de açúcar e mais 2",
    "café com uma colher de chá de açúcar e meia a mais de açúcar",
    "café com uma colher de chá de açúcar e mais duas de açúcar",
    "café com uma colher de chá de açúcar e 0,5 de açúcar",
    "café com uma colher de chá de açúcar e duas adicionais",
    "café com uma colher de chá de açúcar e meia extra",
    "café com uma colher de chá de açúcar e meia pequena porção de açúcar",
    "café com uma colher de chá de açúcar e uma medida adicional de açúcar",
    "café com uma colher de chá de açúcar e duas porções adicionais de açúcar",
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
    "café com uma colher de chá de açúcar e 1/2 g a mais de leite",
    "café com uma colher de chá de açúcar e ½ sachê a mais de leite",
    "café com uma colher de chá de açúcar e 0,5 g a mais de leite",
    "café com uma colher de chá de açúcar e meia de leite",
    "café com uma colher de chá de açúcar e meia a mais de leite",
    "café com uma colher de chá de açúcar e duas de leite",
    "café com uma colher de chá de açúcar e mais duas bananas",
    "café com uma colher de chá de açúcar e meia pequena porção de leite",
    "café com uma colher de chá de açúcar e duas porções adicionais de leite",
  ])("keeps a single sugar spoon when any other quantity is unambiguously separate: %s", text => {
    expect(extractCoffeeSugarSpoonRequest(text)).toEqual({ quantity: 1, unit: "colher de cha" });
  });
});


describe("PR #1339 A-008/A-1339: ambiguous amounts cannot resolve a sugar spoon", () => {
  it.each([
    "caf\u00e9 com 1 ou 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com uma ou duas colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com 1 e 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com 1 ou duas colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com uma e 2 colheres de sopa de a\u00e7\u00facar",
    "caf\u00e9 com 1 a 2 colheres de sopa de a\u00e7\u00facar",
    "caf\u00e9 com 1 at\u00e9 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com 1 ou talvez 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9: entre 1 e 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "café com 1 e/ou 2 colheres de chá de açúcar",
    "café com uma e/ou duas colheres de chá de açúcar",
    "café com 1 e / ou 2 colheres de chá de açúcar",
    "café com 1 ou/e 2 colheres de sopa de açúcar",
    "café com 1 e-ou 2 colheres de sopa de açúcar",
    "café com 1 e/ou talvez 2 colheres de chá de açúcar",
    "café com 1 colher de chá de açúcar e mais açúcar",
    "café com 1 colher de chá de açúcar e açúcar adicional",
    "café com 1 colher de chá de açúcar ou mais",
    "café com 1 colher de chá de açúcar ou menos",
    "café com 1 colher de chá de açúcar e mais um pouco",
    "café com 1 colher de chá de açúcar mais um pouco",
    "café com 1 colher de chá de açúcar, mais um pouco",
    "café com 1 colher de chá de açúcar; mais um pouco",
    "café com 1 colher de chá de açúcar mais um pouquinho",
    "café com 1 colher de chá de açúcar, mais um tanto",
    "café com 1 colher de chá de açúcar mais um pouco de açúcar",
    "café com 1 colher de chá de açúcar outra",
    "café com 1 colher de chá de açúcar e outra",
    "café com 1 colher de chá de açúcar e outras",
    "café com 1 colher de chá de açúcar e mais um pouquinho",
    "café com 1 colher de chá de açúcar e mais um tanto",
    "café com 1 colher de chá de açúcar ou ainda menos",
    "café com 1 colher de chá de açúcar e também outra",
    "café com 1 colher de chá de açúcar ou um pouco",
    "café com 1 colher de chá de açúcar e mais uma medida",
    "café com 1 colher de chá de açúcar e mais um pouco de açúcar",
    "café com 1 colher de chá de açúcar e outra porção de açúcar",
    "café com 1 colher de chá de açúcar ou outra de açúcar",
    "café com 1 colher de chá de açúcar ou mais ainda",
    "café com 1 colher de chá de açúcar e só mais um tanto",
    "café com 1 colher de chá de açúcar ou menos de açúcar",
    "café com 1 colher de chá de açúcar e mais um pouco extra",
    "café com 1 colher de chá de açúcar e uma dose",
    "café com 1 colher de chá de açúcar e mais outra dose",
    "café com 1 colher de chá de açúcar e mais alguma coisa",
    "café com 1 colher de chá de açúcar e mais algo",
    "café com 1 colher de chá de açúcar e mais uma quantidade",
    "café com 1 colher de chá de açúcar e mais leite e mais um pouco",
    "café com 1 colher de chá de açúcar e outra porção de leite e outra",
    "café com 1 colher de chá de açúcar e uma dose de leite ou menos",
    "café com 1 colher de chá de açúcar e/ou mais",
    "café com 1 colher de chá de açúcar e mais leite e mais alguma coisa",
  ])("rejects a coordinated alternative before grams are resolved: %s", text => {
    expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
    expect(extractExplicitSugarQuantity(text)).toBeNull();
    expect(buildCoffeeWithExplicitSugarItem(text)).toBeNull();
  });

  it.each([
    ["caf\u00e9 com 2 colheres de ch\u00e1 de a\u00e7\u00facar", 2],
    ["caf\u00e9 com duas colheres de ch\u00e1 de a\u00e7\u00facar", 2],
    ["caf\u00e9: 2 colheres de ch\u00e1 de a\u00e7\u00facar", 2],
    ["caf\u00e9 com 1 colher de ch\u00e1 de a\u00e7\u00facar e 5 g de leite", 1],
    ["caf\u00e9 com 1 fatia de p\u00e3o e 2 colheres de ch\u00e1 de a\u00e7\u00facar", 2],
    ["café com 1 colher de chá de açúcar e mais leite", 1],
    ["café com 2 colheres de chá de açúcar e leite adicional", 2],
    ["café com 1 colher de chá de açúcar e mais um pouco de leite", 1],
    ["café com 1 colher de chá de açúcar mais um pouco de leite", 1],
    ["café com 1 colher de chá de açúcar, mais um pouco de leite", 1],
    ["café com 1 colher de chá de açúcar; mais um pouquinho de leite", 1],
    ["café com 1 colher de chá de açúcar mais leite", 1],
    ["café com 1 colher de chá de açúcar e outra de leite", 1],
    ["café com 1 colher de chá de açúcar ou mais leite", 1],
    ["café com 1 colher de chá de açúcar e outra porção de leite", 1],
    ["café com 1 colher de chá de açúcar ou menos de leite", 1],
    ["café com 1 colher de chá de açúcar e uma dose de leite", 1],
    ["café com 1 colher de chá de açúcar e mais outra dose de leite", 1],
    ["café com 1 colher de chá de açúcar e mais uma banana", 1],
    ["café com 1 colher de chá de açúcar e mais leite e outra porção de leite", 1],
    ["café com 1 colher de chá de açúcar e uma dose de leite e mais uma banana", 1],
  ] as const)("preserves unambiguous measured sugar: %s", (text, quantity) => {
    expect(extractCoffeeSugarSpoonRequest(text)?.quantity).toBe(quantity);
  });
});


describe("PR #1339 A-001/A-002: ingredient-scoped ellipses and additional spoons", () => {
  it.each([
    "café com 1 colher de chá de açúcar e um pouco mais de leite",
    "café com 1 colher de chá de açúcar um pouco mais de leite",
    "café com 1 colher de chá de açúcar , um pouquinho mais de leite",
    "café com 1 colher de chá de açúcar e um pouco de leite a mais",
    "café com 1 colher de chá de açúcar e um pouco a mais de leite",
    "café com 1 colher de chá de açúcar e 2 g de leite a mais",
    "café com 1 colher de chá de açúcar e mais um pouco do leite",
    "café com 1 colher de chá de açúcar e um pouco mais do leite",
    "café com 1 colher de chá de açúcar e mais um pouco da bebida vegetal",
    "café com 1 colher de chá de açúcar e mais um pouco para o leite",
    "café com 1 colher de chá de açúcar e leite com um pouco mais",
    "café com 1 colher de chá de açúcar e mais uma colher de leite",
    "café com 1 colher de chá de açúcar e mais uma colher de chá de leite",
    "café com 1 colher de chá de açúcar e outra colher de leite",
    "café com 1 colher de chá de açúcar e duas colheres de leite",
    "café com 1 colher de chá de açúcar e uma colher de sopa de leite",
    "café com 1 colher de chá de açúcar e uma colher de leite e mais um pouco de leite",
    "café com 1 colher de chá de açúcar e duas colheres de leite e um pouco mais de leite",
  ])("keeps the explicit sugar spoon when a separate ingredient is quantified: %s", text => {
    expect(extractCoffeeSugarSpoonRequest(text)).toEqual({ quantity: 1, unit: "colher de cha" });
  });

  it.each([
    "café com 1 colher de chá de açúcar e mais uma colher",
    "café com 1 colher de chá de açúcar e mais uma colher de açúcar",
    "café com 1 colher de chá de açúcar e outra colher de açúcar",
    "café com 1 colher de chá de açúcar e duas colheres de açúcar",
    "café com 1 colher de chá de açúcar e duas colheres de leite e mais um pouco",
    "café com 1 colher de chá de açúcar e 2 g de leite a mais e mais um pouco",
    "café com 1 colher de chá de açúcar e um pouco mais de açúcar",
    "café com 1 colher de chá de açúcar e um pouco de açúcar a mais",
    "café com 1 colher de chá de açúcar e mais um pouco do açúcar",
    "café com 1 colher de chá de açúcar e mais uma colher de leite e outra",
  ])("keeps an unresolved or sugar-bound extra measure ambiguous: %s", text => {
    expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
    expect(extractExplicitSugarQuantity(text)).toBeNull();
  });
});

describe("A-1339-BIND-01: bound milk ellipses preserve the sugar spoon", () => {
  const stem = "café com 1 colher de chá de açúcar";
  it.each([
    "e leite com mais um pouco",
    "e leite com só um pouco mais",
    "e 100 ml de leite com mais um pouco",
    "e leite com um pouco mais",
    "e leite com apenas um pouco mais",
    "e leite com ainda mais um pouco",
    "e leite com mais um pouquinho",
    "e leite com só mais um pouquinho",
    "e leite com mais um pouco e 2 g de leite",
  ])("retains the explicit sugar measure when milk owns the ellipsis: %s", tail => {
    expect(extractCoffeeSugarSpoonRequest(`${stem} ${tail}`)).toEqual({
      quantity: 1, unit: "colher de cha",
    });
  });

  it.each([
    "e mais um pouco",
    "e leite e mais um pouco",
    "e leite com mais um pouco e mais um pouco",
    "e leite com mais um pouco de açúcar",
    "e açúcar com mais um pouco",
    "e leite com mais um pouco e mais açúcar",
    "e leite com mais um pouco e 2 g de açúcar",
    "e leite com um pouco mais e outra colher",
  ])("still clarifies an unbound or sugar-bound continuation: %s", tail => {
    expect(extractCoffeeSugarSpoonRequest(`${stem} ${tail}`)).toBeNull();
  });
});

describe("A-1339-BIND-02: connectors cannot masquerade as ingredient subjects", () => {
  const stem = "café com 1 colher de chá de açúcar";
  it.each([
    "e com mais um pouco",
    "mas com mais um pouco",
    "ou com mais um pouco",
    "e/ou com mais um pouco",
    "nem com mais um pouco",
    "e com só um pouco mais",
    "mas com só mais um pouquinho",
    "e com um pouco mais",
    "e leite com mais um pouco e com mais um pouco",
    "e com mais um pouco e leite com mais um pouco",
  ])("rejects an unbound continuation even after a connector: %s", tail => {
    const text = stem + " " + tail;
    expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
    expect(extractExplicitSugarQuantity(text)).toBeNull();
    expect(buildCoffeeWithExplicitSugarItem(text)).toBeNull();
  });

  it.each([
    "e leite com mais um pouco",
    "e leite com só um pouco mais",
    "e água com mais um pouco",
    "mas leite com mais um pouco",
    "e 100 ml de leite com mais um pouco",
    "e com mais um pouco de leite",
    "e leite com mais um pouco e com mais um pouco de leite",
  ])("keeps sugar separate when the ellipsis has an explicit ingredient: %s", tail => {
    expect(extractCoffeeSugarSpoonRequest(stem + " " + tail)).toEqual({
      quantity: 1, unit: "colher de cha",
    });
  });
});

// Independent audit of HEAD 5096091: A-133903 / A-133904.
describe("A-133903/A-133904: adjuncts and indefinite second sugar measures", () => {
  const stem = "café com 1 colher de chá de açúcar";
  it.each([
    "e depois com mais um pouco",
    "e infelizmente com mais um pouco",
    "e eventualmente com mais um pouco",
    "e provavelmente com mais um pouco",
    "e depois disso com mais um pouco",
    "e isso com mais um pouco",
    "e aquilo com mais um pouco",
    "e nada com mais um pouco",
    "e cuidadosamente com mais um pouco",
    "e um açúcar",
    "e várias pitadas de açúcar",
    "e então com mais um pouco",
    "e talvez com mais um pouco",
    "e agora com mais um pouco",
    "e aqui com mais um pouco",
    "e daí com mais um pouco",
    "e logo com mais um pouco",
    "e novamente com mais um pouco",
    "e por fim com mais um pouco",
    "e de novo com mais um pouco",
    "e em seguida com mais um pouco",
    "e ontem com só um pouco mais",
    "e umas gotas de açúcar",
    "e umas pitadas de açúcar",
    "e uns gramas de açúcar",
    "e vários gramas de açúcar",
    "e algum açúcar",
    "e um pouco de açúcar",
    "e algumas gotas de açúcar",
    "e muitas gotas de açúcar",
    "e poucas pitadas de açúcar",
    "e um açúcar extra",
  ])("requires clarification for a second amount without a safe binding: %s", tail => {
    const text = `${stem} ${tail}`;
    expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
    expect(extractExplicitSugarQuantity(text)).toBeNull();
    expect(buildCoffeeWithExplicitSugarItem(text)).toBeNull();
  });

  it.each([
    "e leite com mais um pouco",
    "e leite com só um pouco mais",
    "e mais um pouco de leite",
    "e aveia com mais um pouco",
    "e iogurte com um pouco mais",
    "e mel com mais um pouco",
    "e aveia com só um pouco mais",
    "e umas gotas de leite",
    "e umas gotas de leite",
    "e uns gramas de leite",
    "e vários gramas de leite",
    "e algum leite",
    "e algumas gotas de leite",
  ])("does not steal amounts belonging to an explicitly named ingredient: %s", tail => {
    expect(extractCoffeeSugarSpoonRequest(`${stem} ${tail}`)).toEqual({
      quantity: 1, unit: "colher de cha",
    });
  });
});


describe("PR #1339 A-1339-NEW-01/02: colloquial ellipses and genitive owners", () => {
  const stem = "café com 1 colher de chá de açúcar";
  it.each([
    "e mais um tiquinho",
    "e mais um cadinho",
    "e mais uma colherzinha",
    "e só mais um tiquinho",
    ", mais um cadinho",
    "; mais uma colherzinha",
    "e um tiquinho",
    "e menos uma colherzinha",
    "e mais um tiquinho do açúcar",
    "e leite com mais um tiquinho e mais um cadinho",
  ])("does not discard an unbound colloquial amount: %s", tail => {
    const text = `${stem} ${tail}`;
    expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
    expect(extractExplicitSugarQuantity(text)).toBeNull();
    expect(buildCoffeeWithExplicitSugarItem(text)).toBeNull();
  });

  it.each([
    "e 5 g do leite",
    "e duas gramas da bebida vegetal",
    "e 2 g a mais dos cereais",
    "e +3g das frutas",
    "e uma colherzinha do leite",
    "e mais um tiquinho de leite",
    "e mais um cadinho da bebida vegetal",
    "e leite com mais um tiquinho",
    "e leite com mais uma colherzinha",
    "e mais uma banana",
    "e 1 pão",
  ])("keeps sugar independent of another explicit ingredient: %s", tail => {
    expect(extractCoffeeSugarSpoonRequest(`${stem} ${tail}`)).toEqual({
      quantity: 1, unit: "colher de cha",
    });
  });
});


describe("A-1339-NEW-03: colloquial competing quantities never disappear", () => {
  it.each([...A1339_NEW03_AUDIT_NEGATIVE, ...A1339_NEW03_METAMORPHIC_NEGATIVE])(
    "fails closed on unknown additional measure %s", (_id, text) => {
      expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
      expect(extractExplicitSugarQuantity(text)).toBeNull();
      expect(buildCoffeeWithExplicitSugarItem(text)).toBeNull();
    },
  );

  it.each([...A1339_NEW03_AUDIT_POSITIVE, ...A1339_NEW03_METAMORPHIC_POSITIVE])(
    "keeps the sugar spoon independent when another ingredient is named %s", (_id, text) => {
      expect(extractCoffeeSugarSpoonRequest(text)).toEqual({
        quantity: 1, unit: "colher de cha",
      });
    },
  );
});

describe("A-133905: bare second sugar mention is not one measured spoon", () => {
  it.each(A1339_133905_NEGATIVE)("requires clarification before nutrient conversion %s", (_id, text) => {
    expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
    expect(buildCoffeeWithExplicitSugarItem(text)).toBeNull();
  });

  it.each(A1339_133905_POSITIVE)("preserves a uniquely bound spoon %s", (_id, text) => {
    expect(extractCoffeeSugarSpoonRequest(text)).toEqual({ quantity: 1, unit: "colher de cha" });
  });
});


describe("A-133906: unrecognized sugar portions do not vanish", () => {
  it.each(A1339_133906_NEGATIVE)("rejects overlapping sugar quantity %s", (_id, text) => {
    expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
    expect(extractExplicitSugarQuantity(text)).toBeNull();
    expect(buildCoffeeWithExplicitSugarItem(text)).toBeNull();
  });

  it.each(A1339_133906_POSITIVE)("keeps an explicitly separate ingredient/food %s", (_id, text) => {
    expect(extractCoffeeSugarSpoonRequest(text)).toEqual({ quantity: 1, unit: "colher de cha" });
  });
});


describe("A-133907: spoon denomination cannot be mistaken for an ingredient", () => {
  it.each(A1339_133907_NEGATIVE)("requires clarification for unbound second spoon %s", (_id, text) => {
    expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
    expect(extractExplicitSugarQuantity(text)).toBeNull();
    expect(buildCoffeeWithExplicitSugarItem(text)).toBeNull();
  });

  it.each(A1339_133907_POSITIVE)("keeps an independent, explicitly bound component %s", (_id, text) => {
    expect(extractCoffeeSugarSpoonRequest(text)).toEqual({ quantity: 1, unit: "colher de cha" });
  });
});


describe("A-133908/A-133909: packaged measures vs distinct foods", () => {
  it.each(A1339_133908_NEGATIVE)("never uses the first sugar spoon after a competing portion %s", (_id, text) => {
    expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
    expect(extractExplicitSugarQuantity(text)).toBeNull();
    expect(buildCoffeeWithExplicitSugarItem(text)).toBeNull();
  });

  it.each(A1339_133909_POSITIVE)("preserves a separate food without inventing sugar grams %s", (_id, text) => {
    expect(extractCoffeeSugarSpoonRequest(text)).toEqual({ quantity: 1, unit: "colher de cha" });
  });
});


describe("A-133911/A-133912: unknown utensils vs independent foods of spoon", () => {
  it.each(A1339_133911_NEGATIVE)("fails closed on a second measured sugar amount %s", (_id, text) => {
    expect(extractCoffeeSugarSpoonRequest(text)).toBeNull();
    expect(extractExplicitSugarQuantity(text)).toBeNull();
    expect(buildCoffeeWithExplicitSugarItem(text)).toBeNull();
  });

  it.each(A1339_133912_POSITIVE)("keeps a single measured spoon with a separate food %s", (_id, text) => {
    expect(extractCoffeeSugarSpoonRequest(text)).toEqual({ quantity: 1, unit: "colher de cha" });
  });
});
