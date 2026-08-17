import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseMealCommandFromWhatsApp } from "../mealCommandParser";
import { parseCoffeeAdditionIntent } from "./parsers";

function normalize(value: string | null) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function findCanonicalCoffee(text: string) {
  const parsed = parseMealCommandFromWhatsApp(text);
  const coffee = parsed.items.find(item => {
    const name = normalize(item.foodName);
    return /\bcafe\b/.test(name) && /\bsem acucar\b/.test(name);
  });
  return { parsed, coffee };
}

describe("issue #970 - CANON-DIVERGENCE-001", () => {
  it.each([
    "Adicionar 3 xícaras de café sem açúcar no café da manhã",
    "Coloque 3 xícaras de café sem açúcar para o café da manhã",
    "Lance 3 copos de café sem açúcar a refeição café da manhã",
    "No café da manhã, adicione 3 xícaras de café sem açúcar",
  ])("projeta o café especializado a partir do mesmo contrato canônico: %s", text => {
    const { parsed, coffee } = findCanonicalCoffee(text);
    const specialized = parseCoffeeAdditionIntent(text);

    expect(parsed.intent).toBe("add_items_to_meal");
    expect(coffee).toBeTruthy();
    expect(specialized).toEqual({
      cups: coffee?.quantity,
      unit: coffee?.unit,
      mealLabel: parsed.mealType,
    });
  });

  it.each([
    ["Adicionar café sem açúcar no café da manhã", 0, null, "café da manhã"],
    ["Adicionar 3 xícaras de café sem açúcar", 3, "xícara", null],
  ] as const)("preserva exatamente o campo parcial conhecido: %s", (text, cups, unit, mealLabel) => {
    expect(parseCoffeeAdditionIntent(text)).toEqual({ cups, unit, mealLabel });
  });

  it("deixa unidade não especializada seguir pelo executor canônico genérico", () => {
    const text = "Adicionar 150g de café sem açúcar no café da manhã";
    const { parsed, coffee } = findCanonicalCoffee(text);

    expect(parsed.intent).toBe("add_items_to_meal");
    expect(coffee).toEqual(expect.objectContaining({ quantity: 150, unit: "g" }));
    expect(parseCoffeeAdditionIntent(text)).toBeNull();
  });

  it("não mantém uma segunda lista de verbos dentro do parser especializado", () => {
    const source = readFileSync(fileURLToPath(new URL("./parsers.ts", import.meta.url)), "utf8");
    const functionSource = source.slice(
      source.indexOf("export function parseCoffeeAdditionIntent"),
      source.indexOf("export function parseCoffeeLorCapsuleIntent"),
    );

    expect(functionSource).toContain("parseMealCommandFromWhatsApp(text)");
    expect(functionSource).not.toMatch(/adicionar\|adiciona|incluir\|inclui|colocar\|coloca|acrescentar\|acrescenta|registrar\|registra|lancar\|lanca/);
  });
});
