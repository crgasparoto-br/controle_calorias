import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const logInferenceEventMock = vi.hoisted(() => vi.fn());
const processMealDraftMock = vi.hoisted(() => vi.fn());
const executeWhatsappContextualFoodReplacementIntentMock = vi.hoisted(() =>
  vi.fn()
);
const executeWhatsappDatedFoodAdditionIntentMock = vi.hoisted(() => vi.fn());
const executeWhatsappLlmIntentMock = vi.hoisted(() => vi.fn());
const executeWhatsappTextIntentMock = vi.hoisted(() => vi.fn());
const executeWhatsAppFoodAssistantIntentMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: vi.fn(),
  getDb: getDbMock,
  getUserWhatsappConnection: vi.fn(),
  logInferenceEvent: logInferenceEventMock,
  logPersistenceWarning: vi.fn(),
  upsertUserWhatsappConnection: vi.fn(),
}));

vi.mock("../meals/service", () => ({
  listMeals: vi.fn(),
  updateMeal: vi.fn(),
  processMealDraft: processMealDraftMock,
}));

vi.mock("./contextualFoodReplacementIntent", () => ({
  executeWhatsappContextualFoodReplacementIntent:
    executeWhatsappContextualFoodReplacementIntentMock,
}));
vi.mock("./datedFoodAdditionIntent", () => ({
  executeWhatsappDatedFoodAdditionIntent:
    executeWhatsappDatedFoodAdditionIntentMock,
}));
vi.mock("./llmIntentActions", () => ({
  executeWhatsappLlmIntent: executeWhatsappLlmIntentMock,
}));
vi.mock("./intentActions", () => ({
  executeWhatsappTextIntent: executeWhatsappTextIntentMock,
}));
vi.mock("./foodAssistant", () => ({
  executeWhatsAppFoodAssistantIntent: executeWhatsAppFoodAssistantIntentMock,
}));

const { clearWhatsappConversationContext } = await import("./conversationContext");
const { __resetWhatsappInboundIdempotencyForTests } = await import(
  "./inboundIdempotencyGuard"
);
const { simulateWhatsappInbound } = await import("./service");

function mixedResult() {
  return {
    handled: true as const,
    action: "multi_action_confirmation_needed" as const,
    reply: "Encontrei 2 ações. Revise antes de eu alterar qualquer registro.",
    eventType: "whatsapp.multi_action.confirmation_needed" as const,
    detail: "Mensagem mista validada sem persistência antecipada.",
    data: {
      originalText: "",
      actionCount: 2,
      transactionMode: "all_or_nothing" as const,
      partialSuccessAllowed: false as const,
      extractedActions: [],
      validationSummary: {
        pendingConfirmationCount: 2,
        needsClarificationCount: 0,
        blockedCount: 0,
      },
    },
  };
}

describe("simulateWhatsappInbound com substituição e outra família de ação", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWhatsappConversationContext();
    __resetWhatsappInboundIdempotencyForTests();
    getDbMock.mockResolvedValue(null);
    executeWhatsappDatedFoodAdditionIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
    executeWhatsappContextualFoodReplacementIntentMock.mockResolvedValue(null);
  });

  it("delega substituição + correção de quantidade ao handler contextual sem fallback", async () => {
    const text = "Não é arroz, é batata\nCorrigir feijão para 150 g";
    executeWhatsappContextualFoodReplacementIntentMock.mockResolvedValueOnce(
      mixedResult()
    );

    const result = await simulateWhatsappInbound(42, {
      text,
      messageId: "issue-918-mixed-quantity",
      receivedAt: new Date("2026-07-27T11:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(executeWhatsappContextualFoodReplacementIntentMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ text })
    );
    expect(result).toEqual(
      expect.objectContaining({
        handled: true,
        action: "multi_action_confirmation_needed",
        data: expect.objectContaining({ actionCount: 2 }),
      })
    );
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
  });

  it.each([
    "Não é arroz, é batata\nRemover cerveja",
    "Não é arroz, é batata\nAdicionar banana",
  ])("mantém lote misto no parser determinístico antes do fallback: %s", async text => {
    const result = await simulateWhatsappInbound(42, {
      text,
      messageId: `issue-918-${text.includes("Remover") ? "remove" : "add"}`,
      receivedAt: new Date("2026-07-27T11:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toEqual(
      expect.objectContaining({
        handled: true,
        action: expect.stringMatching(/^multi_action_/),
        data: expect.objectContaining({ actionCount: 2 }),
      })
    );
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
  });
});
