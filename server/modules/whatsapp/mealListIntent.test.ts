import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MealDraftItem } from "../../nutritionEngine";
import { buildWhatsAppFoodLines, formatWhatsAppNutritionTotalsLine } from "./replyTemplates";

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

/** Bloco de item central esperado (mesmo builder do registro/adição, issue #781/#783). */
function itemBlockLines(mealItem: MealDraftItem) {
  return buildWhatsAppFoodLines(mealItem as unknown as Parameters<typeof buildWhatsAppFoodLines>[0]);
}

function totalsLine(items: MealDraftItem[]) {
  const totals = items.reduce(
    (acc, mealItem) => ({
      calories: acc.calories + Number(mealItem.calories || 0),
      protein: acc.protein + Number(mealItem.protein || 0),
      carbs: acc.carbs + Number(mealItem.carbs || 0),
      fat: acc.fat + Number(mealItem.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  return formatWhatsAppNutritionTotalsLine(totals);
}

describe("executeWhatsappMealListIntent", () => {
  const salada = item({ foodName: "salada", calories: 40, protein: 1.2, carbs: 5, fat: 1.5 });
  const sopa = item({ foodName: "sopa", calories: 180, protein: 8, carbs: 20, fat: 6 });
  const arroz = item({ foodName: "arroz", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 });
  const frango = item({ foodName: "frango", portionText: "120 g", estimatedGrams: 120, calories: 198, protein: 37.2, carbs: 0, fat: 4.3 });
  const pao = item({ foodName: "pão", calories: 140, protein: 4.5, carbs: 28, fat: 1.5 });

  beforeEach(() => {
    listMealsMock.mockReset();
    listMealsMock.mockResolvedValue([
      { id: 3, mealLabel: "Jantar", occurredAt: "2026-06-19T22:00:00.000Z", items: [sopa] },
      { id: 4, mealLabel: "Almoço", occurredAt: "2026-06-20T16:20:00.000Z", items: [salada] },
      { id: 2, mealLabel: "Almoço", occurredAt: "2026-06-20T15:30:00.000Z", items: [arroz, frango] },
      { id: 1, mealLabel: "Café da manhã", occurredAt: "2026-06-20T10:00:00.000Z", items: [pao] },
    ]);
  });

  it("lista alimentos da refeição por label e data relativa de hoje usando o bloco central de item/total", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "listar alimentos do almoço de hoje",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result).toMatchObject({
      action: "meal_foods_listed",
      eventType: "whatsapp.intent.meal_foods_listed",
      data: expect.objectContaining({ mealId: 4, itemCount: 1 }),
    });
    expect(result?.reply).toContain("Alimentos de Almoço em 20/06/2026");
    for (const line of itemBlockLines(salada)) {
      expect(result?.reply).toContain(line);
    }
    expect(result?.reply).toContain("Total da refeição:");
    expect(result?.reply).toContain(totalsLine([salada]));
    expect(result?.reply).not.toContain("às");
  });

  it("lista alimentos da refeição por label e data relativa de ontem", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "quais alimentos estão no jantar de ontem?",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result?.action).toBe("meal_foods_listed");
    expect(result?.data).toEqual(expect.objectContaining({ mealId: 3, mealLabel: "Jantar" }));
    expect(result?.reply).toContain("Alimentos de Jantar em 19/06/2026");
    for (const line of itemBlockLines(sopa)) {
      expect(result?.reply).toContain(line);
    }
    expect(result?.reply).not.toContain("às");
  });

  it("lista alimentos da última refeição explicitamente solicitada sem horário", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "me mostre a lista de alimentos da última refeição",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result?.action).toBe("meal_foods_listed");
    expect(result?.data).toEqual(expect.objectContaining({ mealId: 3 }));
    expect(result?.reply).toContain("Alimentos da última refeição (Jantar)");
    expect(result?.reply).not.toContain("às");
  });

  it("lista comandos genéricos de alimentos agrupados por refeição do dia com totais atuais", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "Liste os alimentos",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result).toMatchObject({
      action: "meal_foods_listed",
      eventType: "whatsapp.intent.meal_foods_listed",
      data: expect.objectContaining({ mealCount: 3, itemCount: 4 }),
    });
    expect(result?.reply).toContain("Alimentos registrados hoje");
    expect(result?.reply).toContain("Almoço");
    for (const line of [...itemBlockLines(salada), ...itemBlockLines(arroz), ...itemBlockLines(frango)]) {
      expect(result?.reply).toContain(line);
    }
    expect(result?.reply).toContain(totalsLine([salada, arroz, frango]));
    expect(result?.reply).toContain("Café da manhã");
    for (const line of itemBlockLines(pao)) {
      expect(result?.reply).toContain(line);
    }
    expect(result?.reply).toContain(totalsLine([pao]));
    expect(result?.reply).not.toContain("Almoço às");
    expect(result?.reply).not.toContain("Café da manhã às");
    expect(result?.reply).not.toContain("sopa");
    expect(result?.reply).toContain("Total do dia:");
    expect(result?.reply).toContain(totalsLine([salada, arroz, frango, pao]));
  });

  it("trata 'o que comi hoje' como consulta de alimentos do dia", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "o que comi hoje",
      receivedAt: new Date("2026-06-20T20:14:00-03:00"),
    });

    expect(result?.action).toBe("meal_foods_listed");
    expect(result?.reply).toContain("Alimentos registrados hoje");
    expect(result?.reply).toContain("Almoço");
    expect(result?.reply).toContain("arroz");
    expect(result?.reply).toContain("pão");
    expect(result?.reply).toContain("Total da refeição:");
    expect(result?.reply).not.toContain("às");
  });

  it("retorna estado vazio para listagem genérica sem registros no dia", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "alimentos de hoje",
      receivedAt: new Date("2026-06-21T20:14:00-03:00"),
    });

    expect(result?.action).toBe("meal_foods_listed");
    expect(result?.reply).toContain("Alimentos registrados hoje");
    expect(result?.reply).toContain("Não encontrei alimentos registrados nessa data.");
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
