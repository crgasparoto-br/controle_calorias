import { beforeEach, describe, expect, it, vi } from "vitest";
import { whatsappPendingOperations } from "../../drizzle/schema";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  PENDING_OPERATION_PROCESSING_LEASE_MS,
} from "./whatsappPendingOperationRepository";

vi.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, val: unknown) => ({ __op: "eq", col, val }),
  ne: (col: { name: string }, val: unknown) => ({ __op: "ne", col, val }),
  gt: (col: { name: string }, val: unknown) => ({ __op: "gt", col, val }),
  gte: (col: { name: string }, val: unknown) => ({ __op: "gte", col, val }),
  lt: (col: { name: string }, val: unknown) => ({ __op: "lt", col, val }),
  desc: (col: { name: string }) => ({ __op: "desc", col }),
  and: (...conditions: unknown[]) => ({ __op: "and", conditions }),
  or: (...conditions: unknown[]) => ({ __op: "or", conditions }),
}));

type Row = Record<string, unknown>;
type EqCondition = { __op: "eq" | "ne"; col: { name: string }; val: unknown };
type CompareCondition = {
  __op: "gt" | "gte" | "lt";
  col: { name: string };
  val: unknown;
};
type AndCondition = { __op: "and"; conditions: Condition[] };
type OrCondition = { __op: "or"; conditions: Condition[] };
type OrderCondition = { __op: "desc"; col: { name: string } };
type Condition =
  | EqCondition
  | CompareCondition
  | AndCondition
  | OrCondition
  | OrderCondition;

/**
 * Fake DB que suporta `and()` combinando `eq()` e reporta `affectedRows` no
 * update, o suficiente para exercitar de forma genuína o CAS (compare-and-swap)
 * exigido pela issue #766: apenas uma de duas atualizações concorrentes que
 * casam a mesma condição de estado+versão deve ter sucesso.
 */
