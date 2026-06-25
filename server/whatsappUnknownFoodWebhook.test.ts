import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const logInferenceEventMock = vi.fn();
const handleWhatsAppWebhookWithAnnotatedImagesMock = vi.fn();

const listUserMealsMock = vi.fn();

vi.mock("./db", () => ({
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  logInferenceEvent: logInferenceEventMock,
  listUserMeals: listUserMealsMock,
}));

vi.mock("./whatsappConfig", () => ({
  getWhatsAppChannelConfig: () => ({ phoneNumberId: "phone-number-test" }),
  requireWhatsAppSendConfig: async () => ({
    accessToken: "access-token-test",
    phoneNumberId: "phone-number-test",
  }),
}));

vi.mock("./whatsappAnnotatedImageWebhook", () => ({
  handleWhatsAppWebhookWithAnnotatedImages: handleWhatsAppWebhookWithAnnotatedImagesMock,
}));

const { __resetWhatsAppTextIntentContextForTests, handleWhatsAppWebhookWithTextIntent } = await import("./whatsappIntentWebhook");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function createTextWebhookRequest(text: string, id = `wamid-${text.length}`) {
  return {
    body: {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "phone-number-test" },
                messages: [
                  {
                    id,
                    from: "5511999999999",
                    timestamp: "1780502400",
                    type: "text",
                    text: { body: text },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}

describe("handleWhatsAppWebhookWithTextIntent unknown food reply", () => {
  let sentMessages: string[];

  beforeEach(() => {
    __resetWhatsAppTextIntentContextForTests();
    sentMessages = [];
    getUserIdByWhatsappPhoneMock.mockReset();
    logInferenceEventMock.mockReset();
    handleWhatsAppWebhookWithAnnotatedImagesMock.mockReset();
    listUserMealsMock.mockReset();
    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    listUserMealsMock.mockResolvedValue([]);
    handleWhatsAppWebhookWithAnnotatedImagesMock.mockImplementation(async (_req, res: MockResponse) => (
      res.status(200).json({ ok: true, processed: 1 })
    ));
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if (payload?.text?.body) {
        sentMessages.push(payload.text.body);
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it("alimento inventado sem quantidade explícita passa pelo LLM classificador antes de desistir", async () => {
    // Com o Ponto 1 implementado, mensagens sem verbo de registro e sem quantidade
    // são encaminhadas ao LLM classificador. O LLM retorna clarification_needed
    // para alimentos ambíguos, em vez de cair direto no fallback food_not_found.
    const req = createTextWebhookRequest("alimento inventado", "unknown-food");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(handleWhatsAppWebhookWithAnnotatedImagesMock).not.toHaveBeenCalled();
    // O LLM classificador é chamado (via executeWhatsappLlmIntent) e retorna clarification_needed
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.llm_intent.clarification_needed",
    }));
  });

  it("alimento com unidade de medida explícita é delegado ao fluxo nutricional sem passar pelo LLM", async () => {
    // Mensagem com unidade de medida explícita (100g) é reconhecida por hasExplicitFoodQuantity
    // e vai direto para o pipeline nutricional sem consultar o LLM classificador
    const req = createTextWebhookRequest("100g de bisnaguinha panco", "known-food-with-unit");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(handleWhatsAppWebhookWithAnnotatedImagesMock).toHaveBeenCalledOnce();
    expect(sentMessages).toEqual([]);
  });
});
