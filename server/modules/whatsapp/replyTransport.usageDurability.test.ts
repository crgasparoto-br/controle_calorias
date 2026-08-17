import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendButtons: vi.fn(),
  sendList: vi.fn(),
  sendCta: vi.fn(),
  sendImage: vi.fn(),
  sendImageBuffer: vi.fn(),
  prepare: vi.fn(),
  claim: vi.fn(),
  finalize: vi.fn(),
  inboundId: vi.fn<() => string | null>(),
}));

vi.mock("./webhookUtils", () => ({
  sendWhatsAppTextMessage: mocks.sendText,
  sendWhatsAppInteractiveUrlButtonMessage: mocks.sendCta,
  sendWhatsAppInteractiveButtonsMessage: mocks.sendButtons,
  sendWhatsAppInteractiveListMessage: mocks.sendList,
  sendWhatsAppImageMessage: mocks.sendImage,
  sendWhatsAppImageBufferMessage: mocks.sendImageBuffer,
}));
vi.mock("../usageGovernance/providerUsage", () => ({
  prepareMetaWhatsAppOutboundUsage: mocks.prepare,
  claimMetaWhatsAppOutboundUsageDispatch: mocks.claim,
  finalizeMetaWhatsAppOutboundUsage: mocks.finalize,
}));
vi.mock("./inboundCorrelationContext", () => ({
  getCurrentWhatsappInboundExternalMessageId: mocks.inboundId,
}));

const { buttonsReply, textReply } = await import("./replyContract");
const { sendWhatsAppLogicalReply } = await import("./replyTransport");

const reservation = {
  prepared: true as const,
  created: true,
  idempotencyKey: "meta:whatsapp:stable-position",
  correlationId: "meta:whatsapp:stable-correlation",
};

describe("WhatsApp provider metering durability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inboundId.mockReturnValue("wamid.inbound-durable");
    mocks.prepare.mockResolvedValue(reservation);
    mocks.claim.mockResolvedValue({ claimed: true, state: "provider_dispatch_started" });
    mocks.finalize.mockResolvedValue({ finalized: true, state: "success" });
    mocks.sendText.mockResolvedValue({ ok: true, detail: "text delivered" });
    mocks.sendButtons.mockResolvedValue({ ok: true, detail: "buttons delivered" });
    mocks.sendList.mockResolvedValue({ ok: true, detail: "list delivered" });
    mocks.sendCta.mockResolvedValue({ ok: true, detail: "cta delivered" });
    mocks.sendImage.mockResolvedValue({ ok: true, detail: "image delivered" });
    mocks.sendImageBuffer.mockResolvedValue({ ok: true, detail: "image buffer delivered" });
  });

  it("does not call Meta when the durable usage reservation cannot be created", async () => {
    mocks.prepare.mockRejectedValueOnce(new Error("usage_governance_persistence_unavailable"));

    const result = await sendWhatsAppLogicalReply("5511999999999", textReply("Olá"));

    expect(result.primaryEffectiveOk).toBe(false);
    expect(mocks.sendText).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("keeps provider success when finalization fails and blocks a duplicate outbound while the durable state is uncertain", async () => {
    mocks.finalize.mockRejectedValueOnce(new Error("usage_governance_persistence_unavailable"));

    const first = await sendWhatsAppLogicalReply("5511999999999", textReply("Olá"));
    expect(first.primaryEffectiveOk).toBe(true);
    expect(mocks.sendText).toHaveBeenCalledTimes(1);
    expect(mocks.finalize).toHaveBeenCalledTimes(1);

    mocks.claim.mockResolvedValueOnce({ claimed: false, state: "provider_dispatch_started" });
    const replay = await sendWhatsAppLogicalReply("5511999999999", textReply("Olá"));

    expect(replay.primaryEffectiveOk).toBe(false);
    expect(mocks.sendText).toHaveBeenCalledTimes(1);
  });

  it("treats an already successful idempotent position as delivered without a second provider call", async () => {
    mocks.claim.mockResolvedValueOnce({ claimed: false, state: "success" });

    const result = await sendWhatsAppLogicalReply("5511999999999", textReply("Olá"));

    expect(result.primaryEffectiveOk).toBe(true);
    expect(mocks.sendText).not.toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it("claims once for an original provider attempt plus its textual fallback and finalizes the effective representation", async () => {
    mocks.sendButtons.mockResolvedValueOnce({
      ok: false,
      failureCategory: "provider",
      status: 400,
      statusText: "Bad Request",
      detail: "Meta retornou 400 Bad Request no envio dos botões.",
    });
    mocks.sendText.mockResolvedValueOnce({ ok: true, detail: "fallback delivered" });

    const result = await sendWhatsAppLogicalReply(
      "5511999999999",
      buttonsReply("Confirma?", [
        { id: "yes", title: "Sim" },
        { id: "no", title: "Não" },
      ]),
    );

    expect(result.primaryEffectiveOk).toBe(true);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.sendButtons).toHaveBeenCalledTimes(1);
    expect(mocks.sendText).toHaveBeenCalledTimes(1);
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
      reservation,
      messageType: "text_fallback",
      usedFallback: true,
      effectiveOk: true,
    }));
  });
});
