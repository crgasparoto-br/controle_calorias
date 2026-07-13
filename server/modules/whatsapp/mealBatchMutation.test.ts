import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMealMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({ updateMeal: updateMealMock }));

import {
  MealBatchMutationError,
  describeMealBatchMutationFailure,
  updateMealsWithCompensation,
  type MealBatchMutationChange,
} from "./mealBatchMutation";

function serviceOptionsAt(callIndex: number) {
  const input = updateMealMock.mock.calls[callIndex]?.[1] as Record<PropertyKey, unknown> | undefined;
  const symbol = input
    ? Object.getOwnPropertySymbols(input).find(candidate => candidate.description === "controle_calorias.mealUpdateServiceOptions")
    : undefined;
  return symbol && input ? input[symbol] : undefined;
}

function item(foodName: string, grams: number) {
  return {
    foodName,
    canonicalName: foodName,
    portionText: `${grams} g`,
    quantity: grams,
    unit: "g",
    servings: 1,
    estimatedGrams: grams,
    calories: grams,
    protein: 5,
    carbs: 10,
    fat: 2,
    confidence: 0.9,
    source: "catalog" as const,
  };
}

function snapshot(id: number, mealLabel: string, foodName: string, grams: number) {
  return {
    id,
    mealLabel,
    occurredAt: "2026-07-12T16:00:00.000Z",
    notes: null,
    items: [item(foodName, grams)],
  };
}

describe("meal batch mutation compensation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restaura todas as refeições tentadas quando uma atualização intermediária falha", async () => {
    const beforeFirst = snapshot(10, "Jantar", "Arroz branco", 100);
    const beforeSecond = snapshot(20, "Almoço", "Feijão carioca", 80);
    const afterFirst = snapshot(10, "Jantar", "Arroz branco", 120);
    const afterSecond = snapshot(20, "Almoço", "Feijão carioca", 90);
    const state = new Map([
      [10, beforeFirst],
      [20, beforeSecond],
    ]);
    let failSecondUpdateOnce = true;

    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, any>) => {
      const grams = Number(input.items[0].estimatedGrams);
      if (input.mealId === 20 && grams === 90 && failSecondUpdateOnce) {
        failSecondUpdateOnce = false;
        throw new Error("falha simulada na segunda refeição");
      }
      const saved = {
        id: Number(input.mealId),
        mealLabel: String(input.mealLabel),
        occurredAt: String(input.occurredAt),
        notes: input.notes ?? null,
        items: input.items,
      };
      state.set(saved.id, saved);
      return saved;
    });

    const changes: MealBatchMutationChange[] = [
      { before: beforeFirst, after: afterFirst },
      { before: beforeSecond, after: afterSecond },
    ];

    const operation = updateMealsWithCompensation(42, changes);

    await expect(operation).rejects.toMatchObject({
      name: "MealBatchMutationError",
      rollbackSucceeded: true,
    });
    expect(state.get(10)?.items[0].estimatedGrams).toBe(100);
    expect(state.get(20)?.items[0].estimatedGrams).toBe(80);
    expect(updateMealMock).toHaveBeenCalledTimes(4);
    expect(serviceOptionsAt(0)).toMatchObject({
      recordCatalogUsage: false,
      updateHabits: false,
      logEvent: false,
      finalizeBatch: undefined,
    });
    expect(serviceOptionsAt(1)).toMatchObject({
      finalizeBatch: expect.objectContaining({
        meals: expect.arrayContaining([
          expect.objectContaining({ items: afterFirst.items }),
          expect.objectContaining({ items: afterSecond.items }),
        ]),
      }),
    });
    expect(serviceOptionsAt(3)).toMatchObject({
      finalizeBatch: expect.objectContaining({
        recordCatalogUsage: false,
        throwOnHabitFailure: true,
      }),
    });
  });

  it("finaliza efeitos derivados somente na última escrita de um lote bem-sucedido", async () => {
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: input.mealId,
      ...input,
    }));

    await updateMealsWithCompensation(42, [
      { before: snapshot(10, "Jantar", "Arroz branco", 100), after: snapshot(10, "Jantar", "Arroz branco", 120) },
      { before: snapshot(20, "Almoço", "Feijão carioca", 80), after: snapshot(20, "Almoço", "Feijão carioca", 90) },
    ]);

    expect(updateMealMock).toHaveBeenCalledTimes(2);
    expect(serviceOptionsAt(0)).toMatchObject({ finalizeBatch: undefined });
    expect(serviceOptionsAt(1)).toMatchObject({
      recordCatalogUsage: false,
      updateHabits: false,
      logEvent: false,
      finalizeBatch: expect.objectContaining({ recordCatalogUsage: undefined }),
    });
  });

  it("não afirma restauração completa quando uma compensação também falha", () => {
    const failure = new MealBatchMutationError(new Error("write"), [new Error("rollback")]);
    const description = describeMealBatchMutationFailure(failure);

    expect(description.rollbackSucceeded).toBe(false);
    expect(description.userMessage).toContain("Consulte suas refeições atuais");
  });
});
