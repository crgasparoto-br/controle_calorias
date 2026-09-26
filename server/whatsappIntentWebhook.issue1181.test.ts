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

function createTextWebhookRequest(text: string) {
  return {
    body: {
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: "phone-number-test" },
            messages: [{
              id: `wamid-1181-${text.length}`,
              from: "5511999999999",
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

function searchedMeasure(foodName: string, foodTypeName: string, grams: number) {
  const url = `https://example.test/${foodTypeName}-unidade`;
  const evidence = `1 unidade de ${foodTypeName} pesa ${grams} g.`;
  return {
    id: `measure-${foodTypeName}`,
    outputText: JSON.stringify({
      found: true,
      references: [{
        matchedFoodName: foodName,
        foodTypeName,
        brandName: "",
        measureUnit: "unidade",
        measureQuantity: 1,
        grams,
        referenceKind: "same_food_type",
        describesTypicalMeasure: false,
        sourceUrl: url,
        evidence,
      }],
    }),
    webSearch: {
      executed: true,
      searchCount: 1,
      sources: [{
        url,
        title: `${foodName} natural`,
        supportingText: [evidence],
      }],
    },
    raw: {},
  };
}

function promptText(call: any[]) {
  return call?.[1]?.input?.[0]?.content?.[0]?.text ?? "";
}

describe("issue #1181 — golden flows pelo entrypoint público do WhatsApp", () => {
  let forceGrapeMeasureUnavailable = false;

  beforeEach(() => {
    __resetWhatsAppTextIntentContextForTests();
    vi.clearAllMocks();
    forceGrapeMeasureUnavailable = false;
    getUserIdByWhatsappPhoneMock.mockResolvedValue(1181);
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
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as typeof fetch;

    createDomainTextResponseMock.mockImplementation(async (_provider, request) => {
      const prompt = request.input?.[0]?.content?.[0]?.text ?? "";
      if (/uvas pretas/i.test(prompt)) return searchedMeasure("Uva", "uva", 5);
      if (/p[eê]ra packans/i.test(prompt)) return searchedMeasure("Pêra", "pêra", 150);
      if (/banana nanica/i.test(prompt)) return searchedMeasure("Banana", "banana", 80);
      throw new Error(`unexpected household-measure prompt: ${prompt}`);
    });
  });

  it("resolve banana + pêra qualificada antes da clarificação de peso", async () => {
    const req = createTextWebhookRequest("1 banana nanica, 1 pêra packans");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(annotatedWebhookMock).toHaveBeenCalledOnce();
    const forwarded = annotatedWebhookMock.mock.calls[0]?.[0] as any;
    expect(forwarded.body.entry[0].changes[0].value.messages[0].text.body)
      .toBe("80 g de banana nanica\n150 g de pêra packans");
  });

  it("preserva seis unidades de uva até a gramatura final no fluxo composto", async () => {
    const req = createTextWebhookRequest(
      "1 banana nanica, 6 uvas pretas, 1 pêra packans",
    );
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(annotatedWebhookMock).toHaveBeenCalledOnce();
    const forwarded = annotatedWebhookMock.mock.calls[0]?.[0] as any;
    expect(forwarded.body.entry[0].changes[0].value.messages[0].text.body)
      .toBe("80 g de banana nanica\n30 g de uvas pretas\n150 g de pêra packans");

    const grapePrompt = createDomainTextResponseMock.mock.calls
      .map(promptText)
      .find(prompt => /uvas pretas/i.test(prompt));
    expect(grapePrompt).toContain("Medida: 6 unidade");
    expect(grapePrompt).toContain("pesquisa exclusiva de quantidade: uva");
  });

  it("registra os itens resolvidos e omite somente o item contável pendente", async () => {
    forceGrapeMeasureUnavailable = true;
    createDomainTextResponseMock.mockImplementation(async (_provider, request) => {
      const prompt = request.input?.[0]?.content?.[0]?.text ?? "";
      if (/uvas pretas/i.test(prompt) && forceGrapeMeasureUnavailable) {
        return {
          id: "measure-uva-unavailable",
          outputText: JSON.stringify({ found: false, references: [] }),
          webSearch: { executed: true, searchCount: 1, sources: [] },
          raw: {},
        };
      }
      if (/banana nanica/i.test(prompt)) return searchedMeasure("Banana", "banana", 80);
      throw new Error(`unexpected household-measure prompt: ${prompt}`);
    });

    const req = createTextWebhookRequest("1 banana nanica, 6 uvas pretas");
    const res = createResponse();
    const messageId = req.body.entry[0].changes[0].value.messages[0].id;

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(annotatedWebhookMock).toHaveBeenCalledOnce();
    const forwarded = annotatedWebhookMock.mock.calls[0]?.[0] as any;
    expect(forwarded.body.entry[0].changes[0].value.messages[0].text.body)
      .toBe("80 g de banana nanica");

    const { getWhatsAppDeferredLogicalReply } = await import("./modules/whatsapp/deferredLogicalReply");
    const deferred = getWhatsAppDeferredLogicalReply(
      forwarded,
      messageId,
    );
    expect(deferred?.prefixBlocks.join("\n")).toContain("6 uvas pretas");
    expect(deferred?.prefixBlocks.join("\n")).toContain("Não registrei estes itens");
  });
});
