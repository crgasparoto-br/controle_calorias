import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resumo composto recarregado."),
}));

vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, savedMeal) => ({
    action: "created",
    meal: savedMeal,
  })),
}));

import { persistResolvedCaloricComplement } from "./foodCaloricComplementPersistence";

const occurredAt = new Date("2026-07-24T10:00:00.000Z");
const timeZone = "America/Sao_Paulo";

function sweetenedCoffeeItem() {
  return {
    foodName: "Café com açúcar",
    canonicalName: "Café com açúcar",
    brand: null,
    quantity: 1,
    unit: "xícara",
    portionText: "1 xícara com 5 g de açúcar",
    servings: 1,
    estimatedGrams: 205,
    calories: 22,
    protein: 0,
    carbs: 5,
    fat: 0,
    confidence: 0.9,
    source: "heuristic" as const,
  };
}

function breadItem() {
  return {
    foodName: "Pão francês",
    canonicalName: "Pão francês",
    brand: null,
    quantity: 1,
    unit: "unidade",
    portionText: "1 unidade",
    servings: 1,
    estimatedGrams: 50,
    calories: 135,
    protein: 4,
    carbs: 28,
    fat: 1,
    confidence: 0.9,
    source: "heuristic" as const,
  };
}

function existingItem() {
  return {
    ...breadItem(),
    foodName: "Banana",
    canonicalName: "Banana",
    estimatedGrams: 80,
    calories: 72,
    protein: 1,
    carbs: 19,
    fat: 0,
  };
}

function createHarness(initialMeals: any[] = []) {
  const meals = initialMeals.map(meal => ({ ...meal, items: [...meal.items] }));
  const processFood = vi.fn(async () => ({
    detectedMealLabel: "Café da manhã",
    sourceText: "1 xícara de café com açúcar (5 g de açúcar) e 1 pão francês",
    confidence: 0.9,
    needsConfirmation: false,
    reasoning: "lote alimentar preservado",
    items: [sweetenedCoffeeItem(), breadItem()],
    totals: { calories: 157, protein: 4, carbs: 33, fat: 1 },
  }));
  const createMeal = vi.fn(async (userId: number, input: any) => {
    const meal = { id: 990 + meals.length, userId, ...input };
    meals.push(meal);
    return meal;
  });
  const updateMeal = vi.fn(async (userId: number, input: any) => {
    const index = meals.findIndex(meal => meal.userId === userId && meal.id === input.mealId);
    if (index < 0) throw new Error("meal not found");
    meals[index] = {
      ...meals[index],
      ...input,
      id: input.mealId,
      userId,
      occurredAt: new Date(input.occurredAt),
    };
    return meals[index];
  });
  const listMeals = vi.fn(async (userId: number) =>
    meals.filter(meal => meal.userId === userId)
  );

  return {
    meals,
    processFood,
    createMeal,
    updateMeal,
    deps: {
      processFood,
      getHabits: vi.fn(async () => []),
      createMeal,
      listMeals,
      updateMeal,
      removeMeal: vi.fn(async () => true),
    } as any,
  };
}

describe("retomada composta da clarificação de açúcar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registra todos os alimentos preservados no texto original", async () => {
    const harness = createHarness();

    const result = await persistResolvedCaloricComplement(
      harness.deps,
      7,
      {
        mode: "complete_caloric_complement",
        componentName: "açúcar",
        originalFoodText: "1 xícara de café com açúcar e 1 pão francês",
        coffeeQuantity: {
          quantity: 1,
          unit: "xícara",
          estimatedMl: 200,
          cupsEquivalent: 1,
        },
        operation: { kind: "register", occurredAt: occurredAt.toISOString() },
      },
      { quantity: 5, unit: "g" },
      new Date("2026-07-24T10:01:00.000Z"),
      timeZone,
    );

    expect(result.action).toBe("food_clarification_completed");
    expect(harness.processFood).toHaveBeenCalledWith(expect.objectContaining({
      text: "1 xícara de café com açúcar (5 g de açúcar) e 1 pão francês",
    }));
    expect(harness.createMeal).toHaveBeenCalledWith(7, expect.objectContaining({
      items: [
        expect.objectContaining({ canonicalName: "Café com açúcar", calories: 22 }),
        expect.objectContaining({ foodName: "Pão francês", calories: 135 }),
      ],
    }));
    expect(harness.meals[0].items).toHaveLength(2);
  });

  it("adiciona o lote completo à refeição-alvo depois da resposta", async () => {
    const harness = createHarness([{
      id: 903,
      userId: 7,
      mealLabel: "Café da manhã",
      occurredAt,
      notes: null,
      items: [existingItem()],
    }]);

    const result = await persistResolvedCaloricComplement(
      harness.deps,
      7,
      {
        mode: "complete_caloric_complement",
        componentName: "açúcar",
        originalFoodText: "1 pão francês e 1 xícara de café com açúcar",
        coffeeQuantity: {
          quantity: 1,
          unit: "xícara",
          estimatedMl: 200,
          cupsEquivalent: 1,
        },
        operation: {
          kind: "add_to_meal",
          mealId: 903,
          expectedMealLabel: "Café da manhã",
          expectedOccurredAt: occurredAt.toISOString(),
        },
      },
      { quantity: 5, unit: "g" },
      new Date("2026-07-24T10:01:00.000Z"),
      timeZone,
    );

    expect(result.action).toBe("food_clarification_completed");
    expect(harness.updateMeal).toHaveBeenCalledTimes(1);
    expect(harness.meals[0].items).toHaveLength(3);
    expect(harness.meals[0].items.map((item: any) => item.foodName)).toEqual([
      "Banana",
      "Café com açúcar",
      "Pão francês",
    ]);
  });
});
