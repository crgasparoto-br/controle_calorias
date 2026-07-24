import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(async () => null),
  getUserWhatsappConnection: vi.fn(),
  logInferenceEvent: vi.fn(),
  listMeals: vi.fn(async () => []),
  updateMeal: vi.fn(),
  processMealDraft: vi.fn(),
  datedFoodAddition: vi.fn(async () => null),
  llmIntent: vi.fn(async () => null),
  textIntent: vi.fn(),
  foodAssistant: vi.fn(() => null),
}));

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: vi.fn(),
  getDb: mocks.getDb,
  getUserWhatsappConnection: mocks.getUserWhatsappConnection,
  logInferenceEvent: mocks.logInferenceEvent,
  logPersistenceWarning: vi.fn(),
  upsertUserWhatsappConnection: vi.fn(),
}));

vi.mock("../meals/service", () => ({
  listMeals: mocks.listMeals,
  updateMeal: mocks.updateMeal,
  processMealDraft: mocks.processMealDraft,
}));

vi.mock("./datedFoodAdditionIntent", () => ({
  executeWhatsappDatedFoodAdditionIntent: mocks.datedFoodAddition,
}));
vi.mock("./llmIntentActions", () => ({
  executeWhatsappLlmIntent: mocks.llmIntent,
}));
vi.mock("./intentActions", () => ({
  executeWhatsappTextIntent: mocks.textIntent,
}));
vi.mock("./foodAssistant", () => ({
  executeWhatsAppFoodAssistantIntent: mocks.foodAssistant,
}));

const { simulateWhatsappInbound } = await import("./service");

const clarificationResult = {
  handled: true,
  action: "food_clarification_requested",
  reply: "Informe somente a quantidade de açúcar.",
  eventType: "whatsapp.food_clarification.requested",
  detail: "Pendência persistente criada antes da pergunta.",
};

describe("paridade do café adoçado no simulador", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.textIntent.mockResolvedValue(clarificationResult);
    mocks.processMealDraft.mockResolvedValue({ draftId: "unexpected" });
  });

  it("usa o mesmo intent textual e não cai no fallback nutricional", async () => {
    const receivedAt = new Date("2026-07-24T12:00:00.000Z");
    const result = await simulateWhatsappInbound(903, {
      text: "1 xícara de café com açúcar",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid-simulate-coffee-sugar",
    });

    expect(mocks.textIntent).toHaveBeenCalledWith(903, {
      text: "1 xícara de café com açúcar",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid-simulate-coffee-sugar",
    });
    expect(mocks.processMealDraft).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      action: "food_clarification_requested",
      eventType: "whatsapp.food_clarification.requested",
    }));
  });
});
