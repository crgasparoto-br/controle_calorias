import { beforeEach, describe, expect, it, vi } from "vitest";

const downstreamWebhookMock = vi.fn();
const getUserIdByWhatsappPhoneMock = vi.fn();
const listUserExercisesMock = vi.fn();
const logInferenceEventMock = vi.fn();

vi.mock("./db", () => ({
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  listUserExercises: listUserExercisesMock,
  logInferenceEvent: logInferenceEventMock,
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

function createImageWebhookRequest() {
  return {
    body: {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid-image-1",
                    from: "5511999999999",
                    timestamp: "1780502400",
                    type: "image",
                    image: {
                      id: "media-image-1",
                      mime_type: "image/jpeg",
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
  beforeEach(() => {
    __resetWhatsAppImageIdempotencyForTests();
    downstreamWebhookMock.mockReset();
    getUserIdByWhatsappPhoneMock.mockReset();
    listUserExercisesMock.mockReset();
    logInferenceEventMock.mockReset();
    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    listUserExercisesMock.mockResolvedValue([]);
    downstreamWebhookMock.mockImplementation(async (_req, res: MockResponse) => (
      res.status(200).json({ ok: true, processed: 1 })
    ));
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
});
