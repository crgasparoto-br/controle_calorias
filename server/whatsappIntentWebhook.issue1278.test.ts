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
const processProfessionalAccessWhatsappResponseMock = vi.fn();
const createDomainTextResponseMock = vi.fn();

vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: vi.fn(async () => null),
  recordOutboundReply: vi.fn(async () => undefined),
  recordDomainLink: vi.fn(async () => undefined),
  markMessageProcessed: vi.fn(async () => undefined),
  wasMessageAlreadyProcessed: vi.fn(async () => false),
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  enrichInboundMessage: vi.fn(async () => true),
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
    createDomainTextResponse: createDomainTextResponseMock,
  };
});

const {
  __resetWhatsAppTextIntentContextForTests,
  handleWhatsAppWebhookWithTextIntent,
} = await import("./whatsappIntentWebhook");

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

function createTextWebhookRequest(text: string, index: number) {
  return {
    body: {
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: "phone-number-test" },
            messages: [{
              id: `wamid-1278-${index}`,
              from: "5511999981278",
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
  await handleWhatsAppWebhookWithTextIntent(req as never, res as never);
  return outboundTextBodies.join("\n");
}

function forwardedText(index = 0) {
  const forwarded = annotatedWebhookMock.mock.calls[index]?.[0] as any;
  return forwarded?.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body ?? null;
}

describe("issue #1278 — mensagens reais de produção pelo entrypoint público", () => {
  beforeEach(() => {
    __resetWhatsAppTextIntentContextForTests();
    vi.clearAllMocks();
    getUserIdByWhatsappPhoneMock.mockResolvedValue(1278);
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    listUserExercisesMock.mockResolvedValue([]);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    foodAssistantIntentMock.mockReturnValue(null);
    listMealsMock.mockResolvedValue([]);
    processProfessionalAccessWhatsappResponseMock.mockResolvedValue(null);
    annotatedWebhookMock.mockImplementation(async (_req, res: MockResponse) =>
      res.status(200).json({ ok: true, processed: 1 }),
    );
    outboundTextBodies = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/messages") && init?.body) {
        const payload = JSON.parse(String(init.body));
        const body = payload?.text?.body ?? payload?.interactive?.body?.text ?? null;
        if (typeof body === "string") outboundTextBodies.push(body);
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it.each([
    ["Adicionar o café da manhã, 1,5 fatias de mortadela", "mortadela"],
    ["Adicionar 2 linguiças de frango assadas ao almoço.", "linguiças de frango assadas"],
    ["adicionar o almoço, 2 linguiças de frango assadas", "linguiças de frango assadas"],
  ])("mantém %s no fluxo de adição canônica", async (text, foodName) => {
    executeWhatsappTextIntentMock.mockResolvedValue({
      handled: true,
      action: "meal_item_added",
      reply: `Adicionei ${foodName} à refeição.`,
      eventType: "whatsapp.intent.meal_item_added",
      detail: "Alimento adicionado via WhatsApp.",
    });

    const reply = await send(text, text.length);

    // O comando chega intacto ao fluxo de adição: nenhuma reescrita contável
    // pode transformar o rótulo da refeição em alimento.
    expect(executeWhatsappTextIntentMock).toHaveBeenCalledTimes(1);
    expect((executeWhatsappTextIntentMock.mock.calls[0]?.[1] as { text: string }).text).toBe(text);
    expect(reply).toContain(foodName);

    // Sem passthrough para o pipeline nutricional: nada de refeição nova com
    // itens inventados a partir do texto original.
    expect(annotatedWebhookMock).not.toHaveBeenCalled();
  });

  it("resolve o lote de frutas pela porção canônica local antes de encaminhar ao pipeline nutricional", async () => {
    const reply = await send("1 pêra packans e 1 maçã fugi", 42);

    const forwarded = forwardedText();
    expect(forwarded).toBe("178 g de pêra packans\n130 g de maçã fugi");
    expect(reply).not.toMatch(/informe somente o peso|peso ou volume|não encontrei/i);
  });
});