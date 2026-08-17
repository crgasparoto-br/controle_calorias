import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserIdByWhatsappPhone: vi.fn(),
  recordUsageEvent: vi.fn(),
  getUserSubscriptionStatus: vi.fn(),
}));

vi.mock("../../db", () => ({ getUserIdByWhatsappPhone: mocks.getUserIdByWhatsappPhone }));
vi.mock("../../repositories/usageGovernanceRepository", () => ({ recordUsageEvent: mocks.recordUsageEvent }));
vi.mock("../billing/service", () => ({ billingService: { getUserSubscriptionStatus: mocks.getUserSubscriptionStatus } }));
vi.mock("./service", () => ({ USAGE_RULE_VERSION: "test-rule" }));

import { recordMetaWhatsAppOutboundUsage } from "./providerUsage";

describe("Meta WhatsApp usage metering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserIdByWhatsappPhone.mockResolvedValue(42);
    mocks.recordUsageEvent.mockResolvedValue({ created: true });
    mocks.getUserSubscriptionStatus.mockResolvedValue({
      access: { reason: "sponsored_by_professional", sponsorUserId: 7, planCode: "professional_v1" },
      subscription: { id: "sub-patient", planCode: "individual_v1", billingCycle: "monthly", currency: "BRL" },
      professionalSubscription: { id: "sub-pro", planCode: "professional_v1", billingCycle: "monthly", currency: "BRL" },
    });
  });

  it("attributes an accepted Meta message to the professional payer while preserving the patient beneficiary", async () => {
    await recordMetaWhatsAppOutboundUsage({
      recipientPhone: "5511999999999",
      sourceMessageId: "wamid.inbound-1",
      sequenceIndex: 0,
      messageType: "text",
      role: "primary",
      usedFallback: false,
      occurredAt: new Date("2026-08-17T01:00:00.000Z"),
    });

    expect(mocks.recordUsageEvent).toHaveBeenCalledWith(expect.objectContaining({
      beneficiaryUserId: 42,
      patientUserId: 42,
      sponsorUserId: 7,
      payerUserId: 7,
      subscriptionId: "sub-pro",
      versionCode: "professional_v1",
      provider: "meta",
      channel: "whatsapp",
      operation: "whatsapp_text",
      unitType: "message",
      unitCount: 1,
      estimatedCostMicros: null,
      effectiveCostMicros: null,
      currency: null,
      eventState: "success",
    }));
  });

  it("derives the same idempotency key for the same physical response position", async () => {
    const input = {
      userId: 42,
      sourceMessageId: "wamid.inbound-2",
      sequenceIndex: 1,
      messageType: "buttons",
      role: "auxiliary" as const,
      usedFallback: false,
    };
    await recordMetaWhatsAppOutboundUsage(input);
    await recordMetaWhatsAppOutboundUsage(input);
    const first = mocks.recordUsageEvent.mock.calls[0][0];
    const second = mocks.recordUsageEvent.mock.calls[1][0];
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.correlationId).toBe(second.correlationId);
  });
});
