import { describe, expect, it } from "vitest";

import { parseMealCommandFromWhatsApp } from "./mealCommandParser";

const referenceDate = new Date("2026-06-04T15:00:00.000Z");

describe("parseMealCommandFromWhatsApp targeted meal regressions", () => {
  it("inclui todos os alimentos na refeicao pre-treino em vez de ajustar o ultimo item", () => {
    const result = parseMealCommandFromWhatsApp(
      "Adicionar 57g de banana prata, 9g linhaça, 14g aveia em flocos, 10g mel, 22g whey proten, 6g creatina, 1 iogurte natural desnatado a refeição pré treino",
      { referenceDate },
    );

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("pré-treino");
    expect(result.items).toHaveLength(7);
    expect(result.items).toEqual([
      expect.objectContaining({ foodName: "banana prata", quantity: 57, unit: "g", missingFields: [] }),
      expect.objectContaining({ foodName: "linhaça", quantity: 9, unit: "g", missingFields: [] }),
      expect.objectContaining({ foodName: "aveia em flocos", quantity: 14, unit: "g", missingFields: [] }),
      expect.objectContaining({ foodName: "mel", quantity: 10, unit: "g", missingFields: [] }),
      expect.objectContaining({ foodName: "whey proten", quantity: 22, unit: "g", missingFields: [] }),
      expect.objectContaining({ foodName: "creatina", quantity: 6, unit: "g", missingFields: [] }),
      expect.objectContaining({ foodName: "iogurte natural desnatado", quantity: 1, unit: "unidade", missingFields: [] }),
    ]);
  });

  it("mantem ontem e agua tonica como item alimentar dentro do jantar", () => {
    const result = parseMealCommandFromWhatsApp(
      "adicionar ao jantar de ontem, uma porção de canelone, 1 fatia de pão sovado, 20g requeijão catupiry, 1 fatia de peito de perú, 1 fatia de mussarela, 1 água tônica antartica, 15g koala, 110g leite integral",
      { referenceDate },
    );

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("jantar");
    expect(result.date?.toISOString()).toMatch(/^2026-06-03T/);
    expect(result.items).toHaveLength(8);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ foodName: "água tônica antartica", quantity: 1, unit: "unidade", missingFields: [] }),
      expect.objectContaining({ foodName: "leite integral", quantity: 110, unit: "g", missingFields: [] }),
    ]));
  });
});
