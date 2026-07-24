import { describe, expect, it } from "vitest";
import { splitFoodTextSegments } from "./mealTextParsing";

describe("segmentação de complementos coordenados de bebidas", () => {
  it.each([
    "1 xícara de café com leite e açúcar",
    "1 xícara de café com creme e 5 g de açúcar",
    "1 xícara de chá com leite e mel",
  ])("preserva a preparação composta em um único segmento: %s", sourceText => {
    expect(splitFoodTextSegments(sourceText)).toEqual([sourceText]);
  });

  it("continua separando um alimento vizinho que contém açúcar", () => {
    expect(splitFoodTextSegments(
      "1 xícara de café com leite e 1 fatia de bolo com 10 g de açúcar",
    )).toEqual([
      "1 xícara de café com leite",
      "1 fatia de bolo com 10 g de açúcar",
    ]);
  });

  it("não transforma café e leite independentes em preparação composta", () => {
    expect(splitFoodTextSegments("1 xícara de café e 200 ml de leite")).toEqual([
      "1 xícara de café",
      "200 ml de leite",
    ]);
  });

  it("preserva o complemento e separa o alimento seguinte", () => {
    expect(splitFoodTextSegments(
      "1 xícara de café com leite e açúcar e 1 pão francês",
    )).toEqual([
      "1 xícara de café com leite e açúcar",
      "1 pão francês",
    ]);
  });
});
