/**
 * Política de sessão do contexto conversacional persistente do WhatsApp (issue #763).
 *
 * Uma conversa é considerada ativa/reaproveitável somente enquanto seu status
 * for "active" e sua última atividade estiver dentro da janela de TTL abaixo.
 * A expiração nunca apaga mensagens já persistidas — apenas encerra a conversa
 * lógica atual, permitindo que uma nova seja aberta.
 */

export const WHATSAPP_CONVERSATION_POLICY_VERSION = "whatsapp-conversation-policy-v1";

/** Mantém paridade com o TTL histórico de conversationHistory.ts para continuidade de comportamento. */
export const WHATSAPP_CONVERSATION_ACTIVE_TTL_MS = 30 * 60 * 1000;

export function isConversationActive(
  conversation: { status: string; lastActivityAt: Date | string },
  now: Date = new Date(),
): boolean {
  if (conversation.status !== "active") return false;
  const lastActivityMs = new Date(conversation.lastActivityAt).getTime();
  return now.getTime() - lastActivityMs < WHATSAPP_CONVERSATION_ACTIVE_TTL_MS;
}
