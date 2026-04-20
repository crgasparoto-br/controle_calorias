import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({
    key,
    url: `https://storage.test/${key}`,
  })),
}));

vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: vi.fn(async () => ({
    text: "arroz e frango",
    language: "pt",
    segments: [],
  })),
}));

vi.mock("./nutritionEngine", async () => {
  const actual = await vi.importActual<typeof import("./nutritionEngine")>("./nutritionEngine");
  return {
    ...actual,
    processMealInput: vi.fn(async () => ({
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
    })),
  };
});

const { handleWhatsAppWebhook, verifyWhatsAppWebhook } = await import("./whatsappWebhook");
const { getAdminSnapshot } = await import("./db");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload: unknown) => MockResponse;
};

let lastSentWhatsAppBody: string | null = null;

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

describe("whatsappWebhook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T08:52:00-03:00"));
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-test";
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";
    lastSentWhatsAppBody = null;

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/messages")) {
        const payload = init?.body ? JSON.parse(String(init.body)) : {};
        lastSentWhatsAppBody = payload?.text?.body ?? null;
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      if (url.includes("graph.facebook.com") && !url.includes("/messages")) {
        return {
          ok: true,
          json: async () => ({ url: "https://media.test/file", mime_type: url.includes("audio-media-id") ? "audio/ogg" : "image/jpeg" }),
        } as Response;
      }

      if (url === "https://media.test/file") {
        return {
          ok: true,
          headers: { get: () => ("image/jpeg") },
          arrayBuffer: async () => new TextEncoder().encode("binary-media").buffer,
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

  it("valida o webhook quando o token informado confere", () => {
    const req = {
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "verify-token-test",
        "hub.challenge": "12345",
      },
    };
    const res = createResponse();

    verifyWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("12345");
  });

  it("rejeita a verificação quando o token é inválido", () => {
    const req = {
      query: {
        "hub.mode": "subscribe",
        "hub.verify_token": "token-incorreto",
        "hub.challenge": "999",
      },
    };
    const res = createResponse();

    verifyWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(403);
    expect(res.body).toBe("Webhook verification failed");
  });

  it("retorna sucesso com zero mensagens quando o payload chega vazio", async () => {
    const req = {
      body: {},
    };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 0 });
  });

  it("processa uma mensagem de texto e envia uma resposta no formato detalhado inspirado na imagem de referência", async () => {
    const req = {
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "5511999999999",
                      type: "text",
                      text: {
                        body: "arroz e frango",
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
    expect(lastSentWhatsAppBody).toBe([
      "🍽️ Almoço:",
      "",
      "100 g arroz",
      "• Às 08:52",
      "• Proteínas: 2.7g",
      "• Carboidratos: 28g",
      "• Gorduras: 0.3g",
      "• 130kcal",
    ].join("\n"));
  });

  it("processa mídia de imagem e áudio sem falhar o webhook", async () => {
    const req = {
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "5511777777777",
                      type: "audio",
                      image: {
                        id: "image-media-id",
                        mime_type: "image/jpeg",
                      },
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
  });

  it("registra warning explícito quando a resposta automática do WhatsApp falha", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/messages")) {
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: async () => ({}),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;

    const phone = `551188888${Date.now().toString().slice(-5)}`;
    const req = {
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: phone,
                      type: "text",
                      text: {
                        body: "falha na resposta automática",
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

    const admin = await getAdminSnapshot();
    const warningLog = admin.recentInferenceLogs.find(
      (entry) => entry.eventType === "whatsapp.reply_failed" && entry.detail.includes(phone),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(warningLog).toBeDefined();
    expect(warningLog?.status).toBe("warning");
  });

  it("ignora mensagens não suportadas sem falhar o webhook", async () => {
    const req = {
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "5511888888888",
                      type: "sticker",
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
  });
});
