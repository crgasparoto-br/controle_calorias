import { describe, expect, it } from "vitest";
import { buildHeuristicItem } from "./mealItemBuilders";
import {
  findUnsafeCountableFoodQuantity,
  parseCountableFoodQuantitySegment,
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

  it.each([
    ["1 fatia presunto", "presunto", 18],
    ["1 fatia mussarela", "mussarela", 20],
  ])(
    "reconhece a porção curada sem promovê-la a 100 g nutricionais: %s",
    (text, foodName, grams) => {
      expect(findUnsafeCountableFoodQuantity(text)).toBeNull();
      expect(resolveSafeCountableCatalogGrams(foodName, 1, "fatia")?.grams).toBe(grams);
    },
  );

  it.each([
    ["1 ovo", "ovo", 1, 50],
    ["1 ovo frito", "ovo frito", 1, 50],
    ["2 ovos fritos", "ovos fritos", 2, 100],
  ])("resolve %s pela porção canônica de ovo", (text, foodName, count, grams) => {
    expect(findUnsafeCountableFoodQuantity(text)).toBeNull();
    expect(resolveSafeCountableCatalogGrams(foodName, count, "un")?.grams).toBe(grams);
  });

  it("prepara a refeição real mantendo massa explícita e isolando apenas contagens inseguras", () => {
    const prepared = prepareCountableFoodRegistration([
      "1 pão francês",
      "1 ovo frito",
      "1 fatia de pão francês",
      "1 fatia de queijo prato",
      "45g requeijão catupiry light",
      "3 xícaras de café sem açúcar",
    ].join("\n"));

    expect(prepared.registrationText).toContain("50 g de pão francês");
    expect(prepared.registrationText).toContain("50 g de ovo frito");
    expect(prepared.registrationText).toContain("45g requeijão catupiry light");
    expect(prepared.registrationText).toContain("3 xícaras de café sem açúcar");
    expect(prepared.pendingItems.map(item => item.foodName)).toEqual([
      "pão francês",
      "queijo prato",
    ]);
  });

  it("não reinterpreta massa ou volume explícitos como contagem nua", () => {
    expect(parseCountableFoodQuantitySegment("200 ml café com açúcar")).toBeNull();
    expect(parseCountableFoodQuantitySegment("45 g requeijão catupiry light")).toBeNull();

    const prepared = prepareCountableFoodRegistration("200 ml café com açúcar");
    expect(prepared.pendingItems).toEqual([]);
    expect(prepared.registrationText).toBe("200 ml café com açúcar");
  });

  it("preserva café e chá para os contratos especializados em vez de abrir clarificação contável", () => {
    for (const text of [
      "1 xícara de café com açúcar",
      "3 xícaras de café sem açúcar",
      "1 xícara de café",
      "2 xícaras de chá sem açúcar",
    ]) {
      expect(parseCountableFoodQuantitySegment(text)).toBeNull();
      const prepared = prepareCountableFoodRegistration(text);
      expect(prepared.pendingItems).toEqual([]);
      expect(prepared.registrationText).toBe(text);
    }
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
