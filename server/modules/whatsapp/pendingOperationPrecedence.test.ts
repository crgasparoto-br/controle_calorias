import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, val: unknown) => ({ __op: "eq", col, val }),
  desc: (col: { name: string }) => ({ __op: "desc", col }),
  and: (...conditions: unknown[]) => ({ __op: "and", conditions }),
}));

type FakeDbRow = Record<string, unknown>;
type FakeDbCondition =
  | { __op: "eq"; col: { name: string }; val: unknown }
  | { __op: "and"; conditions: FakeDbCondition[] }
  | { __op: "desc"; col: { name: string } };

function createFakeDb() {
  let rows: FakeDbRow[] = [];
  let nextId = 1;
  let rejectTransitions = false;

  function matches(row: FakeDbRow, condition?: FakeDbCondition): boolean {
    if (!condition) return true;
    if (condition.__op === "eq") return row[condition.col.name] === condition.val;
    if (condition.__op === "and") return condition.conditions.every(inner => matches(row, inner));
    return true;
  }

  function createSelectChain() {
    let whereCondition: FakeDbCondition | undefined;
    let limitValue: number | undefined;
    const resolve = () => {
      let result = rows.filter(row => matches(row, whereCondition));
      result = [...result].sort((a, b) => Number(b.id) - Number(a.id));
      if (limitValue !== undefined) result = result.slice(0, limitValue);
      return result.map(row => ({ ...row }));
    };
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn((condition: FakeDbCondition) => { whereCondition = condition; return chain; }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn((value: number) => { limitValue = value; return Promise.resolve(resolve()); }),
    };
    return chain;
  }

  return {
    select: vi.fn(() => ({ from: vi.fn(() => createSelectChain()) })),
    insert: vi.fn(() => ({
      values: vi.fn((payload: FakeDbRow) => {
        const id = nextId++;
        rows.push({ id, ...payload });
        return Promise.resolve({ insertId: id });
      }),
    })),
    update: vi.fn(() => {
      let setPayload: FakeDbRow = {};
      const chain: any = {
        set: vi.fn((payload: FakeDbRow) => { setPayload = payload; return chain; }),
        where: vi.fn((condition: FakeDbCondition) => {
          if (rejectTransitions) return Promise.resolve({ affectedRows: 0 });
          const matching = rows.filter(row => matches(row, condition));
          for (const row of matching) Object.assign(row, setPayload);
          return Promise.resolve({ affectedRows: matching.length });
        }),
      };
      return chain;
    }),
    snapshot: () => rows.map(row => ({ ...row })),
    rejectTransitions(value: boolean) {
      rejectTransitions = value;
    },
    reset() {
      rows = [];
      nextId = 1;
      rejectTransitions = false;
    },
  };
}

const fakeDb = createFakeDb();

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => fakeDb),
  logPersistenceWarning: vi.fn(),
}));

const { createDrizzleWhatsAppPendingOperationRepository } = await import("../../repositories/whatsappPendingOperationRepository");
const { supersedeActiveWhatsappPendingOperations } = await import("./pendingOperationPrecedence");

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => fakeDb,
  onWarning: vi.fn(),
});

describe("supersedeActiveWhatsappPendingOperations", () => {
  beforeEach(() => fakeDb.reset());

  it("substitui todas as pendências ativas do usuário sem tocar em outro usuário", async () => {
    await repository.createPendingOperation({ userId: 10, type: "meal_item_selection", origin: "test", target: {}, ttlMs: 60_000 });
    await repository.createPendingOperation({ userId: 10, type: "delete", origin: "test", target: {}, ttlMs: 60_000 });
    await repository.createPendingOperation({ userId: 11, type: "delete", origin: "test", target: {}, ttlMs: 60_000 });

    await expect(supersedeActiveWhatsappPendingOperations(10)).resolves.toBe(true);

    const rows = fakeDb.snapshot();
    expect(rows.filter(row => row.userId === 10).every(row => row.state === "superseded")).toBe(true);
    expect(rows.find(row => row.userId === 11)?.state).toBe("active");
  });

  it("falha de forma fechada quando a transição não é confirmada", async () => {
    await repository.createPendingOperation({ userId: 12, type: "delete", origin: "test", target: {}, ttlMs: 60_000 });
    fakeDb.rejectTransitions(true);

    await expect(supersedeActiveWhatsappPendingOperations(12)).resolves.toBe(false);
    expect(fakeDb.snapshot().find(row => row.userId === 12)?.state).toBe("active");
  });
});
