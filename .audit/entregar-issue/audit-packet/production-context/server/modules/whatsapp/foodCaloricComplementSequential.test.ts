import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resumo recarregado."),
  composeWhatsAppMealActionReplies: vi.fn(async () => "Resumos recarregados."),
}));

vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, savedMeal) => ({
    action: "created",
    meal: savedMeal,
  })),
}));

import { persistResolvedCaloricComplement } from "./foodCaloricComplementPersistence";
import type {
  CaloricComplementQuantityContext,
  FoodQuantityClarificationTarget,
} from "./foodQuantityClarification";

const occurredAt = new Date("2026-07-24T10:00:00.000Z");
const timeZone = "America/Sao_Paulo";

function sweetenedCoffeeItem(sugarGrams: number) {
  return {
    foodName: "Café com açúcar",
    canonicalName: "Café com açúcar",
    brand: null,
    quantity: 1,
    unit: "xícara",
    portionText: `1 xícara com ${sugarGrams} g de açúcar`,
    servings: 1,
    estimatedGrams: 200 + sugarGrams,
    calories: 2 + sugarGrams * 4,
    protein: 0,
    carbs: sugarGrams,
    fat: 0,
    confidence: 0.9,
    source: "heuristic" as const,
  };
}

function baseItem(foodName: string, calories = 2) {
  return {
    foodName,
    canonicalName: foodName,
    brand: null,
    quantity: 1,
    unit: "xícara",
    portionText: "1 xícara",
    servings: 1,
    estimatedGrams: 200,
    calories,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 0.9,
    source: "catalog" as const,
  };
}

