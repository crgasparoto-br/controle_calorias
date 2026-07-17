import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());
const goalProgressMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  removeMeal: vi.fn(),
  updateMeal: updateMealMock,
}));
vi.mock("./goalProgressService", () => ({ getWhatsAppMealGoalProgress: goalProgressMock }));
vi.mock("../../db", () => ({ getDb: vi.fn(), logPersistenceWarning: vi.fn() }));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
}));

const { completeWhatsappDeleteInteractiveCallback } = await import("./deleteIntent");

const rice = {
  foodName: "Arroz",
  canonicalName: "Arroz branco cozido",
  portionText: "100 g",
  estimatedGrams: 100,
  calories: 130,
  protein: 2.7,
  carbs: 28,
  fat: 0.3,
  source: "catalog" as const,
};
const chicken = {
  foodName: "Frango",
  canonicalName: "Frango grelhado",
  portionText: "120 g",
  estimatedGrams: 120,
  calories: 190,
  protein: 35,
  carbs: 0,
  fat: 4,
  source: "catalog" as const,
};

describe("deleteIntent canonical progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const meal = {
      id: 10,
      mealLabel: "Almoço",
      occurredAt: "2026-07-15T15:00:00.000Z",
      notes: null,
      items: [rice, chicken],
    };
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ ...meal, ...input }));
    goalProgressMock.mockResolvedValue({
      consumedCalories: 1850,
      goalCalories: 2000,
      exerciseCalories: 300,
      consumedProteinGrams: 110,
      targetProteinGrams: 120,
      consumedCarbsGrams: 130,
      targetCarbsGrams: 150,
      consumedFatGrams: 55,
      targetFatGrams: 50,
    });
  });

  it("retorna o estado final da refeição removida com saldo e percentuais canônicos", async () => {
    const result = await completeWhatsappDeleteInteractiveCallback(42, {
      target: {
        kind: "delete_food_from_meal",
        mealId: 10,
        mealLabel: "Almoço",
        mealOccurredAt: "2026-07-15T15:00:00.000Z",
        itemIndex: 1,
        itemName: "Frango",
      },
    }, "confirm", "America/Sao_Paulo");

    expect(result.action).toBe("meal_item_deleted");
    expect(result.reply).toContain("*Alimento removido*");
    expect(result.reply).toContain("*Total da refeição:*");
    expect(result.reply).toContain("*Meta:* 2.000 kcal");
    expect(result.reply).toContain("*Consumo:* 1.850 kcal");
    expect(result.reply).toContain("*Déficit:* 150 kcal (-7%)");
    expect(result.reply).toContain("• P 110 g (-10 g/-8%)");
    expect(result.reply).toContain("• C 130 g (-20 g/-13%)");
    expect(result.reply).toContain("• G 55 g (+5 g/+10%)");
    expect(goalProgressMock).toHaveBeenCalledWith(42, new Date("2026-07-15T15:00:00.000Z"), "America/Sao_Paulo");
  });
});
