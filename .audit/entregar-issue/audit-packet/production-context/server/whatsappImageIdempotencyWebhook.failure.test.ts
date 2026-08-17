import { beforeEach, describe, expect, it, vi } from "vitest";

const downstreamWebhookMock = vi.fn();
const markMessageProcessedMock = vi.fn(async () => undefined);

vi.mock("./db", () => ({
  createUserWaterLog: vi.fn(),
  getUserIdByWhatsappPhone: vi.fn(async () => 42),
  listUserExercises: vi.fn(async () => []),
  logInferenceEvent: vi.fn(),
}));

vi.mock("./modules/billing/service", () => ({
  billingService: {
    getUserEntitlements: vi.fn(async () => ({
      allowed: true,
      reason: "free_access",
      entitlements: ["system_access"],
      sourceAvailable: true,
      evaluatedAt: new Date(),
    })),
  },
}));

vi.mock("./modules/whatsapp/goalProgressContext", () => ({
  buildWhatsAppExerciseCaloriesByDateKey: vi.fn(() => ({})),
  runWithWhatsAppGoalProgressContext: async (
    _context: unknown,
    operation: () => Promise<unknown>
  ) => operation(),
}));

vi.mock("./modules/whatsapp/conversationContextRollout", () => ({
  withWhatsappContextFlow: async (
    _flow: string,
    operation: () => Promise<unknown>
  ) => operation(),
}));

vi.mock("./modules/whatsapp/timeZoneContext", () => ({
  resolveWhatsAppOperationTimeZone: vi.fn(async () => ({
    timeZone: "America/Sao_Paulo",
    source: "fallback",
    fallbackReason: "profile_missing",
  })),
}));

vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: vi.fn(async () => ({
    conversationId: 1,
    messageId: 10,
    wasNewInsert: true,
  })),
  claimMessageForProcessing: vi.fn(async () => true),
  markMessageProcessed: markMessageProcessedMock,
  recordDomainLink: vi.fn(async () => undefined),
  runWithMessageLifecycleRequestScope: async (
    operation: () => Promise<unknown>
  ) => operation(),
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  enrichInboundMessage: vi.fn(async () => true),
}));

vi.mock("./whatsappIntentWebhook", () => ({
  handleWhatsAppWebhookWithTextIntent: downstreamWebhookMock,
}));

const {
  __resetWhatsAppImageIdempotencyForTests,
  handleWhatsAppWebhookWithImageIdempotency,
} = await import("./whatsappImageIdempotencyWebhook");

function request() {
  return {
    body: {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid-retryable-failure",
                    from: "5511999999999",
                    timestamp: "1780502400",
                    type: "text",
                    text: { body: "100g arroz" },
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

describe("WhatsApp gateway failure lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetWhatsAppImageIdempotencyForTests();
  });

  it("não marca a mensagem como processada quando a cadeia downstream lança exceção", async () => {
    downstreamWebhookMock.mockRejectedValueOnce(
      new Error("downstream unavailable")
    );

    await expect(
      handleWhatsAppWebhookWithImageIdempotency(
        request() as never,
        {} as never
      )
    ).rejects.toThrow("downstream unavailable");

    expect(markMessageProcessedMock).not.toHaveBeenCalled();
  });
});
