import { describe, expect, it } from "vitest";
import { isExplicitFoodAdditionCommand, parseMealCommandFromWhatsApp } from "./mealCommandParser";
import { parseFoodAdditionIntent } from "./intent/parsers";

const RECEIVED_AT = new Date("2026-10-01T18:55:00.000Z");

describe("issue #1278 — destino da refeição antes dos itens e pontuação final", () => {
  it.each([
    ["Adicionar o café da manhã, 1,5 fatias de mortadela", "café da manhã", "mortadela", 1.5, "fatia"],
    ["adicionar o café da manhã: 1,5 fatias de mortadela", "café da manhã", "mortadela", 1.5, "fatia"],
    ["incluir o almoço, 2 linguiças de frango assadas", "almoço", "linguiças de frango assadas", 2, "unidade"],
    ["Adicionar 2 linguiças de frango assadas ao almoço.", "almoço", "linguiças de frango assadas", 2, "unidade"],
    ["Adicionar o jantar, 1 ovo frito", "jantar", "ovo frito", 1, "unidade"],
  ])(
    "reconhece %s como adição completa sem contaminar o nome do alimento",
    (text, mealLabel, foodName, quantity, unit) => {
      const parsed = parseMealCommandFromWhatsApp(text);

      expect(parsed.intent).toBe("add_items_to_meal");
      expect(parsed.mealType).toBe(mealLabel);
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]).toEqual(expect.objectContaining({ foodName, quantity, unit }));
      expect(parsed.items[0]?.missingFields).toEqual([]);
      expect(isExplicitFoodAdditionCommand(text)).toBe(true);

      const addition = parseFoodAdditionIntent(text, RECEIVED_AT);
      expect(addition).toEqual(
        expect.objectContaining({
          mealLabel,
          items: [
            expect.objectContaining({
              foodName,
              quantity,
              unit: unit === "unidade" ? "un" : unit,
            }),
          ],
        }),
      );
    },
  );

  it.each([
    "adicionar 1,5 fatias de mortadela ao café da manhã",
    "adicionar ao café da manhã 1,5 fatias de mortadela",
    "adicionar 1,5 fatias de mortadela ao café da manhã.",
  ])("mantém a forma já suportada em %s", text => {
    const parsed = parseMealCommandFromWhatsApp(text);

    expect(parsed.items).toEqual([
      expect.objectContaining({ foodName: "mortadela", quantity: 1.5, unit: "fatia" }),
    ]);
  });

  it("não promove o rótulo da refeição a item alimentar incompleto", () => {
    const parsed = parseMealCommandFromWhatsApp(
      "Adicionar o café da manhã, 1,5 fatias de mortadela",
    );

    expect(parsed.items.some(item => /caf[eé] da manh[aã]/i.test(item.foodName ?? ""))).toBe(false);
  });
});