import { describe, expect, it } from "vitest";
import {
  extractExplicitQuantities,
  extractExplicitQuantityFoodSegments,
  getQuantityExpressionClarification,
  parseCountableQuantityPrefix,
  parseFoodText,
  unwrapMealQuantityPreface,
} from "./mealTextParsing";

describe("mealTextParsing household spoon units", () => {
  it.each([
    ["1 colher de arroz", "arroz", 1, "colher"],
    ["2 colheres de arroz", "arroz", 2, "colher"],
    ["1 colher de sopa de arroz", "arroz", 1, "colher de sopa"],
    ["2 colheres de sopa de arroz", "arroz", 2, "colher de sopa"],
    ["1 colher de chá de sal", "sal", 1, "colher de chá"],
    ["2 colheres de chá de sal", "sal", 2, "colher de chá"],
  ])("reconhece %s", (input, foodName, quantity, unit) => {
    expect(parseFoodText(input)).toEqual(
      expect.objectContaining({
        foodName,
        quantity,
        unit,
      })
    );
  });

  it.each([
    "comi 1 colher de sopa de arroz",
    "hoje comi 1 colher de sopa de arroz",
    "nesta refeição eu comi 1 colher de sopa de arroz",
  ])("interpreta a medida após o verbo sem reler identidade da frase inteira: %s", input => {
    expect(extractExplicitQuantityFoodSegments(input)).toEqual([
      expect.objectContaining({ foodName: "arroz", quantity: 1, unit: "colher de sopa" }),
    ]);
  });

  it("não reescreve texto livre ou enunciado sem quantidade", () => {
    for (const text of ["comi arroz", "não comi 1 colher de arroz", "como seria 1 colher de arroz?"]) {
      expect(unwrapMealQuantityPreface(text)).toBe(text);
    }
  });

  it("não trata ‘1 colher de sopa’ sem um segundo ‘de’ como medida qualificada", () => {
    expect(parseFoodText("1 colher de sopa")).toEqual(
      expect.objectContaining({
        foodName: "sopa",
        quantity: 1,
        unit: "colher",
      })
    );
  });

  it.each([
    ["1 colher de sopa", "sopa", "colher"],
    ["1 colher de chá de sal", "sal", "colher de chá"],
  ])(
    "mantém parser e extrator de segmentos alinhados em %s",
    (input, foodName, unit) => {
      expect(parseFoodText(input)).toEqual(
        expect.objectContaining({
          foodName,
          quantity: 1,
          unit,
        })
      );
      expect(extractExplicitQuantityFoodSegments(input)).toEqual([
        expect.objectContaining({ foodName, quantity: 1, unit }),
      ]);
    }
  );

  it.each([
    ["1 unidade", "un"],
    ["1 colher de sopa", "colher de sopa"],
    ["1 colher de chá", "colher de chá"],
  ])("extrai unidade de rótulo isolado %s", (label, unit) => {
    expect(extractExplicitQuantities(label)).toEqual([
      expect.objectContaining({ quantity: 1, unit }),
    ]);
  });

  it("preserva o contrato próprio dos labels globais em texto segmentado e acentuado", () => {
    expect(
      extractExplicitQuantities(
        "1 colher de sopa de arroz e 1 colher de chá de sal"
      )
    ).toEqual([
      expect.objectContaining({ quantity: 1, unit: "colher de sopa" }),
      expect.objectContaining({ quantity: 1, unit: "colher de chá" }),
    ]);
  });

  it("extrai medidas distintas no mesmo segmento de texto", () => {
    expect(
      extractExplicitQuantities("1 colher de sopa de arroz com 2 fatias de pão")
    ).toEqual([
      expect.objectContaining({ quantity: 1, unit: "colher de sopa" }),
      expect.objectContaining({ quantity: 2, unit: "fatia" }),
    ]);
  });

  it("decodifica o prefixo countable sem depender de rewrite do nome do alimento", () => {
    expect(parseCountableQuantityPrefix("duas bananas prata")).toEqual({
      quantity: 2,
      remainder: "bananas prata",
    });
    expect(parseCountableQuantityPrefix("dois de ovos cozido")).toEqual({
      quantity: 2,
      remainder: "ovos cozido",
    });
    expect(parseCountableQuantityPrefix("um pouco de arroz")).toEqual({
      quantity: 1,
      remainder: "pouco de arroz",
    });
  });
});

