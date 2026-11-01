import { describe, expect, it, vi } from "vitest";
import { mealItems, meals, userPreferences } from "../../drizzle/schema";
import { buildUserLearnedHouseholdMeasurePreference } from "../householdMeasureResolutionPersistence";
import type { MealDraftItem } from "../nutritionEngine";
import { createDrizzleMealsRepository } from "./mealsRepository";

function item(grams: number): MealDraftItem {
  return {
    foodName: "Presunto cozido",
    canonicalName: "presunto cozido",
    brand: "Marca A",
    portionText: grams === 72 ? "4 fatias (aprox. 72 g)" : `${grams} g`,
    quantity: grams === 72 ? 4 : grams,
    unit: grams === 72 ? "fatia" : "g",
    servings: grams === 72 ? 4 : 1,
    estimatedGrams: grams,
    calories: grams === 72 ? 120 : grams * (120 / 72),
    protein: grams === 72 ? 18 : grams * (18 / 72),
    carbs: grams === 72 ? 2 : grams * (2 / 72),
    fat: grams === 72 ? 4 : grams * (4 / 72),
    confidence: 0.8,
    source: "hybrid",
  };
}

function learning(correctedGrams: number) {
  const built = buildUserLearnedHouseholdMeasurePreference({
    userId: 71,
    foodName: "Presunto cozido",
    brand: "Marca A",
    originalQuantity: 4,
    originalUnit: "fatia",
    correctedQuantity: correctedGrams,
    correctedUnit: "g",
  });
  if (!built) throw new Error("learning fixture must be valid");
  return built;
}

function createSerializedLearningDb(
  initialItems: MealDraftItem[],
  options: { legacyBrandEvidence?: boolean } = {},
) {
  // Represent real persisted rows: identity is stored in a legacy snapshot,
  // never inferred from an extra draft-only "brand" column.
  let currentItems: any[] = initialItems.map((value, index) => {
    const { brand, productVariant, ...persisted } = value;
    const legacyIdentity = {
      ...(brand !== undefined ? { brandName: brand } : {}),
      ...(productVariant !== undefined ? { productVariant } : {}),
    };
    return {
      id: index + 1, mealId: 901, ...persisted,
      foodSnapshotJson: options.legacyBrandEvidence === false || !Object.keys(legacyIdentity).length
        ? null : JSON.stringify(legacyIdentity),
    };
  });
  const preferenceWrites: Array<{ userId: number; preferenceKey: string; preferenceValue: string }> = [];
  const operations: string[] = [];
  let queue = Promise.resolve();

  function txClient() {
    return {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => {
            if (table === meals) {
              return {
                for: vi.fn(() => ({
                  limit: vi.fn(async () => {
                    operations.push("meal.lock");
                    return [{ id: 901, userId: 71 }];
                  }),
                })),
              };
            }
            if (table === mealItems) {
              operations.push("items.read");
              return Promise.resolve(currentItems.map(value => ({ ...value })));
            }
            throw new Error("unexpected select table");
          }),
        })),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((changes: Record<string, unknown>) => ({
          where: vi.fn(async () => {
            if (table === mealItems) {
              // The real repository updates the locked physical row in place.
              // A no-op mock would hide a stale second concurrent operation.
              if (currentItems.length !== 1) throw new Error("expected one locked meal item");
              Object.assign(currentItems[0], changes);
              operations.push("items.update");
            } else {
              operations.push(table === meals ? "meal.update" : "other.update");
            }
          }),
        })),
      })),
      delete: vi.fn((table: unknown) => ({
        where: vi.fn(async () => {
          if (table === mealItems) {
            operations.push("items.delete");
            currentItems = [];
          }
        }),
      })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((payload: any) => {
          if (table === mealItems) {
            operations.push("items.insert");
            currentItems = payload.map((value: any) => ({ ...value }));
            return Promise.resolve(undefined);
          }
          if (table === userPreferences) {
            return {
              onDuplicateKeyUpdate: vi.fn(async () => {
                operations.push("learning.upsert");
                preferenceWrites.push({ ...payload });
              }),
            };
          }
          throw new Error("unexpected insert table");
        }),
      })),
    };
  }

  const db = {
    transaction: vi.fn(<T>(fn: (tx: any) => Promise<T>) => {
      const run = queue.then(() => fn(txClient()));
      queue = run.then(() => undefined, () => undefined);
      return run;
    }),
  };

  return {
    db,
    operations,
    preferenceWrites,
    currentItems: () => currentItems.map(value => ({ ...value })),
  };
}

