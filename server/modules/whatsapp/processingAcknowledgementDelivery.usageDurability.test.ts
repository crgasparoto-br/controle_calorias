import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendText: vi.fn(),
  prepare: vi.fn(),
  claim: vi.fn(),
  finalize: vi.fn(),
  inboundId: vi.fn<() => string | null>(),
}));

vi.mock("./webhookUtils", () => ({ sendWhatsAppTextMessage: mocks.sendText }));
vi.mock("../usageGovernance/providerUsage", () => ({
  prepareMetaWhatsAppOutboundUsage: mocks.prepare,
  claimMetaWhatsAppOutboundUsageDispatch: mocks.claim,
  finalizeMetaWhatsAppOutboundUsage: mocks.finalize,
}));
vi.mock("./inboundCorrelationContext", () => ({
  getCurrentWhatsappInboundExternalMessageId: mocks.inboundId,
}));

const { sendWhatsAppProcessingAcknowledgement } = await import("./processingAcknowledgementDelivery");

const reservation = {
  prepared: true as const,
  created: true,
  idempotencyKey: "meta:whatsapp:ack",
  correlationId: "meta:whatsapp:ack-root",
};

describe("processing acknowledgement usage durability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inboundId.mockReturnValue("wamid.processing");
    mocks.prepare.mockResolvedValue(reservation);
    mocks.claim.mockResolvedValue({ claimed: true, state: "provider_dispatch_started" });
    mocks.finalize.mockResolvedValue({ finalized: true, state: "success" });
    mocks.sendText.mockResolvedValue({ ok: true, detail: "sent" });
  });

  it("fails closed before Meta when metering persistence is unavailable", async () => {
    mocks.prepare.mockRejectedValueOnce(new Error("usage_governance_persistence_unavailable"));

    const result = await sendWhatsAppProcessingAcknowledgement("5511999999999", "Processando");

    expect(result.ok).toBe(false);
    expect(mocks.sendText).not.toHaveBeenCalled();
  });

  it("leaves the pre-provider state durable when post-send finalization fails", async () => {
    mocks.finalize.mockRejectedValueOnce(new Error("usage_governance_persistence_unavailable"));

    const result = await sendWhatsAppProcessingAcknowledgement("5511999999999", "Processando");

    expect(result.ok).toBe(true);
    expect(mocks.sendText).toHaveBeenCalledTimes(1);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.finalize).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a provider call while a previous dispatch is uncertain", async () => {
    mocks.claim.mockResolvedValueOnce({ claimed: false, state: "provider_dispatch_started" });

    const result = await sendWhatsAppProcessingAcknowledgement("5511999999999", "Processando");

    expect(result.ok).toBe(false);
    expect(mocks.sendText).not.toHaveBeenCalled();
  });
});
