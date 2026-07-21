import { describe, expect, it } from "vitest";
import {
  acknowledgementReply,
  buildWhatsAppOutboundFallbackText,
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
  it("textReply produz uma resposta funcional com uma única mensagem de texto", () => {
    const reply = textReply("Registrei 300 ml de água.");
    expect(reply.kind).toBe("functional");
    expect(reply.messages).toEqual([{ type: "text", body: "Registrei 300 ml de água." }]);
  });

  it("acknowledgementReply nunca é classificada como funcional", () => {
    const reply = acknowledgementReply("Recebi sua imagem e estou processando.");
    expect(reply.kind).toBe("acknowledgement");
  });

  it("logicalReplyFromLegacyText adapta um builder string existente sem remover o formato legado", () => {
    const legacyText = "*Refeição registrada.*\n\nItens:\n• Arroz — 100g";
    const reply = logicalReplyFromLegacyText(legacyText);
    expect(reply).toEqual({ kind: "functional", messages: [{ type: "text", body: legacyText }] });
  });

  it("withCtaUrl substitui a mensagem primária por um CTA preservando o texto para gravação", () => {
    const base = textReply("Refeição registrada. Edite se precisar.");
    const withLink = withCtaUrl(base, { buttonText: "Editar refeição", url: "https://app.test/quick-edit/abc" });

    expect(withLink.messages).toEqual([
      { type: "cta_url", bodyText: "Refeição registrada. Edite se precisar.", buttonText: "Editar refeição", url: "https://app.test/quick-edit/abc" },
    ]);
    expect(resolveWhatsAppLogicalReplyRecordText(withLink)).toBe("Refeição registrada. Edite se precisar.");
  });

  it("withAuxiliaryImage anexa mídia auxiliar sem criar uma segunda resposta lógica", () => {
    const base = textReply("Refeição registrada.");
    const withImage = withAuxiliaryImage(base, { url: "https://storage.test/annotated.png", caption: "Imagem anotada." });

    expect(withImage.kind).toBe("functional");
    expect(withImage.messages).toEqual([
      { type: "text", body: "Refeição registrada." },
      { type: "image_url", url: "https://storage.test/annotated.png", caption: "Imagem anotada." },
    ]);
  });

  it("sequencedTextReply representa uma sequência ordenada, como onboarding em duas mensagens", () => {
    const reply = sequencedTextReply(["Boas-vindas ao Controle de Calorias.", "Finalize seu cadastro pelo link."]);
    expect(reply.messages.map(message => message.type)).toEqual(["text", "text"]);
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
    });

    const list = listReply("Qual período?", "Ver opções", [{ rows: [{ id: "today", title: "Hoje" }] }]);
    expect(list.messages[0]).toEqual({
      type: "list",
      bodyText: "Qual período?",
      buttonText: "Ver opções",
      sections: [{ rows: [{ id: "today", title: "Hoje" }] }],
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

  it("valida que uma lista sem nenhuma opção é rejeitada", () => {
    const errors = validateWhatsAppOutboundMessage({
      type: "list",
      bodyText: "x",
      buttonText: "Ver",
      sections: [{ rows: [] }],
    });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: "sections" })]));
  });

  it("valida corpo vazio, IDs duplicados/ausentes e limites de lista (issue #859)", () => {
    expect(validateWhatsAppOutboundMessage({ type: "buttons", bodyText: "", buttons: [{ id: "a", title: "A" }] }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: "bodyText" })]));

    expect(validateWhatsAppOutboundMessage({
      type: "buttons",
      bodyText: "x",
      buttons: [{ id: "dup", title: "Um" }, { id: "dup", title: "Dois" }],
    })).toEqual(expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining("duplicado") })]));

    expect(validateWhatsAppOutboundMessage({
      type: "list",
      bodyText: "x",
      buttonText: "Ver",
      sections: Array.from({ length: 11 }, () => ({ rows: [{ id: crypto.randomUUID(), title: "Item" }] })),
    })).toEqual(expect.arrayContaining([expect.objectContaining({ field: "sections" })]));

    expect(validateWhatsAppOutboundMessage({
      type: "cta_url",
      bodyText: "x",
      buttonText: "Editar",
      url: "not-a-url",
    })).toEqual(expect.arrayContaining([expect.objectContaining({ field: "url" })]));
  });

  it("deriva fallback textual determinístico de botões sem expor IDs de callback", () => {
    const fallback = buildWhatsAppOutboundFallbackText({
      type: "buttons",
      bodyText: "Confirme a exclusão:",
      buttons: [{ id: "delete:1:confirm", title: "Confirmar" }, { id: "delete:1:cancel", title: "Cancelar" }],
    });
    expect(fallback).toBe([
      "Confirme a exclusão:",
      "",
      "1. Confirmar",
      "2. Cancelar",
      "",
      "Responda com o número ou o texto da opção.",
    ].join("\n"));
    expect(fallback).not.toContain("delete:1");
  });

  it("deriva fallback textual numerado de lista preservando título e descrição, sem IDs", () => {
    const fallback = buildWhatsAppOutboundFallbackText({
      type: "list",
      bodyText: "Escolha uma opção:",
      buttonText: "Ver opções",
      sections: [{ rows: [
        { id: "select:1", title: "Arroz", description: "Almoço" },
        { id: "select:2", title: "Arroz integral", description: "Jantar" },
        { id: "cancel", title: "Cancelar" },
      ] }],
    });
    expect(fallback).toBe([
      "Escolha uma opção:",
      "",
      "1. Arroz — Almoço",
      "2. Arroz integral — Jantar",
      "3. Cancelar",
      "",
      "Responda com o número da opção.",
    ].join("\n"));
    expect(fallback).not.toContain("select:1");
  });

  it("não gera fallback inventado quando não há opções suficientes (lista/botões vazios)", () => {
    expect(buildWhatsAppOutboundFallbackText({ type: "buttons", bodyText: "x", buttons: [] })).toBeNull();
    expect(buildWhatsAppOutboundFallbackText({ type: "list", bodyText: "x", buttonText: "Ver", sections: [{ rows: [] }] })).toBeNull();
  });

  it("deriva fallback de CTA no mesmo formato já usado pelo adapter existente", () => {
    const fallback = buildWhatsAppOutboundFallbackText({
      type: "cta_url",
      bodyText: "Refeição registrada.",
      buttonText: "Editar refeição",
      url: "https://app.test/quick-edit/abc",
    });
    expect(fallback).toBe("Refeição registrada.\n\nEditar refeição: https://app.test/quick-edit/abc");
  });
});
