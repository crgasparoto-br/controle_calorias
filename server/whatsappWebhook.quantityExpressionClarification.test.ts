import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

const { handleWhatsAppWebhook } = await import("./whatsappWebhook");
const { listUserMeals, upsertUserWhatsappConnection } = await import("./db");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload: unknown) => MockResponse;
};

let sentWhatsAppPayloads: any[] = [];

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
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function outboundTextBodies() {
  return sentWhatsAppPayloads
    .map(payload => payload?.text?.body ?? payload?.interactive?.body?.text ?? null)
    .filter((body): body is string => typeof body === "string");
}

function createTextPayload(input: { phone: string; text: string; messageId: string }) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: {
                display_phone_number: "5511000000000",
                phone_number_id: "phone-number-test",
              },
              messages: [
                {
                  from: input.phone,
                  id: input.messageId,
                  timestamp: "1713708840",
                  type: "text",
                  text: { body: input.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("whatsappWebhook quantity expression clarification", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T08:52:00-03:00"));
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-test";
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";
    process.env.QUICK_EDIT_BASE_URL = "https://app.example.com";

    sentWhatsAppPayloads = [];
    createTextResponseMock.mockReset();

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/messages")) {
        const payload = init?.body ? JSON.parse(String(init.body)) : {};
        sentWhatsAppPayloads.push(payload);
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("responde com orientação clara e não registra refeição quando a conta da quantidade é inválida", async () => {
    const userId = 2200001;
    const phone = "5511220000001";
    await upsertUserWhatsappConnection({ userId, phoneNumber: phone, displayName: "Quantidade inválida" });

    const res = createResponse();
    await handleWhatsAppWebhook({ body: createTextPayload({ phone, messageId: "quantity-invalid-1", text: "300g/0 de banana" }) } as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(createTextResponseMock).not.toHaveBeenCalled();
    expect(outboundTextBodies().at(-1)).toContain("divisão por zero");
    expect((await listUserMeals(userId)).filter(meal => meal.source === "whatsapp")).toHaveLength(0);
  });
});