function updateInput(nextGrams: number) {
  return {
    meal: {
      id: 901,
      userId: 71,
      mealLabel: "almoço",
      confidence: 0.8,
      occurredAt: Date.parse("2026-09-03T15:00:00.000Z"),
    },
    items: [item(nextGrams)],
    expectedOriginalItem: item(72),
    resolvedCatalogIds: new Map<string, number>(),
    learning: learning(nextGrams),
  };
}

describe("persistMealUpdateWithHouseholdMeasureLearning", () => {
  it("recusa o caminho de aprendizado quando não existe transação", async () => {
    const repository = createDrizzleMealsRepository({
      getDb: async () => ({}) as any,
      onWarning: vi.fn(),
    });

    await expect(repository.persistMealUpdateWithHouseholdMeasureLearning(updateInput(80)))
      .resolves.toBe("unsupported");
  });

  it("serializa correções concorrentes e impede o snapshot stale de sobrescrever o aprendizado vencedor", async () => {
    const state = createSerializedLearningDb([item(72)]);
    const repository = createDrizzleMealsRepository({
      getDb: async () => state.db as any,
      onWarning: vi.fn(),
    });

    const [first, second] = await Promise.all([
      repository.persistMealUpdateWithHouseholdMeasureLearning(updateInput(80)),
      repository.persistMealUpdateWithHouseholdMeasureLearning(updateInput(90)),
    ]);

    expect(first).toBe("updated");
    expect(second).toBe("stale");
    expect(state.preferenceWrites).toHaveLength(1);
    expect(JSON.parse(state.preferenceWrites[0].preferenceValue).grams).toBe(80);
    expect(state.currentItems()).toHaveLength(1);
    expect(Number(state.currentItems()[0].estimatedGrams)).toBe(80);
    expect(state.currentItems()[0].id).toBe(1);
    expect(JSON.parse(state.currentItems()[0].foodSnapshotJson).confirmedCommercialIdentity)
      .toEqual({ brand: "Marca A" });
    expect(state.operations.filter(op => op === "items.update")).toHaveLength(1);
    expect(state.operations).not.toContain("items.delete");
    expect(state.operations.filter(op => op === "learning.upsert")).toHaveLength(1);
    expect(state.operations.filter(op => op === "meal.lock")).toHaveLength(2);
  });

  it("não grava aprendizado nem troca nutrição quando marca confirmada é substituída", async () => {
    const state = createSerializedLearningDb([item(72)]);
    const repository = createDrizzleMealsRepository({
      getDb: async () => state.db as any,
      onWarning: vi.fn(),
    });
    const changed = { ...updateInput(80), items: [{ ...item(80), brand: "Marca B" }] };

    await expect(repository.persistMealUpdateWithHouseholdMeasureLearning(changed))
      .rejects.toThrow(/Recalcule e confirme/);
    expect(state.preferenceWrites).toEqual([]);
    expect(state.operations).not.toContain("items.update");
    expect(state.operations).not.toContain("items.delete");
    expect(state.currentItems()[0].estimatedGrams).toBe(72);
  });

  it("não trata marca sem prova em histórico legado como identidade confirmada", async () => {
    const state = createSerializedLearningDb([item(72)], { legacyBrandEvidence: false });
    const repository = createDrizzleMealsRepository({
      getDb: async () => state.db as any,
      onWarning: vi.fn(),
    });

    await expect(repository.persistMealUpdateWithHouseholdMeasureLearning(updateInput(80)))
      .rejects.toThrow(/Recalcule e confirme/);
    expect(state.preferenceWrites).toEqual([]);
    expect(state.operations).not.toContain("items.update");
    expect(state.operations).not.toContain("items.delete");
    expect(state.currentItems()[0].estimatedGrams).toBe(72);
    expect(state.currentItems()[0].foodSnapshotJson).toBeNull();
  });
});
