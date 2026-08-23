import { describe, expect, it } from "vitest";
import { buildHeuristicItem } from "./mealItemBuilders";
import {
  findUnsafeCountableFoodQuantity,
  prepareCountableFoodRegistration,
  resolveSafeCountableCatalogGrams,
} from "./countableFoodQuantity";
import { findTacoFood } from "./tacoLookup";

describe("issue #997 countable registration and local nutrition", () => {
  it("escala múltiplas unidades somente a partir da porção canônica", () => {
    expect(resolveSafeCountableCatalogGrams("pão francês", 2, "un")?.grams).toBe(100);
    const item = buildHeuristicItem("2 pão francês");
    expect(item.estimatedGrams).toBe(100);
    expect(item.quantity).toBe(2);
  });

  it.each(["1 ovo frito", "1 fatia presunto", "1 fatia mussarela"])(
    "não promove 100 g nutricionais a porção contável: %s",
    text => expect(findUnsafeCountableFoodQuantity(text)).not.toBeNull(),
  );

  it("prepara a refeição real mantendo massa explícita e isolando apenas contagens inseguras", () => {
    const prepared = prepareCountableFoodRegistration([
      "1 pão francês",
      "1 ovo frito",
      "1 fatia presunto",
      "1 fatia mussarela",
      "45g requeijão catupiry light",
      "3 xícaras de café sem açúcar",
    ].join("\n"));

    expect(prepared.registrationText).toContain("50 g de pão francês");
    expect(prepared.registrationText).toContain("45g requeijão catupiry light");
    expect(prepared.pendingItems.map(item => item.foodName)).toEqual([
      "ovo frito",
      "presunto",
      "mussarela",
    ]);
  });

  it("resolve identidades TACO locais antes do perfil genérico", () => {
    expect(findTacoFood("ovo frito")?.name).toBe("Ovo, de galinha, inteiro, frito");
    for (const spelling of ["mussarela", "muçarela", "mozarela"]) {
      expect(findTacoFood(spelling)?.name).toBe("Queijo, mozarela");
    }
    expect(findTacoFood("presunto")?.calories).not.toBe(150);
  });

  it("preserva 45 g e qualificadores de Catupiry Light", () => {
    const item = buildHeuristicItem("45 g de requeijão catupiry light");
    expect(item.estimatedGrams).toBe(45);
    expect(item.foodName.toLowerCase()).toContain("catupiry");
    expect(item.foodName.toLowerCase()).toContain("light");
  });
});
