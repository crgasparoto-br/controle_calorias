import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminWhatsAppTokenStatusMock = vi.fn();
const getDbMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const upsertUserWhatsappConnectionMock = vi.fn();
const listMealsMock = vi.fn();
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
  listMeals: listMealsMock,
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

function recentMeal() {
  return {
    id: 10,
    mealLabel: "Almoço",
    occurredAt: "2026-06-14T14:00:00.000Z",
    notes: null,
    items: [{
      foodName: "Arroz branco",
      canonicalName: "Arroz branco",
      portionText: "100 g",
      servings: 1,
      estimatedGrams: 100,
      calories: 130,
      protein: 2.7,
      carbs: 28,
      fat: 0.3,
      confidence: 0.9,
      source: "catalog",
    }],
  };
}

describe("simulateWhatsappInbound", () => {
  beforeEach(() => {
    getAdminWhatsAppTokenStatusMock.mockReset();
    getDbMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    upsertUserWhatsappConnectionMock.mockReset();
    listMealsMock.mockReset();
    processMealDraftMock.mockReset();
    executeWhatsappLlmIntentMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsAppFoodAssistantIntentMock.mockReset();
    getDbMock.mockResolvedValue(null);
    listMealsMock.mockResolvedValue([]);
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

  it("responde sugestao sem acionar LLM, texto ou parser nutricional", async () => {
    const result = await simulateWhatsappInbound(42, {
      text: "sugira um jantar leve",
    });

    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "router_safe_response",
      data: expect.objectContaining({
        canonicalIntent: "sugestao_refeicao",
        shouldAllowNutritionFallback: false,
      }),
    }));
  });

  it("responde urgencia de saude sem acionar LLM, texto ou parser nutricional", async () => {
    const result = await simulateWhatsappInbound(42, {
      text: "estou passando mal e com falta de ar",
    });

    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "router_safe_response",
      reply: expect.stringContaining("Procure um serviço de urgência"),
      data: expect.objectContaining({
        canonicalIntent: "possivel_urgencia_saude",
        shouldAllowNutritionFallback: false,
      }),
    }));
  });

  it("roteia ajuste de registro para confirmacao sem criar nova refeicao", async () => {
    listMealsMock.mockResolvedValue([recentMeal()]);

    const result = await simulateWhatsappInbound(42, {
      text: "troca arroz branco por arroz integral",
      receivedAt: new Date("2026-06-14T15:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "record_adjustment_confirmation_needed",
      reply: expect.stringContaining("trocar Arroz branco por arroz integral"),
    }));
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      origin: "whatsapp",
      eventType: "whatsapp.records.adjustment_confirmation_needed",
    }));
  });
});
