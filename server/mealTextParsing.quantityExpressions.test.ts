import { describe, expect, it } from "vitest";
import {
  extractExplicitQuantities,
  extractExplicitQuantityFoodSegments,
  getQuantityExpressionClarification,
  parseFoodText,
} from "./mealTextParsing";

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
    expect(parseFoodText(input)).toEqual(expect.objectContaining({
      foodName,
      quantity: grams,
      unit: "g",
      portionText: `${grams} g`,
      estimatedGrams: grams,
    }));
    expect(getQuantityExpressionClarification(input)).toBeNull();
  });

  it("respeita precedência matemática padrão", () => {
    expect(parseFoodText("100g+50g*2 de banana")).toEqual(expect.objectContaining({
      foodName: "banana",
      quantity: 200,
      estimatedGrams: 200,
    }));
  });

  it("aceita resultado decimal e formata conforme o padrão do projeto", () => {
    expect(parseFoodText("1kg/2 de arroz")).toEqual(expect.objectContaining({
      foodName: "arroz",
      quantity: 0.5,
      unit: "kg",
      portionText: "0,5 kg",
      estimatedGrams: 500,
    }));
  });

  it("aceita expressão com unidade não convertida para gramas", () => {
    expect(parseFoodText("2x1 un banana")).toEqual(expect.objectContaining({
      foodName: "banana",
      quantity: 2,
      unit: "un",
      portionText: "2 un",
    }));
  });

  it("extrai uma quantidade explícita calculada para reaplicar em item único", () => {
    expect(extractExplicitQuantities("2x176g de laranja pêra")).toEqual([
      { quantity: 352, unit: "g", estimatedGrams: 352 },
    ]);
  });

  it("extrai quantidades explícitas calculadas por alimento", () => {
    expect(extractExplicitQuantityFoodSegments("300g/2+20g de banana e 2x176g de laranja pêra")).toEqual([
      { foodName: "banana", quantity: 170, unit: "g", estimatedGrams: 170 },
      { foodName: "laranja pêra", quantity: 352, unit: "g", estimatedGrams: 352 },
    ]);
  });

  it("mantém o parser simples para mensagens sem operação", () => {
    expect(parseFoodText("176g de laranja pêra")).toEqual(expect.objectContaining({
      foodName: "laranja pêra",
      quantity: 176,
      unit: "g",
      estimatedGrams: 176,
    }));
  });

  it.each([
    ["300g/0 de banana", "divisão por zero"],
    ["banana e 300g/0 de laranja", "divisão por zero"],
    ["100g-100g de banana", "zero ou negativo"],
    ["100g+20ml de banana", "mistura unidades diferentes"],
    ["1+1+1+1+1+1+1g de banana", "operações demais"],
    ["1+1 de banana", "unidade da quantidade"],
  ])("explica por que não consegue calcular %s", (input, expectedMessage) => {
    expect(getQuantityExpressionClarification(input)).toContain(expectedMessage);
  });
});
