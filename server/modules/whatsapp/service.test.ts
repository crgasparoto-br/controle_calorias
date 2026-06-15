import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminWhatsAppTokenStatusMock = vi.fn();
const getDbMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const upsertUserWhatsappConnectionMock = vi.fn();
const processMealDraftMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsAppFoodAssistantIntentMock = vi.fn();

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: getAdminWhatsAppTokenStatusMock,
  getDb: getDbMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
  upsertUserWhatsappConnection: upsertUserWhatsappConnectionMock,
}));

vi.mock("../meals/service", () => ({
  processMealDraft: processMealDraftMock,
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

const { simulateWhatsappInbound } = await import("./service");

describe("simulateWhatsappInbound", () => {
  beforeEach(() => {
    getAdminWhatsAppTokenStatusMock.mockReset();
    getDbMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    upsertUserWhatsappConnectionMock.mockReset();
    processMealDraftMock.mockReset();
    executeWhatsappLlmIntentMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsAppFoodAssistantIntentMock.mockReset();
    getDbMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
    processMealDraftMock.mockResolvedValue({
      draftId: "draft-1",
      processed: {
        items: [
          {
            foodName: "pão de cenoura",
            canonicalName: "pão de cenoura",
          },
        ],
      },
      media: [],
    });
  });

  it("trata correção 'não é água é pão de cenoura' como alimento corrigido antes da intenção de água", async () => {
    const result = await simulateWhatsappInbound(42, {
      text: "Não é água é pão de cenoura",
    });

    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).toHaveBeenCalledWith(42, {
      source: "whatsapp",
      text: "pão de cenoura",
    });
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      origin: "whatsapp",
      eventType: "whatsapp.intent.food_correction_text_detected",
    }));
    expect(result).toEqual(expect.objectContaining({
      draftId: "draft-1",
    }));
  });

  it("normaliza unidade digitada incorretamente antes de interpretar texto de água", async () => {
    executeWhatsappTextIntentMock.mockResolvedValueOnce({
      handled: true,
      action: "water_logged",
      reply: "Registrei 300 ml de água.",
      eventType: "whatsapp.intent.water_logged",
      detail: "Registro de hidratação via WhatsApp.",
      data: {
        amountMl: 300,
      },
    });

    const result = await simulateWhatsappInbound(42, {
      text: "300mo água",
    });

    expect(executeWhatsappLlmIntentMock).toHaveBeenCalledWith(42, {
      text: "300 ml água",
      receivedAt: expect.any(Date),
    });
    expect(executeWhatsappTextIntentMock).toHaveBeenCalledWith(42, {
      text: "300 ml água",
      receivedAt: expect.any(Date),
    });
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "water_logged",
    }));
  });

  it("separa hidratação e alimentos em mensagens multi-linha antes de processar refeição", async () => {
    executeWhatsappTextIntentMock.mockResolvedValue({
      handled: true,
      action: "water_logged",
      reply: "Registrei 300 ml de água.",
      eventType: "whatsapp.intent.water_logged",
      detail: "Registro de hidratação via WhatsApp.",
      data: {
        amountMl: 300,
      },
    });

    const result = await simulateWhatsappInbound(42, {
      text: "3 bisnaguinhas panco\n300ml água\n19g de mel",
    });

    expect(executeWhatsappTextIntentMock).toHaveBeenCalledTimes(1);
    expect(executeWhatsappTextIntentMock).toHaveBeenCalledWith(42, {
      text: "300 ml água",
      receivedAt: expect.any(Date),
    });
    expect(processMealDraftMock).toHaveBeenCalledWith(42, {
      source: "whatsapp",
      text: "3 bisnaguinhas panco\n19 g de mel",
    });
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "water_and_meal_logged",
      meal: expect.objectContaining({
        draftId: "draft-1",
      }),
      water: [expect.objectContaining({
        action: "water_logged",
      })],
    }));
  });

  it("bloqueia ajuste numerico sem contexto antes do fallback nutricional", async () => {
    const result = await simulateWhatsappInbound(42, {
      text: "somar 30g",
    });

    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "router_safe_response",
      reply: expect.stringContaining("em qual item"),
    }));
  });
});
