import { describe, expect, it, vi } from "vitest";
import { mealItems, mealMedia, meals } from "../../drizzle/schema";
import { createDrizzleMealsRepository } from "./mealsRepository";

type DbOperation = {
  op: string;
  table: unknown;
  payload?: unknown;
};

function createMutationChain(op: string, table: unknown, operations: DbOperation[], response: unknown, onWhere?: () => void) {
  const chain: any = {
    values: vi.fn((payload: unknown) => {
      operations.push({ op: `${op}.values`, table, payload });
      return Promise.resolve(response);
    }),
    set: vi.fn((payload: unknown) => {
      operations.push({ op: `${op}.set`, table, payload });
      return chain;
    }),
    where: vi.fn(() => {
      operations.push({ op: `${op}.where`, table });
      onWhere?.();
      return Promise.resolve(undefined);
    }),
  };
  return chain;
}

function createFakeDb(options: { insertResponse?: unknown; failOn?: string; supportsTransaction?: boolean } = {}) {
  const committedOperations: DbOperation[] = [];

  function buildClient(operations: DbOperation[]) {
    return {
      insert: vi.fn((table: unknown) => {
        const chain = createMutationChain("insert", table, operations, options.insertResponse);
        if (options.failOn === "insert" && table === mealItems) {
          chain.values = vi.fn(() => {
            operations.push({ op: "insert.values", table });
            throw new Error("insert failed");
          });
        }
        return chain;
      }),
      update: vi.fn((table: unknown) => createMutationChain("update", table, operations, undefined)),
      delete: vi.fn((table: unknown) => createMutationChain("delete", table, operations)),
    };
  }

  const db: any = {
    committedOperations,
    ...buildClient(committedOperations),
  };

  if (options.supportsTransaction) {
    db.transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const scratchOperations: DbOperation[] = [];
      const tx = buildClient(scratchOperations);
      try {
        const result = await fn(tx);
        committedOperations.push(...scratchOperations);
        return result;
      } catch (error) {
        // rollback: scratchOperations are discarded, nothing lands in committedOperations
        throw error;
      }
    });
  }

  return db;
}

const warning = vi.fn();

