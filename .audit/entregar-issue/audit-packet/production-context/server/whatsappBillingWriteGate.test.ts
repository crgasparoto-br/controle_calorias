import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getUserEntitlementsMock = vi.fn();
const beginInboundMessageMock = vi.fn();
const claimMessageForProcessingMock = vi.fn();
const markMessageProcessedMock = vi.fn();
const sendWhatsAppLogicalDomainReplyMock = vi.fn();

vi.mock("./db", () => ({
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
}));
vi.mock("./modules/billing/service", () => ({
  billingService: { getUserEntitlements: getUserEntitlementsMock },
}));
vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: beginInboundMessageMock,
  claimMessageForProcessing: claimMessageForProcessingMock,
  markMessageProcessed: markMessageProcessedMock,
}));
vi.mock("./modules/whatsapp/logicalReplyDelivery", () => ({
  sendWhatsAppLogicalDomainReply: sendWhatsAppLogicalDomainReplyMock,
}));

const { gateSuspendedWhatsAppWrites } = await import("./whatsappBillingWriteGate");

function payloadFor(message: Record<string, unknown>) {
  return {
    entry: [{ changes: [{ value: { messages: [{ from: "5511999999999", ...message }] } }] }],
  };
}

describe("suspended WhatsApp write gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getUserEntitlementsMock.mockResolvedValue({
      allowed: true,
      reason: "read_only_access",
      entitlements: ["system_access", "web_access", "reports"],
      sourceAvailable: true,
      evaluatedAt: new Date("2026-08-10T12:00:00.000Z"),
    });
    beginInboundMessageMock.mockResolvedValue({ id: 99 });
    claimMessageForProcessingMock.mockResolvedValue(true);
    markMessageProcessedMock.mockResolvedValue(undefined);
    sendWhatsAppLogicalDomainReplyMock.mockResolvedValue({ result: { primaryOk: true } });
  });

  for (const scenario of [
    { label: "text", message: { id: "wamid-text", type: "text", text: { body: "100 g arroz" } }, contentType: "text" },
    { label: "image", message: { id: "wamid-image", type: "image", image: { id: "img", caption: "100 g arroz" } }, contentType: "image" },
    { label: "audio", message: { id: "wamid-audio", type: "audio", audio: { id: "aud" } }, contentType: "audio" },
    { label: "interactive", message: { id: "wamid-interactive", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "confirm", title: "Confirmar" } } }, contentType: "text" },
  ]) {
    it(`blocks suspended ${scenario.label} before nutrition processing`, async () => {
      const input = payloadFor(scenario.message);
      const result = await gateSuspendedWhatsAppWrites(input);

      expect(result.handledCount).toBe(1);
      expect(result.remainingPayload).toEqual({ entry: [] });
      expect(beginInboundMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 42,
          contentType: scenario.contentType,
          text: null,
          captionText: null,
          allowRawContentStorage: false,
        })
      );
      expect(sendWhatsAppLogicalDomainReplyMock).toHaveBeenCalledOnce();
      expect(markMessageProcessedMock).toHaveBeenCalledOnce();
    });
  }

  it("passes normal paid access through untouched", async () => {
    getUserEntitlementsMock.mockResolvedValue({
      allowed: true,
      reason: "active_subscription",
      entitlements: ["system_access"],
      sourceAvailable: true,
      evaluatedAt: new Date("2026-08-10T12:00:00.000Z"),
    });
    const input = payloadFor({ id: "wamid-paid", type: "text", text: { body: "arroz" } });
    const result = await gateSuspendedWhatsAppWrites(input);

    expect(result.handledCount).toBe(0);
    expect(result.remainingPayload).toBe(input);
    expect(beginInboundMessageMock).not.toHaveBeenCalled();
  });
});
