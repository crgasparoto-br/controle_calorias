import { beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTABLE_FOOD_REGISTRATION_PARITY_CASES } from "./testFixtures/countableFoodRegistrationParityCases";

const getAdminWhatsAppTokenStatusMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const processMealDraftMock = vi.fn();
const processProfessionalAccessWhatsappResponseMock = vi.fn();
const executeWhatsappDatedFoodAdditionIntentMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsAppFoodAssistantIntentMock = vi.fn();

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: getAdminWhatsAppTokenStatusMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
  upsertUserWhatsappConnection: vi.fn(),
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));

vi.mock("../meals/service", () => ({
  processMealDraft: processMealDraftMock,
}));

vi.mock("../professionals/service", () => ({
  processProfessionalAccessWhatsappResponse: processProfessionalAccessWhatsappResponseMock,
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
const { __resetWhatsappInboundIdempotencyForTests } = await import("./inboundIdempotencyGuard");
const { simulateWhatsappInbound } = await import("./service");

describe("issue #1047 — paridade do simulador para registro contável", () => {
  beforeEach(() => {
    clearWhatsappConversationContext();
    __resetWhatsappInboundIdempotencyForTests();
    getAdminWhatsAppTokenStatusMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    processMealDraftMock.mockReset();
    processProfessionalAccessWhatsappResponseMock.mockReset();
    executeWhatsappDatedFoodAdditionIntentMock.mockReset();
    executeWhatsappLlmIntentMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsAppFoodAssistantIntentMock.mockReset();

    processProfessionalAccessWhatsappResponseMock.mockResolvedValue(null);
    executeWhatsappDatedFoodAdditionIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
    processMealDraftMock.mockResolvedValue({
      draftId: "draft-issue-1047-parity",
      processed: { items: [] },
      media: [],
    });
  });

  it.each(COUNTABLE_FOOD_REGISTRATION_PARITY_CASES)(
    "encaminha $id ao fallback nutricional sem esclarecimento genérico",
    async testCase => {
      __resetWhatsappInboundIdempotencyForTests();

      const result = await simulateWhatsappInbound(42, {
        text: testCase.input,
        messageId: `wamid-1047-simulator-${testCase.id}`,
      });

      expect(processMealDraftMock).toHaveBeenCalledWith(42, {
        source: "whatsapp",
        text: testCase.simulatorText,
      }, "America/Sao_Paulo");
      expect(result).toEqual(expect.objectContaining({
        draftId: "draft-issue-1047-parity",
      }));
    },
  );
});
