import { beforeEach, describe, expect, it, vi } from "vitest";

const beginInboundMessageMock = vi.fn(async () => null);
const downstreamWebhookMock = vi.fn();
const createUserWaterLogMock = vi.fn();
const getUserEntitlementsMock = vi.fn();
const getUserIdByWhatsappPhoneMock = vi.fn();
const listUserExercisesMock = vi.fn();

vi.mock("./db", () => ({
  createUserWaterLog: createUserWaterLogMock,
  getDb: vi.fn(async () => null),
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  getUserWaterGoal: vi.fn(async () => ({ dailyMl: 2500 })),
  listUserWaterLogs: vi.fn(async () => []),
  listUserWeightEntries: vi.fn(async () => []),
  listUserExercises: listUserExercisesMock,
  logInferenceEvent: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));

vi.mock("./modules/billing/service", () => ({
  billingService: {
    getUserEntitlements: getUserEntitlementsMock,
  },
}));

vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: beginInboundMessageMock,
  claimMessageForProcessing: vi.fn(async () => true),
  markMessageProcessed: vi.fn(async () => undefined),
  recordDomainLink: vi.fn(async () => undefined),
  runWithMessageLifecycleRequestScope: async (
    operation: () => Promise<unknown>
  ) => operation(),
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  enrichInboundMessage: vi.fn(async () => true),
}));

vi.mock("./whatsappConfig", () => ({
  requireWhatsAppMediaConfig: async () => ({ accessToken: "token-test" }),
  requireWhatsAppSendConfig: async () => ({
    accessToken: "token-test",
    phoneNumberId: "phone-number-test",
  }),
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

function requestFor(message: Record<string, unknown>) {
  return {
    body: {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "5511999999999",
                    timestamp: "1780502400",
                    ...message,
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

const cases = [
  {
    label: "texto",
    contentType: "text",
    message: {
      id: "wamid-billing-text",
      type: "text",
      text: { body: "Comi arroz e frango" },
    },
  },
  {
    label: "áudio",
    contentType: "audio",
    message: {
      id: "wamid-billing-audio",
      type: "audio",
      audio: { id: "audio-1", mime_type: "audio/ogg" },
    },
  },
  {
    label: "confirmação interativa",
    contentType: "text",
    message: {
      id: "wamid-billing-interactive",
      type: "interactive",
      interactive: {
        type: "button_reply",
        button_reply: { id: "confirm-meal", title: "Confirmar" },
      },
    },
  },
] as const;

describe("WhatsApp billing access across message modalities", () => {
  beforeEach(() => {
    __resetWhatsAppImageIdempotencyForTests();
    vi.clearAllMocks();
    beginInboundMessageMock.mockResolvedValue(null);
    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getUserEntitlementsMock.mockResolvedValue({
      allowed: false,
      reason: "no_access",
      entitlements: [],
      sourceAvailable: true,
      evaluatedAt: new Date("2026-07-22T12:00:00.000Z"),
    });
    listUserExercisesMock.mockResolvedValue([]);
    downstreamWebhookMock.mockImplementation(async (_req, res: MockResponse) =>
      res.status(200).json({ ok: true, processed: 1 })
    );
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ messages: [{ id: "sent-1" }] }),
    })) as typeof fetch;
  });

  for (const scenario of cases) {
    it(`blocks ${scenario.label} before any nutrition effect`, async () => {
      const response = createResponse();

      await handleWhatsAppWebhookWithImageIdempotency(
        requestFor(scenario.message) as never,
        response as never
      );

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ ok: true, processed: 1 });
      expect(downstreamWebhookMock).not.toHaveBeenCalled();
      expect(createUserWaterLogMock).not.toHaveBeenCalled();
      expect(beginInboundMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 42,
          contentType: scenario.contentType,
          text: null,
          captionText: null,
          allowRawContentStorage: false,
        })
      );
    });
  }
});
