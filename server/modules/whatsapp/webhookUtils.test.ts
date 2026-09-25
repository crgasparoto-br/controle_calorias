import { beforeEach, describe, expect, it, vi } from "vitest";

const requireWhatsAppSendConfigMock = vi.fn();
const requireWhatsAppMediaConfigMock = vi.fn();

vi.mock("../../whatsappConfig", () => ({
  getWhatsAppChannelConfig: () => ({ phoneNumberId: "phone-number-test" }),
  requireWhatsAppMediaConfig: requireWhatsAppMediaConfigMock,
  requireWhatsAppSendConfig: requireWhatsAppSendConfigMock,
}));

const {
  downloadWhatsAppMedia,
  MAX_WHATSAPP_MEDIA_BYTES,
  sendWhatsAppInteractiveUrlButtonMessage,
  sendWhatsAppInteractiveButtonsMessage,
  sendWhatsAppInteractiveListMessage,
} = await import("./webhookUtils");

function responseHeaders(values: Record<string, string>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

function mediaResponse(input: {
  contentLength?: number;
  reads: Array<Uint8Array | undefined>;
  cancel?: (reason: unknown) => void;
}) {
  let index = 0;
  const reader = {
    read: vi.fn(async () => {
      const value = input.reads[index++];
      return value ? { done: false, value } : { done: true, value: undefined };
    }),
    cancel: vi.fn(async (reason: unknown) => input.cancel?.(reason)),
    releaseLock: vi.fn(),
  };
  return {
    response: {
      ok: true,
      headers: responseHeaders({
        "content-type": "image/jpeg",
        ...(input.contentLength === undefined ? {} : { "content-length": String(input.contentLength) }),
      }),
      body: { getReader: () => reader },
    } as unknown as Response,
    reader,
  };
}

describe("downloadWhatsAppMedia", () => {
  beforeEach(() => {
    requireWhatsAppMediaConfigMock.mockReset();
    requireWhatsAppMediaConfigMock.mockResolvedValue({ accessToken: "access-token-test" });
  });

  it("rejeita Content-Length acima do teto antes de ler o corpo", async () => {
    const oversized = mediaResponse({
      contentLength: MAX_WHATSAPP_MEDIA_BYTES + 1,
      reads: [new Uint8Array([1])],
    });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://media.test/image", mime_type: "image/jpeg" }) })
      .mockResolvedValueOnce(oversized.response) as unknown as typeof fetch;

    await expect(downloadWhatsAppMedia("media-too-large")).rejects.toThrow("whatsapp_media_too_large");
    expect(oversized.reader.read).not.toHaveBeenCalled();
  });

  it("aborta o streaming quando o corpo ultrapassa o teto sem chamar o consumidor", async () => {
    let cancelReason: unknown;
    const oversized = mediaResponse({
      reads: [new Uint8Array(MAX_WHATSAPP_MEDIA_BYTES), new Uint8Array([1])],
      cancel: reason => { cancelReason = reason; },
    });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://media.test/image", mime_type: "image/jpeg" }) })
      .mockResolvedValueOnce(oversized.response) as unknown as typeof fetch;

    await expect(downloadWhatsAppMedia("media-stream-too-large")).rejects.toThrow("whatsapp_media_too_large");
    expect(oversized.reader.cancel).toHaveBeenCalledWith("whatsapp_media_too_large");
    expect(cancelReason).toBe("whatsapp_media_too_large");
  });

  it("reconstitui um corpo dentro do teto em chunks e preserva o mime", async () => {
    const bounded = mediaResponse({
      reads: [new Uint8Array([1, 2]), new Uint8Array([3]), undefined],
    });
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: "https://media.test/image", mime_type: "image/jpeg" }) })
      .mockResolvedValueOnce(bounded.response) as unknown as typeof fetch;

    await expect(downloadWhatsAppMedia("media-bounded")).resolves.toEqual({
      buffer: Buffer.from([1, 2, 3]),
      mimeType: "image/jpeg",
    });
  });
});

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
