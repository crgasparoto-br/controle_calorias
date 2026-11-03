import { describe, expect, it, vi } from "vitest";
import { foodD1OperationEffects, foodD1OperationRoutes } from "../../drizzle/food-intelligence-v2-schema";
import { mealItems, meals } from "../../drizzle/schema";
import { createDrizzleMealsRepository } from "./mealsRepository";

const hash = "a".repeat(64);
const routeKey = "d1-manual-7:submission-retry-1";
const route = (ownerUserId = 7, resolver: "v1" | "v2" = "v1") => ({
  ownerUserId, operationKey: routeKey, originEntrypoint: "addition", resolver,
  revisionsJson: JSON.stringify({ operationScopeHash: hash }),
});
type State = {
  route: ReturnType<typeof route> | null;
  receipt: { ownerUserId: number; operationKey: string; observationId: string;
    decisionHash: string; outcomeJson: string } | null;
  meals: Array<{ id: number; userId: number; status: "draft" | "confirmed" }>;
  items: Array<{ id: number; mealId: number }>;
  nextMealId: number;
  nextItemId: number;
};

/** Isolated transaction fixture, not a substitute for the real TiDB gate. */
function createSerializedDb() {
  let state: State = {
    route: route(), receipt: null, meals: [], items: [], nextMealId: 301, nextItemId: 801,
  };
  let queue = Promise.resolve();

  const makeTransaction = (draft: State) => ({
    select: () => ({
      from(table: unknown) {
        const chain = {
          where: () => chain,
          for: () => chain,
          limit: async () => {
            if (table === foodD1OperationRoutes) return draft.route ? [draft.route] : [];
            if (table === foodD1OperationEffects) return draft.receipt ? [draft.receipt] : [];
            if (table === meals) return draft.meals.filter(meal => meal.status === "confirmed");
            throw new Error("unknown table in D1 receipt fixture");
          },
        };
        return chain;
      },
    }),
    insert(table: unknown) {
      return {
        async values(value: any) {
          if (table === meals) {
            const id = draft.nextMealId++;
            draft.meals.push({ id, userId: value.userId, status: value.status });
            return { insertId: id };
          }
          if (table === mealItems) {
            const values = Array.isArray(value) ? value : [value];
            let first = 0;
            for (const item of values) {
              const id = draft.nextItemId++;
              if (!first) first = id;
              draft.items.push({ id, mealId: item.mealId });
            }
            return { insertId: first };
          }
          if (table === foodD1OperationEffects) {
            if (draft.receipt) throw new Error("duplicate D1 receipt");
            draft.receipt = value;
            return { insertId: 1 };
          }
          throw new Error("unexpected D1 insert");
        },
      };
    },
    update(table: unknown) {
      return {
        set(payload: any) {
          return {
            async where() {
              if (table === meals) {
                draft.meals[draft.meals.length - 1].status = payload.status;
              }
            },
          };
        },
      };
    },
  });

  const db = {
    transaction<T>(handler: (tx: ReturnType<typeof makeTransaction>) => Promise<T>): Promise<T> {
      const job = queue.then(async () => {
        // A failed transaction changes no shared row or receipt.
        const draft: State = JSON.parse(JSON.stringify(state));
        const result = await handler(makeTransaction(draft));
        state = draft;
        return result;
      });
      queue = job.then(() => undefined, () => undefined);
      return job;
    },
  };
  const repo = createDrizzleMealsRepository({ getDb: async () => db as any, onWarning: vi.fn() });
  return { repo, snapshot: () => JSON.parse(JSON.stringify(state)) as State,
    setRoute: (value: State["route"]) => { state.route = value; },
    setReceipt: (value: State["receipt"]) => { state.receipt = value; },
    clearMeals: () => { state.meals = []; state.items = []; },
  };
}

const request = (receiptHash = hash) => ({
  meal: {
    userId: 7, source: "web" as const, mealLabel: "Almoço",
    sourceText: "Registro manual", confidence: 1, occurredAt: Date.parse("2026-11-03T15:00:00Z"),
  },
  items: [{
    foodName: "Arroz", canonicalName: "Arroz", portionText: "100 g",
    quantity: 100, unit: "g", servings: 1, estimatedGrams: 100,
    calories: 130, protein: 3, carbs: 28, fat: 1,
    confidence: 1, source: "catalog" as const,
  }],
  media: [],
  resolvedCatalogIds: new Map<string, number>(),
  legacyD1Receipt: { operationKey: routeKey, operationScopeHash: receiptHash, replayed: false },
});

describe("#1308 D1 legacy manual exactly-once physical meal receipts", () => {
  it("serializes concurrent retries and retains the original confirmed meal after restart", async () => {
    const store = createSerializedDb();
    const first = request();
    const retry = request();
    const [id1, id2] = await Promise.all([store.repo.persistMeal(first), store.repo.persistMeal(retry)]);
    expect(id1).toBe(301);
    expect(id2).toBe(301);
    expect(first.legacyD1Receipt.replayed).toBe(false);
    expect(retry.legacyD1Receipt.replayed).toBe(true);
    const third = request();
    expect(await store.repo.persistMeal(third)).toBe(301);
    expect(third.legacyD1Receipt.replayed).toBe(true);
    const snap = store.snapshot();
    expect(snap.meals).toEqual([{ id: 301, userId: 7, status: "confirmed" }]);
    expect(snap.items).toHaveLength(1);
    expect(snap.receipt).toMatchObject({
      ownerUserId: 7, operationKey: routeKey,
      observationId: "__manual_v1_confirmed", decisionHash: hash,
    });
    expect(JSON.parse(snap.receipt!.outcomeJson)).toEqual({ mealId: 301, itemId: 801 });
  });

  it("rejects changed scope or a swapped resolver before creating any meal item", async () => {
    const store = createSerializedDb();
    await expect(store.repo.persistMeal(request("b".repeat(64))))
      .rejects.toThrow("food-d1-legacy-receipt-unpinned-or-stale");
    store.setRoute(route(7, "v2"));
    await expect(store.repo.persistMeal(request()))
      .rejects.toThrow("food-d1-legacy-receipt-unpinned-or-stale");
    store.setRoute(route(7, "v1"));
    store.setRoute(null);
    await expect(store.repo.persistMeal(request()))
      .rejects.toThrow("food-d1-legacy-receipt-unpinned-or-stale");
    expect(store.snapshot().meals).toEqual([]);
    expect(store.snapshot().items).toEqual([]);
  });

  it("rejects corrupt receipts or deleted historical meals without a second insert", async () => {
    const store = createSerializedDb();
    await store.repo.persistMeal(request());
    const original = store.snapshot().receipt!;
    store.setReceipt({ ...original, decisionHash: "c".repeat(64) });
    await expect(store.repo.persistMeal(request())).rejects.toThrow("food-d1-legacy-receipt-payload-changed");
    store.setReceipt(original);
    store.clearMeals();
    await expect(store.repo.persistMeal(request())).rejects.toThrow("food-d1-legacy-receipt-meal-missing");
    expect(store.snapshot().meals).toEqual([]);
    expect(store.snapshot().items).toEqual([]);
  });

  it("requires transactions; non-transactional fallbacks may not claim idempotency", async () => {
    const repo = createDrizzleMealsRepository({
      getDb: async () => ({}) as any, onWarning: vi.fn(),
    });
    await expect(repo.persistMeal(request()))
      .rejects.toThrow("food-d1-legacy-receipt-transaction-unavailable");
  });
});