function createFakeDb(
  options: {
    insertResult?: (id: number) => unknown;
  } = {}
) {
  let rows: Row[] = [];
  let nextId = 1;

  function matches(row: Row, condition?: Condition): boolean {
    if (!condition) return true;
    if (condition.__op === "eq")
      return row[condition.col.name] === condition.val;
    if (condition.__op === "ne")
      return row[condition.col.name] !== condition.val;
    if (
      condition.__op === "lt" ||
      condition.__op === "gt" ||
      condition.__op === "gte"
    ) {
      const value =
        row[condition.col.name] instanceof Date
          ? (row[condition.col.name] as Date).getTime()
          : row[condition.col.name];
      const compareTo =
        condition.val instanceof Date ? condition.val.getTime() : condition.val;
      return condition.__op === "lt"
        ? (value as number) < (compareTo as number)
        : condition.__op === "gt"
          ? (value as number) > (compareTo as number)
          : (value as number) >= (compareTo as number);
    }
    if (condition.__op === "and")
      return condition.conditions.every(inner => matches(row, inner));
    if (condition.__op === "or")
      return condition.conditions.some(inner => matches(row, inner));
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

  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => createSelectChain()) })),
    insert: vi.fn(() => ({
      values: vi.fn((payload: Row) => {
        if (
          payload.dedupeKey &&
          rows.some(
            row => row.dedupeKey === payload.dedupeKey && row.state === "active"
          )
        ) {
          return Promise.reject(new Error("duplicate dedupe key"));
        }
        const id = nextId++;
        rows.push({ id, ...payload });
        return Promise.resolve(
          options.insertResult ? options.insertResult(id) : { insertId: id }
        );
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

  return db;
}

function createRepository(options?: Parameters<typeof createFakeDb>[0]) {
  const db = createFakeDb(options);
  const onWarning = vi.fn();
  const repository = createDrizzleWhatsAppPendingOperationRepository({
    getDb: async () => db,
    onWarning,
  });
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

  it("retorna a pendência existente quando duas criações disputam a mesma chave", async () => {
    const { repository } = createRepository();
    const input = {
      userId: 42,
      type: "nutrition_label_photo_request",
      target: { mealId: 900, itemIndex: 0 },
      dedupeKey: "nutrition_label_photo_request:42:900:0",
      origin: "nutritionLabelCandidateService",
      ttlMs: 10 * 60 * 1000,
    };

    const [first, second] = await Promise.all([
      repository.createPendingOperation(input),
      repository.createPendingOperation(input),
    ]);

    expect(first?.id).toBe(second?.id);
    expect(first?.dedupeKey).toBe(input.dedupeKey);
  });

  it("rele a pendência criada quando o insert retorna insertId direto", async () => {
    const { repository } = createRepository({
      insertResult: id => ({ insertId: id }),
    });

    const created = await repository.createPendingOperation({
      userId: 1,
      type: "food_registration_clarification",
      target: { kind: "food_registration_clarification" },
      origin: "foodClarification",
      ttlMs: 10 * 60 * 1000,
    });

    expect(created).toEqual(
      expect.objectContaining({
        userId: 1,
        type: "food_registration_clarification",
        origin: "foodClarification",
        target: { kind: "food_registration_clarification" },
        state: "active",
        version: 1,
      })
    );
  });

  it("rele a pendência criada quando o insert retorna cabeçalho em array/tupla", async () => {
    const { repository } = createRepository({
      insertResult: id => [{ insertId: id, affectedRows: 1 }, []],
    });

    const created = await repository.createPendingOperation({
      userId: 1,
      type: "food_registration_clarification",
      target: { kind: "food_registration_clarification" },
      origin: "foodClarification",
      ttlMs: 10 * 60 * 1000,
    });

    expect(created).toEqual(
      expect.objectContaining({
        userId: 1,
        type: "food_registration_clarification",
        origin: "foodClarification",
        target: { kind: "food_registration_clarification" },
        state: "active",
        version: 1,
      })
    );
  });

  it.each([
    ["sem insertId", {}],
    ["insertId zero", { insertId: 0 }],
    ["insertId NaN", { insertId: Number.NaN }],
    ["insertId negativo", { insertId: -1 }],
    ["insertId fracionário", { insertId: 1.5 }],
    ["insertId inválido em tupla", [{ insertId: 0 }, []]],
  ])(
    "falha fechado sem releitura quando o retorno do insert é inválido: %s",
    async (_case, insertResult) => {
      const { db, onWarning, repository } = createRepository({
        insertResult: () => insertResult,
      });

      const created = await repository.createPendingOperation({
        userId: 1,
        type: "food_registration_clarification",
        target: { kind: "food_registration_clarification" },
        origin: "foodClarification",
        ttlMs: 10 * 60 * 1000,
      });

      expect(created).toBeNull();
      expect(db.insert).toHaveBeenCalledTimes(1);
      expect(db.select).not.toHaveBeenCalled();
      expect(onWarning).toHaveBeenCalledWith(
        "WhatsApp pending operation create returned invalid insert id",
        expect.any(Error)
      );
      expect(
        `${onWarning.mock.calls[0]?.[0]} ${onWarning.mock.calls[0]?.[1]?.message}`
      ).not.toContain("food_registration_clarification");
    }
  );

  it("retorna a pendência ativa mais recente do usuário", async () => {
    const { repository } = createRepository();
    const now = new Date("2026-07-10T10:00:00Z");

    await repository.createPendingOperation({
      userId: 1,
      type: "delete",
      target: {},
      origin: "a",
      ttlMs: 60_000,
      now,
    });
    const second = await repository.createPendingOperation({
      userId: 1,
      type: "confirmation",
      target: {},
      origin: "b",
      ttlMs: 60_000,
      now,
    });

    const active = await repository.getActivePendingOperation(1, now);
    expect(active?.id).toBe(second?.id);
  });

  it("retorna a pendência ativa do tipo solicitado mesmo quando outra mensagem abriu uma pendência mais recente", async () => {
    const { repository } = createRepository();
    const now = new Date("2026-07-10T10:00:00Z");

    const labelRequest = await repository.createPendingOperation({
      userId: 1,
      type: "nutrition_label_photo_request",
      target: {
        kind: "nutrition_label_photo_request",
        mealId: 10,
        itemIndex: 0,
      },
      origin: "nutritionLabelCandidateService",
      ttlMs: 60_000,
      now,
    });
    await repository.createPendingOperation({
      userId: 1,
      type: "food_registration_clarification",
      target: { kind: "food_registration_clarification" },
      origin: "foodClarification",
      ttlMs: 60_000,
      now,
    });

    const active = await repository.getActivePendingOperationByType?.(
      1,
      "nutrition_label_photo_request",
      now
    );
    expect(active?.id).toBe(labelRequest?.id);
    const allActive = await repository.listActivePendingOperationsByType?.(
      1,
      "nutrition_label_photo_request",
      now
    );
    expect(allActive?.map(operation => operation.id)).toEqual([
      labelRequest?.id,
    ]);
  });

  it("não retorna pendência expirada", async () => {
    const { repository } = createRepository();
    const now = new Date("2026-07-10T10:00:00Z");

    await repository.createPendingOperation({
      userId: 1,
      type: "delete",
      target: {},
      origin: "a",
      ttlMs: 1000,
      now,
    });

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
      repository.claimPendingOperation({
        id: created!.id,
        expectedVersion: created!.version,
      }),
      repository.claimPendingOperation({
        id: created!.id,
        expectedVersion: created!.version,
      }),
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

    const result = await repository.claimPendingOperation({
      id: created!.id,
      expectedVersion: created!.version + 1,
    });
    expect(result.claimed).toBe(false);
  });

  it("converte lease abandonada em review_required e nunca repete automaticamente", async () => {
    const { repository } = createRepository();
    const now = new Date("2026-09-01T10:00:00.000Z");
    const created = await repository.createPendingOperation({
      userId: 1,
      type: "meal_item_selection",
      target: { continuation: { plan: "complete" } },
      origin: "mealItemSelectionCallback",
      ttlMs: 10 * 60 * 1000,
      now,
    });

    const [first, racing] = await Promise.all([
      repository.beginPendingOperationProcessing({
        id: created!.id,
        expectedVersion: created!.version,
        now,
      }),
      repository.beginPendingOperationProcessing({
        id: created!.id,
        expectedVersion: created!.version,
        now,
      }),
    ]);
    expect([first.claimed, racing.claimed].filter(Boolean)).toHaveLength(1);
    expect(first.claimed ? first.version : racing.version).toBe(2);

    const duringLease = await repository.getActivePendingOperation(
      1,
      new Date(now.getTime() + 1)
    );
    expect(duringLease?.state).toBe("processing");

    // A crash leaves the mutation outcome ambiguous; after the lease, the row
    // is quarantined instead of reactivating a potentially applied increment.
    const abandonedAt = new Date(
      now.getTime() + PENDING_OPERATION_PROCESSING_LEASE_MS
    );
    const review = await repository.getActivePendingOperation(1, abandonedAt);
    expect(review).toMatchObject({
      state: "review_required",
      version: 3,
      id: created!.id,
    });
    const retry = await repository.beginPendingOperationProcessing({
      id: review!.id,
      expectedVersion: review!.version,
      now: abandonedAt,
    });
    expect(retry).toEqual({ claimed: false });
    expect(
      await repository.getActivePendingOperation(1, abandonedAt)
    ).toMatchObject({
      state: "review_required",
      version: 3,
    });
  });

  it("libera uma falha comprovadamente sem mutação e conserva a pendência para retry", async () => {
    const { repository } = createRepository();
    const created = await repository.createPendingOperation({
      userId: 1,
      type: "meal_item_selection",
      target: { continuation: { plan: "complete" } },
      origin: "mealItemSelectionCallback",
      ttlMs: 60_000,
    });
    const claim = await repository.beginPendingOperationProcessing({
      id: created!.id,
      expectedVersion: 1,
    });
    expect(claim.claimed).toBe(true);

    expect(
      await repository.releasePendingOperationProcessing({
        id: created!.id,
        expectedVersion: claim.version!,
      })
    ).toEqual({ released: true });
    expect(await repository.getActivePendingOperation(1)).toMatchObject({
      state: "active",
      version: 3,
      target: created!.target,
    });
  });

  it("retém contexto em estado review_required quando o resultado da mutação é incerto", async () => {
    const { repository } = createRepository();
    const created = await repository.createPendingOperation({
      userId: 1,
      type: "meal_item_selection",
      target: { continuation: { plan: "complete" } },
      origin: "mealItemSelectionCallback",
      ttlMs: 60_000,
    });
    const claim = await repository.beginPendingOperationProcessing({
      id: created!.id,
      expectedVersion: 1,
    });

    expect(
      await repository.requirePendingOperationVerification({
        id: created!.id,
        expectedVersion: claim.version!,
      })
    ).toEqual({ required: true });
    expect(await repository.getPendingOperationById(created!.id)).toMatchObject(
      {
        state: "review_required",
        version: 3,
        target: created!.target,
      }
    );
    expect(await repository.getActivePendingOperation(1)).toMatchObject({
      id: created!.id,
      state: "review_required",
      version: 3,
    });
  });

  it("prioriza a revisão incerta sobre uma nova pendência do mesmo usuário", async () => {
    const { db, repository } = createRepository();
    const created = await repository.createPendingOperation({
      userId: 34,
      type: "meal_item_selection",
      target: { action: "grams_delta" },
      origin: "mealItemSelectionCallback",
      ttlMs: 10 * 60 * 1000,
    });
    const claim = await repository.beginPendingOperationProcessing({
      id: created!.id,
      expectedVersion: created!.version,
    });
    await repository.requirePendingOperationVerification({
      id: created!.id,
      expectedVersion: claim.version!,
    });

    const newer = await repository.createPendingOperation({
      userId: 34,
      type: "another_operation",
      target: {},
      origin: "test",
      ttlMs: 60_000,
    });
    expect(newer).not.toBeNull();
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(await repository.getActivePendingOperation(34)).toMatchObject({
      id: created!.id,
      state: "review_required",
    });
  });

  it("expira a revisão ao atingir o TTL sem reabrir a claim", async () => {
    const { repository } = createRepository();
    const createdAt = new Date("2026-09-02T10:00:00.000Z");
    const created = await repository.createPendingOperation({
      userId: 33,
      type: "meal_item_selection",
      target: { action: "grams_delta" },
      origin: "mealItemSelectionCallback",
      ttlMs: 10 * 60 * 1000,
      now: createdAt,
    });
    const claim = await repository.beginPendingOperationProcessing({
      id: created!.id,
      expectedVersion: 1,
      now: createdAt,
    });
    const reviewAt = new Date(
      createdAt.getTime() + PENDING_OPERATION_PROCESSING_LEASE_MS
    );
    await repository.getActivePendingOperation(33, reviewAt);

    const afterTtl = new Date(createdAt.getTime() + 10 * 60 * 1000 + 1);
    expect(await repository.getActivePendingOperation(33, afterTtl)).toBeNull();
    expect(
      await repository.getPendingOperationById(created!.id, afterTtl)
    ).toMatchObject({
      state: "expired",
      version: claim.version! + 2,
    });
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

    const { superseded } = await repository.supersedePendingOperation(
      created!.id
    );
    expect(superseded).toBe(true);

    const active = await repository.getActivePendingOperation(1);
    expect(active).toBeNull();
  });

  describe("retenção (issue #767)", () => {
    it("apaga pendências não ativas mais antigas que o limite operacional", async () => {
      const { repository } = createRepository();

      const created = await repository.createPendingOperation({
        userId: 1,
        type: "delete",
        target: {},
        origin: "deleteIntent",
        ttlMs: 60_000,
      });
      // cancelPendingOperation grava updatedAt com o relógio real — as janelas de
      // comparação abaixo usam Date.now() como base para permanecerem coerentes com isso.
      await repository.cancelPendingOperation(created!.id);
      const cancelledAt = Date.now();

      const tooEarly = await repository.purgeInactiveOperations(
        30,
        new Date(cancelledAt + 10 * 24 * 60 * 60 * 1000)
      );
      expect(tooEarly).toBe(0);

      const purged = await repository.purgeInactiveOperations(
        30,
        new Date(cancelledAt + 31 * 24 * 60 * 60 * 1000)
      );
      expect(purged).toBe(1);
    });

    it("nunca apaga uma pendência ativa, mesmo além do limite operacional", async () => {
      const { repository } = createRepository();

      await repository.createPendingOperation({
        userId: 1,
        type: "delete",
        target: {},
        origin: "deleteIntent",
        ttlMs: 60_000,
      });

      const purged = await repository.purgeInactiveOperations(
        30,
        new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      );
      expect(purged).toBe(0);
    });
  });

  describe("expiração explícita de pendências (issue #997)", () => {
    it("transiciona pendências expiradas em leituras genéricas e tipadas", async () => {
      const { repository } = createRepository();
      const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1000);
      const expiredReadAt = new Date(expiresAt.getTime() + 1);
      const generic = await repository.createPendingOperation({
        userId: 10,
        type: "generic_expiry",
        target: { key: "generic" },
        origin: "test",
        ttlMs: 60 * 60 * 1000,
        now: createdAt,
      });
      const typed = await repository.createPendingOperation({
        userId: 10,
        type: "typed_expiry",
        target: { key: "typed" },
        origin: "test",
        ttlMs: 60 * 60 * 1000,
        now: createdAt,
      });

      expect(
        await repository.getActivePendingOperation(10, expiredReadAt)
      ).toBeNull();
      expect(
        await repository.getActivePendingOperationByType!(
          10,
          "typed_expiry",
          expiredReadAt
        )
      ).toBeNull();
      expect(
        await repository.getPendingOperationById(generic!.id)
      ).toMatchObject({
        state: "expired",
        version: 2,
        dedupeKey: null,
      });
      expect(await repository.getPendingOperationById(typed!.id)).toMatchObject(
        {
          state: "expired",
          version: 2,
          dedupeKey: null,
        }
      );
    });

    it("transiciona a pendência expirada vista pela lista e encerra processing por CAS", async () => {
      const { repository } = createRepository();
      const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const expiredReadAt = new Date(createdAt.getTime() + 60 * 60 * 1000 + 1);
      const listed = await repository.createPendingOperation({
        userId: 11,
        type: "listed_expiry",
        target: { key: "listed" },
        origin: "test",
        ttlMs: 60 * 60 * 1000,
        now: createdAt,
      });
      const processing = await repository.createPendingOperation({
        userId: 12,
        type: "processing_expiry",
        target: { key: "processing" },
        origin: "test",
        ttlMs: 60 * 60 * 1000,
        now: createdAt,
      });
      const began = await repository.beginPendingOperationProcessing({
        id: processing!.id,
        expectedVersion: 1,
        now: new Date(createdAt.getTime() + 10 * 60 * 1000),
      });
      expect(began).toEqual({ claimed: true, version: 2 });

      expect(
        await repository.listActivePendingOperationsByType!(
          11,
          "listed_expiry",
          expiredReadAt
        )
      ).toEqual([]);
      expect(
        await repository.getActivePendingOperation(12, expiredReadAt)
      ).toBeNull();
      expect(
        await repository.getPendingOperationById(listed!.id)
      ).toMatchObject({ state: "expired", version: 2 });
      expect(
        await repository.getPendingOperationById(processing!.id)
      ).toMatchObject({ state: "expired", version: 3 });
    });

    it("rejeita claim após TTL e purga a linha somente após a retenção do estado terminal", async () => {
      const { repository } = createRepository();
      const createdAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const created = await repository.createPendingOperation({
        userId: 13,
        type: "expired_claim",
        target: {},
        origin: "test",
        ttlMs: 60 * 60 * 1000,
        dedupeKey: "expired-claim-997",
        now: createdAt,
      });

      expect(
        await repository.claimPendingOperation({
          id: created!.id,
          expectedVersion: 1,
        })
      ).toEqual({ claimed: false });
      expect(
        await repository.getPendingOperationById(created!.id)
      ).toMatchObject({
        state: "expired",
        version: 2,
        dedupeKey: null,
      });

      const expirationObservedAt = new Date();
      expect(
        await repository.purgeInactiveOperations(
          30,
          new Date(expirationObservedAt.getTime() + 10 * 24 * 60 * 60 * 1000)
        )
      ).toBe(0);
      expect(
        await repository.getPendingOperationById(created!.id)
      ).toMatchObject({ state: "expired" });
      expect(
        await repository.purgeInactiveOperations(
          30,
          new Date(expirationObservedAt.getTime() + 31 * 24 * 60 * 60 * 1000)
        )
      ).toBe(1);
      expect(await repository.getPendingOperationById(created!.id)).toBeNull();
    });
  });

  describe("isolamento entre usuários (issue #767)", () => {
    it("nunca retorna a pendência ativa de outro usuário", async () => {
      const { repository } = createRepository();

      const opA = await repository.createPendingOperation({
        userId: 1,
        type: "delete",
        target: { mealId: 1 },
        origin: "deleteIntent",
        ttlMs: 60_000,
      });
      await repository.createPendingOperation({
        userId: 2,
        type: "confirmation",
        target: { mealId: 2 },
        origin: "webhookTextCommands",
        ttlMs: 60_000,
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
        userId: 1,
        type: "delete",
        target: {},
        origin: "deleteIntent",
        ttlMs: 60_000,
      });
      const opB = await repository.createPendingOperation({
        userId: 2,
        type: "delete",
        target: {},
        origin: "deleteIntent",
        ttlMs: 60_000,
      });

      await repository.claimPendingOperation({
        id: opA!.id,
        expectedVersion: opA!.version,
      });

      const stillActiveForB = await repository.getActivePendingOperation(2);
      expect(stillActiveForB?.id).toBe(opB!.id);
    });
  });
});
