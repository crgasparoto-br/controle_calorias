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

function createFakeDb(options: {
  insertResponse?: unknown;
  failOn?: string;
  supportsTransaction?: boolean;
  ownsMeal?: boolean;
  mealMetadata?: Record<string, unknown>;
} = {}) {
  const committedOperations: DbOperation[] = [];
  const ownsMeal = options.ownsMeal ?? true;

  function buildClient(operations: DbOperation[]) {
    return {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          const chain: any = {
            where: vi.fn(() => chain),
            orderBy: vi.fn(() => chain),
            for: vi.fn(() => chain),
            limit: vi.fn(async () => {
              operations.push({ op: table === mealItems ? "select.items" : "select.limit", table });
              if (!ownsMeal) return [];
              if (table === mealItems) {
                return [
                  { id: 21, mealId: 7, ...chickenItem },
                  { id: 22, mealId: 7, ...siblingItem },
                ];
              }
              return [{
                id: 7,
                userId: 1,
                source: "web",
                status: "confirmed",
                mealLabel: "Almoço",
                notes: null,
                confidence: 1,
                occurredAt: Date.parse("2026-05-21T12:00:00.000Z"),
                ...options.mealMetadata,
              }];
            }),
          };
          return chain;
        }),
      })),
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
      update: vi.fn((table: unknown) => {
        const chain = createMutationChain("update", table, operations, undefined);
        if (options.failOn === "update-item" && table === mealItems) {
          chain.where = vi.fn(() => {
            operations.push({ op: "update.where", table });
            throw new Error("item update failed");
          });
        }
        return chain;
      }),
      delete: vi.fn((table: unknown) => {
        const chain = createMutationChain("delete", table, operations);
        if (options.failOn === "delete" && table === mealItems) {
          chain.where = vi.fn(() => {
            operations.push({ op: "delete.where", table });
            throw new Error("delete failed");
          });
        }
        return chain;
      }),
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
const chickenItem = {
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
  source: "text" as const,
};
const siblingItem = {
  ...chickenItem,
  foodName: "Arroz",
  canonicalName: "arroz",
  portionText: "1 prato",
  unit: "prato",
  estimatedGrams: 150,
  calories: 200,
  protein: 4,
  carbs: 44,
  fat: 0.4,
};

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
      resolvedCatalogIds: new Map([["arroz", 501]]),
    });

    expect(mealId).toBe(42);
    expect(db.committedOperations.map((o: DbOperation) => o.op)).toEqual(["insert.values", "insert.values", "update.set", "update.where"]);

    const mealInsert = db.committedOperations.find((o: DbOperation) => o.op === "insert.values" && o.table === meals);
    expect(mealInsert?.payload).toMatchObject({ status: "draft" });

    const itemInsert = db.committedOperations.find((o: DbOperation) => o.op === "insert.values" && o.table === mealItems);
    expect(itemInsert?.payload?.[0]).toMatchObject({ foodCatalogId: 501, canonicalName: "arroz" });

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
  it("validates ownership, flips to draft, replaces items, then confirms with updated metadata", async () => {
    const db = createFakeDb();
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await repository.persistMealUpdate({
      meal: { id: 7, userId: 1, mealLabel: "Jantar", confidence: 0.8, occurredAt: Date.now() },
      items: [chickenItem],
      resolvedCatalogIds: new Map(),
    });

    const ops = db.committedOperations.map((o: DbOperation) => o.op);
    expect(ops).toEqual(["select.limit", "update.set", "update.where", "delete.where", "insert.values", "update.set", "update.where"]);

    const [draftSet] = db.committedOperations.filter((o: DbOperation) => o.op === "update.set");
    expect(draftSet.payload).toEqual({ status: "draft" });
  });

  it("does not delete or insert items when the meal belongs to another user", async () => {
    const db = createFakeDb({ ownsMeal: false });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await repository.persistMealUpdate({
      meal: { id: 7, userId: 1, mealLabel: "Jantar", confidence: 0.8, occurredAt: Date.now() },
      items: [chickenItem],
      resolvedCatalogIds: new Map(),
    });

    const ops = db.committedOperations.map((o: DbOperation) => o.op);
    expect(ops).toEqual(["select.limit"]);
    expect(db.committedOperations.some((o: DbOperation) => o.table === mealItems || o.table === mealMedia)).toBe(false);
  });

  it("rolls back item replacement without leaving the meal confirmed when it fails mid-transaction", async () => {
    const db = createFakeDb({ failOn: "insert", supportsTransaction: true });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await expect(
      repository.persistMealUpdate({
        meal: { id: 7, userId: 1, mealLabel: "Jantar", confidence: 0.8, occurredAt: Date.now() },
        items: [chickenItem],
        resolvedCatalogIds: new Map(),
      }),
    ).rejects.toThrow("insert failed");

    expect(db.committedOperations).toEqual([]);
  });
});

