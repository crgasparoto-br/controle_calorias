import { describe, expect, it } from "vitest";

import { parseMealCommandFromWhatsApp } from "./mealCommandParser";

const referenceDate = new Date("2026-08-12T15:00:00.000Z");

function normalize(value: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

describe("issue #970 - adição natural com destino de refeição", () => {
  it.each([
    "Adicionar 3 xícaras de café sem açúcar no café da manhã",
    "Adicione 3 xícaras de café sem açúcar ao café da manhã",
    "Inclua 3 xícaras de café sem açúcar na refeição café da manhã",
    "Coloque 3 xícaras de café sem açúcar para o café da manhã",
    "Acrescente 3 xícaras de café sem açúcar à refeição café da manhã",
    "Registre 3 xícaras de café sem açúcar para a refeição café da manhã",
    "Lançar 3 xícaras de café sem açúcar no café da manhã",
    "Lance 3 xícaras de café sem açúcar a refeição café da manhã",
    "Adicionar 3 xícaras de café sem açúcar, no café da manhã",
    "Adicionar 3 xícaras de café sem açúcar - no café da manhã",
    "ADICIONE 3 XÍCARAS DE CAFÉ SEM AÇÚCAR NO CAFÉ DA MANHÃ",
    "Adicionar 3 xicaras de cafe sem acucar no cafe da manha",
  ])("reconhece quantidade, alimento e café da manhã: %s", text => {
    const result = parseMealCommandFromWhatsApp(text, { referenceDate });

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("café da manhã");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      quantity: 3,
      unit: "xícara",
      missingFields: [],
    }));
    expect(normalize(result.items[0].foodName)).toBe("cafe sem acucar");
  });

  it.each([
    "Adicionar no café da manhã 3 xícaras de café sem açúcar",
    "No café da manhã, adicione 3 xícaras de café sem açúcar",
    "Adicionar café da manhã: 3 xícaras de café sem açúcar",
  ])("aceita as ordens canônicas de destino e conteúdo: %s", text => {
    const result = parseMealCommandFromWhatsApp(text, { referenceDate });

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("café da manhã");
    expect(result.items[0]).toEqual(expect.objectContaining({
      quantity: 3,
      unit: "xícara",
    }));
    expect(normalize(result.items[0].foodName)).toBe("cafe sem acucar");
  });

  it.each([
    ["Adicionar 3 xícaras de café sem açúcar no desjejum", "café da manhã"],
    ["Adicionar 3 xícaras de café sem açúcar no café", "café da manhã"],
    ["Coloque 150g de frango no almoço", "almoço"],
  ])("normaliza aliases de refeição apenas em posição de destino: %s", (text, mealType) => {
    const result = parseMealCommandFromWhatsApp(text, { referenceDate });

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe(mealType);
    expect(result.items[0]?.missingFields).toEqual([]);
  });

  it("não interpreta o alimento café como alias curto de café da manhã", () => {
    const result = parseMealCommandFromWhatsApp(
      "Adicionar 3 xícaras de café sem açúcar",
      { referenceDate },
    );

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBeNull();
    expect(result.items[0]).toEqual(expect.objectContaining({
      quantity: 3,
      unit: "xícara",
    }));
  });

  it("mantém frase sem verbo de mutação fora do comando determinístico", () => {
    const result = parseMealCommandFromWhatsApp(
      "café da manhã com 3 xícaras de café sem açúcar",
      { referenceDate },
    );

    expect(result.intent).toBe("unknown");
  });

  it("preserva data relativa para as novas formas de adição", () => {
    const result = parseMealCommandFromWhatsApp(
      "Coloque 150g de frango no jantar de ontem",
      { referenceDate },
    );

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("jantar");
    expect(result.date?.toISOString()).toMatch(/^2026-08-11T/);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "frango",
      quantity: 150,
      unit: "g",
    }));
  });

  it("preserva contagem sem unidade explícita", () => {
    const result = parseMealCommandFromWhatsApp(
      "Lance 1 banana no lanche",
      { referenceDate },
    );

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("lanche");
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "banana",
      quantity: 1,
      unit: "unidade",
      missingFields: [],
    }));
  });
});
