import { describe, expect, it } from "vitest";

import { parseMealCommandFromWhatsApp } from "./mealCommandParser";

const referenceDate = new Date("2026-06-29T20:25:00.000Z");

describe("parseMealCommandFromWhatsApp relative dinner additions", () => {
  it("interpreta jantar de ontem com virgula e porcoes variadas", () => {
    const result = parseMealCommandFromWhatsApp(
      "adicionar ao jantar de ontem, uma porção de canelone, 1 fatia de pão sovado, 20g requeijão catupiry, 1 fatia de peito de perú, 1 fatia de mussarela, 1 água tônica antartica, 15g koala, 110g leite integral",
      { referenceDate },
    );

    expect(result.intent).toBe("add_items_to_meal");
    expect(result.mealType).toBe("jantar");
    expect(result.date?.toISOString()).toMatch(/^2026-06-28T/);
    expect(result.items).toEqual([
      expect.objectContaining({ foodName: "canelone", quantity: 1, unit: "porção", missingFields: [] }),
      expect.objectContaining({ foodName: "pão sovado", quantity: 1, unit: "fatia", missingFields: [] }),
      expect.objectContaining({ foodName: "requeijão catupiry", quantity: 20, unit: "g", missingFields: [] }),
      expect.objectContaining({ foodName: "peito de perú", quantity: 1, unit: "fatia", missingFields: [] }),
      expect.objectContaining({ foodName: "mussarela", quantity: 1, unit: "fatia", missingFields: [] }),
      expect.objectContaining({ foodName: "água tônica antartica", quantity: 1, unit: "unidade", missingFields: [] }),
      expect.objectContaining({ foodName: "koala", quantity: 15, unit: "g", missingFields: [] }),
      expect.objectContaining({ foodName: "leite integral", quantity: 110, unit: "g", missingFields: [] }),
    ]);
  });
});
