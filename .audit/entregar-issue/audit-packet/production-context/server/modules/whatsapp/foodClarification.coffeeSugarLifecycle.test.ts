import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Café registrado com estado canônico recarregado."),
}));

vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, savedMeal) => ({
    action: "created",
    meal: savedMeal,
  })),
}));

import { createWhatsappFoodClarificationService } from "./foodClarification";
import { createFoodQuantityClarificationService } from "./foodQuantityClarification";

function createRepository() {
  let nextId = 1;
  const rows = new Map<number, any>();
  return {
    rows,
    repository: {
      async createPendingOperation(input: any) {
        const now = input.now ?? new Date();
        const row = {
          id: nextId++,
          userId: input.userId,
          type: input.type,
          target: input.target,
          origin: input.origin,
          state: "active",
          version: 1,
          createdAt: now,
          expiresAt: new Date(now.getTime() + input.ttlMs),
          updatedAt: now,
          consumedAt: null,
        };
        rows.set(row.id, row);
        return row;
      },
      async getActivePendingOperation(userId: number, now = new Date()) {
        return [...rows.values()]
          .filter(row =>
            row.userId === userId
            && row.state === "active"
            && row.expiresAt.getTime() >= now.getTime()
          )
          .sort((left, right) => right.id - left.id)[0] ?? null;
      },
      async getLatestPendingOperation(userId: number) {
        return [...rows.values()]
          .filter(row => row.userId === userId)
          .sort((left, right) => right.id - left.id)[0] ?? null;
      },
      async getPendingOperationById(id: number) {
        return rows.get(id) ?? null;
      },
      async claimPendingOperation({ id, expectedVersion }: any) {
        const row = rows.get(id);
        if (!row || row.state !== "active" || row.version !== expectedVersion) {
          return { claimed: false };
        }
        row.state = "consumed";
        row.version += 1;
        row.consumedAt = new Date();
        return { claimed: true };
      },
      async cancelPendingOperation(id: number) {
        const row = rows.get(id);
        if (!row || row.state !== "active") return { cancelled: false };
        row.state = "cancelled";
        return { cancelled: true };
      },
      async supersedePendingOperation(id: number) {
        const row = rows.get(id);
        if (!row || row.state !== "active") return { superseded: false };
        row.state = "superseded";
        return { superseded: true };
      },
      async purgeInactiveOperations() {
        return 0;
      },
    },
  };
}

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

function createHarness() {
  const storage = createRepository();
  const meals: any[] = [];
  const processFood = vi.fn(async ({ text }: any) => ({
    detectedMealLabel: "Café da manhã",
    sourceText: text,
    confidence: 0.9,
    needsConfirmation: false,
    reasoning: "açúcar incorporado uma única vez",
    items: [sweetenedCoffeeItem()],
    totals: { calories: 22, protein: 0, carbs: 5, fat: 0 },
  }));
  const createMeal = vi.fn(async (userId: number, input: any) => {
    const meal = { id: meals.length + 1, userId, ...input };
    meals.push(meal);
    return meal;
  });
  const listMeals = vi.fn(async (userId: number) =>
    meals.filter(meal => meal.userId === userId)
  );
  const updateMeal = vi.fn(async (userId: number, input: any) => {
    const index = meals.findIndex(meal => meal.userId === userId && meal.id === input.mealId);
    const meal = { ...meals[index], ...input, id: input.mealId, userId };
    if (index >= 0) meals[index] = meal;
    return meal;
  });
  const removeMeal = vi.fn(async (userId: number, mealId: number) => {
    const index = meals.findIndex(meal => meal.userId === userId && meal.id === mealId);
    if (index >= 0) meals.splice(index, 1);
    return true;
  });

  const quantityService = createFoodQuantityClarificationService({
    repository: storage.repository as any,
  });
  const clarificationService = createWhatsappFoodClarificationService({
    repository: storage.repository as any,
    processFood: processFood as any,
    getHabits: vi.fn(async () => []) as any,
    createMeal: createMeal as any,
    listMeals: listMeals as any,
    updateMeal: updateMeal as any,
    removeMeal: removeMeal as any,
  });

  return {
    ...storage,
    meals,
    processFood,
    createMeal,
    quantityService,
    clarificationService,
  };
}

describe("lifecycle persistente do açúcar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mantém respostas incompatíveis, consome a válida e bloqueia reentrega sem duplicar", async () => {
    const harness = createHarness();
    const receivedAt = new Date("2026-07-24T12:00:00.000Z");
    await harness.quantityService.requestCaloricComplementQuantity({
      userId: 903,
      originalFoodText: "1 xícara de café com açúcar",
      operation: { kind: "register", occurredAt: receivedAt.toISOString() },
      receivedAt,
      messageId: "wamid-sugar-lifecycle",
    });

    const invalid = await harness.clarificationService.handle({
      userId: 903,
      text: "sim",
      receivedAt: new Date(receivedAt.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(invalid?.action).toBe("food_clarification_reprompted");
    expect(harness.createMeal).not.toHaveBeenCalled();
    const activeBeforeUnit = await harness.repository.getActivePendingOperation(
      903,
      new Date(receivedAt.getTime() + 1000),
    );
    expect(activeBeforeUnit).not.toBeNull();

    const invalidUnit = await harness.clarificationService.handle({
      userId: 903,
      text: "5 ml",
      receivedAt: new Date(receivedAt.getTime() + 2000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(invalidUnit?.action).toBe("food_clarification_reprompted");
    expect(invalidUnit?.eventType).toBe("whatsapp.food_clarification.invalid_component_unit");
    expect(harness.createMeal).not.toHaveBeenCalled();
    const activeAfterUnit = await harness.repository.getActivePendingOperation(
      903,
      new Date(receivedAt.getTime() + 2000),
    );
    expect(activeAfterUnit?.id).toBe(activeBeforeUnit?.id);
    expect(activeAfterUnit?.state).toBe("active");
    expect(activeAfterUnit?.version).toBe(1);

    const completed = await harness.clarificationService.handle({
      userId: 903,
      text: "5 g",
      receivedAt: new Date(receivedAt.getTime() + 3000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(completed?.action).toBe("food_clarification_completed");
    expect(completed?.reply).toContain("estado canônico recarregado");
    expect(harness.createMeal).toHaveBeenCalledTimes(1);
    expect(harness.meals[0].items[0]).toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      estimatedGrams: 205,
      calories: 22,
      carbs: 5,
    }));

    const replay = await harness.clarificationService.handle({
      userId: 903,
      text: "5 g",
      receivedAt: new Date(receivedAt.getTime() + 4000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(replay?.action).toBe("food_clarification_standalone_command_blocked");
    expect(harness.createMeal).toHaveBeenCalledTimes(1);
  });

  it("bloqueia a retomada de uma pendência expirada sem criar refeição", async () => {
    const harness = createHarness();
    const receivedAt = new Date("2026-07-24T12:00:00.000Z");
    await harness.quantityService.requestCaloricComplementQuantity({
      userId: 904,
      originalFoodText: "200 ml de café com açúcar",
      operation: { kind: "register", occurredAt: receivedAt.toISOString() },
      receivedAt,
      messageId: "wamid-sugar-expired",
    });

    const expired = await harness.clarificationService.handle({
      userId: 904,
      text: "5 g",
      receivedAt: new Date(receivedAt.getTime() + 11 * 60 * 1000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(expired?.action).toBe("food_clarification_standalone_command_blocked");
    expect(harness.createMeal).not.toHaveBeenCalled();
  });
});
