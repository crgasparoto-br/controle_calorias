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

describe("deleteIntent issue #856", () => {
  beforeEach(() => {
    fakePendingOperationDb.reset();
    __resetConversationHistoryForTests();
    listMealsMock.mockReset();
    removeMealMock.mockReset();
    updateMealMock.mockReset();
  });

  it("remove alimento da refeicao nomeada, sem confundir o contexto com exclusao da refeicao", async () => {
    listMealsMock.mockResolvedValue([dinner, lunch]);

    const result = await executeWhatsappDeleteIntent(42, {
      text: "Remover o arroz do almoço",
      receivedAt: new Date("2026-07-20T22:10:00.000Z"),
      entrypoint: "test.namedMeal",
    });

    expect(result).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.intent.delete_food_confirmation_requested",
      data: expect.objectContaining({ mealId: 10, candidateCount: 1 }),
    }));
    expect(result?.reply).toContain("Arroz em Almoço");
    expect(removeMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("usa o contexto conversacional para resolver 'essa refeicao' quando ha mais de um registro", async () => {
    listMealsMock.mockResolvedValue([dinner, lunch]);
    recordConversationTurn(42, "mostrar almoço", "Almoço registrado: Arroz e Queijo minas.", Date.parse("2026-07-20T22:05:00.000Z"));

    const request = await executeWhatsappDeleteIntent(42, {
      text: "Apagar essa refeição",
      receivedAt: new Date("2026-07-20T22:10:00.000Z"),
      entrypoint: "test.conversation",
    });

    expect(request).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.intent.delete_meal_confirmation_requested",
      data: expect.objectContaining({ mealId: 10 }),
    }));
    expect(request?.reply).toContain("Almoço");
  });

  it("falha de forma fechada quando a referencia conversacional nao identifica uma refeicao unica", async () => {
    listMealsMock.mockResolvedValue([dinner, lunch]);

    const result = await executeWhatsappDeleteIntent(42, {
      text: "Apagar essa refeição",
      receivedAt: new Date("2026-07-20T22:10:00.000Z"),
      entrypoint: "test.conversation",
    });

    expect(result).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.intent.delete_clarification_needed",
      data: expect.objectContaining({
        fallbackBlocked: true,
        pendingType: "clarification",
      }),
    }));
    expect(result?.reply).toContain("Não consegui identificar com segurança");
    expect(removeMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("preserva a negacao contextual da issue 841 na refeicao nomeada", async () => {
    listMealsMock.mockResolvedValue([dinner, lunch]);

    const result = await executeWhatsappDeleteIntent(42, {
      text: "Não tem queijo no almoço",
      receivedAt: new Date("2026-07-20T22:10:00.000Z"),
      entrypoint: "test.absence",
    });

    expect(result).toEqual(expect.objectContaining({
      eventType: "whatsapp.intent.delete_food_confirmation_requested",
      data: expect.objectContaining({ mealId: 10 }),
    }));
    expect(result?.reply).toContain("Queijo minas em Almoço");
  });

  it("expoe contrato consumivel pela issue 858 e telemetria sanitizada do entrypoint", async () => {
    listMealsMock.mockResolvedValue([lunch]);

    const result = await executeWhatsappDeleteIntent(42, {
      text: "Excluir o arroz",
      receivedAt: new Date("2026-07-20T22:10:00.000Z"),
      entrypoint: "whatsapp.audio_transcript",
    });

    expect(result?.data).toEqual(expect.objectContaining({
      executor: "deleteIntent",
      fallbackBlocked: true,
      fallbackBlockReason: "destructive_intent",
      pendingType: "confirmation",
      pendingState: "open",
      interaction: expect.objectContaining({
        id: expect.any(Number),
        state: "open",
        type: "confirmation",
        actions: [
          expect.objectContaining({ id: "confirm", label: "Confirmar" }),
          expect.objectContaining({ id: "cancel", label: "Cancelar" }),
        ],
      }),
    }));
    expect(result?.detail).toContain('"entrypoint":"whatsapp.audio_transcript"');
    expect(result?.detail).toContain('"fallbackBlocked":true');
  });
});
