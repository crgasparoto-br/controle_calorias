import { describe, expect, it, vi } from "vitest";
import { habitMemories } from "../../drizzle/schema";
import { createDrizzleHabitsRepository } from "./habitsRepository";

type DbOperation = {
  op: string;
  table: unknown;
  payload?: unknown;
};

function createSelectChain(result: unknown, operations: DbOperation[] = []) {
  const chain: any = {
    from: vi.fn((table: unknown) => {
      operations.push({ op: "select", table });
      return chain;
    }),
    where: vi.fn(() => chain),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function createMutationChain(op: string, table: unknown, operations: DbOperation[]) {
  const chain: any = {
    values: vi.fn((payload: unknown) => {
      operations.push({ op: `${op}.values`, table, payload });
      return Promise.resolve(undefined);
    }),
    where: vi.fn(() => {
      operations.push({ op: `${op}.where`, table });
      return Promise.resolve(undefined);
    }),
  };
  return chain;
}

function createFakeDb(selectResult: unknown = []) {
  const operations: DbOperation[] = [];
  const db = {
    operations,
    select: vi.fn(() => createSelectChain(selectResult, operations)),
    insert: vi.fn((table: unknown) => createMutationChain("insert", table, operations)),
    delete: vi.fn((table: unknown) => createMutationChain("delete", table, operations)),
  };
  return db;
}

describe("createDrizzleHabitsRepository", () => {
  it("caps saturated occurrence counts read from persisted habit memories", async () => {
    const row = {
      id: 3390029,
      userId: 1,
      foodName: "Queijo minas frescal",
      typicalMealLabel: "Jantar",
      preferredPortionGrams: 200,
      notes: "Última porção confirmada: 200 g",
      occurrenceCount: 2_147_483_647,
      lastSeenAt: new Date("2026-06-13T23:01:45.000Z"),
      createdAt: new Date("2026-06-13T23:01:45.000Z"),
      updatedAt: new Date("2026-06-13T23:01:45.000Z"),
    };
    const db = createFakeDb([row]);
    const repository = createDrizzleHabitsRepository({ getDb: async () => db, onWarning: vi.fn() });

    const result = await repository.findRawByUserId(1);

    expect(result?.[0]).toEqual({ ...row, occurrenceCount: 365 });
  });

  it("persists habit snapshots with bounded effective occurrence counts", async () => {
    const db = createFakeDb();
    const repository = createDrizzleHabitsRepository({ getDb: async () => db, onWarning: vi.fn() });

    await repository.insertMany(1, [
      {
        foodName: "Queijo minas frescal",
        typicalMealLabel: "Jantar",
        preferredPortionGrams: 200,
        notes: "Última porção confirmada: 200 g",
        occurrenceCount: 2_147_483_647,
        lastSeenAt: new Date("2026-06-13T23:01:45.000Z").getTime(),
      },
      {
        foodName: "Queijo minas frescal",
        typicalMealLabel: "Jantar",
        preferredPortionGrams: 30,
        notes: "Última porção confirmada: 30 g",
        occurrenceCount: 1,
        lastSeenAt: new Date("2026-06-17T22:26:03.000Z").getTime(),
      },
    ]);

    const insert = db.operations.find(operation => operation.op === "insert.values");
    expect(db.operations.map(operation => operation.op)).toEqual(["delete.where", "insert.values"]);
    expect(insert).toMatchObject({ table: habitMemories });
    expect(insert?.payload).toEqual([
      expect.objectContaining({
        userId: 1,
        foodName: "Queijo minas frescal",
        typicalMealLabel: "Jantar",
        preferredPortionGrams: 30,
        notes: "Última porção confirmada: 30 g",
        occurrenceCount: 365,
      }),
    ]);
  });
});
