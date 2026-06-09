import { beforeEach, describe, expect, it, vi } from "vitest";

const downstreamWebhookMock = vi.fn();
const createUserWaterLogMock = vi.fn();
const getUserIdByWhatsappPhoneMock = vi.fn();
const listUserExercisesMock = vi.fn();
const logInferenceEventMock = vi.fn();

vi.mock("./db", () => ({
  createUserWaterLog: createUserWaterLogMock,
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  listUserExercises: listUserExercisesMock,
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("./whatsappConfig", () => ({
  requireWhatsAppMediaConfig: async () => ({ accessToken: "token-test" }),
  requireWhatsAppSendConfig: async () => ({ accessToken: "token-test", phoneNumberId: "phone-number-test" }),
}));

vi.mock("./whatsappIntentWebhook", () => ({
  handleWhatsAppWebhookWithTextIntent: downstreamWebhookMock,
}));

const {
  __resetWhatsAppImageIdempotencyForTests,
  handleWhatsAppWebhookWithImageIdempotency,
} = await import("./whatsappImageIdempotencyWebhook");

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

function createImageWebhookRequest(caption?: string) {
  return {
    body: {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: caption ? "wamid-image-caption" : "wamid-image-1",
                    from: "5511999999999",
                    timestamp: "1780502400",
                    type: "image",
                    image: {
                      id: "media-image-1",
                      mime_type: "image/jpeg",
                      ...(caption ? { caption } : {}),
                    },
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

describe("handleWhatsAppWebhookWithImageIdempotency", () => {
  let sentBodies: string[];

  beforeEach(() => {
    __resetWhatsAppImageIdempotencyForTests();
    sentBodies = [];
    downstreamWebhookMock.mockReset();
    createUserWaterLogMock.mockReset();
    getUserIdByWhatsappPhoneMock.mockReset();
    listUserExercisesMock.mockReset();
    logInferenceEventMock.mockReset();
    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    listUserExercisesMock.mockResolvedValue([]);
    createUserWaterLogMock.mockResolvedValue({ id: 91 });
    downstreamWebhookMock.mockImplementation(async (_req, res: MockResponse) => (
      res.status(200).json({ ok: true, processed: 1 })
    ));
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if (payload?.text?.body) sentBodies.push(payload.text.body);
      return { ok: true, json: async () => ({ url: "https://media.test/image", mime_type: "image/jpeg" }) } as Response;
    }) as typeof fetch;
  });

  it("delegates the first image delivery and absorbs duplicate image retries", async () => {
    const firstReq = createImageWebhookRequest();
    const firstRes = createResponse();

    await handleWhatsAppWebhookWithImageIdempotency(firstReq as never, firstRes as never);

    expect(firstRes.statusCode).toBe(200);
    expect(firstRes.body).toEqual({ ok: true, processed: 1 });
    expect(downstreamWebhookMock).toHaveBeenCalledOnce();

    const retryReq = createImageWebhookRequest();
    const retryRes = createResponse();

    await handleWhatsAppWebhookWithImageIdempotency(retryReq as never, retryRes as never);

    expect(retryRes.statusCode).toBe(200);
    expect(retryRes.body).toEqual({ ok: true, processed: 0, deduplicated: true });
    expect(downstreamWebhookMock).toHaveBeenCalledOnce();
  });

  it("registra água quando imagem tem legenda com quantidade", async () => {
    const req = createImageWebhookRequest("300 ml de água");
    const res = createResponse();

    await handleWhatsAppWebhookWithImageIdempotency(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(createUserWaterLogMock).toHaveBeenCalledWith(42, expect.objectContaining({ amountMl: 300 }));
    expect(downstreamWebhookMock).not.toHaveBeenCalled();
    expect(sentBodies.at(-1)).toContain("Registrei 300 ml de água");
  });

  it("não trata imagem sem legenda de água como hidratação e delega para o fluxo normal", async () => {
    const req = createImageWebhookRequest();
    const res = createResponse();

    await handleWhatsAppWebhookWithImageIdempotency(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(createUserWaterLogMock).not.toHaveBeenCalled();
    expect(sentBodies.some(body => body.includes("Identifiquei água na imagem"))).toBe(false);
    expect(downstreamWebhookMock).toHaveBeenCalledOnce();
  });
});
