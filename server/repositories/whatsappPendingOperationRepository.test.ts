import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsappPendingOperations } from "../../drizzle/schema";
import { createDrizzleWhatsAppPendingOperationRepository } from "./whatsappPendingOperationRepository";

vi.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, val: unknown) => ({ __op: "eq", col, val }),
  ne: (col: { name: string }, val: unknown) => ({ __op: "ne", col, val }),
  lt: (col: { name: string }, val: unknown) => ({ __op: "lt", col, val }),
  desc: (col: { name: string }) => ({ __op: "desc", col }),
  and: (...conditions: unknown[]) => ({ __op: "and", conditions }),
}));

type Row = Record<string, unknown>;
type EqCondition = { __op: "eq" | "ne"; col: { name: string }; val: unknown };
type LtCondition = { __op: "lt"; col: { name: string }; val: unknown };
type AndCondition = { __op: "and"; conditions: Condition[] };
type OrderCondition = { __op: "desc"; col: { name: string } };
type Condition = EqCondition | LtCondition | AndCondition | OrderCondition;

/**
 * Fake DB que suporta `and()` combinando `eq()` e reporta `affectedRows` no
 * update, o suficiente para exercitar de forma genuína o CAS (compare-and-swap)
 * exigido pela issue #766: apenas uma de duas atualizações concorrentes que
 * casam a mesma condição de estado+versão deve ter sucesso.
 */
function createFakeDb() {
  let rows: Row[] = [];
  let nextId = 1;

  function matches(row: Row, condition?: Condition): boolean {
    if (!condition) return true;
    if (condition.__op === "eq") return row[condition.col.name] === condition.val;
    if (condition.__op === "ne") return row[condition.col.name] !== condition.val;
    if (condition.__op === "lt") {
      const value = row[condition.col.name] instanceof Date ? (row[condition.col.name] as Date).getTime() : row[condition.col.name];
      const compareTo = condition.val instanceof Date ? condition.val.getTime() : condition.val;
      return (value as number) < (compareTo as number);
    }
    if (condition.__op === "and") return condition.conditions.every(inner => matches(row, inner));
    return true;
  }

  function createSelectChain() {
    let whereCondition: Condition | undefined;
    let orderCondition: OrderCondition | undefined;
    let limitValue: number | undefined;

    const resolve = () => {
      let result = rows.filter(row => matches(row, whereCondition));
      if (orderCondition) {
        result = [...result].sort((a, b) => {
          const key = orderCondition!.col.name;
          return (b[key] as number) - (a[key] as number);
        });
      }
      if (limitValue !== undefined) result = result.slice(0, limitValue);
      return result.map(row => ({ ...row }));
    };

    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn((condition: Condition) => {
        whereCondition = condition;
        return chain;
      }),
      orderBy: vi.fn((condition: OrderCondition) => {
        orderCondition = condition;
        return chain;
      }),
      limit: vi.fn((value: number) => {
        limitValue = value;
        return Promise.resolve(resolve());
      }),
    };
    return chain;
  }

  return {
    select: vi.fn(() => ({ from: vi.fn(() => createSelectChain()) })),
    insert: vi.fn(() => ({
      values: vi.fn((payload: Row) => {
        const id = nextId++;
        rows.push({ id, ...payload });
        return Promise.resolve({ insertId: id });
      }),
    })),
    update: vi.fn(() => {
      let setPayload: Row = {};
      const chain: any = {
        set: vi.fn((payload: Row) => {
          setPayload = payload;
          return chain;
        }),
        where: vi.fn((condition: Condition) => {
          const matching = rows.filter(row => matches(row, condition));
          for (const row of matching) Object.assign(row, setPayload);
          return Promise.resolve({ affectedRows: matching.length });
        }),
      };
      return chain;
    }),
    delete: vi.fn(() => ({
      where: vi.fn((condition: Condition) => {
        const remaining = rows.filter(row => !matches(row, condition));
        const deletedCount = rows.length - remaining.length;
        rows = remaining;
        return Promise.resolve({ affectedRows: deletedCount });
      }),
    })),
  };
}

function createRepository() {
  const db = createFakeDb();
  const onWarning = vi.fn();
  const repository = createDrizzleWhatsAppPendingOperationRepository({ getDb: async () => db, onWarning });
  return { db, onWarning, repository };
}

