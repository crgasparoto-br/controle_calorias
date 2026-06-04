import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({
    key,
    url: `https://storage.test/${key}`,
  })),
}));

const transcribeAudioMock = vi.fn(async () => ({
  text: "300ml de água",
  language: "pt",
  segments: [],
}));

vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: transcribeAudioMock,
}));

const processMealInputMock = vi.fn(async () => {
  throw new Error("processMealInput não deve ser chamado para áudio de hidratação");
});

vi.mock("./nutritionEngine", async () => {
  const actual = await vi.importActual<typeof import("./nutritionEngine")>("./nutritionEngine");
  return {
    ...actual,
    processMealInput: processMealInputMock,
  };
});

vi.mock("./_core/imageGeneration", () => ({
  generateImage: vi.fn(),
}));

const {
  __resetWhatsAppWebhookDeduplicationForTests,
  handleWhatsAppWebhook,
} = await import("./whatsappWebhook");
const { upsertUserWhatsappConnection } = await import("./db");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload: unknown) => MockResponse;
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
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe("whatsappWebhook audio hydration", () => {
  let sentWhatsAppBodies: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00-03:00"));
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-test";
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";
    __resetWhatsAppWebhookDeduplicationForTests();
    sentWhatsAppBodies = [];
    transcribeAudioMock.mockClear();
    processMealInputMock.mockClear();

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/messages")) {
        const payload = init?.body ? JSON.parse(String(init.body)) : {};
        if (payload?.text?.body) {
          sentWhatsAppBodies.push(payload.text.body);
        }
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (url.includes("graph.facebook.com") && !url.includes("/messages")) {
        return {
          ok: true,
          json: async () => ({ url: "https://media.test/audio", mime_type: "audio/ogg" }),
        } as Response;
      }

      if (url === "https://media.test/audio") {
        return {
          ok: true,
          headers: { get: () => "audio/ogg" },
          arrayBuffer: async () => new TextEncoder().encode("audio-binary").buffer,
        } as Response;
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

  it("registra hidratação transcrita do áudio e não cai na inferência de alimentos", async () => {
    await upsertUserWhatsappConnection({
      userId: 1,
      phoneNumber: "5511999999999",
      displayName: "Gaspa",
    });

    const req = {
      body: {
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
                      id: "wamid-audio-water-300ml",
                      from: "5511999999999",
                      timestamp: "1780585200",
                      type: "audio",
                      audio: {
                        id: "audio-media-id",
                        mime_type: "audio/ogg",
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
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(transcribeAudioMock).toHaveBeenCalledOnce();
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(sentWhatsAppBodies.some(body => body.includes("Registrei 300 ml de água"))).toBe(true);
  });
});
