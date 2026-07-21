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

const fakeDb = createFakePendingOperationDb();

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => fakeDb),
  logPersistenceWarning: vi.fn(),
}));

const executeWhatsappAiQuestionIntentMock = vi.fn();
vi.mock("./aiQuestionAssistant", () => ({
  isWhatsappAiQuestionText: (text?: string | null) => Boolean(text?.trim().startsWith("/")),
  executeWhatsappAiQuestionIntent: executeWhatsappAiQuestionIntentMock,
}));

const handlePendingWhatsAppConfirmationMock = vi.fn();
vi.mock("./webhookTextCommands", () => ({
  handlePendingWhatsAppConfirmation: handlePendingWhatsAppConfirmationMock,
  completeWhatsappGenericConfirmationCallback: vi.fn(),
  PENDING_CONFIRMATION_TYPE: "confirmation",
  CONFIRM_ALL_ACTION: "confirm_all",
}));

const { resolveWhatsAppPrecedenceGate } = await import("./messageRouter");
const { createDrizzleWhatsAppPendingOperationRepository } = await import("../../repositories/whatsappPendingOperationRepository");

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => fakeDb,
  onWarning: vi.fn(),
});

describe("resolveWhatsAppPrecedenceGate", () => {
  beforeEach(() => {
    fakeDb.reset();
    executeWhatsappAiQuestionIntentMock.mockReset();
    handlePendingWhatsAppConfirmationMock.mockReset();
  });

  it("prioriza comando explícito `/` mesmo com pendência de confirmação ativa e não a toca (regra #6 da issue)", async () => {
    const created = await repository.createPendingOperation({
      userId: 1,
      type: "confirmation",
      origin: "webhookTextCommands",
      target: { summary: "Lanche -> Café da manhã" },
      ttlMs: 60_000,
    });
    executeWhatsappAiQuestionIntentMock.mockResolvedValue({
      handled: true,
      action: "ai_question_answered",
      reply: "resposta da pergunta",
      eventType: "whatsapp.ai_question_answered",
      detail: "detalhe",
    });

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 1, text: "/quantas calorias hoje?" });

    expect(decision).toEqual(expect.objectContaining({ step: "ai_question" }));
    expect(handlePendingWhatsAppConfirmationMock).not.toHaveBeenCalled();

    const stillActive = await repository.getActivePendingOperation(1);
    expect(stillActive?.id).toBe(created?.id);
  });

  it("resolve pendência de confirmação genérica ativa antes de continuar o pipeline", async () => {
    await repository.createPendingOperation({
      userId: 2,
      type: "confirmation",
      origin: "webhookTextCommands",
      target: { summary: "Lanche -> Café da manhã" },
      ttlMs: 60_000,
    });
    handlePendingWhatsAppConfirmationMock.mockResolvedValue({
      handled: true,
      reply: "confirmado",
      eventType: "whatsapp.action_applied",
      detail: "detalhe",
    });

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 2, text: "sim" });

    expect(decision).toEqual(expect.objectContaining({ step: "generic_confirmation" }));
    expect(handlePendingWhatsAppConfirmationMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: { body: "sim" } }),
      2,
    );
  });

  it("segue para o pipeline normal quando não há `/` nem pendência de confirmação genérica", async () => {
    const decision = await resolveWhatsAppPrecedenceGate({ userId: 3, text: "100g de arroz" });
    expect(decision).toEqual({ step: "continue_pipeline" });
    expect(executeWhatsappAiQuestionIntentMock).not.toHaveBeenCalled();
    expect(handlePendingWhatsAppConfirmationMock).not.toHaveBeenCalled();
  });

  it("ignora pendências de outro tipo (ex.: delete) e segue para o pipeline normal", async () => {
    await repository.createPendingOperation({
      userId: 4,
      type: "delete",
      origin: "deleteIntent",
      target: { mealId: 10 },
      ttlMs: 60_000,
    });

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 4, text: "sim" });

    expect(decision).toEqual({ step: "continue_pipeline" });
    expect(handlePendingWhatsAppConfirmationMock).not.toHaveBeenCalled();
  });

  it("mensagem incompatível com a pendência de confirmação não a consome e segue o pipeline (regra #5 da issue)", async () => {
    await repository.createPendingOperation({
      userId: 5,
      type: "confirmation",
      origin: "webhookTextCommands",
      target: { summary: "Lanche -> Café da manhã" },
      ttlMs: 60_000,
    });
    handlePendingWhatsAppConfirmationMock.mockResolvedValue(null);

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 5, text: "na verdade quero registrar 200g de frango" });

    expect(decision).toEqual({ step: "continue_pipeline" });
    const stillActive = await repository.getActivePendingOperation(5);
    expect(stillActive).not.toBeNull();
  });
});

