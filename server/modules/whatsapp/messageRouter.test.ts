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
  PENDING_CONFIRMATION_TYPE: "confirmation",
  buildGenericConfirmationActions: vi.fn(() => [
    { id: "confirm", label: "Confirmar", effect: "apply_action" },
    { id: "cancel", label: "Cancelar", effect: "cancel_action" },
  ]),
  handlePendingWhatsAppConfirmation: handlePendingWhatsAppConfirmationMock,
  completeWhatsappGenericConfirmationCallback: vi.fn(),
}));

const executeWhatsappDeleteIntentMock = vi.fn();
vi.mock("./deleteIntent", () => ({
  PENDING_DELETE_TYPE: "delete",
  executeWhatsappDeleteIntent: executeWhatsappDeleteIntentMock,
  completeWhatsappDeleteInteractiveCallback: vi.fn(),
}));

vi.mock("./mealItemSelectionCallback", () => ({
  PENDING_MEAL_ITEM_SELECTION_TYPE: "meal_item_selection",
  buildMealItemSelectionActions: vi.fn(() => []),
  completeMealItemSelectionInteractiveCallback: vi.fn(),
}));

vi.mock("./periodReportClarification", () => ({
  PENDING_PERIOD_REPORT_TYPE: "period_report",
  buildWhatsappPeriodReportActions: vi.fn(() => []),
  buildWhatsappPeriodReportClarificationListReply: vi.fn(),
  completeWhatsappPeriodReportCallback: vi.fn(),
}));

const { resolveWhatsAppPrecedenceGate } = await import("./messageRouter");
const { createDrizzleWhatsAppPendingOperationRepository } = await import("../../repositories/whatsappPendingOperationRepository");

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => fakeDb,
  onWarning: vi.fn(),
});

const deleteResult = {
  handled: true as const,
  action: "clarification_needed" as const,
  reply: "Confirme a exclusão.",
  eventType: "whatsapp.intent.delete_food_confirmation_requested",
  detail: "gate destrutivo",
  data: { fallbackBlocked: true },
};

describe("resolveWhatsAppPrecedenceGate", () => {
  beforeEach(() => {
    fakeDb.reset();
    executeWhatsappAiQuestionIntentMock.mockReset();
    executeWhatsappDeleteIntentMock.mockReset();
    executeWhatsappDeleteIntentMock.mockResolvedValue(null);
    handlePendingWhatsAppConfirmationMock.mockReset();
  });

  it("prioriza comando explícito / e não consulta o executor destrutivo", async () => {
    executeWhatsappAiQuestionIntentMock.mockResolvedValue({
      handled: true,
      action: "ai_question_answered",
      reply: "resposta da pergunta",
      eventType: "whatsapp.ai_question_answered",
      detail: "detalhe",
    });

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 1, text: "/quantas calorias hoje?" });

    expect(decision).toEqual(expect.objectContaining({ step: "ai_question" }));
    expect(executeWhatsappDeleteIntentMock).not.toHaveBeenCalled();
  });

  it("resolve exclusão antes da confirmação genérica e dos parsers alimentares", async () => {
    executeWhatsappDeleteIntentMock.mockResolvedValue(deleteResult);

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 2, text: "Excluir o Registrar" });

    expect(decision).toEqual({ step: "delete_intent", result: deleteResult });
    expect(executeWhatsappDeleteIntentMock).toHaveBeenCalledWith(2, expect.objectContaining({
      text: "Excluir o Registrar",
      entrypoint: "messageRouter.precedenceGate",
    }));
    expect(handlePendingWhatsAppConfirmationMock).not.toHaveBeenCalled();
  });

  it("resolve resposta curta de pendência destrutiva no mesmo gate", async () => {
    executeWhatsappDeleteIntentMock.mockResolvedValue({ ...deleteResult, action: "meal_deleted", reply: "Excluído." });

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 3, text: "sim" });

    expect(decision).toEqual(expect.objectContaining({ step: "delete_intent" }));
    expect(handlePendingWhatsAppConfirmationMock).not.toHaveBeenCalled();
  });

  it("resolve pendência de confirmação genérica quando o executor destrutivo não trata a mensagem", async () => {
    await repository.createPendingOperation({
      userId: 4,
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

    const decision = await resolveWhatsAppPrecedenceGate({ userId: 4, text: "sim" });

    expect(decision).toEqual(expect.objectContaining({ step: "generic_confirmation" }));
    expect(handlePendingWhatsAppConfirmationMock).toHaveBeenCalled();
  });

  it("segue para o pipeline quando nenhuma precedência trata a mensagem", async () => {
    const decision = await resolveWhatsAppPrecedenceGate({ userId: 5, text: "100g de arroz" });

    expect(decision).toEqual({ step: "continue_pipeline" });
    expect(executeWhatsappDeleteIntentMock).toHaveBeenCalled();
    expect(handlePendingWhatsAppConfirmationMock).not.toHaveBeenCalled();
  });
});
