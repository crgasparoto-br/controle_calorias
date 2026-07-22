import { describe, expect, it, vi } from "vitest";

vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resposta canônica."),
}));
vi.mock("./mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, meal) => ({ action: "created", meal })),
}));

import { createWhatsappFoodClarificationService } from "./foodClarification";
import {
  buildFoodClarificationActions,
  buildQuantityInstruction,
  getFoodClarificationInteractionId,
  isCompleteWhatsappCommand,
  type FoodClarificationCandidate,
  type PendingFoodClarificationTarget,
} from "./foodClarificationContract";

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

  const processFood = vi.fn(async ({ text }: any) => ({
    detectedMealLabel: "Lanche",
    sourceText: text,
    confidence: 0.95,
    needsConfirmation: false,
    reasoning: "teste",
    items: [{
      foodName: text,
      canonicalName: text,
      brand: null,
      quantity: 170,
      unit: "g",
      portionText: "170 g",
      servings: 1,
      estimatedGrams: 170,
      calories: 90,
      protein: 8,
      carbs: 10,
      fat: 1,
      confidence: 0.9,
      source: "catalog" as const,
    }],
    totals: { calories: 90, protein: 8, carbs: 10, fat: 1 },
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

function candidate(name: string): FoodClarificationCandidate {
  return {
    name,
    servingLabel: "100 g",
    gramsPerServing: 100,
    brandName: null,
    isBrandedProduct: false,
    matchKind: "exact",
  };
}

function selectionTarget(): PendingFoodClarificationTarget {
  const candidates = [candidate("Iogurte natural integral"), candidate("Iogurte natural desnatado")];
  return {
    contractVersion: 1,
    interactionId: getFoodClarificationInteractionId("selection"),
    kind: "food_registration_clarification",
    classification: "closed",
    pendingKind: "selection",
    originalText: "1 iorgute natural",
    sanitizedOriginalText: "1 iorgute natural",
    originalCandidate: "iorgute natural",
    normalizedCandidate: "iogurte natural",
    normalizationChanged: true,
    count: 1,
    qualifiers: ["natural"],
    candidates,
    selectedCandidateIndex: null,
    actions: buildFoodClarificationActions("selection", candidates),
    instructionText: "Escolha o iogurte.",
    inboundMessageId: "wamid.audit.855",
    allowedDomainEffect: "register_original_food_once",
  };
}

function quantityTarget(): PendingFoodClarificationTarget {
  const source = selectionTarget();
  return {
    ...source,
    interactionId: getFoodClarificationInteractionId("quantity"),
    pendingKind: "quantity",
    classification: "open",
    candidates: [],
    selectedCandidateIndex: null,
    actions: buildFoodClarificationActions("quantity", []),
    instructionText: buildQuantityInstruction(source.normalizedCandidate),
  };
}

describe("food clarification regressions found by audit", () => {
  it("preserva candidato escolhido e transiciona para o interactionId canônico de quantidade", async () => {
    const { service, repository, processFood, createMeal } = createHarness();
    const start = new Date("2026-07-21T20:00:00.000Z");
    const target = selectionTarget();
    await repository.createPendingOperation({
      userId: 42,
      type: "food_registration_clarification",
      origin: "foodClarification",
      target,
      ttlMs: 600_000,
      now: start,
    });

    const selected = await service.handle({
      userId: 42,
      text: "2.",
      receivedAt: new Date(start.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });
    const quantityInteractionId = getFoodClarificationInteractionId("quantity");
    expect(selected?.action).toBe("food_clarification_reprompted");
    expect(selected?.reply).toContain("Iogurte natural desnatado");
    expect(selected?.data).toEqual(expect.objectContaining({ interactionId: quantityInteractionId }));

    const pending = await repository.getActivePendingOperation(42, new Date(start.getTime() + 1000));
    expect(pending.target.interactionId).toBe(quantityInteractionId);
    expect(pending.target.pendingKind).toBe("quantity");
    expect(pending.target.selectedCandidateIndex).toBe(1);
    expect(pending.target.instructionText).toBe(buildQuantityInstruction("Iogurte natural desnatado"));

    const completed = await service.handle({
      userId: 42,
      text: "170 g.",
      receivedAt: new Date(start.getTime() + 2000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(completed?.action).toBe("food_clarification_completed");
    expect(completed?.data).toEqual(expect.objectContaining({ interactionId: quantityInteractionId }));
    expect(processFood).toHaveBeenCalledWith(expect.objectContaining({
      text: "170 g de Iogurte natural desnatado",
    }));
    expect(createMeal).toHaveBeenCalledTimes(1);
  });

  it("reconhece nova refeição completa sem exigir verbo operacional", async () => {
    const { service, repository, processFood } = createHarness();
    const start = new Date("2026-07-21T20:00:00.000Z");
    const target = quantityTarget();
    await repository.createPendingOperation({
      userId: 42,
      type: "food_registration_clarification",
      origin: "foodClarification",
      target,
      ttlMs: 600_000,
      now: start,
    });

    expect(isCompleteWhatsappCommand("200 g de frango")).toBe(true);
    expect(isCompleteWhatsappCommand("1 banana")).toBe(true);
    expect(isCompleteWhatsappCommand("170 g")).toBe(false);

    const resolved = await service.handle({
      userId: 42,
      text: "200 g de frango",
      receivedAt: new Date(start.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(resolved).toBeNull();
    expect(processFood).not.toHaveBeenCalled();
    expect(await repository.getActivePendingOperation(42, new Date(start.getTime() + 1000))).toBeNull();
  });

  it("restaura falha anterior à mutação com o interactionId canônico do pendingKind", async () => {
    const { service, repository, processFood } = createHarness();
    const start = new Date("2026-07-21T20:00:00.000Z");
    const target = quantityTarget();
    await repository.createPendingOperation({
      userId: 42,
      type: "food_registration_clarification",
      origin: "foodClarification",
      target,
      ttlMs: 600_000,
      now: start,
    });
    processFood.mockRejectedValueOnce(new Error("provider indisponível"));

    const retryResult = await service.handle({
      userId: 42,
      text: "170 g",
      receivedAt: new Date(start.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });
    const quantityInteractionId = getFoodClarificationInteractionId("quantity");
    expect(retryResult?.action).toBe("food_clarification_retryable_failure");
    expect(retryResult?.data).toEqual(expect.objectContaining({ interactionId: quantityInteractionId }));
    const restored = await repository.getActivePendingOperation(42, new Date(start.getTime() + 1000));
    expect(restored.target.interactionId).toBe(quantityInteractionId);
    expect(restored.target.pendingKind).toBe("quantity");
  });

  it.each(["registrar!", "confirmar.", "170 g.", "opção 2."])(
    "bloqueia resposta isolada com pontuação: %s",
    async text => {
      const { service, processFood, createMeal } = createHarness();
      const blocked = await service.handle({
        userId: 42,
        text,
        receivedAt: new Date("2026-07-21T20:00:00.000Z"),
        userTimezone: "America/Sao_Paulo",
      });
      expect(blocked?.action).toBe("food_clarification_standalone_command_blocked");
      expect(processFood).not.toHaveBeenCalled();
      expect(createMeal).not.toHaveBeenCalled();
    },
  );

  it("aceita cancelamento textual com pontuação sem persistir", async () => {
    const { service, repository, processFood } = createHarness();
    const start = new Date("2026-07-21T20:00:00.000Z");
    await repository.createPendingOperation({
      userId: 42,
      type: "food_registration_clarification",
      origin: "foodClarification",
      target: selectionTarget(),
      ttlMs: 600_000,
      now: start,
    });
    const cancelled = await service.handle({
      userId: 42,
      text: "cancelar.",
      receivedAt: new Date(start.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(cancelled?.action).toBe("food_clarification_cancelled");
    expect(processFood).not.toHaveBeenCalled();
  });
});
