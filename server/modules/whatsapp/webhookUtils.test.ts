import { beforeEach, describe, expect, it, vi } from "vitest";

const requireWhatsAppSendConfigMock = vi.fn();

vi.mock("../../whatsappConfig", () => ({
  getWhatsAppChannelConfig: () => ({ phoneNumberId: "phone-number-test" }),
  requireWhatsAppMediaConfig: vi.fn(),
  requireWhatsAppSendConfig: requireWhatsAppSendConfigMock,
}));

const { sendWhatsAppInteractiveUrlButtonMessage } = await import("./webhookUtils");

describe("sendWhatsAppInteractiveUrlButtonMessage", () => {
  beforeEach(() => {
    requireWhatsAppSendConfigMock.mockReset();
    requireWhatsAppSendConfigMock.mockResolvedValue({
      accessToken: "access-token-test",
      phoneNumberId: "phone-number-test",
    });
  });

  it("envia fallback textual com o link quando o botão interativo falha", async () => {
    const payloads: any[] = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      payloads.push(payload);
      if (payload.type === "interactive") {
        return { ok: false, status: 400, statusText: "Bad Request", json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const result = await sendWhatsAppInteractiveUrlButtonMessage(
      "5511999999999",
      "Almoço registrado.",
      "Editar refeição",
      "https://app.example.com/quick-edit/token-123",
    );

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("fallback textual enviado com sucesso");
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toEqual(expect.objectContaining({
      messaging_product: "whatsapp",
      to: "5511999999999",
      type: "interactive",
    }));
    expect(payloads[1]).toEqual(expect.objectContaining({
      messaging_product: "whatsapp",
      to: "5511999999999",
      type: "text",
      text: expect.objectContaining({
        preview_url: true,
        body: [
          "Almoço registrado.",
          "",
          "Editar refeição: https://app.example.com/quick-edit/token-123",
        ].join("\n"),
      }),
    }));
  });
});
