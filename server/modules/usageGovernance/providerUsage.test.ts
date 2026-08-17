import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserIdByWhatsappPhone: vi.fn(),
  recordUsageEvent: vi.fn(),
  getUserSubscriptionStatus: vi.fn(),
  billingModuleLoads: 0,
  serviceModuleLoads: 0,
}));

vi.mock("../../db", () => ({ getUserIdByWhatsappPhone: mocks.getUserIdByWhatsappPhone }));
vi.mock("../../repositories/usageGovernanceRepository", () => ({ recordUsageEvent: mocks.recordUsageEvent }));
vi.mock("../billing/service", () => {
  mocks.billingModuleLoads += 1;
  return { billingService: { getUserSubscriptionStatus: mocks.getUserSubscriptionStatus } };
});
vi.mock("./service", () => {
  mocks.serviceModuleLoads += 1;
  return { USAGE_RULE_VERSION: "test-rule" };
});

import { recordMetaWhatsAppOutboundUsage } from "./providerUsage";

describe("Meta WhatsApp usage metering import isolation", () => {
  it("does not initialize billing persistence or the broad governance service before an attributable event", async () => {
    expect(mocks.billingModuleLoads).toBe(0);
    expect(mocks.serviceModuleLoads).toBe(0);

    await expect(recordMetaWhatsAppOutboundUsage({
      userId: 42,
      sourceMessageId: "   ",
      sequenceIndex: 0,
      messageType: "text",
      role: "primary",
      usedFallback: false,
    })).resolves.toEqual({ created: false, reason: "missing_correlation" });

    expect(mocks.billingModuleLoads).toBe(0);
    expect(mocks.serviceModuleLoads).toBe(0);
  });
});

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

    expect(mocks.billingModuleLoads).toBe(1);
    expect(mocks.serviceModuleLoads).toBe(1);
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
      ruleVersion: "test-rule",
    }));
  });

  it("derives the same idempotency key for the same response position even if a reprocess falls back", async () => {
    const base = {
      userId: 42,
      sourceMessageId: "wamid.inbound-2",
      sequenceIndex: 1,
      role: "auxiliary" as const,
    };
    await recordMetaWhatsAppOutboundUsage({ ...base, messageType: "buttons", usedFallback: false });
    await recordMetaWhatsAppOutboundUsage({ ...base, messageType: "text_fallback", usedFallback: true });
    const first = mocks.recordUsageEvent.mock.calls[0][0];
    const second = mocks.recordUsageEvent.mock.calls[1][0];
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.correlationId).toBe(second.correlationId);
  });
});
