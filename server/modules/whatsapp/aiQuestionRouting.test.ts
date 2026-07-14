import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminWhatsAppTokenStatusMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const upsertUserWhatsappConnectionMock = vi.fn();
const processMealDraftMock = vi.fn();
const processProfessionalAccessWhatsappResponseMock = vi.fn();
const executeWhatsappAiQuestionIntentMock = vi.fn();
const executeWhatsappDatedFoodAdditionIntentMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsAppFoodAssistantIntentMock = vi.fn();

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: getAdminWhatsAppTokenStatusMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
  upsertUserWhatsappConnection: upsertUserWhatsappConnectionMock,
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));

vi.mock("../meals/service", () => ({
  processMealDraft: processMealDraftMock,
}));

vi.mock("../professionals/service", () => ({
  processProfessionalAccessWhatsappResponse: processProfessionalAccessWhatsappResponseMock,
}));

vi.mock("./aiQuestionAssistant", () => ({
  executeWhatsappAiQuestionIntent: executeWhatsappAiQuestionIntentMock,
}));

vi.mock("./datedFoodAdditionIntent", () => ({
  executeWhatsappDatedFoodAdditionIntent: executeWhatsappDatedFoodAdditionIntentMock,
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
const { simulateWhatsappInbound } = await import("./service");

describe("simulateWhatsappInbound slash AI question routing", () => {
  beforeEach(() => {
    clearWhatsappConversationContext();
    getAdminWhatsAppTokenStatusMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    upsertUserWhatsappConnectionMock.mockReset();
    processMealDraftMock.mockReset();
    processProfessionalAccessWhatsappResponseMock.mockReset();
    executeWhatsappAiQuestionIntentMock.mockReset();
    executeWhatsappDatedFoodAdditionIntentMock.mockReset();
    executeWhatsappLlmIntentMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsAppFoodAssistantIntentMock.mockReset();
    processProfessionalAccessWhatsappResponseMock.mockResolvedValue(null);
    executeWhatsappAiQuestionIntentMock.mockResolvedValue(null);
    executeWhatsappDatedFoodAdditionIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
    processMealDraftMock.mockResolvedValue({ draftId: "draft-1" });
  });

  it("responde mensagem iniciada por / antes de contexto, router, LLM e fallback nutricional", async () => {
    executeWhatsappAiQuestionIntentMock.mockResolvedValueOnce({
      handled: true,
      action: "ai_question_answered",
      reply: "Seu consumo de proteína hoje está abaixo da meta.",
      eventType: "whatsapp.ai_question.answered",
      detail: "Pergunta iniciada por / respondida pela IA com contexto do banco de dados do usuário.",
      data: {
        usedUserKnowledgeBase: true,
        internetToolEnabled: true,
      },
    });

    const result = await simulateWhatsappInbound(42, {
      text: "/como está minha proteína hoje?",
      receivedAt: new Date("2026-07-08T12:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
      messageId: "slash-ai-1",
      pendingContextKind: "confirmation",
    });

    expect(executeWhatsappAiQuestionIntentMock).toHaveBeenCalledWith(42, {
      text: "/como está minha proteína hoje?",
      receivedAt: expect.any(Date),
      userTimezone: "America/Sao_Paulo",
    });
    expect(executeWhatsappDatedFoodAdditionIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.ai_question.answered",
    }));
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "ai_question_answered",
      reply: expect.stringContaining("proteína"),
    }));
  });

  it("mantem fluxo atual para mensagem sem /", async () => {
    const result = await simulateWhatsappInbound(42, {
      text: "100g arroz",
      receivedAt: new Date("2026-07-08T12:00:00.000Z"),
      messageId: "meal-1",
    });

    expect(executeWhatsappAiQuestionIntentMock).toHaveBeenCalledWith(42, {
      text: "100 g arroz",
      receivedAt: expect.any(Date),
      userTimezone: undefined,
    });
    expect(processMealDraftMock).toHaveBeenCalledWith(42, {
      source: "whatsapp",
      text: "100 g arroz",
    });
    expect(result).toEqual(expect.objectContaining({ draftId: "draft-1" }));
  });
});
