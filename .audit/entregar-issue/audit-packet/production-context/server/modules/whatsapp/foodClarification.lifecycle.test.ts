import { describe, expect, it, vi } from "vitest";

vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resposta canônica da refeição."),
}));
vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, meal) => ({ action: "created", meal })),
}));

import {
  createWhatsappFoodClarificationService,
  PENDING_FOOD_CLARIFICATION_TTL_MS,
} from "./foodClarification";

function createLifecycleHarness() {
  let nextId = 1;
  const rows = new Map<number, any>();
  const meals: any[] = [];
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
      return [...rows.values()].filter(row => (
        row.userId === userId
        && row.state === "active"
        && row.expiresAt.getTime() >= now.getTime()
      )).sort((a, b) => b.id - a.id)[0] ?? null;
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
      row.version += 1;
      return { cancelled: true };
    },
    async supersedePendingOperation(id: number) {
      const row = rows.get(id);
      if (!row || row.state !== "active") return { superseded: false };
      row.state = "superseded";
      row.version += 1;
      return { superseded: true };
    },
    async purgeInactiveOperations() {
      return 0;
    },
  };

  const processFood = vi.fn(async ({ text }: any) => ({
    detectedMealLabel: "Lanche",
    sourceText: text,
    confidence: 0.95,
    needsConfirmation: false,
    reasoning: "teste",
    items: [{
      foodName: "Alimento resolvido",
      canonicalName: "Alimento resolvido",
      brand: null,
      quantity: 1,
      unit: "unidade",
      portionText: "1 unidade",
      servings: 1,
      estimatedGrams: 40,
      calories: 100,
      protein: 2,
      carbs: 10,
      fat: 5,
      confidence: 0.9,
      source: "catalog",
    }],
    totals: { calories: 100, protein: 2, carbs: 10, fat: 5 },
  }));
  const createMeal = vi.fn(async (userId: number, input: any) => {
    const meal = { id: meals.length + 1, userId, ...input };
    meals.push(meal);
    return meal;
  });

  const service = createWhatsappFoodClarificationService({
    repository: repository as any,
    processFood: processFood as any,
    getHabits: vi.fn(async () => []) as any,
    createMeal: createMeal as any,
    listMeals: vi.fn(async (userId: number) => meals.filter(meal => meal.userId === userId)) as any,
    updateMeal: vi.fn(async (_userId: number, input: any) => ({ id: input.mealId, ...input })) as any,
    removeMeal: vi.fn(async () => true) as any,
  });

  return { service, repository, rows, processFood, createMeal };
}

describe("foodClarification lifecycle", () => {
  it("cancela sem registrar e mantém o texto somente para auditoria da operação", async () => {
    const { service, repository, processFood } = createLifecycleHarness();
    const start = new Date("2026-07-21T15:00:00.000Z");
    await service.handle({ userId: 1, text: "1 iogurte natual desnatado", receivedAt: start, userTimezone: "America/Sao_Paulo" });

    const cancelled = await service.handle({
      userId: 1,
      text: "cancelar",
      receivedAt: new Date(start.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(cancelled?.action).toBe("food_clarification_cancelled");
    expect(processFood).not.toHaveBeenCalled();
    expect(await repository.getActivePendingOperation(1, new Date(start.getTime() + 1000))).toBeNull();
  });

  it("bloqueia quantidade solta após expiração sem criar alimento parcial", async () => {
    const { service, processFood, createMeal } = createLifecycleHarness();
    const start = new Date("2026-07-21T15:00:00.000Z");
    await service.handle({ userId: 1, text: "1 iogurte natural desnatado", receivedAt: start, userTimezone: "America/Sao_Paulo" });

    const afterExpiry = await service.handle({
      userId: 1,
      text: "170 g",
      receivedAt: new Date(start.getTime() + PENDING_FOOD_CLARIFICATION_TTL_MS + 1),
      userTimezone: "America/Sao_Paulo",
    });

    expect(afterExpiry?.action).toBe("food_clarification_standalone_command_blocked");
    expect(processFood).not.toHaveBeenCalled();
    expect(createMeal).not.toHaveBeenCalled();
  });

  it("resposta repetida não duplica registro depois do claim", async () => {
    const { service, processFood, createMeal } = createLifecycleHarness();
    const start = new Date("2026-07-21T15:00:00.000Z");
    await service.handle({ userId: 1, text: "1 iogurte natual desnatado", receivedAt: start, userTimezone: "America/Sao_Paulo" });
    await service.handle({ userId: 1, text: "170 g", receivedAt: new Date(start.getTime() + 1000), userTimezone: "America/Sao_Paulo" });

    const repeated = await service.handle({
      userId: 1,
      text: "170 g",
      receivedAt: new Date(start.getTime() + 2000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(repeated?.action).toBe("food_clarification_standalone_command_blocked");
    expect(processFood).toHaveBeenCalledTimes(1);
    expect(createMeal).toHaveBeenCalledTimes(1);
  });

  it("alimento exato com porção canônica usa a contagem pelo domínio", async () => {
    const { service, processFood, createMeal } = createLifecycleHarness();
    const result = await service.handle({
      userId: 1,
      text: "2 kit kat",
      receivedAt: new Date("2026-07-21T15:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result?.action).toBe("food_clarification_completed");
    expect(processFood).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringMatching(/^2\s+unidade(?:s)?\s+de\s+Kit Kat/i),
    }));
    expect(createMeal).toHaveBeenCalledTimes(1);
  });
});
