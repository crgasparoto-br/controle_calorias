import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const logInferenceEventMock = vi.fn();
const handleWhatsAppWebhookWithAnnotatedImagesMock = vi.fn();

vi.mock("./db", () => ({
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  logInferenceEvent: logInferenceEventMock,
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
    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
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

  it("responde quando alimento simples não existe no catálogo e não cria refeição genérica", async () => {
    const req = createTextWebhookRequest("1 alimento inventado", "unknown-food");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(handleWhatsAppWebhookWithAnnotatedImagesMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.intent.food_not_found",
    }));
    expect(sentMessages.at(-1)).toContain("Não encontrei esse alimento no catálogo ainda");
  });

  it("delega alimento conhecido para o fluxo nutricional normal", async () => {
    const req = createTextWebhookRequest("1 bisnaguinha panco", "known-food");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(handleWhatsAppWebhookWithAnnotatedImagesMock).toHaveBeenCalledOnce();
    expect(sentMessages).toEqual([]);
  });
});
