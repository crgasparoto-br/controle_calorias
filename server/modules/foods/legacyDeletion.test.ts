import { describe, expect, it, vi } from "vitest";
import {
  createLegacyFoodDeletionService,
  LegacyFoodDeletePersistenceError,
  LegacyFoodNotFoundError,
} from "./legacyDeletion";

describe("legacy food deletion", () => {
  it("deprecates an owned active food and removes the favorite in one transaction", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [{ id: 10, name: "Panqueca", aliases: '["massa"]', status: "active" }],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const transaction = vi.fn(async callback => callback({ execute }));
    const service = createLegacyFoodDeletionService({
      getDb: async () => ({ execute, transaction }),
      searchFoods: async () => [],
      onWarning: vi.fn(),
    });

    await expect(service.deleteFood(7, 10)).resolves.toMatchObject({
      success: true,
      status: "deprecated",
      alreadyDeprecated: false,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("is idempotent for an already deprecated owned food", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [{ id: 10, name: "Panqueca", aliases: "[]", status: "deprecated" }],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const service = createLegacyFoodDeletionService({
      getDb: async () => ({
        execute,
        transaction: async callback => callback({ execute }),
      }),
      searchFoods: async () => [],
      onWarning: vi.fn(),
    });

    await expect(service.deleteFood(7, 10)).resolves.toMatchObject({
      alreadyDeprecated: true,
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not allow global, cross-user or nonexistent foods", async () => {
    const execute = vi.fn(async () => [[]]);
    const service = createLegacyFoodDeletionService({
      getDb: async () => ({
        execute,
        transaction: async callback => callback({ execute }),
      }),
      searchFoods: async () => [],
      onWarning: vi.fn(),
    });
    await expect(service.deleteFood(7, 999)).rejects.toBeInstanceOf(
      LegacyFoodNotFoundError
    );
  });

  it("suppresses a deleted food in memory-only mode", async () => {
    const searchFoods = vi.fn(async () => [
      {
        id: 100,
        name: "Panqueca",
        brandName: null,
        servingSize: 100,
        servingUnit: "g",
        calories: 200,
        protein: 8,
        carbs: 30,
        fat: 5,
        fiber: null,
        isFruit: false,
        isVegetable: false,
        isUltraProcessed: false,
        source: "manual",
        foodType: "generic" as const,
        isUserCreated: true,
        createdByUserId: 70,
        isFavorite: false,
        lastUsedAt: null,
      },
    ]);
    const service = createLegacyFoodDeletionService({
      getDb: async () => null,
      searchFoods,
      onWarning: vi.fn(),
    });

    await expect(service.deleteFood(70, 100)).resolves.toMatchObject({
      success: true,
      alreadyDeprecated: false,
    });
    await expect(service.deleteFood(70, 100)).resolves.toMatchObject({
      success: true,
      alreadyDeprecated: true,
    });
    expect(searchFoods).toHaveBeenCalledTimes(1);
  });

  it("does not report success when the database transaction fails", async () => {
    const failure = new Error("database unavailable");
    const onWarning = vi.fn();
    const service = createLegacyFoodDeletionService({
      getDb: async () => ({
        execute: vi.fn(),
        transaction: async () => {
          throw failure;
        },
      }),
      searchFoods: async () => [],
      onWarning,
    });
    await expect(service.deleteFood(7, 10)).rejects.toBeInstanceOf(
      LegacyFoodDeletePersistenceError
    );
    expect(onWarning).toHaveBeenCalledWith(
      "Legacy food deletion failed",
      failure
    );
  });
});
