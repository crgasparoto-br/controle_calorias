import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resumo recarregado."),
}));

vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, meal) => ({
    action: "created",
    meal,
  })),
}));

import { persistResolvedCaloricComplement } from "./foodCaloricComplementPersistence";

const occurredAt = new Date("2026-07-24T10:00:00.000Z");
const timeZone = "America/Sao_Paulo";

function coffeeItem() {
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

function unsweetenedCoffeeItem() {
  return {
    ...coffeeItem(),
    foodName: "Café sem açúcar",
    canonicalName: "Café Sem Açúcar",
    portionText: "1 xícara",
    estimatedGrams: 200,
    calories: 2,
    carbs: 0,
    source: "catalog" as const,
  };
}

function createHarness(initialItems: ReturnType<typeof coffeeItem>[]) {
  const meals = [{
    id: 903,
    userId: 7,
    mealLabel: "Café da manhã",
    occurredAt,
    notes: null,
    items: initialItems,
  }];

  const processFood = vi.fn(async () => ({
    detectedMealLabel: "Café da manhã",
    sourceText: "1 xícara de café com açúcar (5 g de açúcar)",
    confidence: 0.9,
    needsConfirmation: false,
    reasoning: "açúcar incorporado uma única vez",
    items: [coffeeItem()],
    totals: { calories: 22, protein: 0, carbs: 5, fat: 0 },
  }));
  const updateMeal = vi.fn(async (userId: number, input: any) => {
    const index = meals.findIndex(meal => meal.userId === userId && meal.id === input.mealId);
    if (index < 0) throw new Error("meal not found");
    meals[index] = {
      ...meals[index],
      ...input,
      userId,
      id: input.mealId,
      occurredAt: new Date(input.occurredAt),
    };
    return meals[index];
  });

  const deps = {
    processFood,
    getHabits: vi.fn(async () => []),
    listMeals: vi.fn(async (userId: number) => meals.filter(meal => meal.userId === userId)),
    updateMeal,
    createMeal: vi.fn(),
    removeMeal: vi.fn(),
  } as any;

  return { deps, meals, processFood, updateMeal };
}

describe("persistência do complemento calórico", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adiciona exatamente um café adoçado após revalidar e recarregar a refeição", async () => {
    const harness = createHarness([breadItem()] as any);

    const result = await persistResolvedCaloricComplement(
      harness.deps,
      7,
      {
        mode: "complete_caloric_complement",
        componentName: "açúcar",
        originalFoodText: "1 xícara de café com açúcar",
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
    expect(harness.meals[0].items).toHaveLength(2);
    expect(harness.meals[0].items[0].foodName).toBe("Pão francês");
    expect(harness.meals[0].items[1]).toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      calories: 22,
      carbs: 5,
    }));
  });

  it("substitui somente o item-alvo após revalidar sua identidade", async () => {
    const harness = createHarness([
      breadItem(),
      unsweetenedCoffeeItem(),
    ] as any);

    const result = await persistResolvedCaloricComplement(
      harness.deps,
      7,
      {
        mode: "complete_caloric_complement",
        componentName: "açúcar",
        originalFoodText: "1 xícara de café com açúcar",
        coffeeQuantity: {
          quantity: 1,
          unit: "xícara",
          estimatedMl: 200,
          cupsEquivalent: 1,
        },
        operation: {
          kind: "replace_item",
          mealId: 903,
          itemIndex: 1,
          originalFoodName: "Café sem açúcar",
        },
      },
      { quantity: 5, unit: "g" },
      new Date("2026-07-24T10:01:00.000Z"),
      timeZone,
    );

    expect(result.action).toBe("food_clarification_completed");
    expect(harness.updateMeal).toHaveBeenCalledTimes(1);
    expect(harness.meals[0].items[0].foodName).toBe("Pão francês");
    expect(harness.meals[0].items[1]).toEqual(expect.objectContaining({
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
      calories: 22,
      carbs: 5,
    }));
  });

  it("não altera a refeição quando o item-alvo mudou durante a pendência", async () => {
    const harness = createHarness([
      breadItem(),
      coffeeItem(),
    ] as any);

    await expect(persistResolvedCaloricComplement(
      harness.deps,
      7,
      {
        mode: "complete_caloric_complement",
        componentName: "açúcar",
        originalFoodText: "1 xícara de café com açúcar",
        coffeeQuantity: {
          quantity: 1,
          unit: "xícara",
          estimatedMl: 200,
          cupsEquivalent: 1,
        },
        operation: {
          kind: "replace_item",
          mealId: 903,
          itemIndex: 1,
          originalFoodName: "Café sem açúcar",
        },
      },
      { quantity: 5, unit: "g" },
      new Date("2026-07-24T10:01:00.000Z"),
      timeZone,
    )).rejects.toThrow("O item-alvo mudou");

    expect(harness.updateMeal).not.toHaveBeenCalled();
    expect(harness.meals[0].items[1].canonicalName).toBe("Café com açúcar");
  });
});
