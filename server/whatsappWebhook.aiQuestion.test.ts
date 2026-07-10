import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeWhatsappAiQuestionIntentMock = vi.fn();

vi.mock("./modules/whatsapp/aiQuestionAssistant", () => ({
  executeWhatsappAiQuestionIntent: executeWhatsappAiQuestionIntentMock,
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
const { getAdminSnapshot, listUserMeals, upsertUserWhatsappConnection } = await import("./db");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload: unknown) => MockResponse;
};

let sentWhatsAppPayloads: any[] = [];
let whatsappSendShouldFail = false;

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

function buildTextMessageRequest(phoneNumber: string, text: string, extra: Record<string, unknown> = {}) {
  return {
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
                    text: { body: text },
                    ...extra,
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

async function sendTextMessage(phoneNumber: string, text: string, extra: Record<string, unknown> = {}) {
  const req = buildTextMessageRequest(phoneNumber, text, extra);
  const res = createResponse();
  await handleWhatsAppWebhook(req as never, res as never);
  return res;
}

describe("handleWhatsAppWebhook slash AI question routing (webhook real)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T08:52:00-03:00"));
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-token-test";
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";
    process.env.QUICK_EDIT_BASE_URL = "https://app.example.com";
    sentWhatsAppPayloads = [];
    whatsappSendShouldFail = false;
    processMealInputMock.mockClear();
    executeWhatsappAiQuestionIntentMock.mockReset();
    executeWhatsappAiQuestionIntentMock.mockResolvedValue(null);

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/messages")) {
        if (whatsappSendShouldFail) {
          return {
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            json: async () => ({}),
          } as Response;
        }
        const payload = init?.body ? JSON.parse(String(init.body)) : {};
        sentWhatsAppPayloads.push(payload);
        return {
          ok: true,
          json: async () => ({}),
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

  it("responde pela IA uma pergunta real com prefixo / e não processa refeição", async () => {
    const phoneNumber = `5511700${Date.now().toString().slice(-6)}`;
    await upsertUserWhatsappConnection({ userId: 1, phoneNumber, displayName: "Gaspa" });

    executeWhatsappAiQuestionIntentMock.mockImplementation(async (_userId: number, input: { text?: string | null }) => {
      if (!input.text?.trim().startsWith("/")) return null;
      return {
        handled: true,
        action: "ai_question_answered",
        reply: "Seu consumo de proteína hoje está abaixo da meta.",
        eventType: "whatsapp.ai_question.answered",
        detail: "Pergunta iniciada por / respondida pela IA com contexto do banco de dados do usuário.",
        data: { usedUserKnowledgeBase: true },
      };
    });

    const res = await sendTextMessage(phoneNumber, "/como está minha proteína hoje?");

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(executeWhatsappAiQuestionIntentMock).toHaveBeenCalledWith(1, expect.objectContaining({
      text: "/como está minha proteína hoje?",
      receivedAt: expect.any(Date),
    }));
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(sentWhatsAppPayloads).toHaveLength(1);
    expect(sentWhatsAppPayloads[0]?.text?.body).toBe("Seu consumo de proteína hoje está abaixo da meta.");
    const savedMeals = (await listUserMeals(1)).filter(meal => meal.source === "whatsapp");
    expect(savedMeals).toHaveLength(0);
  });

  it("reconhece o prefixo / mesmo com espaços antes da barra", async () => {
    const phoneNumber = `5511701${Date.now().toString().slice(-6)}`;
    await upsertUserWhatsappConnection({ userId: 2, phoneNumber, displayName: "Gaspa" });

    executeWhatsappAiQuestionIntentMock.mockImplementation(async (_userId: number, input: { text?: string | null }) => {
      if (!input.text?.trim().startsWith("/")) return null;
      return {
        handled: true,
        action: "ai_question_answered",
        reply: "Você consumiu 8.200 kcal nesta semana.",
        eventType: "whatsapp.ai_question.answered",
        detail: "Pergunta respondida.",
      };
    });

    const res = await sendTextMessage(phoneNumber, "   /quanto consumi esta semana?");

    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(executeWhatsappAiQuestionIntentMock).toHaveBeenCalledWith(2, expect.objectContaining({
      text: "   /quanto consumi esta semana?",
    }));
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(sentWhatsAppPayloads).toHaveLength(1);
    expect(sentWhatsAppPayloads[0]?.text?.body).toBe("Você consumiu 8.200 kcal nesta semana.");
  });

  it("orienta o usuário quando a mensagem é apenas / ou barras sem conteúdo", async () => {
    const phoneNumber = `5511702${Date.now().toString().slice(-6)}`;
    await upsertUserWhatsappConnection({ userId: 3, phoneNumber, displayName: "Gaspa" });

    executeWhatsappAiQuestionIntentMock.mockImplementation(async (_userId: number, input: { text?: string | null }) => {
      if (!input.text?.trim().startsWith("/")) return null;
      return {
        handled: true,
        action: "ai_question_empty",
        reply: "Envie sua pergunta depois da barra. Exemplo: /como está meu consumo de proteína hoje?",
        eventType: "whatsapp.ai_question.empty",
        detail: "Mensagem iniciada por / sem pergunta para IA.",
      };
    });

    const res = await sendTextMessage(phoneNumber, "///");

    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(sentWhatsAppPayloads).toHaveLength(1);
    expect(sentWhatsAppPayloads[0]?.text?.body).toContain("Envie sua pergunta depois da barra");
  });

  it("prevalece sobre confirmação pendente de reclassificação de refeição", async () => {
    const userId = 900000 + Math.floor(Math.random() * 100000);
    const phoneNumber = `55${String(userId).padStart(11, "0").slice(-11)}`;
    await upsertUserWhatsappConnection({ userId, phoneNumber, displayName: "Gaspa" });

    executeWhatsappAiQuestionIntentMock.mockImplementation(async (_userId: number, input: { text?: string | null }) => {
      if (!input.text?.trim().startsWith("/")) return null;
      return {
        handled: true,
        action: "ai_question_answered",
        reply: "Resposta da IA, ignorando a confirmação pendente.",
        eventType: "whatsapp.ai_question.answered",
        detail: "Pergunta respondida.",
      };
    });

    const seedMessages = [
      { from: phoneNumber, type: "image" as const, image: { id: "clear-image-1", mime_type: "image/jpeg" }, timestamp: "1713708840" },
      { from: phoneNumber, type: "image" as const, image: { id: "clear-image-2", mime_type: "image/jpeg" }, timestamp: "1713708900" },
      { from: phoneNumber, type: "image" as const, image: { id: "clear-image-3", mime_type: "image/jpeg" }, timestamp: "1713708960" },
    ];

    for (const payloadMessage of seedMessages) {
      const req = { body: { entry: [{ changes: [{ value: { messages: [payloadMessage] } }] }] } };
      const res = createResponse();
      await handleWhatsAppWebhook(req as never, res as never);
    }

    processMealInputMock.mockClear();

    const requestChangeRes = await sendTextMessage(phoneNumber, "Mudar a refeição lanche para café da manhã");
    expect(requestChangeRes.body).toEqual({ ok: true, processed: 1 });

    sentWhatsAppPayloads = [];
    const res = await sendTextMessage(phoneNumber, "/perguntar sobre minha meta");

    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(sentWhatsAppPayloads).toHaveLength(1);
    expect(sentWhatsAppPayloads[0]?.text?.body).toBe("Resposta da IA, ignorando a confirmação pendente.");
  });

  it("usa a resposta controlada quando a IA está indisponível ou falha, sem cair no fallback nutricional", async () => {
    const phoneNumber = `5511703${Date.now().toString().slice(-6)}`;
    await upsertUserWhatsappConnection({ userId: 4, phoneNumber, displayName: "Gaspa" });

    executeWhatsappAiQuestionIntentMock.mockImplementation(async (_userId: number, input: { text?: string | null }) => {
      if (!input.text?.trim().startsWith("/")) return null;
      return {
        handled: true,
        action: "ai_question_unavailable",
        reply: "Não consigo responder perguntas por IA agora porque a configuração de IA do servidor está indisponível.",
        eventType: "whatsapp.ai_question.unavailable",
        detail: "Pergunta iniciada por / não pôde ser respondida porque OPENAI_API_KEY não está configurada.",
        data: { reason: "missing_openai_api_key" },
      };
    });

    const res = await sendTextMessage(phoneNumber, "/como está minha meta hoje?");

    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(sentWhatsAppPayloads).toHaveLength(1);
    expect(sentWhatsAppPayloads[0]?.text?.body).toContain("configuração de IA do servidor está indisponível");
  });

  it("registra falha de envio sem reclassificar ou persistir a mensagem como refeição", async () => {
    const phoneNumber = `5511704${Date.now().toString().slice(-6)}`;
    await upsertUserWhatsappConnection({ userId: 5, phoneNumber, displayName: "Gaspa" });

    executeWhatsappAiQuestionIntentMock.mockImplementation(async (_userId: number, input: { text?: string | null }) => {
      if (!input.text?.trim().startsWith("/")) return null;
      return {
        handled: true,
        action: "ai_question_answered",
        reply: "Resposta que vai falhar ao ser enviada.",
        eventType: "whatsapp.ai_question.answered",
        detail: "Pergunta respondida.",
      };
    });
    whatsappSendShouldFail = true;

    const res = await sendTextMessage(phoneNumber, "/como está minha meta hoje?");

    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(processMealInputMock).not.toHaveBeenCalled();
    const savedMeals = (await listUserMeals(5)).filter(meal => meal.source === "whatsapp");
    expect(savedMeals).toHaveLength(0);
    const snapshot = await getAdminSnapshot();
    expect(snapshot.recentInferenceLogs.some(log => log.eventType === "whatsapp.reply_failed")).toBe(true);
  });

  it("é idempotente para reentrega do mesmo message.id", async () => {
    const phoneNumber = `5511705${Date.now().toString().slice(-6)}`;
    await upsertUserWhatsappConnection({ userId: 6, phoneNumber, displayName: "Gaspa" });

    executeWhatsappAiQuestionIntentMock.mockImplementation(async (_userId: number, input: { text?: string | null }) => {
      if (!input.text?.trim().startsWith("/")) return null;
      return {
        handled: true,
        action: "ai_question_answered",
        reply: "Resposta única para a pergunta.",
        eventType: "whatsapp.ai_question.answered",
        detail: "Pergunta respondida.",
      };
    });

    await sendTextMessage(phoneNumber, "/como está minha meta hoje?", { id: "dup-message-1" });
    await sendTextMessage(phoneNumber, "/como está minha meta hoje?", { id: "dup-message-1" });

    expect(executeWhatsappAiQuestionIntentMock).toHaveBeenCalledTimes(1);
    expect(sentWhatsAppPayloads.filter(payload => payload.type === "text")).toHaveLength(1);
  });

  it("mantém o fluxo alimentar normal para mensagens sem /", async () => {
    const phoneNumber = `5511706${Date.now().toString().slice(-6)}`;
    await upsertUserWhatsappConnection({ userId: 7, phoneNumber, displayName: "Gaspa" });

    const res = await sendTextMessage(phoneNumber, "arroz e frango");

    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(executeWhatsappAiQuestionIntentMock).toHaveBeenCalledWith(7, expect.objectContaining({
      text: "arroz e frango",
    }));
    expect(processMealInputMock).toHaveBeenCalled();
    const savedMeals = (await listUserMeals(7)).filter(meal => meal.source === "whatsapp");
    expect(savedMeals.length).toBeGreaterThan(0);
  });
});
