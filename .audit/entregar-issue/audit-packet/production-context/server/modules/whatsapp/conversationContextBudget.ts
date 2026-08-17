/**
 * Orçamento de contexto por consumidor e corte determinístico da janela recente (issue #765).
 *
 * Substitui o limite fixo de 3 turnos de conversationHistory.ts por um orçamento
 * configurável (quantidade de turnos + tamanho total), aplicado de forma
 * determinística: nunca corta uma mensagem no meio, sempre preserva as mais
 * recentes primeiro.
 */

import type { WhatsAppConversationMessageRecord } from "../../repositories/whatsappConversationRepository";

export const CONTEXT_BUDGETS = {
  intent_classifier: { maxTurns: 12, maxChars: 4000 },
  slash_assistant: { maxTurns: 8, maxChars: 3000 },
  correction: { maxTurns: 6, maxChars: 2000 },
  query: { maxTurns: 8, maxChars: 3000 },
} as const;

export type ConversationContextConsumer = keyof typeof CONTEXT_BUDGETS;
export type ConversationContextBudget = (typeof CONTEXT_BUDGETS)[ConversationContextConsumer];

export function getEffectiveMessageText(message: WhatsAppConversationMessageRecord): string {
  return (
    message.sanitizedText
    ?? message.text
    ?? message.sanitizedTranscript
    ?? message.transcript
    ?? message.captionText
    ?? ""
  );
}

function messageLength(message: WhatsAppConversationMessageRecord): number {
  return getEffectiveMessageText(message).length;
}

export type SelectRecentWindowResult = {
  /** Mensagens dentro do orçamento, em ordem ascendente (mais antiga primeiro). */
  window: WhatsAppConversationMessageRecord[];
  /** Mensagens mais antigas que ficaram fora do orçamento — candidatas a resumo. */
  overflow: WhatsAppConversationMessageRecord[];
  truncated: boolean;
};

/**
 * `messages` deve estar em ordem ascendente (mais antiga primeiro), como retornado
 * por findRecentMessagesByUser/findRecentMessages do repositório de #763.
 */
export function selectRecentWindow(
  messages: WhatsAppConversationMessageRecord[],
  budget: ConversationContextBudget,
): SelectRecentWindowResult {
  const windowReversed: WhatsAppConversationMessageRecord[] = [];
  let totalChars = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    if (windowReversed.length >= budget.maxTurns) break;

    const message = messages[i];
    const length = messageLength(message);
    if (windowReversed.length > 0 && totalChars + length > budget.maxChars) break;

    windowReversed.push(message);
    totalChars += length;
  }

  const window = windowReversed.reverse();
  const overflow = messages.slice(0, messages.length - window.length);

  return {
    window,
    overflow,
    truncated: overflow.length > 0,
  };
}
