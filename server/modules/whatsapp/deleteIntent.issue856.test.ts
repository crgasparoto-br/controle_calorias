import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const removeMealMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  removeMeal: removeMealMock,
  updateMeal: updateMealMock,
}));

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

function createFakePendingOperationDb() {
  let rows: FakeDbRow[] = [];
  let nextId = 1;

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
      result = [...result].sort((a, b) => (b.id as number) - (a.id as number));
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
          const matching = rows.filter(row => matches(row, condition));
          for (const row of matching) Object.assign(row, setPayload);
          return Promise.resolve({ affectedRows: matching.length });
        }),
      };
      return chain;
    }),
    snapshot() {
      return rows.map(row => ({ ...row }));
    },
    reset() {
      rows = [];
      nextId = 1;
    },
  };
}

const fakePendingOperationDb = createFakePendingOperationDb();

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => fakePendingOperationDb),
  logPersistenceWarning: vi.fn(),
}));

const { executeWhatsappDeleteIntent } = await import("./deleteIntent");
const { __resetConversationHistoryForTests, recordConversationTurn } = await import("./conversationHistory");
const { createDrizzleWhatsAppPendingOperationRepository } = await import("../../repositories/whatsappPendingOperationRepository");

const pendingRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => fakePendingOperationDb,
  onWarning: vi.fn(),
});

