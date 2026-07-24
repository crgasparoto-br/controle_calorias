import { describe, expect, it } from "vitest";
import {
  isCoffeeWithAddedSugar,
  isFoodCandidateSemanticallyCompatible,
} from "./foodSemanticCompatibility";

describe("açúcar coordenado em preparações de café", () => {
  it.each([
    "café com leite e açúcar",
    "café com creme e 5 g de açúcar",
    "café com leite condensado e 1 colher de chá de açúcar",
  ])("reconhece %s como café adoçado", sourceText => {
    expect(isCoffeeWithAddedSugar(sourceText)).toBe(true);
  });

  it("rejeita referência sem açúcar para preparação coordenada", () => {
    expect(isFoodCandidateSemanticallyCompatible(
      "café com leite e açúcar",
      ["Café sem açúcar", "café puro", "café preto"],
    )).toBe(false);
  });

  it("não classifica café e leite independentes como café adoçado", () => {
    expect(isCoffeeWithAddedSugar("café e leite")).toBe(false);
  });
});
