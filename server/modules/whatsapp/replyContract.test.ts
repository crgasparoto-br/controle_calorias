import { describe, expect, it } from "vitest";
import {
  acknowledgementReply,
  buttonsReply,
  listReply,
  logicalReplyFromLegacyText,
  resolveWhatsAppLogicalReplyRecordText,
  sequencedTextReply,
  textReply,
  validateWhatsAppOutboundMessage,
  withAuxiliaryImage,
  withCtaUrl,
} from "./replyContract";

describe("replyContract", () => {
  it("textReply produz uma resposta funcional com uma única mensagem primária de texto", () => {
    const reply = textReply("Registrei 300 ml de água.");
    expect(reply.kind).toBe("functional");
    expect(reply.messages).toEqual([{ type: "text", body: "Registrei 300 ml de água.", role: "primary" }]);
  });

  it("acknowledgementReply nunca é classificada como funcional", () => {
    const reply = acknowledgementReply("Recebi sua imagem e estou processando.");
    expect(reply.kind).toBe("acknowledgement");
    expect(reply.messages[0].role).toBe("primary");
  });

  it("logicalReplyFromLegacyText adapta um builder string existente sem remover o formato legado", () => {
    const legacyText = "*Refeição registrada.*\n\nItens:\n• Arroz — 100g";
    const reply = logicalReplyFromLegacyText(legacyText);
    expect(reply).toEqual({ kind: "functional", messages: [{ type: "text", body: legacyText, role: "primary" }] });
  });

  it("withCtaUrl substitui a mensagem primária por um CTA preservando o texto para gravação", () => {
    const base = textReply("Refeição registrada. Edite se precisar.");
    const withLink = withCtaUrl(base, { buttonText: "Editar refeição", url: "https://app.test/quick-edit/abc" });

    expect(withLink.messages).toEqual([
      { type: "cta_url", bodyText: "Refeição registrada. Edite se precisar.", buttonText: "Editar refeição", url: "https://app.test/quick-edit/abc", role: "primary" },
    ]);
    expect(resolveWhatsAppLogicalReplyRecordText(withLink)).toBe("Refeição registrada. Edite se precisar.");
  });

  it("withAuxiliaryImage anexa mídia por URL marcada como auxiliar", () => {
    const base = textReply("Refeição registrada.");
    const withImage = withAuxiliaryImage(base, { url: "https://storage.test/annotated.png", caption: "Imagem anotada." });

    expect(withImage.kind).toBe("functional");
    expect(withImage.messages).toEqual([
      { type: "text", body: "Refeição registrada.", role: "primary" },
      { type: "image_url", url: "https://storage.test/annotated.png", caption: "Imagem anotada.", role: "auxiliary" },
    ]);
  });

  it("withAuxiliaryImage representa mídia por media id sem expor payload da Meta ao handler", () => {
    const reply = withAuxiliaryImage(textReply("Refeição registrada."), {
      mediaId: "media-opaque-123",
      caption: "Imagem anotada.",
    });
    expect(reply.messages[1]).toEqual({
      type: "image_id",
      mediaId: "media-opaque-123",
      caption: "Imagem anotada.",
      role: "auxiliary",
    });
  });

  it("sequencedTextReply representa sequência ordenada e classifica mensagens posteriores como auxiliares", () => {
    const reply = sequencedTextReply(["Boas-vindas ao Controle de Calorias.", "Finalize seu cadastro pelo link."]);
    expect(reply.messages.map(message => message.type)).toEqual(["text", "text"]);
    expect(reply.messages.map(message => message.role)).toEqual(["primary", "auxiliary"]);
    expect(reply.messages.map(message => "body" in message ? message.body : null)).toEqual([
      "Boas-vindas ao Controle de Calorias.",
      "Finalize seu cadastro pelo link.",
    ]);
  });

  it("buttonsReply e listReply representam botões e listas sem payload bruto da Meta", () => {
    const buttons = buttonsReply("Confirma a exclusão do almoço?", [
      { id: "confirm", title: "Confirmar" },
      { id: "cancel", title: "Cancelar" },
    ]);
    expect(buttons.messages[0]).toEqual({
      type: "buttons",
      bodyText: "Confirma a exclusão do almoço?",
      buttons: [{ id: "confirm", title: "Confirmar" }, { id: "cancel", title: "Cancelar" }],
      role: "primary",
    });

    const list = listReply("Qual período?", "Ver opções", [{ rows: [{ id: "today", title: "Hoje" }] }]);
    expect(list.messages[0]).toEqual({
      type: "list",
      bodyText: "Qual período?",
      buttonText: "Ver opções",
      sections: [{ rows: [{ id: "today", title: "Hoje" }] }],
      role: "primary",
    });
  });

  it("valida restrições do provedor para botões: quantidade máxima e tamanho de título", () => {
    const tooManyButtons = validateWhatsAppOutboundMessage({
      type: "buttons",
      bodyText: "x",
      buttons: [
        { id: "1", title: "A" },
        { id: "2", title: "B" },
        { id: "3", title: "C" },
        { id: "4", title: "D" },
      ],
    });
    expect(tooManyButtons).toEqual(expect.arrayContaining([expect.objectContaining({ field: "buttons" })]));

    const longTitle = validateWhatsAppOutboundMessage({
      type: "buttons",
      bodyText: "x",
      buttons: [{ id: "1", title: "Título de botão muito comprido demais" }],
    });
    expect(longTitle).toEqual(expect.arrayContaining([expect.objectContaining({ field: "buttons" })]));

    const valid = validateWhatsAppOutboundMessage({
      type: "buttons",
      bodyText: "x",
      buttons: [{ id: "confirm", title: "Confirmar" }],
    });
    expect(valid).toEqual([]);
  });

  it("valida lista sem opções e image id vazio", () => {
    expect(validateWhatsAppOutboundMessage({
      type: "list",
      bodyText: "x",
      buttonText: "Ver",
      sections: [{ rows: [] }],
    })).toEqual(expect.arrayContaining([expect.objectContaining({ field: "sections" })]));

    expect(validateWhatsAppOutboundMessage({
      type: "image_id",
      mediaId: " ",
      caption: "Imagem",
    })).toEqual(expect.arrayContaining([expect.objectContaining({ field: "mediaId" })]));
  });
});