describe("mealTextParsing arithmetic quantity expressions", () => {
  it.each([
    ["2x176g de laranja pêra", "laranja pêra", 352],
    ["2 x 176g de laranja pêra", "laranja pêra", 352],
    ["2*176g laranja pêra", "laranja pêra", 352],
    ["3x50g whey", "whey", 150],
    ["220-20g de laranja pêra", "laranja pêra", 200],
    ["220g-20 de laranja pêra", "laranja pêra", 200],
    ["200+20g de laranja pêra", "laranja pêra", 220],
    ["200g+20g de laranja pêra", "laranja pêra", 220],
    ["200g+20g-10g de banana", "banana", 210],
    ["300g/2 de laranja pêra", "laranja pêra", 150],
    ["300g / 2 de laranja pêra", "laranja pêra", 150],
    ["300g dividido por 2 de laranja pêra", "laranja pêra", 150],
    ["300g/2+20g de banana", "banana", 170],
  ])("calcula %s", (input, foodName, grams) => {
    expect(parseFoodText(input)).toEqual(
      expect.objectContaining({
        foodName,
        quantity: grams,
        unit: "g",
        portionText: `${grams} g`,
        estimatedGrams: grams,
      })
    );
    expect(getQuantityExpressionClarification(input)).toBeNull();
  });

  it("respeita precedência matemática padrão", () => {
    expect(parseFoodText("100g+50g*2 de banana")).toEqual(
      expect.objectContaining({
        foodName: "banana",
        quantity: 200,
        estimatedGrams: 200,
      })
    );
  });

  it("aceita resultado decimal e formata conforme o padrão do projeto", () => {
    expect(parseFoodText("1kg/2 de arroz")).toEqual(
      expect.objectContaining({
        foodName: "arroz",
        quantity: 0.5,
        unit: "kg",
        portionText: "0,5 kg",
        estimatedGrams: 500,
      })
    );
  });

  it("aceita expressão com unidade não convertida para gramas", () => {
    expect(parseFoodText("2x1 un banana")).toEqual(
      expect.objectContaining({
        foodName: "banana",
        quantity: 2,
        unit: "un",
        portionText: "2 un",
      })
    );
  });

  it.each([
    ["1,5 fatias de mortadela", "mortadela", "fatia", "1,5 fatia"],
    ["1.5 fatias de mortadela", "mortadela", "fatia", "1,5 fatia"],
    ["1,5 g de arroz", "arroz", "g", "1,5 g"],
    ["1.5 kg de arroz", "arroz", "kg", "1,5 kg"],
    ["1,5 ml de leite", "leite", "ml", "1,5 ml"],
  ])(
    "preserva quantidade decimal em %s",
    (input, foodName, unit, portionText) => {
      expect(parseFoodText(input)).toEqual(
        expect.objectContaining({
          foodName,
          quantity: 1.5,
          unit,
          portionText,
        })
      );
    }
  );

  it("extrai uma quantidade explícita calculada para reaplicar em item único", () => {
    expect(extractExplicitQuantities("2x176g de laranja pêra")).toEqual([
      { quantity: 352, unit: "g", estimatedGrams: 352 },
    ]);
  });

  it("extrai quantidades explícitas calculadas por alimento", () => {
    expect(
      extractExplicitQuantityFoodSegments(
        "300g/2+20g de banana e 2x176g de laranja pêra"
      )
    ).toEqual([
      { foodName: "banana", quantity: 170, unit: "g", estimatedGrams: 170 },
      {
        foodName: "laranja pêra",
        quantity: 352,
        unit: "g",
        estimatedGrams: 352,
      },
    ]);
  });

  it("mantém o parser simples para mensagens sem operação", () => {
    expect(parseFoodText("176g de laranja pêra")).toEqual(
      expect.objectContaining({
        foodName: "laranja pêra",
        quantity: 176,
        unit: "g",
        estimatedGrams: 176,
      })
    );
  });

  it.each([
    ["300g/0 de banana", "divisão por zero"],
    ["banana e 300g/0 de laranja", "divisão por zero"],
    ["100g-100g de banana", "zero ou negativo"],
    ["100g+20ml de banana", "mistura unidades diferentes"],
    ["1+1+1+1+1+1+1g de banana", "operações demais"],
    ["1+1 de banana", "unidade da quantidade"],
  ])("explica por que não consegue calcular %s", (input, expectedMessage) => {
    expect(getQuantityExpressionClarification(input)).toContain(
      expectedMessage
    );
  });
});

describe("PR #1339 A-008: precedence of component clarification over math parsing", () => {
  it.each([
    "café com uma colher de chá de açúcar e 1/2 g",
    "café com uma colher de chá de açúcar e 1/2 g de açúcar",
    "café com uma colher de chá de açúcar e 1/2 sachê de açúcar",
    "café com uma colher de chá de açúcar e ½ g de açúcar",
    "café com uma colher de chá de açúcar e 1/2 g adicionais",
    "café com uma colher de chá de açúcar e 1/2 de açúcar",
    "café com uma colher de chá de açúcar e mais meia de açúcar",
    "café com uma colher de chá de açúcar e mais 2",
  ])("defers conflicting sugar quantity %s to the canonical spoon guard", text => {
    expect(getQuantityExpressionClarification(text)).toBeNull();
  });

  it("preserves the generic division clarification outside sugar-spoon inputs", () => {
    expect(getQuantityExpressionClarification("banana e 300g/0 de laranja")).toContain("divisão por zero");
  });
});

describe("PR #1339 A-002: spoken counts after consumption prefaces", () => {
  it.each([
    ["comi uma colher de sopa de arroz", "arroz", 1, "colher de sopa"],
    ["hoje comi duas colheres de sopa de arroz", "arroz", 2, "colher de sopa"],
    ["ontem eu consumi uma colher de ch\u00e1 de mel", "mel", 1, "colher de ch\u00e1"],
    ["tomei uma colher de ch\u00e1 de mel", "mel", 1, "colher de ch\u00e1"],
  ] as const)("parses %s without losing the food/quantity binding", (input, foodName, quantity, unit) => {
    expect(extractExplicitQuantityFoodSegments(input)).toEqual([
      expect.objectContaining({ foodName, quantity, unit }),
    ]);
  });

  it.each([
    "comi uma x\u00edcara de caf\u00e9",
    "n\u00e3o comi uma colher de arroz",
    "como seria uma colher de arroz?",
    "comi arroz",
  ])("does not reinterpret non-spoon or negated prose: %s", text => {
    expect(unwrapMealQuantityPreface(text)).toBe(text);
  });
});
