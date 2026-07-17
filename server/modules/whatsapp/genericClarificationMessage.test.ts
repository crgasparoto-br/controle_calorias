import { describe, expect, it } from "vitest";

import { classifyWhatsappMessageDeterministically } from "./intentInterpreter";
import { evaluateWhatsappIntentRoute } from "./intentRouter";
import {
  buildWhatsAppClarificationReplyMessage,
  normalizeWhatsAppClarificationMessage,
  WHATSAPP_GENERIC_CLARIFICATION_MESSAGE,
} from "./replyMessages";

describe("generic WhatsApp clarification message", () => {
  it("mantem o roteador alinhado com a mensagem canonica", () => {
    const route = evaluateWhatsappIntentRoute({ text: "beleza" });

    expect(route.reply).toBe(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE);
  });

  it("normaliza a mensagem antiga produzida pelo classificador deterministico", () => {
    const intent = classifyWhatsappMessageDeterministically("@@@");

    expect(intent.intent).toBe("unknown");
    expect(intent.clarificationQuestion).toContain("Não entendi com segurança");
    expect(normalizeWhatsAppClarificationMessage(intent.clarificationQuestion!))
      .toBe(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE);
    expect(buildWhatsAppClarificationReplyMessage(intent.clarificationQuestion!))
      .toContain(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE);
  });

  it("normaliza o fallback generico usado pelo executor LLM", () => {
    const reply = buildWhatsAppClarificationReplyMessage(
      "Não consegui entender com segurança. Diga se deseja registrar um alimento, corrigir uma refeição ou consultar seus registros.",
    );

    expect(reply).toContain(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE);
    expect(reply).not.toContain("Não consegui entender com segurança");
  });

  it("preserva perguntas de esclarecimento especificas", () => {
    const message = "Me diga em qual refeição devo fazer o ajuste.";

    expect(normalizeWhatsAppClarificationMessage(message)).toBe(message);
    expect(buildWhatsAppClarificationReplyMessage(message)).toContain(message);
  });
});
