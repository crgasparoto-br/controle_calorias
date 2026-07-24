import { describe, expect, it, vi } from "vitest";

vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resumo recarregado."),
  composeWhatsAppMealActionReplies: vi.fn(async () => "Resumos recarregados."),
}));

vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, meal) => ({
    action: "created",
    meal,
  })),
}));

import { persistResolvedCaloricComplement } from "./foodCaloricComplementPersistence";

const occurredAt = new Date("2026-07-24T10:00:00.000Z");

function item(foodName: string, calories: number, carbs: number) {
  return {
    foodName,
    canonicalName: foodName,
    brand: null,
    quantity: 1,
    unit: "unidade",
    portionText: "1 unidade",
    servings: 1,
    estimatedGrams: 100,
    calories,
    protein: 1,
    carbs,
    fat: 0,
    confidence: 0.9,
    source: "heuristic" as const,
  };
}

function sweetenedCoffee() {
  return {
    ...item("Café com açúcar", 22, 5),
    quantity: 1,
    unit: "xícara",
    portionText: "1 xícara com 5 g de açúcar",
    estimatedGrams: 205,
  };
}

function unsweetenedCoffee() {
  return {
    ...item("Café sem açúcar", 2, 0),
    canonicalName: "Café Sem Açúcar",
    quantity: 1,
    unit: "xícara",
    portionText: "1 xícara",
    estimatedGrams: 200,
    source: "catalog" as const,
  };
}

describe("compensação da substituição composta", () => {
  it("restaura inclusive a atualização que persistiu antes de lançar erro", async () => {
    const meals: any[] = [
      {
        id: 903,
        userId: 7,
        mealLabel: "Lanche",
        occurredAt: new Date("2026-07-24T11:00:00.000Z"),
        notes: null,
        items: [item("Banana", 72, 19)],
      },
      {
        id: 904,
        userId: 7,
        mealLabel: "Café da manhã",
        occurredAt,
        notes: null,
        items: [unsweetenedCoffee()],
      },
    ];
    const original = JSON.parse(JSON.stringify(meals));
    let forwardAttempts = 0;
    let injectedFailure = false;

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
      if (!injectedFailure) {
        forwardAttempts += 1;
        if (forwardAttempts === 2) {
          injectedFailure = true;
          throw new Error("efeito complementar falhou depois da persistência");
        }
      }
      return meals[index];
    });

    const deps = {
      processFood: vi.fn(async () => ({
        detectedMealLabel: "Café da manhã",
        sourceText: "1 xícara de café com açúcar (5 g de açúcar)",
        confidence: 0.9,
        needsConfirmation: false,
        reasoning: "açúcar incorporado",
        items: [sweetenedCoffee()],
        totals: { calories: 22, protein: 1, carbs: 5, fat: 0 },
      })),
      getHabits: vi.fn(async () => []),
      listMeals: vi.fn(async (userId: number) => meals.filter(meal => meal.userId === userId)),
      updateMeal,
      createMeal: vi.fn(),
      removeMeal: vi.fn(),
    } as any;

    await expect(persistResolvedCaloricComplement(
      deps,
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
          mealId: 904,
          itemIndex: 0,
          originalFoodName: "Café sem açúcar",
          companionReplacements: [{ fromFood: "Banana", toFood: "Maçã" }],
        },
      },
      { quantity: 5, unit: "g" },
      new Date("2026-07-24T11:01:00.000Z"),
      "America/Sao_Paulo",
    )).rejects.toThrow("alterações anteriores foram revertidas");

    expect(updateMeal).toHaveBeenCalledTimes(4);
    expect(meals.map(meal => ({
      id: meal.id,
      items: meal.items.map((candidate: any) => ({
        foodName: candidate.foodName,
        canonicalName: candidate.canonicalName,
        calories: candidate.calories,
        carbs: candidate.carbs,
      })),
    }))).toEqual(original.map((meal: any) => ({
      id: meal.id,
      items: meal.items.map((candidate: any) => ({
        foodName: candidate.foodName,
        canonicalName: candidate.canonicalName,
        calories: candidate.calories,
        carbs: candidate.carbs,
      })),
    })));
  });
});
