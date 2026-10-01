import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const listUserExercisesMock = vi.fn();
const logInferenceEventMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const foodAssistantIntentMock = vi.fn();
const annotatedWebhookMock = vi.fn();
const listMealsMock = vi.fn();
const listMealSchedulesMock = vi.fn();
const processProfessionalAccessWhatsappResponseMock = vi.fn();

vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: vi.fn(async () => ({ messageId: 1, conversationId: 1, wasNewInsert: true })),
  recordOutboundReply: vi.fn(async () => undefined),
  recordDomainLink: vi.fn(async () => undefined),
  markMessageProcessed: vi.fn(async () => undefined),
  wasMessageAlreadyProcessed: vi.fn(async () => false),
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  enrichInboundMessage: vi.fn(async () => true),
  ensureMessageProcessingOwnership: vi.fn(async () => true),
}));
vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  logPersistenceWarning: vi.fn(),
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  getUserNutritionGoal: getUserNutritionGoalMock,
  listUserExercises: listUserExercisesMock,
  logInferenceEvent: logInferenceEventMock,
}));
vi.mock("./whatsappConfig", () => ({
  getWhatsAppChannelConfig: () => ({ phoneNumberId: "phone-number-test" }),
  requireWhatsAppSendConfig: async () => ({
    accessToken: "access-token-test",
    phoneNumberId: "phone-number-test",
  }),
}));
vi.mock("./modules/whatsapp/intentActions", () => ({
  executeWhatsappTextIntent: executeWhatsappTextIntentMock,
}));
vi.mock("./modules/whatsapp/llmIntentActions", () => ({
  executeWhatsappLlmIntent: executeWhatsappLlmIntentMock,
}));
vi.mock("./modules/whatsapp/foodAssistant", () => ({
  executeWhatsAppFoodAssistantIntent: foodAssistantIntentMock,
}));
vi.mock("./modules/meals/service", () => ({
  listMeals: listMealsMock,
}));
vi.mock("./modules/mealSchedules/service", () => ({
  listMealSchedules: listMealSchedulesMock,
  findConfiguredMealSchedule: vi.fn(() => null),
}));
vi.mock("./modules/professionals/service", () => ({
  processProfessionalAccessWhatsappResponse: processProfessionalAccessWhatsappResponseMock,
}));
vi.mock("./whatsappAnnotatedImageWebhook", () => ({
  handleWhatsAppWebhookWithAnnotatedImages: annotatedWebhookMock,
}));
vi.mock("./_core/ai/configResolver", async importOriginal => {
  const actual = await importOriginal<typeof import("./_core/ai/configResolver")>();
  return {
    ...actual,
    resolveCapabilityConfig: vi.fn(() => ({
      state: "enabled",
      primary: { provider: "openai", model: "test" },
      fallbacks: [],
    })),
  };
});
vi.mock("./_core/ai/capabilityExecutor", async importOriginal => {
  const actual = await importOriginal<typeof import("./_core/ai/capabilityExecutor")>();
  return {
    ...actual,
    executeResolvedCapability: vi.fn(async (_policy: unknown, execute: (attempt: any) => Promise<any>) => ({
      value: await execute({
        provider: { id: "openai" },
        model: "test",
        signal: undefined,
      }),
      provider: "openai",
      model: "test",
    })),
  };
});
vi.mock("./_core/ai/domainTextResponse", async importOriginal => {
  const actual = await importOriginal<typeof import("./_core/ai/domainTextResponse")>();
  return {
    ...actual,
    createDomainTextResponse: vi.fn(),
  };
});

const {
  __resetWhatsAppTextIntentContextForTests,
  handleWhatsAppWebhookWithTextIntent,
} = await import("./whatsappIntentWebhook");
const { markMessageProcessed: markMessageProcessedMock } = await import(
  "./modules/whatsapp/messageLifecycle"
);
const { MealInferenceError } = await import("./nutritionEngine");

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

let outboundTextBodies: string[] = [];
let providerAcceptingSends = true;

