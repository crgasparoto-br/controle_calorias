import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { describe, it } from "vitest";

function replaceOnce(path: string, oldValue: string, newValue: string) {
  const text = readFileSync(path, "utf-8");
  if (!text.includes(oldValue)) {
    throw new Error(`Expected content not found in ${path}: ${oldValue.slice(0, 100)}`);
  }
  writeFileSync(path, text.replace(oldValue, newValue), "utf-8");
}

function insertBeforeLastDescribeClosure(path: string, content: string) {
  const text = readFileSync(path, "utf-8");
  const marker = "\n});";
  const index = text.lastIndexOf(marker);
  if (index < 0) throw new Error(`Final describe closure not found in ${path}`);
  writeFileSync(path, `${text.slice(0, index)}${content}${text.slice(index)}`, "utf-8");
}

describe("temporary audited patch generator", () => {
  it("generates the final source manifest", () => {
    replaceOnce(
      "server/modules/whatsapp/intentRouter.ts",
      'import { joinUnitWords } from "./quantityUnitVocabulary";\n',
      'import { joinUnitWords } from "./quantityUnitVocabulary";\nimport { WHATSAPP_GENERIC_CLARIFICATION_MESSAGE } from "./replyMessages";\n',
    );
    replaceOnce(
      "server/modules/whatsapp/intentRouter.ts",
      'reply: "Só preciso entender melhor o que você deseja 😊\\n\\nVocê quer registrar um alimento, corrigir uma refeição ou consultar seus registros?\\n\\nCaso queira fazer uma pergunta, envie a mensagem novamente começando com `/`.",',
      "reply: WHATSAPP_GENERIC_CLARIFICATION_MESSAGE,",
    );

    replaceOnce(
      "server/modules/whatsapp/intentInterpreter.ts",
      'import { joinUnitWords } from "./quantityUnitVocabulary";\n',
      'import { joinUnitWords } from "./quantityUnitVocabulary";\nimport { WHATSAPP_GENERIC_CLARIFICATION_MESSAGE } from "./replyMessages";\n',
    );
    replaceOnce(
      "server/modules/whatsapp/intentInterpreter.ts",
      'clarificationQuestion: "Não entendi com segurança. Você quer registrar alimento, corrigir uma refeição ou consultar seus registros?",',
      "clarificationQuestion: WHATSAPP_GENERIC_CLARIFICATION_MESSAGE,",
    );

    replaceOnce(
      "server/modules/whatsapp/llmIntentActions.ts",
      '  buildWhatsAppRecoverableErrorReplyMessage,\n} from "./replyMessages";',
      '  buildWhatsAppRecoverableErrorReplyMessage,\n  WHATSAPP_GENERIC_CLARIFICATION_MESSAGE,\n} from "./replyMessages";',
    );
    replaceOnce(
      "server/modules/whatsapp/llmIntentActions.ts",
      `function buildClarification(intent: WhatsappInterpretedIntent): WhatsappLlmIntentResult {\n  return {\n    handled: true,\n    action: "clarification_needed",\n    reply: buildWhatsAppClarificationReplyMessage(intent.clarificationQuestion\n      ?? "Não consegui entender com segurança. Diga se deseja registrar um alimento, corrigir uma refeição ou consultar seus registros."),`,
      `function buildClarification(intent: WhatsappInterpretedIntent): WhatsappLlmIntentResult {\n  const clarificationQuestion = intent.intent === "unknown"\n    ? WHATSAPP_GENERIC_CLARIFICATION_MESSAGE\n    : intent.clarificationQuestion ?? WHATSAPP_GENERIC_CLARIFICATION_MESSAGE;\n\n  return {\n    handled: true,\n    action: "clarification_needed",\n    reply: buildWhatsAppClarificationReplyMessage(clarificationQuestion),`,
    );

    const normalizerBlock = `function normalizeClarificationText(value: string) {\n  return value\n    .normalize("NFD")\n    .replace(/[\\u0300-\\u036f]/g, "")\n    .toLowerCase()\n    .replace(/\\s+/g, " ")\n    .trim();\n}\n\nexport function normalizeWhatsAppClarificationMessage(message: string) {\n  const normalized = normalizeClarificationText(message);\n  const isGenericFallback = (\n    normalized.startsWith("nao entendi com seguranca")\n    || normalized.startsWith("nao consegui entender com seguranca")\n  )\n    && normalized.includes("registrar")\n    && normalized.includes("corrigir")\n    && normalized.includes("consultar");\n\n  return isGenericFallback ? WHATSAPP_GENERIC_CLARIFICATION_MESSAGE : message;\n}\n\n`;
    replaceOnce("server/modules/whatsapp/replyMessages.ts", normalizerBlock, "");
    replaceOnce(
      "server/modules/whatsapp/replyMessages.ts",
      "    lines: [normalizeWhatsAppClarificationMessage(message)],",
      "    lines: [message],",
    );

    writeFileSync(
      "server/modules/whatsapp/genericClarificationMessage.test.ts",
      `import { describe, expect, it } from "vitest";\n\nimport {\n  classifyWhatsappMessageDeterministically,\n  interpretWhatsappMessageWithDiagnostics,\n} from "./intentInterpreter";\nimport { evaluateWhatsappIntentRoute } from "./intentRouter";\nimport {\n  buildWhatsAppClarificationReplyMessage,\n  WHATSAPP_GENERIC_CLARIFICATION_MESSAGE,\n} from "./replyMessages";\n\ndescribe("generic WhatsApp clarification message", () => {\n  it("usa a mensagem canonica no roteador", () => {\n    const route = evaluateWhatsappIntentRoute({ text: "beleza" });\n    expect(route.reply).toBe(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE);\n  });\n\n  it("usa a mensagem canonica no classificador deterministico", () => {\n    const intent = classifyWhatsappMessageDeterministically("@@@");\n    expect(intent.intent).toBe("unknown");\n    expect(intent.clarificationQuestion).toBe(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE);\n  });\n\n  it("mantem a mensagem canonica quando a LLM esta desativada", async () => {\n    const interpretation = await interpretWhatsappMessageWithDiagnostics(\n      "@@@",\n      { version: "whatsapp-intent-context/v1" } as never,\n      { useLlm: false },\n    );\n    expect(interpretation.source).toBe("deterministic");\n    expect(interpretation.fallbackReason).toBe("disabled");\n    expect(interpretation.intent.clarificationQuestion).toBe(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE);\n  });\n\n  it("preserva perguntas de esclarecimento especificas", () => {\n    const message = "Me diga em qual refeição devo fazer o ajuste.";\n    expect(buildWhatsAppClarificationReplyMessage(message)).toContain(message);\n    expect(buildWhatsAppClarificationReplyMessage(message)).not.toContain(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE);\n  });\n});\n`,
      "utf-8",
    );

    replaceOnce(
      "server/modules/whatsapp/service.test.ts",
      'const { simulateWhatsappInbound } = await import("./service");\n',
      'const { simulateWhatsappInbound } = await import("./service");\nconst { WHATSAPP_GENERIC_CLARIFICATION_MESSAGE } = await import("./replyMessages");\n',
    );
    insertBeforeLastDescribeClosure(
      "server/modules/whatsapp/service.test.ts",
      `\n\n  it("entrega a mensagem canonica pelo fluxo completo de entrada do WhatsApp", async () => {\n    const result = await simulateWhatsappInbound(4299, {\n      text: "beleza",\n      messageId: "friendly-clarification-router",\n    });\n\n    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();\n    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();\n    expect(processMealDraftMock).not.toHaveBeenCalled();\n    expect(result).toEqual(expect.objectContaining({\n      handled: true,\n      action: "router_safe_response",\n      reply: WHATSAPP_GENERIC_CLARIFICATION_MESSAGE,\n    }));\n  });\n`,
    );

    replaceOnce(
      "server/modules/whatsapp/llmIntentActions.test.ts",
      'import { executeWhatsappLlmIntent } from "./llmIntentActions";\n',
      'import { executeWhatsappLlmIntent } from "./llmIntentActions";\nimport { WHATSAPP_GENERIC_CLARIFICATION_MESSAGE } from "./replyMessages";\n',
    );
    insertBeforeLastDescribeClosure(
      "server/modules/whatsapp/llmIntentActions.test.ts",
      `\n\n  it("usa a mensagem canonica quando a LLM retorna texto generico de baixa confianca", async () => {\n    interpretWhatsappMessageWithDiagnosticsMock.mockResolvedValue({\n      source: "llm",\n      validationStatus: "valid",\n      operationalTrace: llmTrace,\n      intent: interpretedIntent({\n        intent: "unknown",\n        confidence: 0.3,\n        clarificationQuestion: "Não consegui entender com segurança. Diga se deseja registrar um alimento, corrigir uma refeição ou consultar seus registros.",\n      }),\n    });\n\n    const result = await executeWhatsappLlmIntent(42, {\n      text: "mensagem ambigua",\n      receivedAt: new Date("2026-06-12T12:00:00.000Z"),\n      messageId: "friendly-clarification-llm",\n    });\n\n    expect(result).toEqual(expect.objectContaining({\n      action: "clarification_needed",\n      reply: expect.stringContaining(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE),\n    }));\n    expect(result && "reply" in result ? result.reply : "").not.toContain("Não consegui entender com segurança");\n  });\n`,
    );

    replaceOnce(
      "docs/design-docs/whatsapp-intent-router.md",
      "A mensagem genérica de baixa confiança possui uma única versão amigável, definida em `replyMessages.ts`. O roteador usa essa versão diretamente, enquanto o builder canônico normaliza variantes legadas produzidas pelo classificador determinístico ou pelo fallback da LLM antes do envio.\n\nA normalização só ocorre quando o texto representa a pergunta genérica sobre registrar, corrigir ou consultar. Perguntas específicas, como solicitação de quantidade, refeição ou item, permanecem inalteradas.",
      "A mensagem genérica de baixa confiança possui uma única versão amigável, definida em `replyMessages.ts`. O roteador, o classificador determinístico e o fallback do executor LLM importam diretamente essa mesma constante; o builder canônico apenas aplica a formatação final da resposta.\n\nPerguntas específicas, como solicitação de quantidade, refeição ou item, continuam sendo fornecidas ao builder sem substituição textual.",
    );
    replaceOnce(
      "docs/design-docs/whatsapp-intent-router.md",
      "`server/modules/whatsapp/genericClarificationMessage.test.ts` cobre o alinhamento entre o roteador, o classificador determinístico, o fallback da LLM e o builder canônico de respostas.",
      "`server/modules/whatsapp/genericClarificationMessage.test.ts` cobre a fonte canônica e o fallback determinístico sem LLM. `server/modules/whatsapp/service.test.ts` valida a resposta pelo fluxo completo de entrada, e `server/modules/whatsapp/llmIntentActions.test.ts` cobre baixa confiança da LLM com texto genérico.",
    );

    const paths = [
      "server/modules/whatsapp/intentRouter.ts",
      "server/modules/whatsapp/intentInterpreter.ts",
      "server/modules/whatsapp/llmIntentActions.ts",
      "server/modules/whatsapp/replyMessages.ts",
      "server/modules/whatsapp/genericClarificationMessage.test.ts",
      "server/modules/whatsapp/service.test.ts",
      "server/modules/whatsapp/llmIntentActions.test.ts",
      "docs/design-docs/whatsapp-intent-router.md",
    ];
    const files = paths.map((path) => {
      const content = readFileSync(path);
      return {
        path,
        sha256: createHash("sha256").update(content).digest("hex"),
        contentBase64: content.toString("base64"),
      };
    });
    const manifestPath = "/tmp/whatsapp-clarification-patch.json";
    writeFileSync(manifestPath, JSON.stringify({ version: 1, files }), "utf-8");
    if (existsSync("/tmp/vitest.log")) unlinkSync("/tmp/vitest.log");
    renameSync(manifestPath, "/tmp/vitest.log");

    throw new Error("Intentional temporary failure: patched source manifest generated.");
  });
});
