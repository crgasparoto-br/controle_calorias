import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIssue874ClarificationService } from "./issue874Clarification";
import { createWhatsappFoodClarificationService } from "./foodClarification";
import type { WhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";

function createRepository(): WhatsAppPendingOperationRepository {
  const rows = new Map<number, any>();
  let sequence = 1;
  return {
    async createPendingOperation(input) {
      const row = {
        id: sequence++,
        ...input,
        state: "active",
        version: 1,
        expiresAt: new Date((input.now ?? new Date()).getTime() + input.ttlMs),
        createdAt: input.now ?? new Date(),
        updatedAt: input.now ?? new Date(),
        consumedAt: null,
      };
      rows.set(row.id, row);
      return row;
    },
    async getActivePendingOperation(userId, now = new Date()) {
      return (
        [...rows.values()]
          .filter(
            row =>
              row.userId === userId &&
              row.state === "active" &&
              row.expiresAt >= now
          )
          .sort((left, right) => right.id - left.id)[0] ?? null
      );
    },
    async getPendingOperationById(id) {
      return rows.get(id) ?? null;
    },
    async claimPendingOperation({ id, expectedVersion }) {
      const row = rows.get(id);
      if (!row || row.state !== "active" || row.version !== expectedVersion)
        return { claimed: false };
      row.state = "consumed";
      row.version += 1;
      row.consumedAt = new Date();
      return { claimed: true };
    },
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
    async purgeInactiveOperations() {
      return 0;
    },
  };
}

const originalMeal = {
  id: 31,
  userId: 42,
  source: "whatsapp" as const,
  mealLabel: "Lanche",
  occurredAt: new Date("2026-07-22T15:00:00.000Z").getTime(),
  notes: "Registro por imagem",
  items: [
    {
      foodName: "30G",
      canonicalName: "1 porção",
      portionText: "30 g",
      quantity: 30,
      unit: "g",
      servings: 1,
      estimatedGrams: 30,
      calories: 150,
      protein: 6,
      carbs: 15,
      fat: 5,
      confidence: 0.3,
      source: "heuristic" as const,
    },
  ],
};

describe("issue 874 persistent quantity clarification", () => {
  const repository = createRepository();
  const listMeals = vi.fn();
  const updateMeal = vi.fn();

  beforeEach(() => {
    listMeals.mockReset();
    updateMeal.mockReset();
    listMeals.mockResolvedValue([originalMeal]);
    updateMeal.mockImplementation(async (_userId, input) => ({
      ...originalMeal,
      ...input,
    }));
  });

  it("combina alimento e quantidade em duas mensagens e confirma o estado corrigido", async () => {
    const clarification = createIssue874ClarificationService({ repository });
    const requested = await clarification.requestLatestFoodCorrectionQuantity({
      userId: 42,
      mealId: 31,
      itemIndex: 0,
      originalFoodName: "30G",
      replacementFoodName: "queijo parmesão polenghi",
      receivedAt: new Date("2026-07-22T15:05:00.000Z"),
    });
    expect(requested.action).toBe("food_clarification_requested");

    const foodService = createWhatsappFoodClarificationService({
      repository,
      processFood: vi.fn() as never,
      getHabits: vi.fn(async () => []) as never,
      createMeal: vi.fn() as never,
      listMeals: listMeals as never,
      updateMeal: updateMeal as never,
      removeMeal: vi.fn() as never,
    });
    const completed = await foodService.handle({
      userId: 42,
      text: "30g",
      receivedAt: new Date("2026-07-22T15:06:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(updateMeal).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        mealId: 31,
        items: [
          expect.objectContaining({
            foodName: "queijo parmesão polenghi",
            quantity: 30,
            unit: "g",
            estimatedGrams: 30,
          }),
        ],
      })
    );
    expect(completed).toEqual(
      expect.objectContaining({
        action: "meal_item_replaced",
        eventType: "whatsapp.intent.meal_item_replaced",
        data: expect.objectContaining({ mealId: 31 }),
      })
    );
    expect(completed?.reply).toContain("Alimento substituído");
    expect(completed?.reply).toContain("queijo parmesão polenghi");
  });

  it("cria pendência de quantidade para alimento identificado por imagem", async () => {
    const clarification = createIssue874ClarificationService({ repository });
    const result = await clarification.requestImageFoodQuantity({
      userId: 77,
      foodName: "Banana prata",
      receivedAt: new Date("2026-07-22T12:00:00.000Z"),
      messageId: "wamid.image874",
    });
    expect(result).toEqual(
      expect.objectContaining({
        action: "food_clarification_requested",
        eventType: "whatsapp.food_clarification.requested",
        data: expect.objectContaining({ pendingKind: "quantity" }),
      })
    );
    expect(result.reply).toMatch(/Banana prata|peso|volume|tamanho/i);
    expect(
      await repository.getActivePendingOperation(
        77,
        new Date("2026-07-22T12:01:00.000Z")
      )
    ).toEqual(
      expect.objectContaining({
        type: "food_registration_clarification",
        state: "active",
      })
    );
  });
});