function createTextWebhookRequest(text: string, index: number) {
  return {
    body: {
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: "phone-number-test" },
            messages: [{
              id: `wamid-1282-${index}`,
              from: "5511999981282",
              timestamp: "1780502400",
              type: "text",
              text: { body: text },
            }],
          },
        }],
      }],
    },
  };
}

async function send(text: string, index: number) {
  outboundTextBodies = [];
  const req = createTextWebhookRequest(text, index);
  const res = createResponse();
  let thrown: unknown = null;
  try {
    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);
  } catch (error) {
    thrown = error;
  }
  return { reply: outboundTextBodies.join("\n"), thrown, res };
}

const PRODUCTION_MESSAGE = "Adicionar ao café da manhã 1,5 fatias de mortadela";

describe("issue #1282 — falha de inferência não deixa a mensagem sem resposta", () => {
  beforeEach(() => {
    __resetWhatsAppTextIntentContextForTests();
    vi.clearAllMocks();
    providerAcceptingSends = true;
    getUserIdByWhatsappPhoneMock.mockResolvedValue(1282);
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    listUserExercisesMock.mockResolvedValue([]);
    listMealsMock.mockResolvedValue([]);
    listMealSchedulesMock.mockResolvedValue([]);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    foodAssistantIntentMock.mockReturnValue(null);
    processProfessionalAccessWhatsappResponseMock.mockResolvedValue(null);
    annotatedWebhookMock.mockImplementation(async (_req, res: MockResponse) =>
      res.status(200).json({ ok: true, processed: 1 }),
    );
    outboundTextBodies = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/messages") && init?.body) {
        if (!providerAcceptingSends) {
          return {
            ok: false,
            status: 400,
            text: async () => "",
            json: async () => ({}),
          } as Response;
        }
        const payload = JSON.parse(String(init.body));
        const body = payload?.text?.body ?? payload?.interactive?.body?.text ?? null;
        if (typeof body === "string") outboundTextBodies.push(body);
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it("entrega a clarificação de domínio quando o fluxo textual lança erro de inferência", async () => {
    executeWhatsappTextIntentMock.mockRejectedValue(
      new MealInferenceError("Não consegui confirmar a variante do produto.", {
        code: "food_identity_clarification_required",
      }),
    );

    const { reply, thrown } = await send(PRODUCTION_MESSAGE, 1);

    expect(thrown).toBeNull();
    expect(reply).toContain("Não consegui concluir agora");
    expect(reply).toContain("Não consegui confirmar a variante do produto.");
    expect(markMessageProcessedMock).toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "whatsapp.intent.unexpected_failure",
        status: "warning",
      }),
    );
  });

  it("usa texto sanitizado quando o erro de inferência não traz mensagem", async () => {
    executeWhatsappTextIntentMock.mockRejectedValue(new MealInferenceError("", {}));

    const { reply, thrown } = await send(PRODUCTION_MESSAGE, 2);

    expect(thrown).toBeNull();
    expect(reply).toContain("Tente novamente em alguns instantes");
  });

  it("preserva a repropagação de erro que não é falha de domínio", async () => {
    executeWhatsappTextIntentMock.mockRejectedValue(
      new Error("simulated abrupt runtime termination after ACK delivery"),
    );

    const { reply, thrown } = await send(PRODUCTION_MESSAGE, 3);

    // Contrato de posse/reinício: erro de infraestrutura continua propagando
    // para que o provedor reentregue e a recuperação assuma o owner órfão.
    expect(reply).toBe("");
    expect(thrown).toBeInstanceOf(Error);
  });

  it("mantém a repropagação quando a resposta controlada não é entregue", async () => {
    providerAcceptingSends = false;
    executeWhatsappTextIntentMock.mockRejectedValue(
      new MealInferenceError("Não consegui confirmar a variante do produto."),
    );

    const { reply, thrown } = await send(PRODUCTION_MESSAGE, 4);

    expect(reply).toBe("");
    expect(thrown).toBeInstanceOf(MealInferenceError);
    expect(logInferenceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "whatsapp.reply_failed" }),
    );
  });
});
