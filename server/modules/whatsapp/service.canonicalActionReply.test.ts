import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminWhatsAppTokenStatusMock = vi.fn();
const getDbMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const upsertUserWhatsappConnectionMock = vi.fn();
const processMealDraftMock = vi.fn();
const executeWhatsappDatedFoodAdditionIntentMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsAppFoodAssistantIntentMock = vi.fn();

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: getAdminWhatsAppTokenStatusMock,
  getDb: getDbMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
  logPersistenceWarning: vi.fn(),
  upsertUserWhatsappConnection: upsertUserWhatsappConnectionMock,
}));

vi.mock("../meals/service", () => ({
  listMeals: vi.fn().mockResolvedValue([]),
  updateMeal: vi.fn(),
  processMealDraft: processMealDraftMock,
}));

vi.mock("./datedFoodAdditionIntent", () => ({ executeWhatsappDatedFoodAdditionIntent: executeWhatsappDatedFoodAdditionIntentMock }));
vi.mock("./llmIntentActions", () => ({ executeWhatsappLlmIntent: executeWhatsappLlmIntentMock }));
vi.mock("./intentActions", () => ({ executeWhatsappTextIntent: executeWhatsappTextIntentMock }));
vi.mock("./foodAssistant", () => ({ executeWhatsAppFoodAssistantIntent: executeWhatsAppFoodAssistantIntentMock }));

const { clearWhatsappConversationContext } = await import("./conversationContext");
const { simulateWhatsappInbound } = await import("./service");

describe("simulateWhatsappInbound canonical action reply", () => {
  beforeEach(() => {
    clearWhatsappConversationContext();
    vi.clearAllMocks();
    getDbMock.mockResolvedValue(null);
    executeWhatsappDatedFoodAdditionIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
    processMealDraftMock.mockResolvedValue({
      draftId: "draft-1",
      processed: { items: [] },
      media: [],
    });
  });

  it("devolve sem alteração o mesmo contrato canônico produzido pela ação", async () => {
    const canonicalReply = [
      "*Alimento adicionado*",
      "",
      "Refeição atualizada:",
      "🍽️ *Almoço* — 12:00",
      "• 🍚 Arroz branco — 100g",
      "130 kcal | P 2,7 g | C 28 g | G 0,3 g",
      "",
      "*Total da refeição:*",
      "*130 kcal | P 2,7 g | C 28 g | G 0,3 g*",
      "",
      "*Meta:* 2.000 kcal",
      "*Exercícios:* 300 kcal",
      "*Consumo:* 1.850 kcal",
      "*Déficit:* 150 kcal (-7%)",
      "",
      "*Macronutrientes*",
      "• P 110 g (-10 g/-8%)",
      "• C 130 g (-20 g/-13%)",
      "• G 55 g (+5 g/+10%)",
    ].join("\n");
    executeWhatsappTextIntentMock.mockResolvedValue({
      handled: true,
      action: "meal_item_added",
      reply: canonicalReply,
      eventType: "whatsapp.intent.meal_item_added",
      detail: "Alimento adicionado.",
      data: { mealId: 10 },
    });

    const result = await simulateWhatsappInbound(42, {
      text: "comi 100 g de arroz",
      receivedAt: new Date("2026-07-15T15:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
      messageId: "canonical-action-1",
    });

    expect(executeWhatsappTextIntentMock).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({
      action: "meal_item_added",
      reply: canonicalReply,
    }));
  });

  it("encaminha o cenário #970 do simulador sem alterar o comando textual", async () => {
    executeWhatsappTextIntentMock.mockResolvedValue({
      handled: true,
      action: "meal_item_added",
      reply: "Adicionei 3 xícaras de café sem açúcar à refeição Café da manhã.",
      eventType: "whatsapp.intent.meal_item_added",
      detail: "Cenário #970 tratado pelo executor textual canônico.",
      data: { mealId: 970 },
    });

    const text = "Adicionar 3 xícaras de café sem açúcar no café da manhã";
    const result = await simulateWhatsappInbound(42, {
      text,
      receivedAt: new Date("2026-08-12T12:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
      messageId: "issue-970-simulator",
    });

    expect(executeWhatsappTextIntentMock).toHaveBeenCalledWith(42, expect.objectContaining({
      text,
      messageId: "issue-970-simulator",
    }));
    expect(result).toEqual(expect.objectContaining({
      action: "meal_item_added",
    }));
  });
});
