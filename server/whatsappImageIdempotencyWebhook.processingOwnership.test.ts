import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimState: vi.fn(),
  wasProcessed: vi.fn(),
  beginInbound: vi.fn(),
  logInferenceEvent: vi.fn(),
  downstream: vi.fn(),
}));

vi.mock("./db", () => ({
  createUserWaterLog: vi.fn(),
  getUserIdByWhatsappPhone: vi.fn(async () => 1061),
  listUserExercises: vi.fn(async () => []),
  logInferenceEvent: mocks.logInferenceEvent,
}));

vi.mock("./modules/billing/service", () => ({
  billingService: {
    getUserEntitlements: vi.fn(async () => ({ allowed: true })),
  },
}));

vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: mocks.beginInbound,
  claimMessageForProcessingState: mocks.claimState,
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  recordDomainLink: vi.fn(),
  runWithMessageLifecycleRequestScope: (operation: () => unknown) => operation(),
  wasMessageAlreadyProcessed: mocks.wasProcessed,
}));

vi.mock("./modules/whatsapp/conversationContextRollout", () => ({
  withWhatsappContextFlow: (_flow: unknown, operation: () => unknown) => operation(),
}));

vi.mock("./modules/whatsapp/goalProgressContext", () => ({
  buildWhatsAppExerciseCaloriesByDateKey: vi.fn(() => ({})),
  runWithWhatsAppGoalProgressContext: (_context: unknown, operation: () => unknown) => operation(),
}));

vi.mock("./modules/whatsapp/timeZoneContext", () => ({
  resolveWhatsAppOperationTimeZone: vi.fn(async () => ({ timeZone: "America/Sao_Paulo" })),
}));

vi.mock("./modules/whatsapp/userMeasurementReplyContext", () => ({
  getWhatsAppWaterProgress: vi.fn(async () => ({
    totalMl: 0,
    goalMl: 2000,
    dateKey: "2026-09-11",
    timeZone: "America/Sao_Paulo",
  })),
}));

vi.mock("./modules/whatsapp/domainReplyFormatters", () => ({
  buildWhatsAppCanonicalWaterReply: vi.fn(() => "Água registrada."),
}));

vi.mock("./modules/whatsapp/replyMessages", () => ({
  buildWhatsAppOnboardingLeadReplyMessage: vi.fn(() => "Finalize seu cadastro."),
  buildWhatsAppWaterImageClarificationReplyMessage: vi.fn(() => "Informe a quantidade de água."),
}));

vi.mock("./modules/whatsapp/logicalReplyDelivery", () => ({
  sendWhatsAppLogicalDomainReply: vi.fn(),
  sendWhatsAppStandaloneLogicalReply: vi.fn(),
}));

vi.mock("./whatsappIntentWebhook", () => ({
  handleWhatsAppWebhookWithTextIntent: mocks.downstream,
}));

const { handleWhatsAppWebhookWithImageIdempotency, __resetWhatsAppImageIdempotencyForTests } =
  await import("./whatsappImageIdempotencyWebhook");

function createRequest() {
  return {
    body: {
      entry: [{
        changes: [{
          value: {
            messages: [{
              id: "wamid.1061.restart",
              from: "5511999999999",
              timestamp: "1789164000",
              type: "text",
              text: { body: "/como está minha proteína hoje?" },
            }],
          },
        }],
      }],
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    send(payload: unknown) { this.body = payload; return this; },
  };
}

describe("WhatsApp webhook processing ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetWhatsAppImageIdempotencyForTests();
    mocks.beginInbound.mockResolvedValue({ conversationId: 77, messageId: 1061, wasNewInsert: false });
    mocks.wasProcessed.mockResolvedValue(false);
    mocks.claimState.mockResolvedValue("claimed");
    mocks.downstream.mockImplementation(async (_req: unknown, res: ReturnType<typeof createResponse>) =>
      res.status(200).json({ ok: true, processed: 1 }));
  });

  it("não converte owner ativo em duplicate terminal: responde 503 retryable", async () => {
    mocks.claimState.mockResolvedValue("inflight");
    const response = createResponse();

    await handleWhatsAppWebhookWithImageIdempotency(createRequest() as never, response as never);

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      retryable: true,
      reason: "message_processing_inflight",
    });
    expect(mocks.downstream).not.toHaveBeenCalled();
    expect(mocks.logInferenceEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.idempotency.inflight_retry",
      status: "warning",
    }));
  });

  it("mantém 200 deduplicado somente quando há conclusão persistida", async () => {
    mocks.wasProcessed.mockResolvedValue(true);
    const response = createResponse();

    await handleWhatsAppWebhookWithImageIdempotency(createRequest() as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, processed: 0, deduplicated: true });
    expect(mocks.claimState).not.toHaveBeenCalled();
    expect(mocks.downstream).not.toHaveBeenCalled();
    expect(mocks.logInferenceEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.idempotency.processed_duplicate",
      status: "success",
    }));
  });

  it("retoma owner órfão no mesmo POST e deixa o pipeline real continuar", async () => {
    mocks.claimState.mockResolvedValue("recovered");
    const request = createRequest();
    const response = createResponse();

    await handleWhatsAppWebhookWithImageIdempotency(request as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, processed: 1 });
    expect(mocks.downstream).toHaveBeenCalledOnce();
    expect(mocks.logInferenceEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.idempotency.orphan_recovered",
      status: "success",
    }));
  });

  it("não usa cache local como prova terminal quando a persistência está indisponível", async () => {
    mocks.beginInbound.mockResolvedValue(null);
    const firstResponse = createResponse();
    await handleWhatsAppWebhookWithImageIdempotency(createRequest() as never, firstResponse as never);
    expect(firstResponse.statusCode).toBe(503);

    const secondResponse = createResponse();
    await handleWhatsAppWebhookWithImageIdempotency(createRequest() as never, secondResponse as never);

    expect(secondResponse.statusCode).toBe(503);
    expect(secondResponse.body).toEqual({
      ok: false,
      retryable: true,
      reason: "message_processing_unavailable",
    });
    expect(mocks.downstream).not.toHaveBeenCalled();
  });
});