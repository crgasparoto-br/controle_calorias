import { beforeEach, describe, expect, it, vi } from "vitest";

const sendWhatsAppTextMessageMock = vi.fn(async () => ({ ok: true, detail: "Resposta automática enviada com sucesso." }));
const sendWhatsAppInteractiveUrlButtonMessageMock = vi.fn(async () => ({ ok: true, usedFallback: false, detail: "Mensagem interativa enviada com sucesso." }));
const sendWhatsAppInteractiveButtonsMessageMock = vi.fn(async () => ({ ok: true, detail: "Botões enviados com sucesso." }));
const sendWhatsAppInteractiveListMessageMock = vi.fn(async () => ({ ok: true, detail: "Lista enviada com sucesso." }));
const sendWhatsAppImageMessageMock = vi.fn(async () => ({ ok: true, detail: "Imagem anotada enviada com sucesso." }));
const sendWhatsAppImageBufferMessageMock = vi.fn(async () => ({ ok: true, detail: "Imagem anotada enviada por upload com sucesso." }));

vi.mock("./webhookUtils", () => ({
  sendWhatsAppTextMessage: sendWhatsAppTextMessageMock,
  sendWhatsAppInteractiveUrlButtonMessage: sendWhatsAppInteractiveUrlButtonMessageMock,
  sendWhatsAppInteractiveButtonsMessage: sendWhatsAppInteractiveButtonsMessageMock,
  sendWhatsAppInteractiveListMessage: sendWhatsAppInteractiveListMessageMock,
  sendWhatsAppImageMessage: sendWhatsAppImageMessageMock,
  sendWhatsAppImageBufferMessage: sendWhatsAppImageBufferMessageMock,
}));

const requireWhatsAppSendConfigMock = vi.fn(async () => ({ accessToken: "token-test", phoneNumberId: "phone-id-test" }));
vi.mock("../../whatsappConfig", () => ({
  requireWhatsAppSendConfig: requireWhatsAppSendConfigMock,
}));

const recordOutboundReplyMock = vi.fn(async () => {});
vi.mock("./messageLifecycle", () => ({
  recordOutboundReply: recordOutboundReplyMock,
}));

const {
  acknowledgementReply,
  buttonsReply,
  textReply,
  withAuxiliaryImage,
  withCtaUrl,
} = await import("./replyContract");
const { sendWhatsAppLogicalReply } = await import("./replyTransport");

const lifecycle = { handle: { conversationId: 1, messageId: 1, wasNewInsert: true }, userId: 42 };