function createHarness(initialMeals: any[] = []) {
  const meals = initialMeals.map(meal => ({ ...meal, items: [...meal.items] }));
  let nextPendingId = 1;
  const pendingOperations: any[] = [];
  const repository = {
    createPendingOperation: vi.fn(async (input: any) => {
      const record = {
        id: nextPendingId++,
        userId: input.userId,
        type: input.type,
        target: input.target,
        origin: input.origin,
        state: "active",
        version: 1,
        createdAt: input.now,
        updatedAt: input.now,
        expiresAt: new Date(input.now.getTime() + input.ttlMs),
        consumedAt: null,
      };
      pendingOperations.push(record);
      return record;
    }),
  };
  const processFood = vi.fn(async (input: { text: string }) => {
    const segments = input.text.split(/\s+e\s+/i);
    const sweetened = segments.filter(segment =>
      /café|cafe/i.test(segment)
        && /com açúcar|com acucar|adoçad|adocad/i.test(segment)
    );
    const unresolved = sweetened.some(segment =>
      !/\(\d+(?:[,.]\d+)?\s*g\s+de\s+açúcar\)/i.test(segment)
    );
    if (unresolved) {
      throw {
        code: "food_component_quantity_required",
        context: { component: "açúcar" },
      };
    }
    const sugarQuantities = sweetened.map(segment => {
      const match = segment.match(/\((\d+(?:[,.]\d+)?)\s*g\s+de\s+açúcar\)/i);
      return Number(match?.[1].replace(",", "."));
    });
    const items = sugarQuantities.map(sweetenedCoffeeItem);
    return {
      detectedMealLabel: "Café da manhã",
      sourceText: input.text,
      confidence: 0.9,
      needsConfirmation: false,
      reasoning: "clarificação sequencial",
      items,
      totals: {
        calories: items.reduce((sum, item) => sum + item.calories, 0),
        protein: 0,
        carbs: items.reduce((sum, item) => sum + item.carbs, 0),
        fat: 0,
      },
    };
  });
  const createMeal = vi.fn(async (userId: number, input: any) => {
    const meal = { id: 900 + meals.length, userId, ...input };
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
    pendingOperations,
    processFood,
    createMeal,
    updateMeal,
    deps: {
      repository,
      processFood,
      getHabits: vi.fn(async () => []),
      createMeal,
      listMeals,
      updateMeal,
      removeMeal: vi.fn(async () => true),
    } as any,
  };
}

function registrationContext(): CaloricComplementQuantityContext {
  const originalText =
    "1 xícara de café com açúcar e 1 xícara de café adoçado";
  return {
    mode: "complete_caloric_complement",
    componentName: "açúcar",
    originalFoodText: originalText,
    originalText,
    inboundMessageId: "wamid-sequential-903",
    completedComponents: [],
    coffeeQuantity: {
      quantity: 1,
      unit: "xícara",
      estimatedMl: 200,
      cupsEquivalent: 1,
    },
    operation: { kind: "register", occurredAt: occurredAt.toISOString() },
  };
}

function nextContext(harness: ReturnType<typeof createHarness>) {
  const target = harness.pendingOperations.at(-1)?.target as FoodQuantityClarificationTarget;
  expect(target).toBeTruthy();
  return target.resolutionContext as CaloricComplementQuantityContext;
}

describe("clarificação sequencial de múltiplos cafés adoçados", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserva a primeira resposta e conclui o registro após reinício", async () => {
    const harness = createHarness();
    const first = await persistResolvedCaloricComplement(
      harness.deps,
      7,
      registrationContext(),
      { quantity: 5, unit: "g" },
      new Date("2026-07-24T10:01:00.000Z"),
      timeZone,
    );

    expect(first.action).toBe("food_clarification_requested");
    expect(harness.meals).toHaveLength(0);
    const persistedContext = nextContext(harness);
    expect(persistedContext.originalFoodText).toContain("café com açúcar (5 g de açúcar)");
    expect(persistedContext.completedComponents).toEqual([
      { componentName: "açúcar", quantity: 5, unit: "g" },
    ]);

    const second = await persistResolvedCaloricComplement(
      harness.deps,
      7,
      persistedContext,
      { quantity: 8, unit: "g" },
      new Date("2026-07-24T10:02:00.000Z"),
      timeZone,
    );

    expect(second.action).toBe("food_clarification_completed");
    expect(harness.meals).toHaveLength(1);
    expect(harness.meals[0].items).toEqual([
      expect.objectContaining({ calories: 22, carbs: 5 }),
      expect.objectContaining({ calories: 34, carbs: 8 }),
    ]);
    expect(harness.meals[0].notes).toBe(
      "1 xícara de café com açúcar e 1 xícara de café adoçado"
    );
  });

  it("não altera a refeição de adição até todas as quantidades serem conhecidas", async () => {
    const harness = createHarness([{
      id: 903,
      userId: 7,
      mealLabel: "Café da manhã",
      occurredAt,
      notes: null,
      items: [baseItem("Banana", 72)],
    }]);
    const context = registrationContext();
    context.operation = {
      kind: "add_to_meal",
      mealId: 903,
      expectedMealLabel: "Café da manhã",
      expectedOccurredAt: occurredAt.toISOString(),
    };

    const first = await persistResolvedCaloricComplement(
      harness.deps,
      7,
      context,
      { quantity: 4, unit: "g" },
      new Date("2026-07-24T10:01:00.000Z"),
      timeZone,
    );
    expect(first.action).toBe("food_clarification_requested");
    expect(harness.updateMeal).not.toHaveBeenCalled();
    expect(harness.meals[0].items).toHaveLength(1);

    const second = await persistResolvedCaloricComplement(
      harness.deps,
      7,
      nextContext(harness),
      { quantity: 7, unit: "g" },
      new Date("2026-07-24T10:02:00.000Z"),
      timeZone,
    );
    expect(second.action).toBe("food_clarification_completed");
    expect(harness.updateMeal).toHaveBeenCalledTimes(1);
    expect(harness.meals[0].items).toHaveLength(3);
  });

  it("mantém duas substituições adoçadas pendentes e aplica o lote uma única vez", async () => {
    const harness = createHarness([{
      id: 903,
      userId: 7,
      mealLabel: "Café da manhã",
      occurredAt,
      notes: null,
      items: [baseItem("Café sem açúcar"), baseItem("Chá sem açúcar")],
    }]);
    const context: CaloricComplementQuantityContext = {
      mode: "complete_caloric_complement",
      componentName: "açúcar",
      originalFoodText: "1 xícara de Café com açúcar",
      originalText:
        "trocar café sem açúcar por café com açúcar e chá sem açúcar por café adoçado",
      inboundMessageId: "wamid-replace-903",
      completedComponents: [],
      coffeeQuantity: {
        quantity: 1,
        unit: "xícara",
        estimatedMl: 200,
        cupsEquivalent: 1,
      },
      operation: {
        kind: "replace_item",
        mealId: 903,
        itemIndex: 0,
        originalFoodName: "Café sem açúcar",
        companionReplacements: [{
          fromFood: "Chá sem açúcar",
          toFood: "Café adoçado",
        }],
      },
    };

    const first = await persistResolvedCaloricComplement(
      harness.deps,
      7,
      context,
      { quantity: 5, unit: "g" },
      new Date("2026-07-24T10:01:00.000Z"),
      timeZone,
    );
    expect(first.action).toBe("food_clarification_requested");
    expect(harness.updateMeal).not.toHaveBeenCalled();
    expect(harness.meals[0].items.map((item: any) => item.foodName)).toEqual([
      "Café sem açúcar",
      "Chá sem açúcar",
    ]);

    const persistedContext = nextContext(harness);
    expect((persistedContext.operation as any).resolvedReplacements).toHaveLength(1);

    const second = await persistResolvedCaloricComplement(
      harness.deps,
      7,
      persistedContext,
      { quantity: 8, unit: "g" },
      new Date("2026-07-24T10:02:00.000Z"),
      timeZone,
    );
    expect(second.action).toBe("food_clarification_completed");
    expect(harness.updateMeal).toHaveBeenCalledTimes(1);
    expect(harness.meals[0].items).toEqual([
      expect.objectContaining({ canonicalName: "Café com açúcar", carbs: 5 }),
      expect.objectContaining({ canonicalName: "Café com açúcar", carbs: 8 }),
    ]);
  });
});