const lunch = {
  id: 10,
  mealLabel: "Almoço",
  occurredAt: "2026-07-20T15:00:00.000Z",
  notes: "texto",
  items: [
    { foodName: "Arroz", canonicalName: "Arroz branco", portionText: "100 g", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
    { foodName: "Queijo minas", canonicalName: "Queijo minas", portionText: "30 g", calories: 90, protein: 6, carbs: 1, fat: 7 },
  ],
};

const dinner = {
  id: 11,
  mealLabel: "Jantar",
  occurredAt: "2026-07-20T22:00:00.000Z",
  notes: "texto",
  items: [
    { foodName: "Sopa", canonicalName: "Sopa", portionText: "300 ml", calories: 180, protein: 8, carbs: 25, fat: 5 },
  ],
};

const legacyRegistrarMeal = {
  ...lunch,
  id: 30,
  items: [{
    foodName: "Registrar",
    canonicalName: "Registrar",
    portionText: "1 unidade",
    servings: 1,
    estimatedGrams: 0,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 0.1,
    source: "legacy",
  }],
};

describe("deleteIntent issue #856", () => {
  beforeEach(() => {
    fakePendingOperationDb.reset();
    __resetConversationHistoryForTests();
    listMealsMock.mockReset();
    removeMealMock.mockReset();
    updateMealMock.mockReset();
    removeMealMock.mockResolvedValue(undefined);
    updateMealMock.mockImplementation(async (_userId, input) => ({ ...lunch, ...input }));
  });

  it("substitui uma pendência alimentar real por novo comando destrutivo explícito", async () => {
    const previous = await pendingRepository.createPendingOperation({
      userId: 51,
      type: "meal_item_selection",
      origin: "mealItemSelectionCallback",
      ttlMs: 60_000,
      target: { kind: "selection", candidates: [{ mealId: 999 }] },
    });
    listMealsMock.mockResolvedValue([legacyRegistrarMeal]);

    const result = await executeWhatsappDeleteIntent(51, {
      text: "Excluir o Registrar",
      receivedAt: new Date("2026-07-20T22:10:00.000Z"),
      entrypoint: "test.incompatiblePending",
    });

    expect(result).toEqual(expect.objectContaining({
      eventType: "whatsapp.intent.delete_food_confirmation_requested",
      data: expect.objectContaining({ fallbackBlocked: true, pendingType: "confirmation" }),
    }));
    const rows = fakePendingOperationDb.snapshot();
    expect(rows.find(row => row.id === previous?.id)?.state).toBe("superseded");
    expect(rows.at(-1)).toEqual(expect.objectContaining({ type: "delete", state: "active" }));
    expect(removeMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("mantém confirmação destrutiva aberta após resposta inválida e não executa mutação", async () => {
    listMealsMock.mockResolvedValue([lunch]);
    await executeWhatsappDeleteIntent(52, { text: "Excluir o arroz" });

    const invalid = await executeWhatsappDeleteIntent(52, { text: "talvez o arroz" });

    expect(invalid).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.intent.delete_food_confirmation_still_pending",
      data: expect.objectContaining({ fallbackBlocked: true, pendingState: "open" }),
      interactiveReply: expect.any(Object),
    }));
    expect(removeMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();

    const confirmed = await executeWhatsappDeleteIntent(52, { text: "sim" });
    expect(confirmed).toEqual(expect.objectContaining({ action: "meal_item_deleted" }));
    expect(updateMealMock).toHaveBeenCalledTimes(1);
  });

  it("cria seleção ordenada quando existem várias refeições com o mesmo rótulo", async () => {
    const recentLunch = {
      ...lunch,
      id: 12,
      occurredAt: "2026-07-21T15:00:00.000Z",
      items: [{ ...lunch.items[0], foodName: "Feijão" }],
    };
    listMealsMock.mockResolvedValue([lunch, recentLunch, dinner]);

    const selection = await executeWhatsappDeleteIntent(53, {
      text: "Apagar o almoço",
      timeZone: "America/Sao_Paulo",
    });

    expect(selection).toEqual(expect.objectContaining({
      eventType: "whatsapp.intent.delete_meal_selection_requested",
      data: expect.objectContaining({
        candidateCount: 2,
        pendingType: "selection",
        interaction: expect.objectContaining({
          candidates: [
            expect.objectContaining({ kind: "delete_meal", mealId: 12, order: 1 }),
            expect.objectContaining({ kind: "delete_meal", mealId: 10, order: 2 }),
          ],
        }),
      }),
    }));
    expect(removeMealMock).not.toHaveBeenCalled();

    const confirmation = await executeWhatsappDeleteIntent(53, { text: "2" });
    expect(confirmation).toEqual(expect.objectContaining({
      eventType: "whatsapp.intent.delete_meal_confirmation_requested",
      data: expect.objectContaining({ mealId: 10 }),
    }));

    const completed = await executeWhatsappDeleteIntent(53, { text: "sim" });
    expect(completed).toEqual(expect.objectContaining({ action: "meal_deleted" }));
    expect(removeMealMock).toHaveBeenCalledWith(53, 10);
    expect(removeMealMock).toHaveBeenCalledTimes(1);
  });

  it("não escolhe silenciosamente a refeição mais recente quando o comando é genérico", async () => {
    listMealsMock.mockResolvedValue([dinner, lunch]);

    const result = await executeWhatsappDeleteIntent(54, { text: "Remover refeição" });

    expect(result).toEqual(expect.objectContaining({
      eventType: "whatsapp.intent.delete_meal_selection_requested",
      data: expect.objectContaining({ candidateCount: 2, pendingType: "selection" }),
    }));
    expect(removeMealMock).not.toHaveBeenCalled();
  });

  it("remove alimento da refeição nomeada sem confundir contexto com exclusão da refeição", async () => {
    listMealsMock.mockResolvedValue([dinner, lunch]);

    const result = await executeWhatsappDeleteIntent(42, {
      text: "Remover o arroz do almoço",
      receivedAt: new Date("2026-07-20T22:10:00.000Z"),
      entrypoint: "test.namedMeal",
    });

    expect(result).toEqual(expect.objectContaining({
      eventType: "whatsapp.intent.delete_food_confirmation_requested",
      data: expect.objectContaining({ mealId: 10, candidateCount: 1 }),
    }));
    expect(result?.reply).toContain("Arroz em Almoço");
  });

  it("usa contexto conversacional somente quando identifica uma refeição única", async () => {
    listMealsMock.mockResolvedValue([dinner, lunch]);
    recordConversationTurn(42, "mostrar almoço", "Almoço registrado: Arroz e Queijo minas.", Date.parse("2026-07-20T22:05:00.000Z"));

    const request = await executeWhatsappDeleteIntent(42, {
      text: "Apagar essa refeição",
      receivedAt: new Date("2026-07-20T22:10:00.000Z"),
    });

    expect(request).toEqual(expect.objectContaining({
      eventType: "whatsapp.intent.delete_meal_confirmation_requested",
      data: expect.objectContaining({ mealId: 10 }),
    }));
  });

  it("falha de forma fechada quando referência conversacional não é única", async () => {
    listMealsMock.mockResolvedValue([dinner, lunch]);

    const result = await executeWhatsappDeleteIntent(55, { text: "Apagar essa refeição" });

    expect(result).toEqual(expect.objectContaining({
      eventType: "whatsapp.intent.delete_clarification_needed",
      data: expect.objectContaining({ fallbackBlocked: true }),
    }));
    expect(result?.reply).toContain("Não consegui identificar com segurança");
  });

  it("preserva negação contextual da issue #841", async () => {
    listMealsMock.mockResolvedValue([dinner, lunch]);

    const result = await executeWhatsappDeleteIntent(56, { text: "Não tem queijo no almoço" });

    expect(result).toEqual(expect.objectContaining({
      eventType: "whatsapp.intent.delete_food_confirmation_requested",
      data: expect.objectContaining({ mealId: 10 }),
    }));
    expect(result?.reply).toContain("Queijo minas em Almoço");
  });
});
