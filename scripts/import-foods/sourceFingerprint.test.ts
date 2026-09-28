import { describe, expect, it } from "vitest";

import { createSourceContentHash } from "./sourceFingerprint.ts";
import type { ImportPayload } from "./types.ts";

function payload(): ImportPayload {
  return {
    source: {
      slug: "taco",
      name: "Tabela Brasileira de Composicao de Alimentos",
      version: "2026.1",
      countryCode: "BR",
      sourceUrl: "https://example.test/taco.csv",
      sourceReference: "TACO 2026.1",
    },
    foods: [
      {
        sourceFoodCode: "002",
        name: "Arroz cozido",
        caloriesKcalPer100g: 128,
        proteinGramsPer100g: 2.5,
        carbsGramsPer100g: 28.1,
        fatGramsPer100g: 0.2,
        nutrients: { zinc: 0.5, iron: 0.2 },
        aliases: ["arroz", "arroz branco"],
        portions: [{ label: "colher", grams: 25, isDefault: false }],
      },
    ],
  };
}

describe("createSourceContentHash", () => {
  it("é invariável à ordem de alimentos, aliases, porções e chaves nutricionais", () => {
    const original = payload();
    const reordered: ImportPayload = {
      ...original,
      foods: [
        {
          ...original.foods[0],
          nutrients: { iron: 0.2, zinc: 0.5 },
          aliases: ["arroz branco", "arroz"],
          portions: [{ label: "colher", grams: 25, isDefault: false }],
        },
      ],
    };

    expect(createSourceContentHash(original)).toBe(
      createSourceContentHash(reordered)
    );
  });

  it("muda quando a composição material da fonte muda", () => {
    const changed: ImportPayload = {
      ...payload(),
      foods: [{ ...payload().foods[0], caloriesKcalPer100g: 130 }],
    };

    expect(createSourceContentHash(payload())).not.toBe(
      createSourceContentHash(changed)
    );
  });

  it("não usa notas operacionais nem data de coleta como identidade material", () => {
    const first: ImportPayload = {
      ...payload(),
      source: {
        ...payload().source,
        notes: "carga A",
        collectedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const second: ImportPayload = {
      ...payload(),
      source: {
        ...payload().source,
        notes: "carga B",
        collectedAt: "2026-02-01T00:00:00.000Z",
      },
    };

    expect(createSourceContentHash(first)).toBe(
      createSourceContentHash(second)
    );
  });
});
