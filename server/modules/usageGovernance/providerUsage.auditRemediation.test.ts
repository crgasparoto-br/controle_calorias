import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserIdByWhatsappPhone: vi.fn(),
  recordUsageEvent: vi.fn(),
  getUserSubscriptionStatus: vi.fn(),
  claimUsageProviderDispatch: vi.fn(),
  finalizeUsageProviderDispatch: vi.fn(),
}));

vi.mock("../../db", () => ({ getUserIdByWhatsappPhone: mocks.getUserIdByWhatsappPhone }));
vi.mock("../../repositories/usageGovernanceRepository", () => ({ recordUsageEvent: mocks.recordUsageEvent }));
vi.mock("../../repositories/usageProviderDispatchRepository", () => ({
  claimUsageProviderDispatch: mocks.claimUsageProviderDispatch,
  finalizeUsageProviderDispatch: mocks.finalizeUsageProviderDispatch,
}));
vi.mock("../billing/service", () => ({
  billingService: { getUserSubscriptionStatus: mocks.getUserSubscriptionStatus },
}));
vi.mock("./service", () => ({ USAGE_RULE_VERSION: "test-rule" }));

const previousDispatchTestMode = process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE;
process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE = "database";
afterAll(() => {
  if (previousDispatchTestMode === undefined) delete process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE;
  else process.env.USAGE_PROVIDER_DISPATCH_TEST_MODE = previousDispatchTestMode;
});
const {
  claimMetaWhatsAppOutboundUsageDispatch,
  finalizeMetaWhatsAppOutboundUsage,
  prepareMetaWhatsAppOutboundUsage,
} = await import("./providerUsage");

describe("Meta provider usage durable dispatch state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserIdByWhatsappPhone.mockResolvedValue(42);
    mocks.getUserSubscriptionStatus.mockResolvedValue({
      access: { reason: "sponsored_by_professional", sponsorUserId: 7, planCode: "professional_v1" },
      subscription: { id: "sub-patient", planCode: "individual_v1", billingCycle: "monthly" },
      professionalSubscription: { id: "sub-pro", planCode: "professional_v1", billingCycle: "monthly" },
    });
    mocks.recordUsageEvent.mockResolvedValue({ created: true });
    mocks.claimUsageProviderDispatch.mockResolvedValue({ claimed: true, state: "provider_dispatch_started" });
    mocks.finalizeUsageProviderDispatch.mockResolvedValue({ finalized: true, state: "success" });
  });

  it("persists a reserved ledger position before any provider call can be claimed", async () => {
    const prepared = await prepareMetaWhatsAppOutboundUsage({
      recipientPhone: "5511999999999",
      sourceMessageId: "wamid.inbound-durable-1",
      sequenceIndex: 0,
      messageType: "text",
      role: "primary",
      occurredAt: new Date("2026-08-17T18:00:00.000Z"),
    });

    expect(prepared.prepared).toBe(true);
    expect(mocks.recordUsageEvent).toHaveBeenCalledWith(expect.objectContaining({
      provider: "meta",
      channel: "whatsapp",
      eventState: "provider_dispatch_reserved",
      beneficiaryUserId: 42,
      payerUserId: 7,
      subscriptionId: "sub-pro",
      unitCount: 1,
      metadata: expect.objectContaining({ measurementState: "reserved_before_provider_call" }),
    }));
  });

  it("keeps a stable logical root but assigns distinct durable identities to original and fallback attempts", async () => {
    const first = await prepareMetaWhatsAppOutboundUsage({
      userId: 42,
      sourceMessageId: "wamid.inbound-durable-2",
      sequenceIndex: 1,
      messageType: "buttons",
      role: "auxiliary",
      attemptKind: "original",
    });
    const second = await prepareMetaWhatsAppOutboundUsage({
      userId: 42,
      sourceMessageId: "wamid.inbound-durable-2",
      sequenceIndex: 1,
      messageType: "text_fallback",
      role: "auxiliary",
      attemptKind: "fallback",
    });
    expect(first.prepared && second.prepared).toBe(true);
    if (!first.prepared || !second.prepared) throw new Error("unexpected preparation failure");
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first.correlationId).toBe(second.correlationId);
    expect(mocks.recordUsageEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      attemptRole: "auxiliary",
      retryRootKey: null,
    }));
    expect(mocks.recordUsageEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      attemptRole: "fallback",
      retryRootKey: first.correlationId,
    }));
  });

  it("claims the reserved position atomically before provider dispatch", async () => {
    const prepared = await prepareMetaWhatsAppOutboundUsage({
      userId: 42,
      sourceMessageId: "wamid.inbound-durable-3",
      sequenceIndex: 0,
      messageType: "text",
      role: "primary",
    });
    if (!prepared.prepared) throw new Error("unexpected preparation failure");

    await expect(claimMetaWhatsAppOutboundUsageDispatch(prepared)).resolves.toMatchObject({ claimed: true });
    expect(mocks.claimUsageProviderDispatch).toHaveBeenCalledWith(prepared.idempotencyKey);
  });

  it("finalizes the already-durable attempt without erasing the idempotent identity", async () => {
    const prepared = await prepareMetaWhatsAppOutboundUsage({
      userId: 42,
      sourceMessageId: "wamid.inbound-durable-4",
      sequenceIndex: 0,
      messageType: "buttons",
      role: "primary",
    });
    if (!prepared.prepared) throw new Error("unexpected preparation failure");

    await finalizeMetaWhatsAppOutboundUsage({
      reservation: prepared,
      messageType: "text_fallback",
      role: "primary",
      usedFallback: true,
      effectiveOk: true,
      providerStatus: 400,
      providerStatusText: "Bad Request",
    });

    expect(mocks.finalizeUsageProviderDispatch).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: prepared.idempotencyKey,
      eventState: "success",
      operation: "whatsapp_text_fallback",
      attemptRole: "fallback",
      retryRootKey: prepared.correlationId,
      metadata: expect.objectContaining({ measurementState: "finalized", usedFallback: true }),
    }));
  });
});
