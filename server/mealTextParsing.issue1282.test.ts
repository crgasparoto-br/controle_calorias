import { describe, expect, it } from "vitest";
import { parseFoodText, splitFoodTextSegments } from "./mealTextParsing";

/**
 * Issue #1282 — a vírgula decimal era tratada como separador de itens:
 * `22,5 g de mortadela` virava `22` + `5 g de mortadela` e o primeiro segmento
 * era registrado a partir do próprio número (`22` → arroz).
 */
describe("issue #1282 — vírgula decimal não separa itens", () => {
  it("preserva o separador decimal entre dígitos", () => {
    expect(splitFoodTextSegments("22,5 g de mortadela")).toEqual(["22,5 g de mortadela"]);
    expect(splitFoodTextSegments("1,5 fatias de mortadela")).toEqual(["1,5 fatias de mortadela"]);
    expect(splitFoodTextSegments("0,5 copo de leite")).toEqual(["0,5 copo de leite"]);
  });

  it("continua separando itens por vírgula", () => {
    expect(splitFoodTextSegments("arroz, feijão e bife")).toEqual(["arroz", "feijão", "bife"]);
    expect(splitFoodTextSegments("arroz, 2 ovos")).toEqual(["arroz", "2 ovos"]);
    expect(splitFoodTextSegments("banana, maçã")).toEqual(["banana", "maçã"]);
    // Item separado depois de um número continua sendo dois itens.
    expect(splitFoodTextSegments("alimento 1, alimento 2")).toEqual(["alimento 1", "alimento 2"]);
    expect(splitFoodTextSegments("1,5 fatias de mortadela, 2 ovos")).toEqual([
      "1,5 fatias de mortadela",
      "2 ovos",
    ]);
  });

  it("lê a quantidade decimal da refeição inteira", () => {
    expect(parseFoodText("22,5 g de mortadela")).toMatchObject({
      foodName: "mortadela",
      quantity: 22.5,
      unit: "g",
      estimatedGrams: 22.5,
    });
    expect(parseFoodText("1,5 fatias de mortadela")).toMatchObject({
      foodName: "mortadela",
      quantity: 1.5,
      unit: "fatia",
    });
  });
});