describe("createDrizzleMealsRepository moveMealItem", () => {
  const sourceMeal = {
    id: 7,
    userId: 1,
    source: "web" as const,
    mealLabel: "Almoço",
    status: "confirmed" as const,
    occurredAt: Date.parse("2026-05-21T12:00:00.000Z"),
    sourceText: "arroz e frango",
    confidence: 1,
    items: [chickenItem, siblingItem],
    media: [],
    createdAt: Date.parse("2026-05-21T11:00:00.000Z"),
  };

  it("edita somente a linha selecionada e preserva irmãos sem delete/reinsert", async () => {
    const db = createFakeDb({ supportsTransaction: true });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await repository.updateMealItem({
      userId: 1,
      meal: sourceMeal,
      itemIndex: 0,
      updatedItem: { ...chickenItem, portionText: "2 filés" },
      mealLabel: "Almoço",
      occurredAt: sourceMeal.occurredAt,
      resolvedCatalogIds: new Map(),
    });

    expect(db.committedOperations.some((operation: DbOperation) => operation.op === "delete.where")).toBe(false);
    expect(db.committedOperations.filter((operation: DbOperation) => operation.op === "update.set" && operation.table === mealItems)).toHaveLength(1);
  });

  it("rejeita snapshot stale antes de criar destino ou alterar qualquer linha", async () => {
    const db = createFakeDb({ insertResponse: { insertId: 42 }, supportsTransaction: true });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await expect(repository.moveMealItem({
      userId: 1,
      sourceMeal: { ...sourceMeal, items: [chickenItem, { ...siblingItem, portionText: "alterado em outra sessão" }] },
      itemIndex: 0,
      updatedItem: chickenItem,
      targetMeal: { mealLabel: "Jantar", occurredAt: sourceMeal.occurredAt },
      resolvedCatalogIds: new Map(),
    })).rejects.toThrow("A refeição foi alterada antes do salvamento");

    expect(db.committedOperations).toEqual([]);
  });

  it.each([
    ["rótulo", { mealLabel: "Jantar" }],
    ["data", { occurredAt: Date.parse("2026-05-21T13:00:00.000Z") }],
  ])("rejeita alteração concorrente de metadata (%s) antes de criar destino", async (_dimension, mealMetadata) => {
    const db = createFakeDb({ insertResponse: { insertId: 42 }, supportsTransaction: true, mealMetadata });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await expect(repository.moveMealItem({
      userId: 1,
      sourceMeal,
      itemIndex: 0,
      updatedItem: chickenItem,
      targetMeal: { mealLabel: "Jantar", occurredAt: sourceMeal.occurredAt },
      resolvedCatalogIds: new Map(),
    })).rejects.toThrow("A refeição foi alterada antes do salvamento");

    expect(db.committedOperations).toEqual([]);
  });

  it("descarta metadata e destino quando a atualização da linha selecionada falha", async () => {
    const db = createFakeDb({ insertResponse: { insertId: 42 }, failOn: "update-item", supportsTransaction: true });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await expect(repository.updateMealItem({
      userId: 1,
      meal: sourceMeal,
      itemIndex: 0,
      updatedItem: chickenItem,
      mealLabel: "Almoço",
      occurredAt: sourceMeal.occurredAt,
      resolvedCatalogIds: new Map(),
    })).rejects.toThrow("item update failed");

    expect(db.committedOperations).toEqual([]);
  });

  it("confirma destino e origem na mesma transação", async () => {
    const db = createFakeDb({ insertResponse: { insertId: 42 }, supportsTransaction: true });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    const result = await repository.moveMealItem({
      userId: 1,
      sourceMeal,
      itemIndex: 0,
      updatedItem: { ...chickenItem, portionText: "2 filés" },
      targetMeal: { mealLabel: "Jantar", occurredAt: sourceMeal.occurredAt },
      resolvedCatalogIds: new Map(),
    });

    expect(result).toEqual({ targetMealId: 42 });
    expect(db.committedOperations.some((operation: DbOperation) => operation.op === "delete.where" && operation.table === mealItems)).toBe(false);
    const itemUpdates = db.committedOperations.filter((operation: DbOperation) => operation.op === "update.set" && operation.table === mealItems);
    expect(itemUpdates).toHaveLength(1);
    expect(itemUpdates[0]?.payload).toMatchObject({ mealId: 42, portionText: "2 filés" });
    expect(db.committedOperations.some((operation: DbOperation) => operation.payload && JSON.stringify(operation.payload).includes("Arroz"))).toBe(false);
  });

  it("descarta destino quando a atualização da origem falha", async () => {
    const db = createFakeDb({ insertResponse: { insertId: 42 }, failOn: "update-item", supportsTransaction: true });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await expect(repository.moveMealItem({
      userId: 1,
      sourceMeal,
      itemIndex: 0,
      updatedItem: chickenItem,
      targetMeal: { mealLabel: "Jantar", occurredAt: sourceMeal.occurredAt },
      resolvedCatalogIds: new Map(),
    })).rejects.toThrow("item update failed");

    expect(db.committedOperations).toEqual([]);
  });
});

describe("createDrizzleMealsRepository deleteMeal", () => {
  it("validates ownership before deleting child rows and meal", async () => {
    const db = createFakeDb();
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await repository.deleteMeal(1, 7);

    expect(db.committedOperations.map((o: DbOperation) => o.op)).toEqual(["select.limit", "delete.where", "delete.where", "delete.where"]);
    expect(db.committedOperations[1].table).toBe(mealItems);
    expect(db.committedOperations[2].table).toBe(mealMedia);
    expect(db.committedOperations[3].table).toBe(meals);
  });

  it("does not delete child rows when the meal belongs to another user", async () => {
    const db = createFakeDb({ ownsMeal: false });
    const repository = createDrizzleMealsRepository({ getDb: async () => db, onWarning: warning });

    await repository.deleteMeal(1, 7);

    expect(db.committedOperations.map((o: DbOperation) => o.op)).toEqual(["select.limit"]);
    expect(db.committedOperations.some((o: DbOperation) => o.table === mealItems || o.table === mealMedia || o.table === meals && o.op.startsWith("delete"))).toBe(false);
  });
});