describe("reapresentação transversal e resolução textual (issue #858)", () => {
  beforeEach(() => {
    fakeDb.reset();
    executeWhatsappAiQuestionIntentMock.mockReset();
    handlePendingWhatsAppConfirmationMock.mockReset();
  });

  it("palavra de comando isolada durante pendência de exclusão reapresenta os mesmos botões sem consumir a pendência", async () => {
    const created = await repository.createPendingOperation({
      userId: 10,
      type: "delete",
      origin: "deleteIntent",
      target: { kind: "delete_meal", mealId: 7, mealLabel: "Almoço", mealOccurredAt: new Date().toISOString() },
      ttlMs: 60_000,
    });

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 10, text: "registrar" });

    expect(decision.step).toBe("pending_reprompt");
    if (decision.step !== "pending_reprompt") throw new Error("unreachable");
    expect(decision.result.interactiveReply?.messages[0]).toMatchObject({ type: "buttons" });
    expect(decision.result.data).toMatchObject({ pendingType: "delete", fallbackBlocked: true });

    const stillActive = await repository.getActivePendingOperation(10);
    expect(stillActive?.id).toBe(created?.id);
    expect(stillActive?.state).toBe("active");
  });

  it("índice fora da faixa durante seleção de exclusão reapresenta as mesmas opções", async () => {
    await repository.createPendingOperation({
      userId: 11,
      type: "delete",
      origin: "deleteIntent",
      target: {
        kind: "selection",
        targetFoodName: "pão",
        candidates: [
          { kind: "delete_food_from_meal", mealId: 1, mealLabel: "Almoço", mealOccurredAt: new Date().toISOString(), itemIndex: 0, itemName: "Pão francês" },
          { kind: "delete_food_from_meal", mealId: 2, mealLabel: "Lanche", mealOccurredAt: new Date().toISOString(), itemIndex: 1, itemName: "Pão de queijo" },
        ],
      },
      ttlMs: 60_000,
    });

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 11, text: "9" });

    expect(decision.step).toBe("pending_reprompt");
    if (decision.step !== "pending_reprompt") throw new Error("unreachable");
    // 2 candidatos + Cancelar = 3 botões (regra central de componente).
    expect(decision.result.interactiveReply?.messages[0]).toMatchObject({ type: "buttons" });
    const stillActive = await repository.getActivePendingOperation(11);
    expect(stillActive?.state).toBe("active");
  });

  it("resposta válida à pendência de exclusão segue para a cadeia existente (continue_pipeline)", async () => {
    await repository.createPendingOperation({
      userId: 12,
      type: "delete",
      origin: "deleteIntent",
      target: { kind: "delete_meal", mealId: 7, mealLabel: "Almoço", mealOccurredAt: new Date().toISOString() },
      ttlMs: 60_000,
    });

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 12, text: "sim" });
    expect(decision).toEqual({ step: "continue_pipeline" });
  });

  it("comando completo novo não consome a pendência e segue o pipeline", async () => {
    const created = await repository.createPendingOperation({
      userId: 13,
      type: "delete",
      origin: "deleteIntent",
      target: { kind: "delete_meal", mealId: 7, mealLabel: "Almoço", mealOccurredAt: new Date().toISOString() },
      ttlMs: 60_000,
    });

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 13, text: "registrar 100 g de arroz" });
    expect(decision).toEqual({ step: "continue_pipeline" });
    const stillActive = await repository.getActivePendingOperation(13);
    expect(stillActive?.id).toBe(created?.id);
  });

  it("texto numérico resolve a clarificação genérica pela mesma ação canônica do callback", async () => {
    await repository.createPendingOperation({
      userId: 14,
      type: "intent_clarification",
      origin: "intentClarificationInteraction",
      target: { kind: "intent_clarification", originalText: "registrar" },
      ttlMs: 60_000,
    });

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 14, text: "2" });

    expect(decision.step).toBe("pending_text_resolution");
    if (decision.step !== "pending_text_resolution") throw new Error("unreachable");
    expect(decision.result.eventType).toBe("whatsapp.intent_clarification.correct_meal");

    const stillActive = await repository.getActivePendingOperation(14);
    expect(stillActive).toBeNull();
  });

  it("resposta inválida à clarificação genérica reapresenta a lista sem criar nova pendência", async () => {
    const created = await repository.createPendingOperation({
      userId: 15,
      type: "intent_clarification",
      origin: "intentClarificationInteraction",
      target: { kind: "intent_clarification", originalText: "editar" },
      ttlMs: 60_000,
    });

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 15, text: "7" });

    expect(decision.step).toBe("pending_reprompt");
    if (decision.step !== "pending_reprompt") throw new Error("unreachable");
    expect(decision.result.interactiveReply?.messages[0]).toMatchObject({ type: "list" });

    const stillActive = await repository.getActivePendingOperation(15);
    expect(stillActive?.id).toBe(created?.id);
  });
});
