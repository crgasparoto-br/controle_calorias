import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MealDraftItem } from "../../nutritionEngine";

const listMealsMock = vi.fn();

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
}));

const { executeWhatsappMealListIntent } = await import("./mealListIntent");

function item(input: Partial<MealDraftItem> & Pick<MealDraftItem, "foodName" | "calories" | "protein" | "carbs" | "fat">): MealDraftItem {
  return {
    canonicalName: input.foodName,
    quantity: 100,
    unit: "g",
    portionText: "100 g",
    servings: 1,
    estimatedGrams: 100,
    confidence: 0.9,
    source: "heuristic",
    ...input,
  };
}

describe("executeWhatsappMealListIntent", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    listMealsMock.mockResolvedValue([
      {
        id: 3,
        mealLabel: "Jantar",
        occurredAt: "2026-06-19T22:00:00.000Z",
        items: [item({ foodName: "sopa", calories: 180, protein: 8, carbs: 20, fat: 6 })],
      },
      {
        id: 2,
        mealLabel: "Almoço",
        occurredAt: "2026-06-20T15:30:00.000Z",
        items: [
          item({ foodName: "arroz", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 }),
          item({ foodName: "frango", portionText: "120 g", estimatedGrams: 120, calories: 198, protein: 37.2, carbs: 0, fat: 4.3 }),
        ],
      },
      {
        id: 1,
        mealLabel: "Café da manhã",
        occurredAt: "2026-06-20T10:00:00.000Z",
        items: [item({ foodName: "pão", calories: 140, protein: 4.5, carbs: 28, fat: 1.5 })],
      },
    ]);
  });

  it("lista alimentos da refeição por label e data relativa de hoje", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "listar alimentos do almoço de hoje",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result).toMatchObject({
      action: "meal_foods_listed",
      eventType: "whatsapp.intent.meal_foods_listed",
      data: expect.objectContaining({ mealId: 2, itemCount: 2 }),
    });
    expect(result?.reply).toContain("Alimentos de Almoço em 20/06/2026:");
    expect(result?.reply).toContain("100 g de arroz - 130 kcal");
    expect(result?.reply).toContain("120 g de frango - 198 kcal");
    expect(result?.reply).toContain("Total: 328 kcal");
  });

  it("lista alimentos da refeição por label e data relativa de ontem", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "quais alimentos estão no jantar de ontem?",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result?.action).toBe("meal_foods_listed");
    expect(result?.data).toEqual(expect.objectContaining({ mealId: 3, mealLabel: "Jantar" }));
    expect(result?.reply).toContain("Alimentos de Jantar em 19/06/2026:");
    expect(result?.reply).toContain("100 g de sopa - 180 kcal");
  });

  it("lista alimentos da última refeição explicitamente solicitada", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "me mostre a lista de alimentos da última refeição",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result?.action).toBe("meal_foods_listed");
    expect(result?.data).toEqual(expect.objectContaining({ mealId: 3 }));
    expect(result?.reply).toContain("Alimentos da última refeição (Jantar às 19:00):");
  });

  it("pede esclarecimento quando não encontra a refeição solicitada", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "o que foi registrado no café da manhã de ontem?",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result).toMatchObject({
      action: "clarification_needed",
      eventType: "whatsapp.intent.meal_foods_not_found",
      reply: expect.stringContaining("Não encontrei a refeição Café da manhã em 19/06/2026"),
    });
  });

  it("ignora textos que não pedem lista de alimentos", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "adicionar 100g de arroz ao almoço",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result).toBeNull();
    expect(listMealsMock).not.toHaveBeenCalled();
  });
});
