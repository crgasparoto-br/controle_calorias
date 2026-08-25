import { describe, expect, it } from "vitest";
import { getDateKeyInTimeZone } from "../../../../shared/timeZone";
import { resolveWhatsappRelativeMealDateSelection } from "./explicitMealDate";
import { findMealByLabel } from "./mealItemHelpers";

const timeZone = "America/Sao_Paulo";

describe("data explícita de adição de refeição (#1006)", () => {
  it.each([
    ["hoje", "2026-08-24"],
    ["ontem", "2026-08-23"],
    ["anteontem", "2026-08-22"],
    ["amanhã", "2026-08-25"],
  ])("preserva explicitness e resolve %s no timezone do usuário", (token, expectedDate) => {
    const selection = resolveWhatsappRelativeMealDateSelection({
      text: `adicionar 100 g de arroz ao almoço de ${token}`,
      receivedAt: new Date("2026-08-25T02:30:00.000Z"),
      timeZone,
      fallbackDate: new Date("2026-08-20T12:00:00.000Z"),
    });

    expect(selection.explicit).toBe(true);
    expect(getDateKeyInTimeZone(selection.date, timeZone)).toBe(expectedDate);
  });

  it("não transforma a data de fallback contextual em data explícita", () => {
    const fallbackDate = new Date("2026-08-22T12:00:00.000Z");
    const selection = resolveWhatsappRelativeMealDateSelection({
      text: "adicionar 100 g de arroz ao almoço",
      receivedAt: new Date("2026-08-24T18:00:00.000Z"),
      timeZone,
      fallbackDate,
    });

    expect(selection).toEqual({ date: fallbackDate, explicit: false });
  });

  it("bloqueia fallback para refeição homônima de outro dia quando a data é explícita", () => {
    const olderMeal = {
      id: 22,
      mealLabel: "Café da manhã",
      occurredAt: "2026-08-22T11:00:00.000Z",
    };
    const meals = [olderMeal];
    const requestedDate = new Date("2026-08-24T15:00:00.000Z");

    expect(findMealByLabel(meals, "café da manhã", requestedDate, timeZone, {
      allowCrossDayFallback: false,
    })).toBeNull();
    expect(findMealByLabel(meals, "café da manhã", requestedDate, timeZone)).toEqual(olderMeal);
  });

  it("seleciona o registro do mesmo dia antes de qualquer fallback", () => {
    const meals = [
      { id: 22, mealLabel: "Café da manhã", occurredAt: "2026-08-22T11:00:00.000Z" },
      { id: 24, mealLabel: "Café da manhã", occurredAt: "2026-08-24T11:00:00.000Z" },
    ];

    expect(findMealByLabel(meals, "café da manhã", new Date("2026-08-24T15:00:00.000Z"), timeZone, {
      allowCrossDayFallback: false,
    })?.id).toBe(24);
  });
});
