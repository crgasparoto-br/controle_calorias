import { beforeEach, describe, expect, it, vi } from "vitest";

const requireWhatsAppSendConfigMock = vi.fn();

vi.mock("../../whatsappConfig", () => ({
  getWhatsAppChannelConfig: () => ({ phoneNumberId: "phone-number-test" }),
  requireWhatsAppMediaConfig: vi.fn(),
  requireWhatsAppSendConfig: requireWhatsAppSendConfigMock,
}));

const {
  sendWhatsAppInteractiveUrlButtonMessage,
  sendWhatsAppInteractiveButtonsMessage,
  sendWhatsAppInteractiveListMessage,
} = await import("./webhookUtils");

describe("sendWhatsAppInteractiveUrlButtonMessage", () => {
  beforeEach(() => {
    requireWhatsAppSendConfigMock.mockReset();
    requireWhatsAppSendConfigMock.mockResolvedValue({
      accessToken: "access-token-test",
      phoneNumberId: "phone-number-test",
    });
  });

  it("retorna a falha original para o transporte central aplicar o fallback", async () => {
    const payloads: any[] = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      payloads.push(payload);
      return { ok: false, status: 400, statusText: "Bad Request", text: async () => "{}" } as Response;
    }) as typeof fetch;

    const result = await sendWhatsAppInteractiveUrlButtonMessage(
      "5511999999999",
      "Almoço registrado.",
      "Editar refeição",
      "https://app.example.com/quick-edit/token-123",
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("400 Bad Request");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(expect.objectContaining({
      messaging_product: "whatsapp",
      to: "5511999999999",
      type: "interactive",
    }));
  });
});

describe("sendWhatsAppInteractiveButtonsMessage", () => {
  beforeEach(() => {
    requireWhatsAppSendConfigMock.mockReset();
    requireWhatsAppSendConfigMock.mockResolvedValue({
      accessToken: "access-token-test",
      phoneNumberId: "phone-number-test",
    });
  });

  it("serializa botões de resposta no payload interativo esperado pela Cloud API", async () => {
    const payloads: any[] = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      payloads.push(init?.body ? JSON.parse(String(init.body)) : {});
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const result = await sendWhatsAppInteractiveButtonsMessage("5511999999999", "Confirma a exclusão do almoço?", [
      { id: "confirm", title: "Confirmar" },
      { id: "cancel", title: "Cancelar" },
    ]);

    expect(result.ok).toBe(true);
    expect(payloads[0]).toEqual({
      messaging_product: "whatsapp",
      to: "5511999999999",
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Confirma a exclusão do almoço?" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "confirm", title: "Confirmar" } },
            { type: "reply", reply: { id: "cancel", title: "Cancelar" } },
          ],
        },
      },
    });
  });

  it("retorna falha sanitizada quando a Meta rejeita o envio", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 400, statusText: "Bad Request", text: async () => "{}" } as Response)) as typeof fetch;

    const result = await sendWhatsAppInteractiveButtonsMessage("5511999999999", "x", [{ id: "confirm", title: "Confirmar" }]);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("400");
    expect(result).toEqual(expect.objectContaining({ failureCategory: "provider", status: 400, statusText: "Bad Request" }));
  });
});

describe("sendWhatsAppInteractiveListMessage", () => {
  beforeEach(() => {
    requireWhatsAppSendConfigMock.mockReset();
    requireWhatsAppSendConfigMock.mockResolvedValue({
      accessToken: "access-token-test",
      phoneNumberId: "phone-number-test",
    });
  });

  it("serializa seções e linhas de lista no payload interativo esperado pela Cloud API", async () => {
    const payloads: any[] = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      payloads.push(init?.body ? JSON.parse(String(init.body)) : {});
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    const result = await sendWhatsAppInteractiveListMessage("5511999999999", "Qual período?", "Ver opções", [
      { title: "Períodos", rows: [{ id: "today", title: "Hoje", description: "Resumo de hoje" }] },
    ]);

    expect(result.ok).toBe(true);
    expect(payloads[0]).toEqual({
      messaging_product: "whatsapp",
      to: "5511999999999",
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "Qual período?" },
        action: {
          button: "Ver opções",
          sections: [{ title: "Períodos", rows: [{ id: "today", title: "Hoje", description: "Resumo de hoje" }] }],
        },
      },
    });
  });
});