describe("createDrizzleWhatsAppPendingOperationRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cria uma pendência ativa com versão inicial 1", async () => {
    const { repository } = createRepository();

    const created = await repository.createPendingOperation({
      userId: 1,
      type: "delete",
      target: { mealId: 10 },
      origin: "deleteIntent",
      ttlMs: 10 * 60 * 1000,
    });

    expect(created).not.toBeNull();
    expect(created?.state).toBe("active");
    expect(created?.version).toBe(1);
  });

  it("retorna a pendência ativa mais recente do usuário", async () => {
    const { repository } = createRepository();
    const now = new Date("2026-07-10T10:00:00Z");

    await repository.createPendingOperation({ userId: 1, type: "delete", target: {}, origin: "a", ttlMs: 60_000, now });
    const second = await repository.createPendingOperation({ userId: 1, type: "confirmation", target: {}, origin: "b", ttlMs: 60_000, now });

    const active = await repository.getActivePendingOperation(1, now);
    expect(active?.id).toBe(second?.id);
  });

  it("não retorna pendência expirada", async () => {
    const { repository } = createRepository();
    const now = new Date("2026-07-10T10:00:00Z");

    await repository.createPendingOperation({ userId: 1, type: "delete", target: {}, origin: "a", ttlMs: 1000, now });

    const later = new Date(now.getTime() + 5000);
    const active = await repository.getActivePendingOperation(1, later);
    expect(active).toBeNull();
  });

  it("apenas uma de duas reivindicações concorrentes (CAS) tem sucesso", async () => {
    const { repository } = createRepository();

    const created = await repository.createPendingOperation({
      userId: 1,
      type: "confirmation",
      target: { mealId: 5 },
      origin: "webhookTextCommands",
      ttlMs: 60_000,
    });

    const [first, second] = await Promise.all([
      repository.claimPendingOperation({ id: created!.id, expectedVersion: created!.version }),
      repository.claimPendingOperation({ id: created!.id, expectedVersion: created!.version }),
    ]);

    const claims = [first.claimed, second.claimed];
    expect(claims.filter(Boolean)).toHaveLength(1);

    const stillActive = await repository.getActivePendingOperation(1);
    expect(stillActive).toBeNull();
  });

  it("falha ao reivindicar com versão desatualizada", async () => {
    const { repository } = createRepository();

    const created = await repository.createPendingOperation({
      userId: 1,
      type: "delete",
      target: {},
      origin: "deleteIntent",
      ttlMs: 60_000,
    });

    const result = await repository.claimPendingOperation({ id: created!.id, expectedVersion: created!.version + 1 });
    expect(result.claimed).toBe(false);
  });

  it("cancela uma pendência ativa e ela deixa de estar disponível", async () => {
    const { repository } = createRepository();

    const created = await repository.createPendingOperation({
      userId: 1,
      type: "selection",
      target: {},
      origin: "gramsAdjustmentIntent",
      ttlMs: 60_000,
    });

    const { cancelled } = await repository.cancelPendingOperation(created!.id);
    expect(cancelled).toBe(true);

    const active = await repository.getActivePendingOperation(1);
    expect(active).toBeNull();
  });

  it("substitui (supersede) uma pendência ativa", async () => {
    const { repository } = createRepository();

    const created = await repository.createPendingOperation({
      userId: 1,
      type: "period_report_clarification",
      target: {},
      origin: "whatsappIntentWebhook",
      ttlMs: 60_000,
    });

    const { superseded } = await repository.supersedePendingOperation(created!.id);
    expect(superseded).toBe(true);

    const active = await repository.getActivePendingOperation(1);
    expect(active).toBeNull();
  });

  describe("retenção (issue #767)", () => {
    it("apaga pendências não ativas mais antigas que o limite operacional", async () => {
      const { repository } = createRepository();

      const created = await repository.createPendingOperation({
        userId: 1, type: "delete", target: {}, origin: "deleteIntent", ttlMs: 60_000,
      });
      // cancelPendingOperation grava updatedAt com o relógio real — as janelas de
      // comparação abaixo usam Date.now() como base para permanecerem coerentes com isso.
      await repository.cancelPendingOperation(created!.id);
      const cancelledAt = Date.now();

      const tooEarly = await repository.purgeInactiveOperations(30, new Date(cancelledAt + 10 * 24 * 60 * 60 * 1000));
      expect(tooEarly).toBe(0);

      const purged = await repository.purgeInactiveOperations(30, new Date(cancelledAt + 31 * 24 * 60 * 60 * 1000));
      expect(purged).toBe(1);
    });

    it("nunca apaga uma pendência ativa, mesmo além do limite operacional", async () => {
      const { repository } = createRepository();

      await repository.createPendingOperation({
        userId: 1, type: "delete", target: {}, origin: "deleteIntent", ttlMs: 60_000,
      });

      const purged = await repository.purgeInactiveOperations(30, new Date(Date.now() + 60 * 24 * 60 * 60 * 1000));
      expect(purged).toBe(0);
    });
  });

  describe("isolamento entre usuários (issue #767)", () => {
    it("nunca retorna a pendência ativa de outro usuário", async () => {
      const { repository } = createRepository();

      const opA = await repository.createPendingOperation({
        userId: 1, type: "delete", target: { mealId: 1 }, origin: "deleteIntent", ttlMs: 60_000,
      });
      await repository.createPendingOperation({
        userId: 2, type: "confirmation", target: { mealId: 2 }, origin: "webhookTextCommands", ttlMs: 60_000,
      });

      const activeForA = await repository.getActivePendingOperation(1);
      const activeForB = await repository.getActivePendingOperation(2);

      expect(activeForA?.id).toBe(opA!.id);
      expect(activeForA?.userId).toBe(1);
      expect(activeForB?.userId).toBe(2);
      expect(activeForA?.id).not.toBe(activeForB?.id);
    });

    it("claim de um id não afeta a pendência ativa de outro usuário", async () => {
      const { repository } = createRepository();

      const opA = await repository.createPendingOperation({
        userId: 1, type: "delete", target: {}, origin: "deleteIntent", ttlMs: 60_000,
      });
      const opB = await repository.createPendingOperation({
        userId: 2, type: "delete", target: {}, origin: "deleteIntent", ttlMs: 60_000,
      });

      await repository.claimPendingOperation({ id: opA!.id, expectedVersion: opA!.version });

      const stillActiveForB = await repository.getActivePendingOperation(2);
      expect(stillActiveForB?.id).toBe(opB!.id);
    });
  });
});
