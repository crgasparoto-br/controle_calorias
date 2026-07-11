/**
 * Camada central de captura e idempotência das mensagens do WhatsApp.
 *
 * Os três entrypoints usam o mesmo serviço. A chave única no banco impede linhas
 * duplicadas e um lease atômico permite retry após crash, sem depender de Map local.
 * O escopo AsyncLocalStorage preserva a propriedade da mesma mensagem quando o
 * roteamento passa por intent -> imagem anotada -> webhook base na mesma requisição.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createDrizzleWhatsAppConversationRepository,
  type DomainLinkInput,
  type WhatsAppConversationRepository,
} from "../../repositories/whatsappConversationRepository";
import {
  createDrizzleWhatsAppConversationMessageEnrichmentRepository,
  type EnrichWhatsAppConversationMessageInput,
  type WhatsAppConversationMessageEnrichmentRepository,
} from "../../repositories/whatsappConversationMessageEnrichmentRepository";
import { getDb, logPersistenceWarning } from "../../db";

const DEFAULT_PROCESSING_LEASE_MS = 15 * 60 * 1000;

export type MessageLifecycleHandle = { conversationId: number; messageId: number; wasNewInsert: boolean } | null;

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

export type MessageLifecycleService = ReturnType<typeof createMessageLifecycleService>;

type MessageLifecycleScope = {
  service: MessageLifecycleService;
  claimedMessageIds: Set<number>;
};

export function createMessageLifecycleService(input: {
  conversationRepository: WhatsAppConversationRepository;
  enrichmentRepository?: WhatsAppConversationMessageEnrichmentRepository;
  processingLeaseMs?: number;
}) {
  const processingLeaseMs = input.processingLeaseMs ?? DEFAULT_PROCESSING_LEASE_MS;

  return {
    async beginInboundMessage(message: BeginInboundMessageInput): Promise<MessageLifecycleHandle> {
      const conversation = await input.conversationRepository.createOrGetActiveConversation(
        message.userId,
        message.whatsappConnectionId,
        message.phoneNumber,
      );
      if (!conversation) return null;

      const appended = await input.conversationRepository.appendMessage({
        conversationId: conversation.id,
        userId: message.userId,
        direction: "inbound",
        externalMessageId: message.externalMessageId ?? null,
        contentType: message.contentType,
        text: message.text ?? null,
        transcript: message.transcript ?? null,
        captionText: message.captionText ?? null,
        mediaStorageKey: message.mediaStorageKey ?? null,
        mediaMimeType: message.mediaMimeType ?? null,
        occurredAt: message.occurredAt,
        allowRawContentStorage: message.allowRawContentStorage,
      });
      if (!appended) return null;

      return { conversationId: conversation.id, messageId: appended.message.id, wasNewInsert: appended.wasNewInsert };
    },

    async claimMessageForProcessing(handle: MessageLifecycleHandle, now = new Date()): Promise<boolean> {
      if (!handle) return true;
      if (handle.wasNewInsert) return true;

      return input.conversationRepository.claimStaleUnprocessedMessage(
        handle.messageId,
        new Date(now.getTime() - processingLeaseMs),
        now,
      );
    },

    async wasMessageAlreadyProcessed(handle: MessageLifecycleHandle): Promise<boolean> {
      if (!handle || handle.wasNewInsert) return false;
      const links = await input.conversationRepository.findDomainLinksForMessage(handle.messageId);
      return links.length > 0;
    },

    async recordOutboundReply(
      handle: MessageLifecycleHandle,
      reply: { userId: number; text: string; occurredAt?: Date },
    ): Promise<void> {
      if (!handle) return;

      const appended = await input.conversationRepository.appendMessage({
        conversationId: handle.conversationId,
        userId: reply.userId,
        direction: "outbound",
        contentType: "text",
        text: reply.text,
        respondsToMessageId: handle.messageId,
        occurredAt: reply.occurredAt ?? new Date(),
        allowRawContentStorage: true,
      });
      if (!appended) return;

      await input.conversationRepository.linkResponse(handle.messageId, appended.message.id);
    },

    async recordDomainLink(handle: MessageLifecycleHandle, link: DomainLinkInput): Promise<void> {
      if (!handle) return;
      if (!link.mealId && !link.mealItemId && !link.waterLogId && !link.weightEntryId && !link.exerciseId) return;
      await input.conversationRepository.linkDomainRecord(handle.messageId, link);
    },

    async markMessageProcessed(handle: MessageLifecycleHandle, processedAt = new Date()): Promise<void> {
      if (!handle) return;
      await input.conversationRepository.markProcessed(handle.messageId, processedAt);
    },

    async enrichInboundMessage(
      externalMessageId: string | null | undefined,
      enrichment: EnrichWhatsAppConversationMessageInput,
    ): Promise<boolean> {
      if (!externalMessageId || !input.enrichmentRepository) return false;
      return input.enrichmentRepository.enrichInboundMessageByExternalId(externalMessageId, enrichment);
    },
  };
}

const defaultConversationRepository = createDrizzleWhatsAppConversationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const defaultEnrichmentRepository = createDrizzleWhatsAppConversationMessageEnrichmentRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const defaultService = createMessageLifecycleService({
  conversationRepository: defaultConversationRepository,
  enrichmentRepository: defaultEnrichmentRepository,
});
const lifecycleScope = new AsyncLocalStorage<MessageLifecycleScope>();

function getActiveService() {
  return lifecycleScope.getStore()?.service ?? defaultService;
}

export async function withMessageLifecycleService<T>(
  service: MessageLifecycleService,
  operation: () => Promise<T>,
): Promise<T> {
  const current = lifecycleScope.getStore();
  return lifecycleScope.run({
    service,
    claimedMessageIds: current?.claimedMessageIds ?? new Set<number>(),
  }, operation);
}

export async function runWithMessageLifecycleRequestScope<T>(operation: () => Promise<T>): Promise<T> {
  if (lifecycleScope.getStore()) return operation();
  return lifecycleScope.run({ service: defaultService, claimedMessageIds: new Set<number>() }, operation);
}

export async function beginInboundMessage(input: BeginInboundMessageInput): Promise<MessageLifecycleHandle> {
  return getActiveService().beginInboundMessage(input);
}

export async function claimMessageForProcessing(handle: MessageLifecycleHandle, now = new Date()): Promise<boolean> {
  if (!handle) return true;

  const scope = lifecycleScope.getStore();
  if (scope?.claimedMessageIds.has(handle.messageId)) return true;

  const claimed = await getActiveService().claimMessageForProcessing(handle, now);
  if (claimed) scope?.claimedMessageIds.add(handle.messageId);
  return claimed;
}

export async function wasMessageAlreadyProcessed(handle: MessageLifecycleHandle): Promise<boolean> {
  return getActiveService().wasMessageAlreadyProcessed(handle);
}

export async function recordOutboundReply(
  handle: MessageLifecycleHandle,
  input: { userId: number; text: string; occurredAt?: Date },
): Promise<void> {
  await getActiveService().recordOutboundReply(handle, input);
}

export async function recordDomainLink(handle: MessageLifecycleHandle, link: DomainLinkInput): Promise<void> {
  await getActiveService().recordDomainLink(handle, link);
}

export async function markMessageProcessed(handle: MessageLifecycleHandle, processedAt = new Date()): Promise<void> {
  await getActiveService().markMessageProcessed(handle, processedAt);
}

export async function enrichInboundMessage(
  externalMessageId: string | null | undefined,
  input: EnrichWhatsAppConversationMessageInput,
): Promise<boolean> {
  return getActiveService().enrichInboundMessage(externalMessageId, input);
}
