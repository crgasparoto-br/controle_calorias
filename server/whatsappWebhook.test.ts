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

const generateImageMock = vi.fn(async () => ({
  url: "https://storage.test/generated/meal-support/annotated.png",
  storageKey: "generated/meal-support/annotated.png",
  mimeType: "image/png",
}));

vi.mock("./nutritionEngine", async () => {
  const actual = await vi.importActual<typeof import("./nutritionEngine")>("./nutritionEngine");
  return {
    ...actual,
    processMealInput: processMealInputMock,
  };
});

vi.mock("./_core/imageGeneration", () => ({
  generateImage: generateImageMock,
}));

const { handleWhatsAppWebhook, verifyWhatsAppWebhook } = await import("./whatsappWebhook");
const { getAdminSnapshot, listUserMeals, upsertUserWhatsappConnection } = await import("./db");
const { requireWhatsAppSendConfig } = await import("./whatsappConfig");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload: unknown) => MockResponse;
};

let lastSentWhatsAppBody: string | null = null;
let lastSentWhatsAppUrl: string | null = null;
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

describe("whatsappWebhook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T08:52:00-03:00"));
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-test";
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";
    lastSentWhatsAppBody = null;
    lastSentWhatsAppUrl = null;
    sentWhatsAppPayloads = [];
    generateImageMock.mockReset();
    generateImageMock.mockResolvedValue({
      url: "https://storage.test/generated/meal-support/annotated.png",
      storageKey: "generated/meal-support/annotated.png",
      mimeType: "image/png",
    });
    processMealInputMock.mockReset();
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
        lastSentWhatsAppUrl = url;
        sentWhatsAppPayloads.push(payload);
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

  it("gera erro claro quando falta configuração obrigatória para envio pelo WhatsApp fixo", async () => {
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;

    await expect(requireWhatsAppSendConfig()).rejects.toThrow("WHATSAPP_PHONE_NUMBER_ID");
  });

  it("processa uma mensagem recebida pelo número fixo, identifica o usuário pelo telefone de origem e responde com o Phone Number ID oficial", async () => {
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
    const savedMeals = (await listUserMeals(1)).filter((meal) => meal.source === "whatsapp");
    expect(savedMeals.length).toBeGreaterThan(0);
    expect(lastSentWhatsAppUrl).toContain("/phone-number-test/messages");
    expect(lastSentWhatsAppBody).toBe([
      "Almoço Registrado às 08:52hs.",
      "",
      "Itens:",
      "arroz, 100g - 130 Kcal",
      "Prot. 2,7 g | Carb. 28 g | Gord. 0,3 g",
      "",
      "Total da refeição:",
      "130 Kcal",
      "Prot. 2,7 g | Carb. 28 g | Gord. 0,3 g",
      "",
      "*Meta de hoje:*",
      "• Meta: 2.200 Kcal",
      "• Meta ajustada: 2.200 Kcal",
      "• Déficit: 2.070 Kcal",
    ].join("\n"));
  });

  it("processa mídia de imagem e áudio sem falhar o webhook quando o número está vinculado", async () => {
    await upsertUserWhatsappConnection({
      userId: 1,
      phoneNumber: "5511777777777",
      displayName: "Gaspa",
    });

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
    expect(processMealInputMock).toHaveBeenCalled();
    expect(sentWhatsAppPayloads.some(payload => payload.type === "image" && payload.image?.link === "https://storage.test/generated/meal-support/annotated.png")).toBe(true);
    const savedMeals = (await listUserMeals(1)).filter((meal) => meal.source === "whatsapp");
    const savedMeal = savedMeals[0];
    expect(savedMeal?.media).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mediaType: "image",
        storageUrl: "https://storage.test/whatsapp/image/5511777777777-image-media-id.jpg",
      }),
      expect.objectContaining({
        mediaType: "image",
        storageUrl: "https://storage.test/generated/meal-support/annotated.png",
        originalFileName: "whatsapp-annotated-meal.png",
      }),
    ]));
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
    await upsertUserWhatsappConnection({
      userId: 1,
      phoneNumber: phone,
      displayName: "Gaspa",
    });

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

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    const savedMeals = (await listUserMeals(1)).filter((meal) => meal.source === "whatsapp");
    expect(savedMeals.length).toBeGreaterThan(0);
    expect(lastSentWhatsAppBody).toBeNull();
  });

  it("ignora mensagens recebidas por um WhatsApp Phone Number ID diferente do canal fixo configurado", async () => {
    await upsertUserWhatsappConnection({
      userId: 1,
      phoneNumber: "5511555555555",
      displayName: "Contato",
    });

    const req = {
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: {
                    display_phone_number: "5511999990000",
                    phone_number_id: "outro-phone-number-id",
                  },
                  messages: [
                    {
                      from: "5511555555555",
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
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(lastSentWhatsAppUrl).toBeNull();
  });

  it("ignora mensagens não suportadas sem falhar o webhook quando o número está vinculado", async () => {
    await upsertUserWhatsappConnection({
      userId: 1,
      phoneNumber: "5511888888888",
      displayName: "Gaspa",
    });

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

  it("solicita confirmação antes de reclassificar registros históricos via WhatsApp e só aplica a mudança após resposta afirmativa", async () => {
    const userId = 700000 + Math.floor(Math.random() * 100000);
    const phoneNumber = `55${String(userId).padStart(11, "0").slice(-11)}`;

    await upsertUserWhatsappConnection({
      userId,
      phoneNumber,
      displayName: "Gaspa",
    });

    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Lanche",
      sourceText: "imagem de lanche",
      confidence: 0.91,
      needsConfirmation: true,
      reasoning: "Inferência simulada para webhook.",
      items: [
        {
          foodName: "banana",
          canonicalName: "Banana prata",
          portionText: "1 unidade",
          servings: 1,
          estimatedGrams: 90,
          calories: 80,
          protein: 1,
          carbs: 20,
          fat: 0.2,
          confidence: 0.92,
          source: "catalog" as const,
        },
      ],
      totals: { calories: 80, protein: 1, carbs: 20, fat: 0.2 },
    });

    const seedMessages = [
      { from: phoneNumber, type: "image", image: { id: "clear-image-1", mime_type: "image/jpeg" }, timestamp: "1713708840" },
      { from: phoneNumber, type: "image", image: { id: "clear-image-2", mime_type: "image/jpeg" }, timestamp: "1713708900" },
      { from: phoneNumber, type: "image", image: { id: "clear-image-3", mime_type: "image/jpeg" }, timestamp: "1713708960" },
    ];

    for (const payloadMessage of seedMessages) {
      const req = { body: { entry: [{ changes: [{ value: { messages: [payloadMessage] } }] }] } };
      const res = createResponse();
      await handleWhatsAppWebhook(req as never, res as never);
    }

    processMealInputMock.mockClear();
    const requestChange = {
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: phoneNumber,
                      type: "text",
                      text: {
                        body: "Mudar a refeição lanche para café da manhã",
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
    const firstResponse = createResponse();

    await handleWhatsAppWebhook(requestChange as never, firstResponse as never);

    const mealsBeforeConfirmation = (await listUserMeals(userId)).filter((meal) => meal.source === "whatsapp").slice(0, 3);

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.body).toEqual({ ok: true, processed: 1 });
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(mealsBeforeConfirmation).toHaveLength(3);
    expect(mealsBeforeConfirmation.every((meal) => meal.mealLabel === "Lanche")).toBe(true);
    expect(lastSentWhatsAppBody).toContain("Responda SIM para confirmar a mudança para Café da manhã");

    const confirmChange = {
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: phoneNumber,
                      type: "text",
                      text: {
                        body: "sim",
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
    const secondResponse = createResponse();

    await handleWhatsAppWebhook(confirmChange as never, secondResponse as never);

    const updatedMeals = (await listUserMeals(userId)).filter((meal) => meal.source === "whatsapp").slice(0, 3);

    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.body).toEqual({ ok: true, processed: 1 });
    expect(updatedMeals).toHaveLength(3);
    expect(updatedMeals.every((meal) => meal.mealLabel === "Café da manhã")).toBe(true);
    expect(lastSentWhatsAppBody).toContain("3 registro(s) recente(s) foram alterados de Lanche para Café da manhã");
  });

  it("pede esclarecimento quando o comando de mudança de refeição é ambíguo e não cria novo alimento", async () => {
    const userId = 800000 + Math.floor(Math.random() * 100000);
    const phoneNumber = `55${String(userId).padStart(11, "0").slice(-11)}`;

    await upsertUserWhatsappConnection({
      userId,
      phoneNumber,
      displayName: "Gaspa",
    });

    processMealInputMock
      .mockResolvedValueOnce({
        detectedMealLabel: "Lanche",
        sourceText: "primeira imagem",
        confidence: 0.91,
        needsConfirmation: true,
        reasoning: "Inferência simulada para webhook.",
        items: [
          {
            foodName: "banana",
            canonicalName: "Banana prata",
            portionText: "1 unidade",
            servings: 1,
            estimatedGrams: 90,
            calories: 80,
            protein: 1,
            carbs: 20,
            fat: 0.2,
            confidence: 0.92,
            source: "catalog" as const,
          },
        ],
        totals: { calories: 80, protein: 1, carbs: 20, fat: 0.2 },
      })
      .mockResolvedValueOnce({
        detectedMealLabel: "Bebida",
        sourceText: "segunda imagem",
        confidence: 0.91,
        needsConfirmation: true,
        reasoning: "Inferência simulada para webhook.",
        items: [
          {
            foodName: "café",
            canonicalName: "Café sem açúcar",
            portionText: "1 xícara",
            servings: 1,
            estimatedGrams: 120,
            calories: 5,
            protein: 0.3,
            carbs: 0.2,
            fat: 0,
            confidence: 0.92,
            source: "heuristic" as const,
          },
        ],
        totals: { calories: 5, protein: 0.3, carbs: 0.2, fat: 0 },
      })
      .mockResolvedValueOnce({
        detectedMealLabel: "Lanche",
        sourceText: "terceira imagem",
        confidence: 0.91,
        needsConfirmation: true,
        reasoning: "Inferência simulada para webhook.",
        items: [
          {
            foodName: "pão",
            canonicalName: "Pão francês",
            portionText: "1 unidade",
            servings: 1,
            estimatedGrams: 50,
            calories: 140,
            protein: 4.5,
            carbs: 28,
            fat: 1.5,
            confidence: 0.92,
            source: "catalog" as const,
          },
        ],
        totals: { calories: 140, protein: 4.5, carbs: 28, fat: 1.5 },
      });

    const seedMessages = [
      { from: phoneNumber, type: "image", image: { id: "image-1", mime_type: "image/jpeg" }, timestamp: "1713708840" },
      { from: phoneNumber, type: "image", image: { id: "image-2", mime_type: "image/jpeg" }, timestamp: "1713708900" },
      { from: phoneNumber, type: "image", image: { id: "image-3", mime_type: "image/jpeg" }, timestamp: "1713708960" },
    ];

    for (const payloadMessage of seedMessages) {
      const req = { body: { entry: [{ changes: [{ value: { messages: [payloadMessage] } }] }] } };
      const res = createResponse();
      await handleWhatsAppWebhook(req as never, res as never);
    }

    processMealInputMock.mockClear();
    const req = {
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: phoneNumber,
                      type: "text",
                      text: {
                        body: "Mudar a refeição lanche para café da manhã",
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
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(lastSentWhatsAppBody).toContain("Você quer que eu mova apenas os itens marcados como Lanche");

  });

  it("registra warning quando o número recebido não possui vínculo ativo com um usuário", async () => {
    const unlinkedPhone = `5511666${Date.now().toString().slice(-7)}`;
    const req = {
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: unlinkedPhone,
                      type: "text",
                      text: {
                        body: "envio sem vínculo",
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
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(lastSentWhatsAppBody).toBeNull();
  });
});
