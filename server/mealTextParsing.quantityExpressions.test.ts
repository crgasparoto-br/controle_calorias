import { describe, expect, it } from "vitest";
import { extractExplicitQuantities, parseFoodText } from "./mealTextParsing";

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
  });

  it("respeita precedência matemática padrão", () => {
    expect(parseFoodText("100g+50g*2 de banana")).toEqual(expect.objectContaining({
      foodName: "banana",
      quantity: 200,
      estimatedGrams: 200,
    }));
  });

  it("extrai uma quantidade explícita calculada para reaplicar em item único", () => {
    expect(extractExplicitQuantities("2x176g de laranja pêra")).toEqual([
      { quantity: 352, unit: "g", estimatedGrams: 352 },
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
});