describe("createDrizzleMealsRepository persistMeal", () => {
  it("inserts the meal as draft, writes items/media, then confirms", async () => {
    const db = createFakeDb({ insertResponse: { insertId: 42 } });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    const mealId = await repository.persistMeal({
      meal: {
        userId: 1,
        source: "web",
        mealLabel: "Almoço",
        sourceText: "arroz e feijão",
        confidence: 0.9,
        occurredAt: Date.now(),
      },
      items: [
        {
          foodCatalogId: null,
          foodName: "Arroz",
          canonicalName: "arroz",
          portionText: "1 prato",
          quantity: 1,
          unit: "prato",
          servings: 1,
          estimatedGrams: 150,
          calories: 200,
          protein: 4,
          carbs: 44,
          fat: 0.4,
          confidence: 0.9,
          source: "text",
        },
      ],
      media: [],
      resolvedCatalogIds: new Map(),
    });

    expect(mealId).toBe(42);
    expect(db.committedOperations.map((o: DbOperation) => o.op)).toEqual(["insert.values", "insert.values", "update.set", "update.where"]);

    const mealInsert = db.committedOperations.find((o: DbOperation) => o.op === "insert.values" && o.table === meals);
    expect(mealInsert?.payload).toMatchObject({ status: "draft" });

    const confirm = db.committedOperations.find((o: DbOperation) => o.op === "update.set");
    expect(confirm?.payload).toEqual({ status: "confirmed" });
  });

  it("rolls back and never confirms when item persistence fails mid-transaction", async () => {
    const db = createFakeDb({ insertResponse: { insertId: 42 }, failOn: "insert", supportsTransaction: true });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await expect(
      repository.persistMeal({
        meal: {
          userId: 1,
          source: "web",
          mealLabel: "Almoço",
          sourceText: "arroz e feijão",
          confidence: 0.9,
          occurredAt: Date.now(),
        },
        items: [
          {
            foodCatalogId: null,
            foodName: "Arroz",
            canonicalName: "arroz",
            portionText: "1 prato",
            quantity: 1,
            unit: "prato",
            servings: 1,
            estimatedGrams: 150,
            calories: 200,
            protein: 4,
            carbs: 44,
            fat: 0.4,
            confidence: 0.9,
            source: "text",
          },
        ],
        media: [],
        resolvedCatalogIds: new Map(),
      }),
    ).rejects.toThrow("insert failed");

    expect(db.committedOperations).toEqual([]);
  });

  it("without transaction support, leaves the meal row as draft instead of confirming it", async () => {
    const db = createFakeDb({ insertResponse: { insertId: 42 }, failOn: "insert" });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await expect(
      repository.persistMeal({
        meal: {
          userId: 1,
          source: "web",
          mealLabel: "Almoço",
          sourceText: "arroz e feijão",
          confidence: 0.9,
          occurredAt: Date.now(),
        },
        items: [
          {
            foodCatalogId: null,
            foodName: "Arroz",
            canonicalName: "arroz",
            portionText: "1 prato",
            quantity: 1,
            unit: "prato",
            servings: 1,
            estimatedGrams: 150,
            calories: 200,
            protein: 4,
            carbs: 44,
            fat: 0.4,
            confidence: 0.9,
            source: "text",
          },
        ],
        media: [],
        resolvedCatalogIds: new Map(),
      }),
    ).rejects.toThrow("insert failed");

    expect(db.committedOperations.some((o: DbOperation) => o.op === "update.set")).toBe(false);
    const mealInsert = db.committedOperations.find((o: DbOperation) => o.op === "insert.values" && o.table === meals);
    expect(mealInsert?.payload).toMatchObject({ status: "draft" });
  });
});

describe("createDrizzleMealsRepository persistMealUpdate", () => {
  it("flips to draft, replaces items, then confirms with updated metadata", async () => {
    const db = createFakeDb();
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await repository.persistMealUpdate({
      meal: { id: 7, userId: 1, mealLabel: "Jantar", confidence: 0.8, occurredAt: Date.now() },
      items: [
        {
          foodCatalogId: null,
          foodName: "Frango",
          canonicalName: "frango",
          portionText: "1 filé",
          quantity: 1,
          unit: "filé",
          servings: 1,
          estimatedGrams: 120,
          calories: 250,
          protein: 30,
          carbs: 0,
          fat: 10,
          confidence: 0.9,
          source: "text",
        },
      ],
      resolvedCatalogIds: new Map(),
    });

    const ops = db.committedOperations.map((o: DbOperation) => o.op);
    expect(ops).toEqual(["update.set", "update.where", "delete.where", "insert.values", "update.set", "update.where"]);

    const [draftSet, , , , confirmSet] = db.committedOperations.filter((o: DbOperation) => o.op === "update.set" || o.op === "delete.where" || o.op === "insert.values");
    expect(draftSet.payload).toEqual({ status: "draft" });
  });

  it("rolls back item replacement without leaving the meal confirmed when it fails mid-transaction", async () => {
    const db = createFakeDb({ failOn: "insert", supportsTransaction: true });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await expect(
      repository.persistMealUpdate({
        meal: { id: 7, userId: 1, mealLabel: "Jantar", confidence: 0.8, occurredAt: Date.now() },
        items: [
          {
            foodCatalogId: null,
            foodName: "Frango",
            canonicalName: "frango",
            portionText: "1 filé",
            quantity: 1,
            unit: "filé",
            servings: 1,
            estimatedGrams: 120,
            calories: 250,
            protein: 30,
            carbs: 0,
            fat: 10,
            confidence: 0.9,
            source: "text",
          },
        ],
        resolvedCatalogIds: new Map(),
      }),
    ).rejects.toThrow("insert failed");

    expect(db.committedOperations).toEqual([]);
  });
});
