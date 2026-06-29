import { describe, expect, it } from "vitest";
import { findCatalogFood } from "./catalogMatching";
import { processMealInput } from "./nutritionEngine";
import { findTacoFood } from "./tacoLookup";
import {
  learnPersonalFoodAlias,
  resolvePersonalFoodAlias,
  __resetPersonalFoodAliasStoreForTests,
} from "./modules/whatsapp/personalFoodAliasStore";

describe("food variation matching", () => {
  it("não resolve pão sovado como pão francês no catálogo global", () => {
    expect(findCatalogFood("pão sovado")?.name).not.toBe("Pão francês");
  });

  it("não resolve variações específicas usando aliases genéricos de outros alimentos", () => {
    expect(findCatalogFood("queijo prato")?.name).not.toBe("Queijo minas frescal");
    expect(findCatalogFood("leite desnatado")?.name).not.toBe("Leite integral");
  });

  it("resolve variações específicas pelo item correspondente da TACO", () => {
    expect(findTacoFood("queijo prato")?.slug).toBe("taco-queijo-prato");
    expect(findTacoFood("leite desnatado")?.slug).toContain("desnatado");
  });

  it("resolve pão sovado pelo item específico da TACO", () => {
    const food = findTacoFood("pão sovado");
    expect(food?.slug).toBe("taco-pao-trigo-sovado");
    expect(food?.name).toBe("Pão, trigo, sovado");
  });

  it("mantém 74g de pão sovado como alimento canônico sovado no pipeline", async () => {
    const result = await processMealInput({ text: "74g de pão sovado" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "pão sovado",
      canonicalName: "Pão, trigo, sovado",
      quantity: 74,
      unit: "g",
      estimatedGrams: 74,
    }));
  });

  it("não aplica alias pessoal genérico de pão sobre uma variação específica", () => {
    __resetPersonalFoodAliasStoreForTests();
    learnPersonalFoodAlias({
      userId: 1,
      aliasText: "pão",
      canonicalName: "Pão francês",
    });

    expect(resolvePersonalFoodAlias({ userId: 1, foodText: "pão" })?.canonicalName).toBe("Pão francês");
    expect(resolvePersonalFoodAlias({ userId: 1, foodText: "pão sovado" })).toBeNull();
  });
});
