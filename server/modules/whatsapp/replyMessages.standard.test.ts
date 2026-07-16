import { describe, expect, it } from "vitest";

import {
  buildWhatsAppActionCancelledReplyMessage,
  buildWhatsAppActionConfirmationRequestReplyMessage,
  buildWhatsAppActionConfirmedReplyMessage,
  buildWhatsAppAmbiguousItemReplyMessage,
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppItemNotFoundReplyMessage,
  buildWhatsAppPartialAudioTranscriptionReplyMessage,
  buildWhatsAppRecoverableErrorReplyMessage,
  buildWhatsAppSecurityBlockedReplyMessage,
} from "./replyMessages";

describe("standard WhatsApp reply builders", () => {
  it("padroniza respostas de esclarecimento, item não encontrado e ambiguidade", () => {
    expect(buildWhatsAppClarificationReplyMessage("Me diga a refeição.")).toContain("*Preciso de uma informação*");
    expect(buildWhatsAppItemNotFoundReplyMessage({
      target: "arroz",
      context: "nas refeições de hoje",
      instruction: "Me diga qual item devo ajustar.",
    })).toContain("*Item não encontrado*");
    expect(buildWhatsAppAmbiguousItemReplyMessage({
      target: "arroz",
      context: "na última refeição",
      options: "1. Arroz branco\n2. Arroz integral",
      instruction: "Responda com o número do item.",
    })).toContain("*Preciso confirmar o item*");
  });

  it("padroniza confirmação, execução e cancelamento de ações", () => {
    expect(buildWhatsAppActionConfirmationRequestReplyMessage({
      summary: "Encontrei 2 registros recentes.",
    })).toContain("*Confirmação necessária*");
    expect(buildWhatsAppActionConfirmedReplyMessage("Registros alterados.")).toContain("*Alteração confirmada*");
    expect(buildWhatsAppActionCancelledReplyMessage("Nada foi alterado.")).toContain("*Alteração cancelada*");
  });

  it("padroniza erros recuperáveis, segurança e áudio parcial", () => {
    expect(buildWhatsAppRecoverableErrorReplyMessage("Tente novamente.")).toContain("*Não consegui concluir agora*");
    expect(buildWhatsAppSecurityBlockedReplyMessage()).toContain("*Não posso seguir essa instrução*");
    expect(buildWhatsAppPartialAudioTranscriptionReplyMessage()).toContain("*Áudio não transcrito*");
  });
});
