import { describe, expect, it, vi } from "vitest";
import type { WhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";
import { createFoodQuantityClarificationService } from "./foodQuantityClarification";
import { createWhatsappFoodClarificationService } from "./foodClarification";

const mocks = vi.hoisted(() => ({
  continuePlan: vi.fn(async () => ({
    handled: true,
    action: "meal_item_grams_adjusted",
    reply: "ok",
    eventType: "whatsapp.intent.meal_item_grams_adjusted",
    detail: "aplicado uma vez",
  })),
}));

vi.mock("./mixedMealItemIncrementPlan", () => ({
  continueMixedMealItemIncrementPlan: mocks.continuePlan,
}));

function createRepository() {
  const rows = new Map<number, any>();
  let sequence = 1;
  const claimPendingOperation = vi.fn(async ({ id, expectedVersion }) => {
    const row = rows.get(id);
    if (!row || row.state !== "active" || row.version !== expectedVersion) return { claimed: false };
    row.state = "consumed";
    row.version += 1;
    row.consumedAt = new Date();
    return { claimed: true };
  });
  const repository: WhatsAppPendingOperationRepository = {
    async createPendingOperation(input) {
      const now = input.now ?? new Date();
      const row = {
        id: sequence++,
        ...input,
        state: "active",
        version: 1,
        expiresAt: new Date(now.getTime() + input.ttlMs),
        createdAt: now,
        updatedAt: now,
        consumedAt: null,
      };
      rows.set(row.id, row);
      return row;
    },
    async getActivePendingOperation(userId, now = new Date()) {
      return [...rows.values()]
        .filter(row => row.userId === userId && row.state === "active" && row.expiresAt >= now)
        .sort((left, right) => right.id - left.id)[0] ?? null;
    },
    async getPendingOperationById(id) { return rows.get(id) ?? null; },
    claimPendingOperation,
    async cancelPendingOperation(id) {
      const row = rows.get(id);
      if (!row || row.state !== "active") return { cancelled: false };
      row.state = "cancelled";
      return { cancelled: true };
    },
    async supersedePendingOperation(id) {
      const row = rows.get(id);
      if (!row || row.state !== "active") return { superseded: false };
      row.state = "superseded";
      return { superseded: true };
    },
    async purgeInactiveOperations() { return 0; },
  };
  return { repository, rows, claimPendingOperation };
}

function mixedPlan() {
  return {
    contractVersion: 1 as const,
    originalText: "Adicionar 48g ao requeijão, 1 fatia ao presunto e uma na mussarela",
    mealLabel: null,
    timeZone: "America/Sao_Paulo",
    operations: [
      { targetFood: "requeijao", quantity: 48, unit: "g" as const, gramsDelta: 48 },
      { targetFood: "presunto", quantity: 1, unit: "fatia" as const },
      { targetFood: "mussarela", quantity: 1, unit: "fatia" as const, inheritedUnit: true },
    ],
  };
}

function clarificationHandler(repository: WhatsAppPendingOperationRepository) {
  return createWhatsappFoodClarificationService({
    repository,
    processFood: vi.fn() as never,
    getHabits: vi.fn(async () => []) as never,
    createMeal: vi.fn() as never,
    listMeals: vi.fn(async () => []) as never,
    updateMeal: vi.fn() as never,
    removeMeal: vi.fn() as never,
    createWhatsappMeal: vi.fn() as never,
  });
}

describe("issue #997 persistent mixed increment clarification", () => {
  it("usa receivedAt da interação para o TTL, sem confundir com occurredAt histórico da refeição", async () => {
    const { repository, rows } = createRepository();
    const clarification = createFoodQuantityClarificationService({ repository });
    const receivedAt = new Date("2026-08-22T20:00:00.000Z");
    const occurredAt = new Date("2026-08-01T12:00:00.000Z");

    await clarification.requestConfirmedTextMealQuantity({
      userId: 42,
      foodName: "ovo frito",
      originalText: "1 ovo frito",
      registrationSegments: ["1 ovo frito"],
      pendingItems: [{ segmentIndex: 0, segment: "1 ovo frito", foodName: "ovo frito", count: 1, requestedUnit: "un" }],
      currentPendingIndex: 0,
      occurredAt,
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid.issue997",
    });

    const row = [...rows.values()][0];
    expect(row.createdAt).toEqual(receivedAt);
    expect(row.target.resolutionContext.occurredAt).toBe(occurredAt.toISOString());
    expect(row.target.resolutionContext.receivedAt).toBe(receivedAt.toISOString());
    expect(row.target.resolutionContext.inboundMessageId).toBe("wamid.issue997");
  });

  it("resposta sem massa/volume não consome a pendência", async () => {
    const { repository, claimPendingOperation } = createRepository();
    const clarification = createFoodQuantityClarificationService({ repository });
    await clarification.requestMealItemIncrementQuantity({
      userId: 42,
      foodName: "Presunto",
      originalText: mixedPlan().originalText,
      plan: mixedPlan(),
      operationIndex: 1,
      receivedAt: new Date(),
    });

    const result = await clarificationHandler(repository).handle({
      userId: 42,
      text: "1 fatia",
      receivedAt: new Date(),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result?.action).toBe("food_clarification_requested");
    expect(claimPendingOperation).not.toHaveBeenCalled();
    expect(mocks.continuePlan).not.toHaveBeenCalled();
  });

  it("duas respostas concorrentes/retry continuam o plano exatamente uma vez", async () => {
    mocks.continuePlan.mockClear();
    const { repository, claimPendingOperation } = createRepository();
    const clarification = createFoodQuantityClarificationService({ repository });
    await clarification.requestMealItemIncrementQuantity({
      userId: 42,
      foodName: "Presunto",
      originalText: mixedPlan().originalText,
      plan: mixedPlan(),
      operationIndex: 1,
      receivedAt: new Date(),
    });

    const firstProcess = clarificationHandler(repository);
    const restartedProcess = clarificationHandler(repository);
    const [first, retry] = await Promise.all([
      firstProcess.handle({ userId: 42, text: "20 g", receivedAt: new Date(), userTimezone: "America/Sao_Paulo" }),
      restartedProcess.handle({ userId: 42, text: "20 g", receivedAt: new Date(), userTimezone: "America/Sao_Paulo" }),
    ]);

    expect(claimPendingOperation).toHaveBeenCalledTimes(2);
    expect(mocks.continuePlan).toHaveBeenCalledTimes(1);
    expect([first?.action, retry?.action]).toContain("meal_item_grams_adjusted");
  });
});
