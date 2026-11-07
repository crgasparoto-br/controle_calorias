import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMealMock = vi.hoisted(() => vi.fn());
const UPDATE_OPTIONS = Symbol.for("controle_calorias.mealUpdateServiceOptions");
const MUTATION_PRE_IMAGE = Symbol.for("controle_calorias.mealMutationPreImage");

vi.mock("../meals/service", () => ({
  updateMeal: updateMealMock,
  MEAL_UPDATE_SERVICE_OPTIONS: Symbol.for(
    "controle_calorias.mealUpdateServiceOptions"
  ),
  getMealMutationPreImage: (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const token = (value as Record<PropertyKey, unknown>)[
      Symbol.for("controle_calorias.mealMutationPreImage")
    ];
    return typeof token === "string" ? token : null;
  },
}));

import {
  MealBatchMutationError,
  describeMealBatchMutationFailure,
  updateMealsWithCompensation,
  type MealBatchMutationChange,
} from "./mealBatchMutation";

function serviceOptionsAt(callIndex: number) {
  const input = updateMealMock.mock.calls[callIndex]?.[1] as
    | Record<PropertyKey, unknown>
    | undefined;
  return input?.[UPDATE_OPTIONS] as Record<string, unknown> | undefined;
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

function snapshot(
  id: number,
  mealLabel: string,
  foodName: string,
  grams: number
) {
  return {
    id,
    mealLabel,
    occurredAt: "2026-07-12T16:00:00.000Z",
    notes: null,
    mutationPreImage: id.toString(16).padStart(64, "0"),
    items: [item(foodName, grams)],
  };
}

function attachPostImage<T extends object>(value: T, token: string) {
  Object.defineProperty(value, MUTATION_PRE_IMAGE, { value: token });
  return value;
}

function token(number: number) {
  return number.toString(16).padStart(64, "0");
}

describe("meal batch mutation compensation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("compensates only confirmed writes and reports an unknown in-flight write", async () => {
    const beforeFirst = snapshot(10, "Jantar", "Arroz branco", 100);
    const beforeSecond = snapshot(20, "Almoço", "Feijão carioca", 80);
    const afterFirst = snapshot(10, "Jantar", "Arroz branco", 120);
    const afterSecond = snapshot(20, "Almoço", "Feijão carioca", 90);
    const state = new Map([
      [10, { ...beforeFirst }],
      [20, { ...beforeSecond }],
    ]);
    let failSecondUpdateOnce = true;
    let nextToken = 100;
    const postImages = new Map<number, string>();
    let firstForwardPostImage: string | undefined;

    updateMealMock.mockImplementation(
      async (_userId: number, input: Record<PropertyKey, any>) => {
        const options = input[UPDATE_OPTIONS] as Record<string, unknown>;
        const mealId = Number(input.mealId);
        const current = state.get(mealId);
        if (options.expectedPreImage !== current?.mutationPreImage) {
          throw new Error("stale CAS");
        }
        const grams = Number(input.items[0].estimatedGrams);
        if (mealId === 20 && grams === 90 && failSecondUpdateOnce) {
          failSecondUpdateOnce = false;
          throw new Error("falha simulada na segunda refeição");
        }
        const postImage = token(nextToken++);
        postImages.set(mealId, postImage);
        if (mealId === 10 && grams === 120) firstForwardPostImage = postImage;
        const saved = attachPostImage(
          {
            id: mealId,
            mealLabel: String(input.mealLabel),
            occurredAt: String(input.occurredAt),
            notes: input.notes ?? null,
            items: input.items,
          },
          postImage
        );
        state.set(mealId, { ...saved, mutationPreImage: postImage });
        return saved;
      }
    );

    const changes: MealBatchMutationChange[] = [
      { before: beforeFirst, after: afterFirst },
      { before: beforeSecond, after: afterSecond },
    ];

    await expect(
      updateMealsWithCompensation(42, changes)
    ).rejects.toMatchObject({
      name: "MealBatchMutationError",
      rollbackSucceeded: false,
    });
    expect(state.get(10)?.items[0].estimatedGrams).toBe(100);
    expect(state.get(20)?.items[0].estimatedGrams).toBe(80);
    expect(updateMealMock).toHaveBeenCalledTimes(3);
    expect(serviceOptionsAt(0)).toMatchObject({
      expectedPreImage: beforeFirst.mutationPreImage,
      recordCatalogUsage: false,
      updateHabits: false,
      logEvent: false,
      finalizeBatch: undefined,
    });
    expect(serviceOptionsAt(1)).toMatchObject({
      expectedPreImage: beforeSecond.mutationPreImage,
      finalizeBatch: expect.objectContaining({
        meals: expect.arrayContaining([
          expect.objectContaining({ items: afterFirst.items }),
          expect.objectContaining({ items: afterSecond.items }),
        ]),
      }),
    });
    expect(serviceOptionsAt(2)).toMatchObject({
      expectedPreImage: firstForwardPostImage,
      finalizeBatch: expect.objectContaining({
        recordCatalogUsage: false,
        throwOnHabitFailure: true,
      }),
    });
  });

  it("rejects a mixed V1/V2 batch before touching any V1 sibling", async () => {
    const legacyBefore = snapshot(10, "Jantar", "Arroz branco", 100);
    const legacyAfter = snapshot(10, "Jantar", "Arroz branco", 120);
    const pinnedV2 = {
      ...snapshot(20, "Almoço", "Feijão carioca", 80),
      items: [{ ...item("Feijão carioca", 80),
        historicalRef: "variant:120", v2SnapshotVerified: true as const }],
    };
    const changes: MealBatchMutationChange[] = [
      { before: legacyBefore, after: legacyAfter },
      { before: pinnedV2, after: pinnedV2 },
    ];
    await expect(updateMealsWithCompensation(42, changes))
      .rejects.toThrow("food-v2-legacy-item-mutation-not-supported");
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("rejects a fabricated V2 projection in the after image of a legacy batch", async () => {
    const before = snapshot(10, "Jantar", "Arroz branco", 100);
    const after = {
      ...snapshot(10, "Jantar", "Arroz branco", 120),
      items: [{ ...item("Arroz branco", 120), v2SnapshotVerified: true as const }],
    };
    await expect(updateMealsWithCompensation(42, [{ before, after }]))
      .rejects.toThrow("food-v2-legacy-item-mutation-not-supported");
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("finalizes derived effects only after the last successful CAS write", async () => {
    let nextToken = 200;
    updateMealMock.mockImplementation(
      async (_userId: number, input: Record<PropertyKey, any>) =>
        attachPostImage({ id: input.mealId, ...input }, token(nextToken++))
    );

    await updateMealsWithCompensation(42, [
      {
        before: snapshot(10, "Jantar", "Arroz branco", 100),
        after: snapshot(10, "Jantar", "Arroz branco", 120),
      },
      {
        before: snapshot(20, "Almoço", "Feijão carioca", 80),
        after: snapshot(20, "Almoço", "Feijão carioca", 90),
      },
    ]);

    expect(updateMealMock).toHaveBeenCalledTimes(2);
    expect(serviceOptionsAt(0)).toMatchObject({
      expectedPreImage: snapshot(10, "Jantar", "Arroz branco", 100)
        .mutationPreImage,
      finalizeBatch: undefined,
    });
    expect(serviceOptionsAt(1)).toMatchObject({
      expectedPreImage: snapshot(20, "Almoço", "Feijão carioca", 80)
        .mutationPreImage,
      recordCatalogUsage: false,
      updateHabits: false,
      logEvent: false,
      finalizeBatch: expect.objectContaining({ meals: expect.any(Array) }),
    });
  });

  it("rejects changes without a verifiable persisted pre-image before writing", async () => {
    const before = snapshot(10, "Jantar", "Arroz branco", 100);
    const after = snapshot(10, "Jantar", "Arroz branco", 120);
    const changes: MealBatchMutationChange[] = [
      {
        before: { ...before, mutationPreImage: undefined },
        after,
      },
    ];

    await expect(updateMealsWithCompensation(42, changes)).rejects.toThrow(
      /pre-image/
    );
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("does not claim complete rollback when a compensation also fails", () => {
    const failure = new MealBatchMutationError(new Error("write"), [
      new Error("rollback"),
    ]);
    const description = describeMealBatchMutationFailure(failure);

    expect(description.rollbackSucceeded).toBe(false);
    expect(description.userMessage).toContain("Consulte suas refeições atuais");
  });
});
