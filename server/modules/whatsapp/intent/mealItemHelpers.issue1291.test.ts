import { describe, expect, it } from "vitest";
import { findMealByLabel } from "./mealItemHelpers";

const timeZone = "America/Sao_Paulo";

function meal(id: number, mealLabel: string, occurredAtIso: string) {
  return { id, mealLabel, occurredAt: new Date(occurredAtIso).getTime() };
}

describe("findMealByLabel — janela do fallback contextual (#1291)", () => {
  it("não desloca uma adição sem data para uma refeição de três dias antes", () => {
    const meals = [meal(301, "Lanche da tarde", "2026-09-28T19:49:00.000Z")];
    const referenceDate = new Date("2026-10-02T00:45:00.000Z");

    expect(findMealByLabel(meals, "lanche da tarde", referenceDate, timeZone, {
      allowCrossDayFallback: true,
    })).toBeNull();
  });

  it("mantém a refeição imediatamente anterior quando a mensagem chega logo depois dela", () => {
    const previousDinner = meal(302, "Jantar", "2026-10-02T00:30:00.000Z");
    const referenceDate = new Date("2026-10-02T01:10:00.000Z");

    expect(findMealByLabel([previousDinner], "jantar", referenceDate, timeZone, {
      allowCrossDayFallback: true,
    })).toBe(previousDinner);
  });

  it("prefere a refeição do próprio dia antes de qualquer fallback", () => {
    const sameDay = meal(303, "Jantar", "2026-10-02T21:00:00.000Z");
    const previousDay = meal(304, "Jantar", "2026-10-01T21:00:00.000Z");
    const referenceDate = new Date("2026-10-02T23:30:00.000Z");

    expect(findMealByLabel([sameDay, previousDay], "jantar", referenceDate, timeZone, {
      allowCrossDayFallback: true,
    })).toBe(sameDay);
  });

  it("continua fail-closed quando a mensagem trouxe data explícita", () => {
    const previousDay = meal(305, "Lanche da tarde", "2026-09-30T19:49:00.000Z");
    const referenceDate = new Date("2026-10-01T12:00:00.000Z");

    expect(findMealByLabel([previousDay], "lanche da tarde", referenceDate, timeZone, {
      allowCrossDayFallback: false,
    })).toBeNull();
  });
});