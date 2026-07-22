import { beforeEach, describe, expect, it, vi } from "vitest";

const sendWhatsAppTextMessageMock = vi.fn(async () => ({ ok: true, detail: "Resposta automática enviada com sucesso." }));
const sendWhatsAppInteractiveUrlButtonMessageMock = vi.fn(async () => ({ ok: true, detail: "Mensagem interativa enviada com sucesso." }));
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

const recordOutboundReplyMock = vi.fn(async () => {});
vi.mock("./messageLifecycle", () => ({
  recordOutboundReply: recordOutboundReplyMock,
}));

const getCurrentWhatsappInboundExternalMessageIdMock = vi.fn<() => string | null>(() => null);
vi.mock("./inboundCorrelationContext", () => ({
  getCurrentWhatsappInboundExternalMessageId: getCurrentWhatsappInboundExternalMessageIdMock,
}));

const {
  acknowledgementReply,
  buttonsReply,
  listReply,
  sequencedTextReply,
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
    sendWhatsAppInteractiveUrlButtonMessageMock.mockResolvedValue({ ok: true, detail: "Mensagem interativa enviada com sucesso." });
    getCurrentWhatsappInboundExternalMessageIdMock.mockReturnValue(null);
    sendWhatsAppImageMessageMock.mockResolvedValue({ ok: true, detail: "Imagem anotada enviada com sucesso." });
  });

  it("nunca chama o transporte real da Cloud API — apenas os mocks de webhookUtils", async () => {
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
    // ordem: chamada de texto (primária) antes da chamada de imagem (auxiliar).
    expect(sendWhatsAppTextMessageMock.mock.invocationCallOrder[0]).toBeLessThan(sendWhatsAppImageMessageMock.mock.invocationCallOrder[0]);
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

  it("falha na mensagem primária não grava outbound no lifecycle", async () => {
    sendWhatsAppTextMessageMock.mockResolvedValueOnce({ ok: false, detail: "Meta retornou 500 Internal Server Error." });

    const result = await sendWhatsAppLogicalReply("5511999990000", textReply("Registrei 300 ml de água."), lifecycle);

    expect(result.primaryOk).toBe(false);
    expect(result.recorded).toBe(false);
    expect(recordOutboundReplyMock).not.toHaveBeenCalled();
  });


  it("continua tentando auxiliares independentes mesmo após falha efetiva de um auxiliar anterior (issue #859)", async () => {
    sendWhatsAppTextMessageMock
      .mockResolvedValueOnce({ ok: true, detail: "primeira enviada" })
      .mockResolvedValueOnce({ ok: false, detail: "segunda falhou" })
      .mockResolvedValueOnce({ ok: true, detail: "terceira enviada" });

    const result = await sendWhatsAppLogicalReply(
      "5511999990000",
      sequencedTextReply(["primeira", "segunda", "terceira"]),
    );

    expect(sendWhatsAppTextMessageMock).toHaveBeenCalledTimes(3);
    expect(sendWhatsAppTextMessageMock).toHaveBeenCalledWith("5511999990000", "terceira");
    expect(result.sends).toHaveLength(3);
    expect(result.sends[0].effectiveOk).toBe(true);
    expect(result.sends[1].effectiveOk).toBe(false);
    expect(result.sends[2].effectiveOk).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.primaryEffectiveOk).toBe(true);
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

  it("CTA rejeitado pela Meta e fallback aceito reflete sucesso efetivo coerente com botões/lista", async () => {
    sendWhatsAppInteractiveUrlButtonMessageMock.mockResolvedValueOnce({
      ok: false,
      detail: "Meta retornou 400 Bad Request: erro no envio da mensagem interativa.",
    });
    const reply = withCtaUrl(textReply("Refeição registrada."), { buttonText: "Editar refeição", url: "https://app.test/quick-edit/abc" });

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(result.sends[0].usedFallback).toBe(true);
    expect(result.sends[0].originalOk).toBe(false);
    expect(result.sends[0].fallbackOk).toBe(true);
    expect(result.sends[0].category).toBe("provider");
    expect(result.sends[0].effectiveOk).toBe(true);
    expect(result.recorded).toBe(true);
  });

  it("botões rejeitados por validação local com conteúdo suficiente geram fallback textual determinístico (issue #859)", async () => {
    const reply = buttonsReply("Confirma?", [
      { id: "1", title: "Um" },
      { id: "2", title: "Dois" },
      { id: "3", title: "Três" },
      { id: "4", title: "Quatro" },
    ]);

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(sendWhatsAppInteractiveButtonsMessageMock).not.toHaveBeenCalled();
    expect(result.sends[0].originalOk).toBe(false);
    expect(result.sends[0].category).toBe("validation");
    expect(result.sends[0].usedFallback).toBe(true);
    expect(result.sends[0].effectiveOk).toBe(true);
    expect(sendWhatsAppTextMessageMock).toHaveBeenCalledWith(
      "5511999990000",
      expect.stringContaining("1. Um"),
    );
    // IDs de callback nunca aparecem no texto do fallback.
    expect(sendWhatsAppTextMessageMock.mock.calls[0][1]).not.toContain("\"1\"");
    expect(result.recorded).toBe(true);
  });

  it("botões enviados com sucesso não acionam fallback (botão aceito)", async () => {
    const reply = buttonsReply("Confirme a exclusão:", [
      { id: "confirm", title: "Confirmar" },
      { id: "cancel", title: "Cancelar" },
    ]);

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(sendWhatsAppInteractiveButtonsMessageMock).toHaveBeenCalledWith(
      "5511999990000",
      "Confirme a exclusão:",
      [{ id: "confirm", title: "Confirmar" }, { id: "cancel", title: "Cancelar" }],
    );
    expect(result.sends[0].originalOk).toBe(true);
    expect(result.sends[0].usedFallback).toBe(false);
    expect(result.sends[0].effectiveOk).toBe(true);
    expect(sendWhatsAppTextMessageMock).not.toHaveBeenCalled();
    expect(result.recorded).toBe(true);
  });

  it("botão rejeitado pela Meta e fallback aceito produz sucesso efetivo e grava lifecycle uma única vez", async () => {
    sendWhatsAppInteractiveButtonsMessageMock.mockResolvedValueOnce({ ok: false, detail: "Meta retornou 400 Bad Request no envio dos botões." });
    const reply = buttonsReply("Confirme a exclusão:", [
      { id: "confirm", title: "Confirmar" },
      { id: "cancel", title: "Cancelar" },
    ]);

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(result.sends[0].originalOk).toBe(false);
    expect(result.sends[0].category).toBe("provider");
    expect(result.sends[0].usedFallback).toBe(true);
    expect(result.sends[0].fallbackOk).toBe(true);
    expect(result.sends[0].effectiveOk).toBe(true);
    expect(sendWhatsAppTextMessageMock).toHaveBeenCalledTimes(1);
    expect(recordOutboundReplyMock).toHaveBeenCalledTimes(1);
    expect(result.recorded).toBe(true);
  });

  it("botão e fallback rejeitados não registram entrega funcional nem consomem a pendência", async () => {
    sendWhatsAppInteractiveButtonsMessageMock.mockResolvedValueOnce({ ok: false, detail: "Meta retornou 400 Bad Request no envio dos botões." });
    sendWhatsAppTextMessageMock.mockResolvedValueOnce({ ok: false, detail: "Meta retornou 500 Internal Server Error." });
    const reply = buttonsReply("Confirme a exclusão:", [
      { id: "confirm", title: "Confirmar" },
      { id: "cancel", title: "Cancelar" },
    ]);

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(result.sends[0].effectiveOk).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.recorded).toBe(false);
    expect(recordOutboundReplyMock).not.toHaveBeenCalled();
  });

  it("lista aceita não aciona fallback", async () => {
    const reply = listReply("Escolha uma opção:", "Ver opções", [
      { rows: [{ id: "select:1", title: "Arroz" }, { id: "cancel", title: "Cancelar" }] },
    ]);

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(sendWhatsAppInteractiveListMessageMock).toHaveBeenCalled();
    expect(result.sends[0].usedFallback).toBe(false);
    expect(result.sends[0].effectiveOk).toBe(true);
  });

  it("lista rejeitada pela Meta e fallback aceito preserva título e descrição, sem IDs", async () => {
    sendWhatsAppInteractiveListMessageMock.mockResolvedValueOnce({ ok: false, detail: "Meta retornou 400 Bad Request no envio da lista." });
    const reply = listReply("Escolha uma opção:", "Ver opções", [
      { rows: [
        { id: "select:1", title: "Arroz", description: "Almoço" },
        { id: "select:2", title: "Arroz integral", description: "Jantar" },
        { id: "cancel", title: "Cancelar" },
      ] },
    ]);

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(result.sends[0].usedFallback).toBe(true);
    expect(result.sends[0].effectiveOk).toBe(true);
    const fallbackBody = sendWhatsAppTextMessageMock.mock.calls[0][1];
    expect(fallbackBody).toContain("1. Arroz — Almoço");
    expect(fallbackBody).toContain("2. Arroz integral — Jantar");
    expect(fallbackBody).toContain("3. Cancelar");
    expect(fallbackBody).not.toContain("select:1");
    expect(result.recorded).toBe(true);
  });

  it("lista e fallback rejeitados não registram entrega funcional", async () => {
    sendWhatsAppInteractiveListMessageMock.mockResolvedValueOnce({ ok: false, detail: "Meta retornou 400 Bad Request no envio da lista." });
    sendWhatsAppTextMessageMock.mockResolvedValueOnce({ ok: false, detail: "Meta retornou 500 Internal Server Error." });
    const reply = listReply("Escolha uma opção:", "Ver opções", [
      { rows: [{ id: "select:1", title: "Arroz" }, { id: "cancel", title: "Cancelar" }] },
    ]);

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(result.sends[0].effectiveOk).toBe(false);
    expect(result.recorded).toBe(false);
    expect(recordOutboundReplyMock).not.toHaveBeenCalled();
  });

  it("lista vazia não gera fallback inventado: falha efetiva sem opções", async () => {
    const reply = listReply("Escolha uma opção:", "Ver opções", [{ rows: [] }]);

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(sendWhatsAppInteractiveListMessageMock).not.toHaveBeenCalled();
    expect(result.sends[0].usedFallback).toBe(false);
    expect(result.sends[0].effectiveOk).toBe(false);
    expect(result.recorded).toBe(false);
  });

  it("falha de configuração (credenciais ausentes) é classificada e ainda tenta fallback quando aplicável", async () => {
    sendWhatsAppInteractiveButtonsMessageMock.mockResolvedValueOnce({ ok: false, detail: "Credenciais do WhatsApp não configuradas para envio de botões." });
    const reply = buttonsReply("Confirme a exclusão:", [
      { id: "confirm", title: "Confirmar" },
      { id: "cancel", title: "Cancelar" },
    ]);

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(result.sends[0].category).toBe("config");
    expect(result.sends[0].usedFallback).toBe(true);
  });

  it("sequência texto -> CTA (falha total) -> imagem: falha total do CTA não impede a tentativa da imagem auxiliar", async () => {
    sendWhatsAppInteractiveUrlButtonMessageMock.mockResolvedValueOnce({
      ok: false,
      detail: "Meta retornou 400 Bad Request: no envio da mensagem interativa. Falha ao enviar fallback textual.",
    });
    sendWhatsAppTextMessageMock
      .mockResolvedValueOnce({ ok: true, detail: "resumo enviado" })
      .mockResolvedValueOnce({ ok: false, detail: "fallback falhou" });
    const reply = {
      kind: "functional" as const,
      recordText: "Refeição registrada.",
      messages: [
        { type: "text" as const, body: "Refeição registrada." },
        { type: "cta_url" as const, bodyText: "Precisa ajustar algum alimento?", buttonText: "Editar refeição", url: "https://app.test/quick-edit/abc" },
        { type: "image_url" as const, url: "https://storage.test/annotated.png", caption: "Imagem anotada." },
      ],
    };

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(result.primaryEffectiveOk).toBe(true);
    expect(result.recorded).toBe(true);
    expect(result.sends[1]).toEqual(expect.objectContaining({
      role: "auxiliary",
      originalOk: false,
      fallbackOk: false,
      effectiveOk: false,
      sequenceDecision: "continue",
    }));
    // Imagem auxiliar independente ainda deve ser tentada mesmo com falha total do CTA primário.
    expect(sendWhatsAppImageMessageMock).toHaveBeenCalledWith(
      "5511999990000",
      "https://storage.test/annotated.png",
      "Imagem anotada.",
    );
  });

  it("falha efetiva da mensagem primária encerra a sequência", async () => {
    sendWhatsAppTextMessageMock.mockResolvedValueOnce({ ok: false, detail: "Meta retornou 500" });
    const reply = withAuxiliaryImage(
      textReply("Refeição registrada."),
      { url: "https://storage.test/annotated.png", caption: "Imagem anotada." },
    );

    const result = await sendWhatsAppLogicalReply("5511999990000", reply, lifecycle);

    expect(result.primaryEffectiveOk).toBe(false);
    expect(result.recorded).toBe(false);
    expect(result.sends).toHaveLength(1);
    expect(result.sends[0].sequenceDecision).toBe("stop");
    expect(sendWhatsAppImageMessageMock).not.toHaveBeenCalled();
  });

  it("sanitiza URLs presentes no detalhe retornado pelo provedor", async () => {
    sendWhatsAppInteractiveButtonsMessageMock.mockResolvedValueOnce({
      ok: false,
      detail: "Meta retornou 400 com https://app.test/quick-edit/token-secreto",
    });
    sendWhatsAppTextMessageMock.mockResolvedValueOnce({ ok: false, detail: "fallback falhou" });

    const result = await sendWhatsAppLogicalReply("5511999990000", buttonsReply("Confirma?", [
      { id: "confirm", title: "Confirmar" },
      { id: "cancel", title: "Cancelar" },
    ]));

    expect(result.sends[0].detail).toContain("[url_redacted]");
    expect(result.sends[0].detail).not.toContain("token-secreto");
  });

  it("propaga o identificador de correlação do inbound para a observabilidade", async () => {
    getCurrentWhatsappInboundExternalMessageIdMock.mockReturnValue("wamid.trace-859");

    const result = await sendWhatsAppLogicalReply("5511999990000", textReply("Resposta"));

    expect(result.sends[0].traceId).toBe("wamid.trace-859");
  });

  it("sem handle de lifecycle não tenta gravar (uso fora do fluxo persistente, ex.: simulateWhatsappInbound)", async () => {
    const result = await sendWhatsAppLogicalReply("5511999990000", textReply("Registrei 300 ml de água."));
    expect(result.ok).toBe(true);
    expect(result.recorded).toBe(false);
    expect(recordOutboundReplyMock).not.toHaveBeenCalled();
  });
});
