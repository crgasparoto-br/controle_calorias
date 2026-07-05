import { describe, expect, it } from "vitest";
import {
  formatWhatsAppConsolidationDateKey,
  resolveWhatsAppMealConsolidationTarget,
} from "./mealConsolidation";

describe("mealConsolidation", () => {
  it("usa data local de São Paulo", () => {
    expect(formatWhatsAppConsolidationDateKey(new Date("2026-06-04T02:30:00.000Z"))).toBe("2026-06-03");
    expect(formatWhatsAppConsolidationDateKey(new Date("2026-06-04T12:30:00.000Z"))).toBe("2026-06-04");
  });

  it("encontra refeição existente do mesmo dia e tipo", () => {
    const result = resolveWhatsAppMealConsolidationTarget({
      savedMealId: 10,
      mealLabel: "Café da manhã",
      occurredAt: new Date("2026-06-04T10:14:00.000Z"),
      meals: [
        { id: 10, source: "whatsapp", mealLabel: "Café da manhã", occurredAt: new Date("2026-06-04T10:14:00.000Z") },
        { id: 9, source: "whatsapp", mealLabel: "cafe da manha", occurredAt: new Date("2026-06-04T10:02:00.000Z") },
        { id: 8, source: "whatsapp", mealLabel: "Almoço", occurredAt: new Date("2026-06-04T15:00:00.000Z") },
      ],
    });

    expect(result.action).toBe("append");
    expect(result.action === "append" ? result.meal.id : null).toBe(9);
  });

  it("ignora refeições de outro dia, tipo ou origem", () => {
    const result = resolveWhatsAppMealConsolidationTarget({
      savedMealId: 10,
      mealLabel: "Jantar",
      occurredAt: new Date("2026-06-04T22:00:00.000Z"),
      meals: [
        { id: 1, source: "web", mealLabel: "Jantar", occurredAt: new Date("2026-06-04T21:00:00.000Z") },
        { id: 2, source: "whatsapp", mealLabel: "Almoço", occurredAt: new Date("2026-06-04T16:00:00.000Z") },
        { id: 3, source: "whatsapp", mealLabel: "Jantar", occurredAt: new Date("2026-06-03T22:00:00.000Z") },
      ],
    });

    expect(result.action).toBe("create");
  });

  it("retorna ambíguo quando há mais de uma candidata", () => {
    const result = resolveWhatsAppMealConsolidationTarget({
      savedMealId: 10,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-04T18:00:00.000Z"),
      meals: [
        { id: 1, source: "whatsapp", mealLabel: "Lanche", occurredAt: new Date("2026-06-04T15:00:00.000Z") },
        { id: 2, source: "whatsapp", mealLabel: "Lanche", occurredAt: new Date("2026-06-04T17:00:00.000Z") },
      ],
    });

    expect(result.action).toBe("ambiguous");
    expect(result.action === "ambiguous" ? result.meals.map(meal => meal.id) : []).toEqual([2, 1]);
  });
});
