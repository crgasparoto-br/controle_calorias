import { beforeEach, describe, expect, it, vi } from "vitest";

const legacyHandleMock = vi.fn();
const annotatedHandleMock = vi.fn();

vi.mock("./whatsappWebhookLegacy", () => ({
  __resetWhatsAppWebhookDeduplicationForTests: vi.fn(),
  verifyWhatsAppWebhook: vi.fn(),
  handleWhatsAppWebhook: legacyHandleMock,
}));

vi.mock("./whatsappAnnotatedImageWebhook", () => ({
  handleWhatsAppWebhookWithAnnotatedImages: annotatedHandleMock,
}));

function response() {
  return {} as never;
}

function request(message: Record<string, unknown>) {
  return {
    body: {
      entry: [{ changes: [{ value: { messages: [message] } }] }],
    },
  } as never;
}

describe("WhatsApp webhook image routing facade", () => {
  beforeEach(() => {
    legacyHandleMock.mockReset();
    annotatedHandleMock.mockReset();
    legacyHandleMock.mockResolvedValue("legacy");
    annotatedHandleMock.mockResolvedValue("annotated");
  });

  it("routes an image plus audio through the structured image router", async () => {
    const { handleWhatsAppWebhook } = await import("./whatsappWebhook");
    const req = request({
      id: "multimodal-1",
      from: "5511999999999",
      image: { id: "image-1", mime_type: "image/jpeg" },
      audio: { id: "audio-1", mime_type: "audio/ogg" },
    });
    const res = response();

    await expect(handleWhatsAppWebhook(req, res)).resolves.toBe("annotated");
    expect(annotatedHandleMock).toHaveBeenCalledWith(req, res);
    expect(legacyHandleMock).not.toHaveBeenCalled();
  });

  it("falls through to legacy on structured-router re-entry", async () => {
    const { handleWhatsAppWebhook } = await import("./whatsappWebhook");
    const req = request({
      id: "unclaimed-image-1",
      from: "5511999999999",
      image: { id: "image-1", mime_type: "image/jpeg" },
    });
    const res = response();
    annotatedHandleMock.mockImplementationOnce(() => handleWhatsAppWebhook(req, res));

    await expect(handleWhatsAppWebhook(req, res)).resolves.toBe("legacy");
    expect(annotatedHandleMock).toHaveBeenCalledTimes(1);
    expect(legacyHandleMock).toHaveBeenCalledTimes(1);
  });

  it("keeps non-image payloads in the legacy domain handler", async () => {
    const { handleWhatsAppWebhook } = await import("./whatsappWebhook");
    const req = request({
      id: "text-1",
      from: "5511999999999",
      text: { body: "almoço: arroz e feijão" },
    });
    const res = response();

    await expect(handleWhatsAppWebhook(req, res)).resolves.toBe("legacy");
    expect(legacyHandleMock).toHaveBeenCalledWith(req, res);
    expect(annotatedHandleMock).not.toHaveBeenCalled();
  });
});
