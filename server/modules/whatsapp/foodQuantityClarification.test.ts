import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFoodQuantityClarificationService } from "./foodQuantityClarification";
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
  const createWhatsappMeal = vi.fn();

  beforeEach(() => {
    listMeals.mockReset();
    updateMeal.mockReset();
    createWhatsappMeal.mockReset();
    listMeals.mockResolvedValue([originalMeal]);
    updateMeal.mockImplementation(async (_userId, input) => ({
      ...originalMeal,
      ...input,
    }));
  });

  it("combina alimento e quantidade em duas mensagens e confirma o estado corrigido", async () => {
    const clarification = createFoodQuantityClarificationService({
      repository,
    });
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
      processFood: vi.fn(async () => ({
        detectedMealLabel: "Lanche",
        sourceText: "30 g de queijo parmesão polenghi",
        confidence: 0.95,
        needsConfirmation: false,
        reasoning: "Referência canônica resolvida.",
        items: [
          {
            ...originalMeal.items[0],
            foodName: "Queijo parmesão Polenghi",
            canonicalName: "Queijo parmesão Polenghi",
            quantity: 30,
            unit: "g",
            portionText: "30 g",
            estimatedGrams: 30,
            calories: 126,
            protein: 10,
            carbs: 1,
            fat: 9,
            source: "catalog" as const,
          },
        ],
        totals: { calories: 126, protein: 10, carbs: 1, fat: 9 },
      })) as never,
      getHabits: vi.fn(async () => []) as never,
      createMeal: vi.fn() as never,
      listMeals: listMeals as never,
      updateMeal: updateMeal as never,
      removeMeal: vi.fn() as never,
      createWhatsappMeal: createWhatsappMeal as never,
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
            calories: 126,
            protein: 10,
            carbs: 1,
            fat: 9,
            source: "catalog",
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

  it("preserva múltiplos alimentos e conclui quantidades em sequência", async () => {
    const clarification = createFoodQuantityClarificationService({
      repository,
    });
    const occurredAt = new Date("2026-07-22T12:00:00.000Z");
    const requested = await clarification.requestImageMealQuantity({
      userId: 88,
      detectedMealLabel: "Almoço",
      sourceText: "Imagem com arroz e frango",
      reasoning: "Dois alimentos identificados sem porção.",
      confidence: 0.9,
      occurredAt,
      items: [
        {
          ...originalMeal.items[0],
          foodName: "Arroz branco",
          canonicalName: "Arroz branco",
          portionText: "porção não informada",
          estimatedGrams: 0,
        },
        {
          ...originalMeal.items[0],
          foodName: "Frango grelhado",
          canonicalName: "Frango grelhado",
          portionText: "porção não informada",
          estimatedGrams: 0,
        },
      ],
      media: [],
      pendingItemIndexes: [0, 1],
    });
    expect(requested.reply).toContain("1 de 2");

    const processFood = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            ...originalMeal.items[0],
            foodName: "Arroz branco",
            canonicalName: "Arroz branco",
            quantity: 100,
            unit: "g",
            portionText: "100 g",
            estimatedGrams: 100,
            calories: 130,
            protein: 2.5,
            carbs: 28,
            fat: 0.3,
            source: "catalog" as const,
          },
        ],
      })
      .mockResolvedValueOnce({
        items: [
          {
            ...originalMeal.items[0],
            foodName: "Frango grelhado",
            canonicalName: "Frango grelhado",
            quantity: 120,
            unit: "g",
            portionText: "120 g",
            estimatedGrams: 120,
            calories: 198,
            protein: 37,
            carbs: 0,
            fat: 4.3,
            source: "catalog" as const,
          },
        ],
      });
    createWhatsappMeal.mockImplementation(async (_userId, input) => ({
      ...originalMeal,
      id: 880,
      mealLabel: input.detectedMealLabel,
      occurredAt: new Date(input.occurredAt).getTime(),
      items: input.items,
    }));
    listMeals.mockResolvedValue([]);
    const foodService = createWhatsappFoodClarificationService({
      repository,
      processFood: processFood as never,
      getHabits: vi.fn(async () => []) as never,
      createMeal: vi.fn() as never,
      listMeals: listMeals as never,
      updateMeal: updateMeal as never,
      removeMeal: vi.fn() as never,
      createWhatsappMeal: createWhatsappMeal as never,
    });

    const first = await foodService.handle({
      userId: 88,
      text: "100g",
      receivedAt: new Date("2026-07-22T12:01:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });
    expect(first?.action).toBe("food_clarification_requested");
    expect(first?.reply).toContain("2 de 2");
    expect(createWhatsappMeal).not.toHaveBeenCalled();

    const second = await foodService.handle({
      userId: 88,
      text: "120g",
      receivedAt: new Date("2026-07-22T12:02:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });
    expect(second?.action).toBe("food_clarification_completed");
    expect(createWhatsappMeal).toHaveBeenCalledWith(
      88,
      expect.objectContaining({
        items: [
          expect.objectContaining({ foodName: "Arroz branco", calories: 130 }),
          expect.objectContaining({
            foodName: "Frango grelhado",
            calories: 198,
          }),
        ],
      })
    );
  });

  it("cria pendência de quantidade para alimento identificado por imagem", async () => {
    const clarification = createFoodQuantityClarificationService({
      repository,
    });
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
