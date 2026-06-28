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
        id: 4,
        mealLabel: "Almoço",
        occurredAt: "2026-06-20T16:20:00.000Z",
        items: [item({ foodName: "salada", calories: 40, protein: 1.2, carbs: 5, fat: 1.5 })],
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
      data: expect.objectContaining({ mealId: 4, itemCount: 1 }),
    });
    expect(result?.reply).toContain("Alimentos de Almoço em 20/06/2026:");
    expect(result?.reply).toContain("100 g de salada - 40 kcal");
    expect(result?.reply).toContain("Total: 40 kcal");
    expect(result?.reply).not.toContain("às");
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
    expect(result?.reply).not.toContain("às");
  });

  it("lista alimentos da última refeição explicitamente solicitada sem horário", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "me mostre a lista de alimentos da última refeição",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result?.action).toBe("meal_foods_listed");
    expect(result?.data).toEqual(expect.objectContaining({ mealId: 3 }));
    expect(result?.reply).toContain("Alimentos da última refeição (Jantar):");
    expect(result?.reply).not.toContain("às");
  });

  it("lista comandos genéricos de alimentos agrupados por refeição do dia", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "Liste os alimentos",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result).toMatchObject({
      action: "meal_foods_listed",
      eventType: "whatsapp.intent.meal_foods_listed",
      data: expect.objectContaining({ mealCount: 3, itemCount: 4 }),
    });
    expect(result?.reply).toContain("Alimentos registrados em 20/06/2026:");
    expect(result?.reply).toContain("Almoço:");
    expect(result?.reply).toContain("100 g de salada - 40 kcal");
    expect(result?.reply).toContain("100 g de arroz - 130 kcal");
    expect(result?.reply).toContain("120 g de frango - 198 kcal");
    expect(result?.reply).toContain("Subtotal da refeição: 368 kcal | Prot. 41,1 g | Carb. 33 g | Gord. 6,1 g");
    expect(result?.reply).toContain("Café da manhã:");
    expect(result?.reply).toContain("100 g de pão - 140 kcal");
    expect(result?.reply).toContain("Subtotal da refeição: 140 kcal | Prot. 4,5 g | Carb. 28 g | Gord. 1,5 g");
    expect(result?.reply).not.toContain("Almoço às");
    expect(result?.reply).not.toContain("Café da manhã às");
    expect(result?.reply).not.toContain("sopa");
    expect(result?.reply).toContain("Total do dia: 508 kcal | Prot. 45,6 g | Carb. 61 g | Gord. 7,6 g");
  });

  it("trata 'o que comi hoje' como consulta de alimentos do dia", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "o que comi hoje",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result?.action).toBe("meal_foods_listed");
    expect(result?.reply).toContain("Alimentos registrados em 20/06/2026:");
    expect(result?.reply).toContain("Almoço:");
    expect(result?.reply).toContain("arroz");
    expect(result?.reply).toContain("pão");
    expect(result?.reply).toContain("Subtotal da refeição:");
    expect(result?.reply).not.toContain("às");
  });

  it("retorna estado vazio para listagem genérica sem registros no dia", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "alimentos de hoje",
      receivedAt: new Date("2026-06-21T20:14:00-03:00"),
    });

    expect(result?.action).toBe("meal_foods_listed");
    expect(result?.reply).toBe("Não encontrei alimentos registrados em 21/06/2026.");
    expect(result?.data).toEqual(expect.objectContaining({ mealCount: 0, itemCount: 0 }));
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
