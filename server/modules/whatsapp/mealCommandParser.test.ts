import { describe, expect, it } from "vitest";

import { parseMealCommandFromWhatsApp } from "./mealCommandParser";

const referenceDate = new Date("2026-06-04T15:00:00.000Z");

describe("parseMealCommandFromWhatsApp", () => {
  it("interpreta adicao simples de item a refeicao no dia relativo", () => {
    const result = parseMealCommandFromWhatsApp(
      "Adicionar 300g de amendoim japonês Elma Chips ao jantar de ontem",
      { referenceDate },
    );

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("jantar");
    expect(result.date?.toISOString()).toMatch(/^2026-06-03T/);
    expect(result.items).toEqual([
      expect.objectContaining({
        foodName: "amendoim japonês",
        brand: "Elma Chips",
        quantity: 300,
        unit: "g",
        missingFields: [],
      }),
    ]);
  });

  it("interpreta adicao multipla com refeicao antes dos itens", () => {
    const result = parseMealCommandFromWhatsApp(
      "Adicionar ao jantar de ontem 300g amendoim japonês Elma Chips, 330ml de cerveja Budweiser",
      { referenceDate },
    );

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("jantar");
    expect(result.date?.toISOString()).toMatch(/^2026-06-03T/);
    expect(result.items).toEqual([
      expect.objectContaining({
        foodName: "amendoim japonês",
        brand: "Elma Chips",
        quantity: 300,
        unit: "g",
      }),
      expect.objectContaining({
        foodName: "cerveja",
        brand: "Budweiser",
        quantity: 330,
        unit: "ml",
      }),
    ]);
  });

  it("interpreta adicao multipla com ponto e virgula entre itens", () => {
    const result = parseMealCommandFromWhatsApp(
      "Adicionar ao jantar de ontem 300g amendoim japonês Elma Chips; 330ml de cerveja Budweiser",
      { referenceDate },
    );

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("jantar");
    expect(result.items).toEqual([
      expect.objectContaining({
        foodName: "amendoim japonês",
        brand: "Elma Chips",
        quantity: 300,
        unit: "g",
      }),
      expect.objectContaining({
        foodName: "cerveja",
        brand: "Budweiser",
        quantity: 330,
        unit: "ml",
      }),
    ]);
  });

  it("mantem brand null quando a marca esta ausente em um dos itens", () => {
    const result = parseMealCommandFromWhatsApp(
      "Adicionar ao jantar de ontem 300g amendoim japonês Elma Chips e 330ml de cerveja",
      { referenceDate },
    );

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.items).toEqual([
      expect.objectContaining({
        foodName: "amendoim japonês",
        brand: "Elma Chips",
        quantity: 300,
        unit: "g",
      }),
      expect.objectContaining({
        foodName: "cerveja",
        brand: null,
        quantity: 330,
        unit: "ml",
      }),
    ]);
  });

  it("interpreta troca direta de quantidade", () => {
    const result = parseMealCommandFromWhatsApp("Trocar 330ml por 600ml", { referenceDate });

    expect(result).toEqual(expect.objectContaining({
      intent: "replace_quantity",
      previousQuantity: 330,
      previousUnit: "ml",
      nextQuantity: 600,
      nextUnit: "ml",
      missingFields: [],
    }));
  });

  it("interpreta correcao explicita de quantidade", () => {
    const result = parseMealCommandFromWhatsApp("Não é 330ml é 600ml", { referenceDate });

    expect(result).toEqual(expect.objectContaining({
      intent: "correct_quantity",
      previousQuantity: 330,
      previousUnit: "ml",
      nextQuantity: 600,
      nextUnit: "ml",
      missingFields: [],
    }));
  });

  it("interpreta correcao curta com contexto recente", () => {
    const result = parseMealCommandFromWhatsApp("Corrigir para 600ml", {
      referenceDate,
      recentMealType: "jantar",
      recentDate: new Date("2026-06-03T22:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      intent: "correct_quantity",
      mealType: "jantar",
      nextQuantity: 600,
      nextUnit: "ml",
      missingFields: ["previousQuantity"],
    }));
  });

  it("interpreta correcao invertida de quantidade", () => {
    const result = parseMealCommandFromWhatsApp("Era 600ml, não 330ml", { referenceDate });

    expect(result).toEqual(expect.objectContaining({
      intent: "correct_quantity",
      previousQuantity: 330,
      previousUnit: "ml",
      nextQuantity: 600,
      nextUnit: "ml",
      missingFields: [],
    }));
  });

  it("mantem refeicao simples como comando desconhecido", () => {
    const result = parseMealCommandFromWhatsApp("almoço: arroz, feijão e frango", { referenceDate });

    expect(result).toEqual(expect.objectContaining({
      intent: "unknown",
      items: [],
      missingFields: ["intent"],
    }));
  });
});