describe("replyTransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendWhatsAppTextMessageMock.mockResolvedValue({ ok: true, detail: "Resposta automática enviada com sucesso." });
    sendWhatsAppImageMessageMock.mockResolvedValue({ ok: true, detail: "Imagem anotada enviada com sucesso." });
    requireWhatsAppSendConfigMock.mockResolvedValue({ accessToken: "token-test", phoneNumberId: "phone-id-test" });
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, statusText: "OK" })) as typeof fetch;
  });

  it("usa os adapters centralizados de webhookUtils para texto", async () => {
    await sendWhatsAppLogicalReply("5511999990000", textReply("Registrei 300 ml de água."), lifecycle);
    expect(sendWhatsAppTextMessageMock).toHaveBeenCalledWith("5511999990000", "Registrei 300 ml de água.");
  });

  it("envia uma resposta funcional simples e grava exatamente uma vez no lifecycle", async () => {
    const result = await sendWhatsAppLogicalReply("5511999990000", textReply("Registrei 300 ml de água."), lifecycle);

    expect(result.ok).toBe(true);
    expect(result.recorded).toBe(true);
    expect(recordOutboundReplyMock).toHaveBeenCalledTimes(1);
    expect(recordOutboundReplyMock).toHaveBeenCalledWith(lifecycle.handle, { userId: 42, text: "Registrei 300 ml de água." });
  });

  it("acknowledgement nunca é gravado como resposta funcional, mesmo com envio bem-sucedido", async () => {
    const result = await sendWhatsAppLogicalReply("5511999990000", acknowledgementReply("Recebi sua imagem e estou processando."), lifecycle);

    expect(result.ok).toBe(true);
    expect(result.recorded).toBe(false);
    expect(recordOutboundReplyMock).not.toHaveBeenCalled();
  });

  it("envia a sequência de mensagens físicas na ordem definida (texto + imagem auxiliar)", async () => {
    const reply = withAuxiliaryImage(
      textReply("Refeição registrada."),
      { url: "https://storage.test/annotated.png", caption: "Imagem anotada com os alimentos identificados." },
    );

    await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(sendWhatsAppTextMessageMock).toHaveBeenCalledWith("5511999990000", "Refeição registrada.");
    expect(sendWhatsAppImageMessageMock).toHaveBeenCalledWith(
      "5511999990000",
      "https://storage.test/annotated.png",
      "Imagem anotada com os alimentos identificados.",
    );
    expect(sendWhatsAppTextMessageMock.mock.invocationCallOrder[0]).toBeLessThan(sendWhatsAppImageMessageMock.mock.invocationCallOrder[0]);
  });

  it("serializa imagem por media id dentro do transporte central", async () => {
    const reply = withAuxiliaryImage(textReply("Refeição registrada."), {
      mediaId: "media-opaque-123",
      caption: "Imagem anotada.",
    });

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: "whatsapp",
      to: "5511999990000",
      type: "image",
      image: { id: "media-opaque-123", caption: "Imagem anotada." },
    });
  });

  it("falha na mídia auxiliar não impede a gravação da resposta funcional primária", async () => {
    sendWhatsAppImageMessageMock.mockResolvedValueOnce({ ok: false, detail: "Meta retornou 500 Internal Server Error." });
    const reply = withAuxiliaryImage(
      textReply("Refeição registrada."),
      { url: "https://storage.test/annotated.png", caption: "Imagem anotada." },
    );

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(result.primaryOk).toBe(true);
    expect(result.recorded).toBe(true);
    expect(result.ok).toBe(false);
    expect(recordOutboundReplyMock).toHaveBeenCalledTimes(1);
  });

  it("falha na mensagem primária não grava outbound nem envia mídia auxiliar órfã", async () => {
    sendWhatsAppTextMessageMock.mockResolvedValueOnce({ ok: false, detail: "Meta retornou 500 Internal Server Error." });
    const reply = withAuxiliaryImage(textReply("Registrei 300 ml de água."), {
      url: "https://storage.test/annotated.png",
      caption: "Imagem anotada.",
    });

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(result.primaryOk).toBe(false);
    expect(result.recorded).toBe(false);
    expect(result.ok).toBe(false);
    expect(sendWhatsAppImageMessageMock).not.toHaveBeenCalled();
    expect(recordOutboundReplyMock).not.toHaveBeenCalled();
  });

  it("CTA URL usa o transporte interativo dedicado e preserva o texto de gravação", async () => {
    const reply = withCtaUrl(textReply("Refeição registrada. Edite se precisar."), {
      buttonText: "Editar refeição",
      url: "https://app.test/quick-edit/abc",
    });

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(sendWhatsAppInteractiveUrlButtonMessageMock).toHaveBeenCalledWith(
      "5511999990000",
      "Refeição registrada. Edite se precisar.",
      "Editar refeição",
      "https://app.test/quick-edit/abc",
    );
    expect(recordOutboundReplyMock).toHaveBeenCalledWith(lifecycle.handle, {
      userId: 42,
      text: "Refeição registrada. Edite se precisar.",
    });
    expect(result.recorded).toBe(true);
  });

  it("rejeita botões inválidos antes de chamar o transporte", async () => {
    const reply = buttonsReply("Confirma?", [
      { id: "1", title: "Um" },
      { id: "2", title: "Dois" },
      { id: "3", title: "Três" },
      { id: "4", title: "Quatro" },
    ]);

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(sendWhatsAppInteractiveButtonsMessageMock).not.toHaveBeenCalled();
    expect(result.sends[0].ok).toBe(false);
    expect(result.sends[0].detail).toContain("validação do contrato");
    expect(result.recorded).toBe(false);
    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
  });

  it("sem handle de lifecycle não tenta gravar", async () => {
    const result = await sendWhatsAppLogicalReply("5511999990000", textReply("Registrei 300 ml de água."));
    expect(result.ok).toBe(true);
    expect(result.recorded).toBe(false);
    expect(recordOutboundReplyMock).not.toHaveBeenCalled();
  });
});
