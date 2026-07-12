/**
 * Ponto único de roteamento por precedência do WhatsApp (issue #766).
 *
 * Centraliza os passos 2 e 3 da ordem obrigatória do épico #762 (a segurança/
 * idempotência, passo 1, já é resolvida antes deste ponto por cada webhook via
 * inspectWhatsAppUserContentSafety/dedup guards existentes):
 *
 *   2. comando explícito `/` tem precedência definida;
 *   3. pendência operacional ativa e ainda válida;
 *   (4-7: classificação da intenção atual, contexto conversacional, banco como
 *    fonte de verdade e clarificação continuam na cadeia existente de cada
 *    webhook, que é chamada quando este gate devolve `continue_pipeline`.)
 *
 * Antes desta issue, o comando `/` e a confirmação genérica de ação
 * (pendingWhatsAppConfirmations) só eram checados em whatsappWebhook.ts, o
 * último fallback da cadeia — ou seja, rodavam por último, não primeiro. Este
 * módulo resolve isso: é chamado no topo de cada entrypoint antes de qualquer
 * outra classificação.
 */
import { getDb, logPersistenceWarning } from "../../db";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";
import { executeWhatsappAiQuestionIntent, isWhatsappAiQuestionText } from "./aiQuestionAssistant";
import { handlePendingWhatsAppConfirmation, completeWhatsappGenericConfirmationCallback, PENDING_CONFIRMATION_TYPE } from "./webhookTextCommands";
import { claimWhatsAppInteractiveCallback } from "./interactiveCallback";
import { completeWhatsappDeleteInteractiveCallback, PENDING_DELETE_TYPE } from "./deleteIntent";
import { buildWhatsAppCallbackUnavailableReplyMessage } from "./replyMessages";
import type { WhatsAppWebhookMessage } from "./webhookUtils";

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

const PENDING_PROFESSIONAL_ACCESS_TYPE = "professional_access";

export type WhatsAppInteractiveCallbackResult = {
  handled: true;
  reply: string;
  eventType: string;
  detail: string;
  interactiveReply?: import("./replyContract").WhatsAppLogicalReply;
};

export type WhatsAppPrecedenceGateResult =
  | { step: "ai_question"; result: NonNullable<Awaited<ReturnType<typeof executeWhatsappAiQuestionIntent>>> }
  | { step: "interactive_callback"; result: WhatsAppInteractiveCallbackResult }
  | { step: "generic_confirmation"; result: NonNullable<Awaited<ReturnType<typeof handlePendingWhatsAppConfirmation>>> }
  | { step: "continue_pipeline" };

function buildUnavailableInteractiveCallbackResult(): WhatsAppInteractiveCallbackResult {
  return {
    handled: true,
    reply: buildWhatsAppCallbackUnavailableReplyMessage(),
    eventType: "whatsapp.interactive_callback.unavailable",
    detail: "Callback de botão/lista inválido, expirado, já consumido ou cancelado.",
  };
}

/**
 * Ponto único de resolução de botões/listas (issue #782): reivindica a
 * pendência referenciada pelo ID opaco do callback e despacha para o
 * resolvedor do domínio correspondente ao `type` persistido em
 * `whatsappPendingOperations`. Nenhum domínio consome a pendência de novo.
 */
async function resolveWhatsAppInteractiveCallback(
  userId: number,
  interactiveReplyId: string,
  receivedAt?: Date,
): Promise<WhatsAppInteractiveCallbackResult> {
  const claim = await claimWhatsAppInteractiveCallback(userId, interactiveReplyId, receivedAt);
  if (claim.status !== "claimed") {
    return buildUnavailableInteractiveCallbackResult();
  }

  switch (claim.pendingOperation.type) {
    case PENDING_DELETE_TYPE:
      return completeWhatsappDeleteInteractiveCallback(userId, claim.pendingOperation, claim.action);
    case PENDING_CONFIRMATION_TYPE:
      return completeWhatsappGenericConfirmationCallback(userId, claim.pendingOperation, claim.action);
    case PENDING_PROFESSIONAL_ACCESS_TYPE: {
      const { completeWhatsAppProfessionalAccessCallback } = await import("../professionals/service");
      return completeWhatsAppProfessionalAccessCallback(userId, claim.pendingOperation, claim.action);
    }
    default:
      // Tipo de pendência sem callback central migrado ainda (ex.: clarificação de período): trata como indisponível.
      return buildUnavailableInteractiveCallbackResult();
  }
}

/**
 * Resolve os passos 2 e 3 da ordem de precedência. Deve ser chamado antes de
 * qualquer classificação de intenção (delete/gramas/substituição/LLM/etc).
 *
 * Importante (clarificação #6 da issue): se existir uma pendência destrutiva
 * ativa (ex.: exclusão) e a mensagem for um comando `/`, a pendência NÃO é
 * tocada aqui — o `/` sempre responde primeiro, mas o passo 3 (pendência) só é
 * resolvido nas mensagens que não são `/`, então uma pendência de exclusão
 * nunca é consumida como efeito colateral de uma pergunta com `/`.
 */
export async function resolveWhatsAppPrecedenceGate(input: {
  userId: number;
  text?: string | null;
  receivedAt?: Date;
  userTimezone?: string | null;
  /** ID opaco de `button_reply`/`list_reply` (issue #782). Resolvido antes de qualquer outra precedência: um clique nunca é reinterpretado como texto livre nem cai no fallback nutricional. */
  interactiveReplyId?: string | null;
}): Promise<WhatsAppPrecedenceGateResult> {
  if (input.interactiveReplyId) {
    const result = await resolveWhatsAppInteractiveCallback(input.userId, input.interactiveReplyId, input.receivedAt);
    return { step: "interactive_callback", result };
  }

  if (isWhatsappAiQuestionText(input.text)) {
    const result = await executeWhatsappAiQuestionIntent(input.userId, {
      text: input.text,
      receivedAt: input.receivedAt,
      userTimezone: input.userTimezone,
    });
    if (result) {
      return { step: "ai_question", result };
    }
  }

  const pending = await pendingOperationRepository.getActivePendingOperation(input.userId, input.receivedAt);
  if (pending && pending.type === "confirmation") {
    const message: WhatsAppWebhookMessage = { text: { body: input.text ?? "" } };
    const result = await handlePendingWhatsAppConfirmation(message, input.userId);
    if (result) {
      return { step: "generic_confirmation", result };
    }
  }

  return { step: "continue_pipeline" };
}
