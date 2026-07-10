/**
 * Camada central de captura de mensagens do WhatsApp (issue #764).
 *
 * Ponto único que os 3 webhooks (intent, base/mídia, imagem anotada) usam para
 * gravar entrada/saída na persistência de conversas criada em #763, com
 * idempotência por message.id da Meta. Não substitui os mecanismos em memória
 * existentes (conversationHistory.ts, dedup caches, intentAuditLog.ts) — a
 * remoção deles é decisão de #768, após a captura unificada e a regressão
 * multicanal estarem validadas.
 */

import {
  createDrizzleWhatsAppConversationRepository,
  type DomainLinkInput,
  type WhatsAppConversationRepository,
} from "../../repositories/whatsappConversationRepository";
import { getDb, logPersistenceWarning } from "../../db";

const repository: WhatsAppConversationRepository = createDrizzleWhatsAppConversationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export type MessageLifecycleHandle = { conversationId: number; messageId: number } | null;

export type BeginInboundMessageInput = {
  userId: number;
  whatsappConnectionId: number | null;
  phoneNumber: string;
  externalMessageId?: string | null;
  contentType: "text" | "image" | "audio" | "multimodal" | "system";
  text?: string | null;
  transcript?: string | null;
  captionText?: string | null;
  mediaStorageKey?: string | null;
  mediaMimeType?: string | null;
  occurredAt: Date;
  allowRawContentStorage?: boolean;
};

/**
 * Cria/reaproveita a conversa ativa do usuário e grava a mensagem de entrada.
 * Idempotente: reentrega do mesmo externalMessageId retorna a mensagem já
 * existente em vez de duplicar (garantido pela unique key em #763).
 */
export async function beginInboundMessage(input: BeginInboundMessageInput): Promise<MessageLifecycleHandle> {
  const conversation = await repository.createOrGetActiveConversation(
    input.userId,
    input.whatsappConnectionId,
    input.phoneNumber,
  );
  if (!conversation) return null;

  const message = await repository.appendMessage({
    conversationId: conversation.id,
    userId: input.userId,
    direction: "inbound",
    externalMessageId: input.externalMessageId ?? null,
    contentType: input.contentType,
    text: input.text ?? null,
    transcript: input.transcript ?? null,
    captionText: input.captionText ?? null,
    mediaStorageKey: input.mediaStorageKey ?? null,
    mediaMimeType: input.mediaMimeType ?? null,
    occurredAt: input.occurredAt,
    allowRawContentStorage: input.allowRawContentStorage,
  });
  if (!message) return null;

  return { conversationId: conversation.id, messageId: message.id };
}

/**
 * Grava a resposta funcional efetivamente entregue ao usuário (uma única vez
 * por interação, mesmo quando há fallback de botão interativo para texto —
 * o corpo entregue é o mesmo) e a vincula à mensagem de entrada.
 */
export async function recordOutboundReply(
  handle: MessageLifecycleHandle,
  input: { userId: number; text: string; occurredAt?: Date },
): Promise<void> {
  if (!handle) return;

  const reply = await repository.appendMessage({
    conversationId: handle.conversationId,
    userId: input.userId,
    direction: "outbound",
    contentType: "text",
    text: input.text,
    respondsToMessageId: handle.messageId,
    occurredAt: input.occurredAt ?? new Date(),
    allowRawContentStorage: true,
  });
  if (!reply) return;

  await repository.linkResponse(handle.messageId, reply.id);
}

/** Vincula a mensagem de entrada a um registro de domínio já persistido (refeição, água, peso, exercício). */
export async function recordDomainLink(handle: MessageLifecycleHandle, link: DomainLinkInput): Promise<void> {
  if (!handle) return;
  if (!link.mealId && !link.mealItemId && !link.waterLogId && !link.weightEntryId && !link.exerciseId) return;

  await repository.linkDomainRecord(handle.messageId, link);
}

/**
 * Marca que o processamento desta mensagem foi concluído (com ou sem
 * resposta). O desfecho específico (sucesso, falha, bloqueio, ignorada)
 * continua auditável via logInferenceEvent, já chamado em cada call site
 * dos webhooks — esta função só fecha o processedAt da mensagem persistida.
 */
export async function markMessageProcessed(handle: MessageLifecycleHandle, processedAt: Date = new Date()): Promise<void> {
  if (!handle) return;
  await repository.markProcessed(handle.messageId, processedAt);
}
