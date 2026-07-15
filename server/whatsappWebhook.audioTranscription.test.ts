import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { transcribeAudioMock } = vi.hoisted(() => ({
  transcribeAudioMock: vi.fn(),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({
    key,
    url: `https://storage.test/${key}`,
  })),
}));

vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: transcribeAudioMock,
}));

const processMealInputMock = vi.fn(async () => ({
  detectedMealLabel: "Almoço",
  sourceText: "arroz e frango",
  confidence: 0.91,
  needsConfirmation: true,
  reasoning: "Inferência simulada para webhook.",
  items: [
    {
      foodName: "arroz",
      canonicalName: "Arroz branco cozido",
      portionText: "100 g",
      servings: 1,
      estimatedGrams: 100,
      calories: 130,
      protein: 2.7,
      carbs: 28,
      fat: 0.3,
      confidence: 0.92,
      source: "catalog" as const,
    },
  ],
  totals: {
    calories: 130,
    protein: 2.7,
    carbs: 28,
    fat: 0.3,
  },
}));

vi.mock("./nutritionEngine", async () => {
  const actual = await vi.importActual<typeof import("./nutritionEngine")>("./nutritionEngine");
  return {
    ...actual,
    processMealInput: processMealInputMock,
  };
});

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

function createAudioPayload(input: { phone: string; text?: string; messageId: string }) {
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
                  type: "audio",
                  ...(input.text ? { text: { body: input.text } } : {}),
                  audio: {
                    id: `${input.messageId}-audio-media-id`,
                    mime_type: "audio/ogg; codecs=opus",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("whatsappWebhook audio transcription failures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T08:52:00-03:00"));
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-test";
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";
    process.env.QUICK_EDIT_BASE_URL = "https://app.example.com";

    sentWhatsAppPayloads = [];
    transcribeAudioMock.mockReset();
    transcribeAudioMock.mockResolvedValue({
      task: "transcribe",
      language: "pt",
      duration: 2.4,
      text: "arroz e frango",
      segments: [],
    });
    processMealInputMock.mockClear();
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "arroz e frango",
      confidence: 0.91,
      needsConfirmation: true,
      reasoning: "Inferência simulada para webhook.",
      items: [
        {
          foodName: "arroz",
          canonicalName: "Arroz branco cozido",
          portionText: "100 g",
          servings: 1,
          estimatedGrams: 100,
          calories: 130,
          protein: 2.7,
          carbs: 28,
          fat: 0.3,
          confidence: 0.92,
          source: "catalog" as const,
        },
      ],
      totals: {
        calories: 130,
        protein: 2.7,
        carbs: 28,
        fat: 0.3,
      },
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/messages")) {
        const payload = init?.body ? JSON.parse(String(init.body)) : {};
        sentWhatsAppPayloads.push(payload);
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (url.includes("graph.facebook.com") && !url.includes("/messages")) {
        return {
          ok: true,
          json: async () => ({ url: "https://media.test/audio.ogg", mime_type: "audio/ogg; codecs=opus" }),
        } as Response;
      }

      if (url === "https://media.test/audio.ogg") {
        return {
          ok: true,
          headers: { get: () => "audio/ogg; codecs=opus" },
          arrayBuffer: async () => new TextEncoder().encode("binary-audio").buffer,
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

  it("não chama processMealInput quando áudio puro falha na transcrição", async () => {
    const userId = 2100001;
    const phone = "5511210000001";
    await upsertUserWhatsappConnection({ userId, phoneNumber: phone, displayName: "Audio" });
    transcribeAudioMock.mockResolvedValue({
      error: "Voice transcription failed",
      code: "TRANSCRIPTION_FAILED",
      details: "OpenAI transcription provider returned status 503.",
    });

    const res = createResponse();
    await handleWhatsAppWebhook({ body: createAudioPayload({ phone, messageId: "audio-failure-1" }) } as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(outboundTextBodies().at(-1)).toContain("*⚠️ Não foi possível processar o áudio*");
    expect((await listUserMeals(userId)).filter(meal => meal.source === "whatsapp")).toHaveLength(0);
  });

  it("trata transcrição vazia de áudio puro como falha bloqueante", async () => {
    const userId = 2100002;
    const phone = "5511210000002";
    await upsertUserWhatsappConnection({ userId, phoneNumber: phone, displayName: "Audio vazio" });
    transcribeAudioMock.mockResolvedValue({
      task: "transcribe",
      language: "pt",
      duration: 1,
      text: "   ",
      segments: [],
    });

    const res = createResponse();
    await handleWhatsAppWebhook({ body: createAudioPayload({ phone, messageId: "audio-empty-1" }) } as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(outboundTextBodies().at(-1)).toContain("*⚠️ Não consegui entender o áudio*");
    expect((await listUserMeals(userId)).filter(meal => meal.source === "whatsapp")).toHaveLength(0);
  });

  it("continua processando o texto quando texto e áudio chegam juntos e o áudio falha", async () => {
    const userId = 2100003;
    const phone = "5511210000003";
    await upsertUserWhatsappConnection({ userId, phoneNumber: phone, displayName: "Texto e audio" });
    transcribeAudioMock.mockResolvedValue({
      error: "Audio file format is not supported",
      code: "INVALID_FORMAT",
      details: "Unsupported audio MIME type: application/octet-stream",
    });

    const res = createResponse();
    await handleWhatsAppWebhook({ body: createAudioPayload({ phone, messageId: "text-audio-failure-1", text: "arroz e frango" }) } as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(processMealInputMock).toHaveBeenCalledWith(expect.objectContaining({
      text: "arroz e frango",
      transcript: undefined,
    }));
    expect(outboundTextBodies().some(body => body.includes("Vou considerar o texto que você enviou"))).toBe(true);
    expect(outboundTextBodies().at(-1)).toContain("*Almoço Registrado");
  });
});
