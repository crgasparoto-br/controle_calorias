import { describe, expect, it } from "vitest";

import {
  classifyWhatsappMessageDeterministically,
  interpretWhatsappMessageWithDiagnostics,
} from "./intentInterpreter";
import { evaluateWhatsappIntentRoute } from "./intentRouter";
import {
  buildWhatsAppClarificationReplyMessage,
  WHATSAPP_GENERIC_CLARIFICATION_MESSAGE,
} from "./replyMessages";

describe("generic WhatsApp clarification message", () => {
  it("usa a mensagem canonica no roteador", () => {
    const route = evaluateWhatsappIntentRoute({ text: "beleza" });
    expect(route.reply).toBe(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE);
  });

  it("usa a mensagem canonica no classificador deterministico", () => {
    const intent = classifyWhatsappMessageDeterministically("@@@");
    expect(intent.intent).toBe("unknown");
    expect(intent.clarificationQuestion).toBe(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE);
  });

  it("mantem a mensagem canonica quando a LLM esta desativada", async () => {
    const interpretation = await interpretWhatsappMessageWithDiagnostics(
      "@@@",
      { version: "whatsapp-intent-context/v1" } as never,
      { useLlm: false },
    );
    expect(interpretation.source).toBe("deterministic");
    expect(interpretation.fallbackReason).toBe("disabled");
    expect(interpretation.intent.clarificationQuestion).toBe(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE);
  });

  it("preserva perguntas de esclarecimento especificas", () => {
    const message = "Me diga em qual refeição devo fazer o ajuste.";
    expect(buildWhatsAppClarificationReplyMessage(message)).toContain(message);
    expect(buildWhatsAppClarificationReplyMessage(message)).not.toContain(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE);
  });
});
