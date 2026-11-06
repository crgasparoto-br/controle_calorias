import { describe, expect, it, vi } from "vitest";
import { mealItems, meals } from "../../drizzle/schema";
import {
  createMealMutationPreImage,
  persistMealUpdateWithPreImage,
} from "./mealMutationPreImage";

function makeState() {
  return {
    meal: {
      id: 71,
      userId: 42,
      mealLabel: "Jantar",
      notes: null,
      confidence: 0.9,
      occurredAt: new Date("2026-10-01T20:00:00.000Z"),
      status: "confirmed",
      createdAt: new Date("2026-10-01T20:00:00.000Z"),
    },
    items: [
      {
        id: 801,
        mealId: 71,
        foodId: 30,
        foodVariantId: 300,
        nutritionProfileId: 3000,
        foodPortionId: 30000,
        portionId: 930,
        foodName: "Presunto",
        canonicalName: "presunto",
        quantity: 1,
        estimatedGrams: 20,
        calories: 25,
      },
    ],
  };
}

function makeTransaction(state: ReturnType<typeof makeState>) {
  return {
    select: () => ({
      from: (table: unknown) => {
        const query = {
          where: () => query,
          limit: async () => (table === meals ? [state.meal] : state.items),
          orderBy: async () => state.items,
        };
        return query;
      },
    }),
  };
}

describe("issue #997 persisted meal pre-image CAS", () => {
  it("checks the pre-image inside one transaction and returns the committed post-image token", async () => {
    const state = makeState();
    const preImage = createMealMutationPreImage(state.meal, state.items);
    const transaction = makeTransaction(state);
    const order: string[] = [];
    const db = {
      transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
        order.push("transaction");
        return run(transaction);
      }),
    };
    const lockMealAndItems = vi.fn(async () => {
      order.push("lock");
      return { meal: state.meal, items: state.items };
    });
    const replaceMealItemsInTransaction = vi.fn(async (_tx, input) => {
      order.push("replace");
      state.meal = { ...state.meal, mealLabel: input.meal.mealLabel };
      state.items = input.items as typeof state.items;
    });

    const postImage = await persistMealUpdateWithPreImage({
      db,
      expectedPreImage: preImage,
      meal: {
        id: 71,
        userId: 42,
        mealLabel: "Ceia",
        confidence: 0.9,
        occurredAt: Date.now(),
      },
      items: [{ foodName: "Presunto", quantity: 2, estimatedGrams: 40 }],
      resolvedCatalogIds: new Map(),
      runInTransaction: (database, run) => database.transaction(run),
      lockMealAndItems,
      replaceMealItemsInTransaction,
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["transaction", "lock", "replace"]);
    expect(replaceMealItemsInTransaction).toHaveBeenCalledTimes(1);
    expect(postImage).toBe(createMealMutationPreImage(state.meal, state.items));
    expect(postImage).not.toBe(preImage);
  });

  it("rejects a stale persisted pre-image before any write inside the transaction", async () => {
    const state = makeState();
    const stalePreImage = createMealMutationPreImage(state.meal, state.items);
    state.items[0] = { ...state.items[0], estimatedGrams: 999 };
    const transaction = makeTransaction(state);
    const replaceMealItemsInTransaction = vi.fn();

    await expect(
      persistMealUpdateWithPreImage({
        db: {
          transaction: async (run: (tx: unknown) => Promise<unknown>) =>
            run(transaction),
        },
        expectedPreImage: stalePreImage,
        meal: {
          id: 71,
          userId: 42,
          mealLabel: "Jantar",
          confidence: 0.9,
          occurredAt: Date.now(),
        },
        items: [],
        resolvedCatalogIds: new Map(),
        runInTransaction: (database, run) => database.transaction(run),
        lockMealAndItems: async () => ({
          meal: state.meal,
          items: state.items,
        }),
        replaceMealItemsInTransaction,
      })
    ).rejects.toThrow("Meal pre-image changed before CAS.");

    expect(replaceMealItemsInTransaction).not.toHaveBeenCalled();
  });

  it("fails closed for malformed pre-image tokens and transactionless persistence", async () => {
    const state = makeState();
    const replaceMealItemsInTransaction = vi.fn();
    const common = {
      expectedPreImage: "not-a-sha256-token",
      meal: {
        id: 71,
        userId: 42,
        mealLabel: "Jantar",
        confidence: 0.9,
        occurredAt: Date.now(),
      },
      items: [],
      resolvedCatalogIds: new Map<string, number>(),
      runInTransaction: async (
        _database: unknown,
        run: (tx: unknown) => Promise<unknown>
      ) => run({}),
      lockMealAndItems: async () => ({ meal: state.meal, items: state.items }),
      replaceMealItemsInTransaction,
    };

    await expect(
      persistMealUpdateWithPreImage({
        ...common,
        db: { transaction: async () => undefined },
      })
    ).rejects.toThrow("Invalid persisted meal pre-image token.");
    await expect(
      persistMealUpdateWithPreImage({
        ...common,
        expectedPreImage: "",
        db: { transaction: async () => undefined },
      })
    ).rejects.toThrow("Invalid persisted meal pre-image token.");
    await expect(
      persistMealUpdateWithPreImage({ ...common, db: {} })
    ).rejects.toThrow(
      "Meal batch mutation requires transactional persistence CAS."
    );
    expect(replaceMealItemsInTransaction).not.toHaveBeenCalled();
  });
});
