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

  it("calcula quantidade liquida com subtracao em gramas antes de montar o alimento", () => {
    const result = parseMealCommandFromWhatsApp(
      "Adicionar 160g - 23g de maça fugi ao lanche",
      { referenceDate },
    );

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("lanche");
    expect(result.items).toEqual([
      expect.objectContaining({
        foodName: "maça fugi",
        quantity: 137,
        unit: "g",
        missingFields: [],
        quantityExpression: expect.objectContaining({
          leftQuantity: 160,
          rightQuantity: 23,
          operator: "-",
          unit: "g",
          result: 137,
        }),
      }),
    ]);
  });

  it.each([
    ["arroz integral", "Adicionar 200g - 50g de arroz integral ao almoço", 150],
    ["frango grelhado", "Adicionar 180g - 30g de frango grelhado ao jantar", 150],
    ["iogurte natural", "Adicionar 170g - 45g de iogurte natural ao lanche", 125],
  ])("aplica a conta liquida para qualquer alimento: %s", (foodName, text, quantity) => {
    const result = parseMealCommandFromWhatsApp(text, { referenceDate });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName,
      quantity,
      unit: "g",
      missingFields: [],
    }));
  });

  it.each([
    "Adicionar 160g-23g de maçã Fuji ao lanche",
    "Adicionar 160 g - 23 g maçã Fuji ao lanche",
    "Adicionar 160g - 23g de maçã Fuji ao lanche",
  ])("aceita variacao de espacamento na conta: %s", text => {
    const result = parseMealCommandFromWhatsApp(text, { referenceDate });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "maçã Fuji",
      quantity: 137,
      unit: "g",
    }));
  });

  it("infere unidade ausente quando a expressao tem uma unica unidade inequivoca", () => {
    const result = parseMealCommandFromWhatsApp("Adicionar 110 - 30 g de banana ao lanche", { referenceDate });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "banana",
      quantity: 80,
      unit: "g",
      missingFields: [],
    }));
  });

  it("aceita virgula decimal quando o calculo e seguro", () => {
    const result = parseMealCommandFromWhatsApp("Adicionar 160,5g - 20,5g de arroz ao jantar", { referenceDate });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "arroz",
      quantity: 140,
      unit: "g",
    }));
  });

  it("nao calcula automaticamente quando as unidades sao incompativeis", () => {
    const result = parseMealCommandFromWhatsApp("Adicionar 160g - 20ml de maçã ao lanche", { referenceDate });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "maçã",
      quantity: null,
      unit: null,
      missingFields: ["quantity", "unit"],
    }));
  });

  it("nao registra automaticamente quando o resultado e zero ou negativo", () => {
    const result = parseMealCommandFromWhatsApp("Adicionar 160g - 200g de maçã ao lanche", { referenceDate });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "maçã",
      quantity: null,
      unit: null,
      missingFields: ["quantity", "unit"],
    }));
  });

  it("normaliza unidade caseira sem manter quantidade no nome do alimento", () => {
    const result = parseMealCommandFromWhatsApp(
      "Adicionar 2 fatias pão ao café da manhã",
      { referenceDate },
    );

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("café da manhã");
    expect(result.items).toEqual([
      expect.objectContaining({
        foodName: "pão",
        brand: null,
        quantity: 2,
        unit: "fatia",
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

  it("reconhece expressao aritmetica sem verbo quando ha tipo de refeicao — caso principal do bug", () => {
    const result = parseMealCommandFromWhatsApp("120g - 30g frango ao almoco", { referenceDate });

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("almoço");
    expect(result.items).toEqual([
      expect.objectContaining({
        foodName: "frango",
        quantity: 90,
        unit: "g",
        missingFields: [],
        quantityExpression: expect.objectContaining({
          leftQuantity: 120,
          rightQuantity: 30,
          operator: "-",
          unit: "g",
          result: 90,
        }),
      }),
    ]);
  });

  it("reconhece expressao aritmetica sem verbo com alimento antes da expressao", () => {
    const result = parseMealCommandFromWhatsApp("frango 120g - 30g no jantar", { referenceDate });

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("jantar");
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "frango",
      quantity: 90,
      unit: "g",
      missingFields: [],
    }));
  });

  it("reconhece expressao aritmetica de soma sem verbo", () => {
    const result = parseMealCommandFromWhatsApp("150g + 50g de arroz no almoco", { referenceDate });

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("almoço");
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "arroz",
      quantity: 200,
      unit: "g",
      missingFields: [],
    }));
  });

  it("nao reconhece expressao aritmetica sem verbo quando nao ha tipo de refeicao", () => {
    // Sem tipo de refeição a mensagem é ambígua — deve ser tratada pelo LLM
    const result = parseMealCommandFromWhatsApp("120g - 30g frango", { referenceDate });

    expect(result.intent).toBe("unknown");
  });

  it("mantem refeicao simples como comando desconhecido", async () => {
    const result = parseMealCommandFromWhatsApp("almoço: arroz, feijão e frango", { referenceDate });

    expect(result).toEqual(expect.objectContaining({
      intent: "unknown",
      items: [],
      missingFields: ["intent"],
    }));
  });
});
