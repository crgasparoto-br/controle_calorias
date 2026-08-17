import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Alimento registrado com estado canônico."),
}));

vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, savedMeal) => ({ action: "created", meal: savedMeal })),
}));

import {
  createWhatsappFoodClarificationService,
  hasSafeCanonicalPortion,
  isPendingFoodClarificationTarget,
  parseCountedFoodRequest,
  PENDING_FOOD_CLARIFICATION_TYPE,
} from "./foodClarification";

function createRepository() {
  let nextId = 1;
  const rows = new Map<number, any>();

  const repository = {
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
        .filter(row => row.userId === userId && row.state === "active" && row.expiresAt.getTime() >= now.getTime())
        .sort((left, right) => right.id - left.id)[0] ?? null;
    },
    async getPendingOperationById(id: number) {
      return rows.get(id) ?? null;
    },
    async claimPendingOperation({ id, expectedVersion }: any) {
      const row = rows.get(id);
      if (!row || row.state !== "active" || row.version !== expectedVersion) return { claimed: false };
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
  };

  return { repository, rows };
}

function mealItem(foodName = "Iogurte Natural Desnatado") {
  return {
    foodName,
    canonicalName: foodName,
    brand: null,
    quantity: 170,
    unit: "g",
    portionText: "170 g",
    servings: 1.7,
    estimatedGrams: 170,
    calories: 90,
    protein: 8,
    carbs: 10,
    fat: 1,
    confidence: 0.9,
    source: "catalog" as const,
  };
}

function createHarness() {
  const { repository, rows } = createRepository();
  const meals: any[] = [];
  const processFood = vi.fn(async ({ text }: any) => ({
    detectedMealLabel: "Lanche",
    sourceText: text,
    confidence: 0.9,
    needsConfirmation: false,
    reasoning: "teste",
    items: [mealItem()],
    totals: { calories: 90, protein: 8, carbs: 10, fat: 1 },
  }));
  const createMeal = vi.fn(async (userId: number, input: any) => {
    const meal = { id: meals.length + 1, userId, ...input };
    meals.push(meal);
    return meal;
  });
  const listMeals = vi.fn(async (userId: number) => meals.filter(meal => meal.userId === userId));
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

  const service = createWhatsappFoodClarificationService({
    repository: repository as any,
    processFood: processFood as any,
    getHabits: vi.fn(async () => []) as any,
    createMeal: createMeal as any,
    listMeals: listMeals as any,
    updateMeal: updateMeal as any,
    removeMeal: removeMeal as any,
  });

  return { service, repository, rows, processFood, createMeal, meals };
}

describe("foodClarification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserva texto original e normaliza erro ortográfico simples", () => {
    expect(parseCountedFoodRequest("1 iogurte natual desnatado")).toEqual({
      originalText: "1 iogurte natual desnatado",
      originalCandidate: "iogurte natual desnatado",
      normalizedCandidate: "iogurte natural desnatado",
      normalizationChanged: true,
      count: 1,
    });
  });

  it("aceita unidade canônica exata e rejeita referência genérica de 100 g", () => {
    expect(hasSafeCanonicalPortion({
      name: "Banana",
      servingLabel: "1 unidade",
      gramsPerServing: 86,
      brandName: null,
      isBrandedProduct: false,
      matchKind: "exact",
    })).toBe(true);
    expect(hasSafeCanonicalPortion({
      name: "Iogurte genérico",
      servingLabel: "100 g",
      gramsPerServing: 100,
      brandName: null,
      isBrandedProduct: false,
      matchKind: "exact",
    })).toBe(false);
    expect(hasSafeCanonicalPortion({
      name: "Produto semelhante",
      servingLabel: "1 unidade",
      gramsPerServing: 80,
      brandName: null,
      isBrandedProduct: false,
      matchKind: "fallback",
    })).toBe(false);
  });

  it("cria pergunta específica e pendência persistida para iogurte sem porção segura", async () => {
    const { service, repository, processFood } = createHarness();
    const receivedAt = new Date("2026-07-21T15:00:00.000Z");

    const response = await service.handle({
      userId: 42,
      text: "1 iogurte natual desnatado",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid.855",
    });

    expect(response).toEqual(expect.objectContaining({
      action: "food_clarification_requested",
      reply: expect.stringContaining("iogurte natural desnatado"),
      data: expect.objectContaining({
        classification: "open",
        pendingKind: "quantity",
        originalTextPreserved: true,
        normalizedCandidate: "iogurte natural desnatado",
        inboundMessageId: "wamid.855",
      }),
    }));
    const pending = await repository.getActivePendingOperation(42, receivedAt);
    expect(pending?.type).toBe(PENDING_FOOD_CLARIFICATION_TYPE);
    expect(isPendingFoodClarificationTarget(pending?.target)).toBe(true);
    expect((pending?.target as any).originalText).toBe("1 iogurte natual desnatado");
    expect(processFood).not.toHaveBeenCalled();
  });

  it("não consome quantidade pendente com registrar e conclui somente com 170 g", async () => {
    const { service, repository, processFood, createMeal } = createHarness();
    const receivedAt = new Date("2026-07-21T15:00:00.000Z");
    await service.handle({ userId: 42, text: "1 iogurte natual desnatado", receivedAt, userTimezone: "America/Sao_Paulo" });

    const incompatible = await service.handle({
      userId: 42,
      text: "registrar",
      receivedAt: new Date(receivedAt.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(incompatible?.action).toBe("food_clarification_reprompted");
    expect(processFood).not.toHaveBeenCalled();
    expect((await repository.getActivePendingOperation(42, new Date(receivedAt.getTime() + 1000)))?.state).toBe("active");

    const completed = await service.handle({
      userId: 42,
      text: "170 g",
      receivedAt: new Date(receivedAt.getTime() + 2000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(completed?.action).toBe("food_clarification_completed");
    expect(processFood).toHaveBeenCalledWith(expect.objectContaining({ text: "170 g de iogurte natural desnatado" }));
    expect(createMeal).toHaveBeenCalledTimes(1);
    expect(await repository.getActivePendingOperation(42, new Date(receivedAt.getTime() + 2000))).toBeNull();
  });

  it("não captura um novo comando completo como complemento da pendência", async () => {
    const { service, repository, processFood } = createHarness();
    const receivedAt = new Date("2026-07-21T15:00:00.000Z");
    await service.handle({ userId: 42, text: "1 alimento desconhecido", receivedAt, userTimezone: "America/Sao_Paulo" });

    const response = await service.handle({
      userId: 42,
      text: "registrar 100 g de arroz",
      receivedAt: new Date(receivedAt.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(response).toBeNull();
    expect(processFood).not.toHaveBeenCalled();
    expect(await repository.getActivePendingOperation(42, new Date(receivedAt.getTime() + 1000))).toBeNull();
  });

  it("isola pendências entre usuários", async () => {
    const { service, repository } = createHarness();
    const receivedAt = new Date("2026-07-21T15:00:00.000Z");
    await service.handle({ userId: 42, text: "1 alimento desconhecido", receivedAt, userTimezone: "America/Sao_Paulo" });

    const otherUser = await service.handle({
      userId: 99,
      text: "registrar",
      receivedAt: new Date(receivedAt.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(otherUser?.action).toBe("food_clarification_standalone_command_blocked");
    expect(await repository.getActivePendingOperation(42, new Date(receivedAt.getTime() + 1000))).not.toBeNull();
    expect(await repository.getActivePendingOperation(99, new Date(receivedAt.getTime() + 1000))).toBeNull();
  });
});
