import { describe, expect, it, vi } from "vitest";

vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resposta canônica."),
}));
vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, meal) => ({ action: "created", meal })),
}));

import { createWhatsappFoodClarificationService } from "./foodClarification";
import { isCompleteWhatsappCommand } from "./foodClarificationContract";

function createHarness() {
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
        origin: input.origin,
        target: input.target,
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

  const processFood = vi.fn(async () => ({
    detectedMealLabel: "Refeição",
    sourceText: "",
    confidence: 0.9,
    needsConfirmation: false,
    reasoning: "teste",
    items: [],
    totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
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
    updateMeal: vi.fn(async (userId: number, input: any) => ({ id: input.mealId, userId, ...input })) as any,
    removeMeal: vi.fn(async () => true) as any,
  });

  return { service, repository, rows, processFood, createMeal };
}

describe("issue #855 - nova refeição em texto livre durante clarificação", () => {
  it.each([
    "arroz com frango",
    "jantar: arroz e frango",
    "pão com queijo e café",
  ])("reconhece como nova mensagem alimentar completa: %s", text => {
    expect(isCompleteWhatsappCommand(text)).toBe(true);
  });

  it.each([
    "talvez",
    "registrar",
    "170 g",
    "opção 2",
  ])("não promove resposta curta ou quantidade isolada a nova refeição: %s", text => {
    expect(isCompleteWhatsappCommand(text)).toBe(false);
  });

  it.each([
    "arroz com frango",
    "jantar: arroz e frango",
    "pão com queijo e café",
  ])("substitui a pendência e devolve %s ao roteador sem mutação antecipada", async text => {
    const { service, repository, rows, processFood, createMeal } = createHarness();
    const start = new Date("2026-07-21T20:00:00.000Z");

    const requested = await service.handle({
      userId: 42,
      text: "1 iogurte natural desnatado",
      receivedAt: start,
      userTimezone: "America/Sao_Paulo",
    });
    expect(requested?.action).toBe("food_clarification_requested");

    const result = await service.handle({
      userId: 42,
      text,
      receivedAt: new Date(start.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toBeNull();
    expect(await repository.getActivePendingOperation(42, new Date(start.getTime() + 1000))).toBeNull();
    expect([...rows.values()].some(row => row.state === "superseded")).toBe(true);
    expect(processFood).not.toHaveBeenCalled();
    expect(createMeal).not.toHaveBeenCalled();
  });

  it("mantém a pendência para texto incompatível que não é uma nova refeição", async () => {
    const { service, repository, processFood } = createHarness();
    const start = new Date("2026-07-21T20:00:00.000Z");
    await service.handle({
      userId: 42,
      text: "1 iogurte natural desnatado",
      receivedAt: start,
      userTimezone: "America/Sao_Paulo",
    });

    const result = await service.handle({
      userId: 42,
      text: "talvez",
      receivedAt: new Date(start.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result?.action).toBe("food_clarification_reprompted");
    expect(await repository.getActivePendingOperation(42, new Date(start.getTime() + 1000))).not.toBeNull();
    expect(processFood).not.toHaveBeenCalled();
  });
});
