/**
 * Camada central de captura e idempotência das mensagens do WhatsApp.
 *
 * Os entrypoints usam o mesmo serviço. A chave única no banco impede linhas
 * duplicadas e o ownership persistente permite retry após crash, sem depender de
 * Map local para decidir conclusão ou liveness. O escopo AsyncLocalStorage
 * preserva somente a propriedade já comprovada na persistência durante a mesma
 * requisição.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
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
import {
  createDrizzleWhatsAppProcessingClaimRepository,
  type WhatsAppProcessingClaimRepository,
} from "../../repositories/whatsappProcessingClaimRepository";
import { getDb, logPersistenceWarning } from "../../db";
import {
  runWithWhatsappInboundCorrelationScope,
  setCurrentWhatsappInboundExternalMessageId,
} from "./inboundCorrelationContext";
import {
  beginCurrentQuestionLatencyTrace,
  claimCurrentQuestionDeliveryRetryRelease,
  finalizeCurrentQuestionLatencyTrace,
  getCurrentQuestionLatencyTrace,
  recordCurrentQuestionOutcome,
  recordCurrentQuestionPersistenceMs,
  shouldReleaseCurrentQuestionForDeliveryRetry,
} from "./questionLatencyContext";
import { WhatsAppQuestionDeliveryRetryableError } from "./questionDeliveryRecovery";

export { getCurrentWhatsappInboundExternalMessageId as getCurrentInboundExternalMessageId } from "./inboundCorrelationContext";

const LEGACY_PROCESSING_LEASE_MS = 15 * 60 * 1000;
export const DEFAULT_PROCESSING_HEARTBEAT_TIMEOUT_MS = 30 * 1000;
export const DEFAULT_PROCESSING_HEARTBEAT_INTERVAL_MS = 5 * 1000;

export type MessageLifecycleHandle = { conversationId: number; messageId: number; wasNewInsert: boolean } | null;
export type MessageProcessingClaimStatus = "claimed" | "recovered" | "inflight" | "processed" | "unavailable";

type MessageProcessingClaimDecision = {
  status: MessageProcessingClaimStatus;
  ownerToken?: string;
};

export class WhatsAppProcessingOwnershipLostError extends Error {
  constructor() {
    super("WhatsApp processing ownership is no longer available for this inbound message.");
    this.name = "WhatsAppProcessingOwnershipLostError";
  }
}

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

type PendingProcessedMessage = {
  service: MessageLifecycleService;
  handle: NonNullable<MessageLifecycleHandle>;
  processedAt: Date;
  ownerToken?: string;
};

type MessageLifecycleScope = {
  service: MessageLifecycleService;
  claimedMessageIds: Set<number>;
  externalMessageIdByMessageId: Map<number, string>;
  claimedExternalMessageIds: Set<string>;
  processingOwnerTokenByMessageId: Map<number, string>;
  processingHeartbeatTimers: Map<number, ReturnType<typeof setInterval>>;
  heartbeatInFlightMessageIds: Set<number>;
  pendingProcessedMessages: Map<number, PendingProcessedMessage>;
};

export function createMessageLifecycleService(input: {
  conversationRepository: WhatsAppConversationRepository;
  enrichmentRepository?: WhatsAppConversationMessageEnrichmentRepository;
  processingClaimRepository?: WhatsAppProcessingClaimRepository;
  /** Alias mantido para testes/compatibilidade do lease legado. */
  processingLeaseMs?: number;
  processingHeartbeatTimeoutMs?: number;
  processingHeartbeatIntervalMs?: number;
  ownerTokenFactory?: () => string;
}) {
  const legacyProcessingLeaseMs = input.processingLeaseMs ?? LEGACY_PROCESSING_LEASE_MS;
  const processingHeartbeatTimeoutMs = input.processingHeartbeatTimeoutMs
    ?? input.processingLeaseMs
    ?? DEFAULT_PROCESSING_HEARTBEAT_TIMEOUT_MS;
  const processingHeartbeatIntervalMs = input.processingHeartbeatIntervalMs
    ?? Math.min(DEFAULT_PROCESSING_HEARTBEAT_INTERVAL_MS, Math.max(100, Math.floor(processingHeartbeatTimeoutMs / 3)));
  const ownerTokenFactory = input.ownerTokenFactory ?? randomUUID;

  async function claimMessageForProcessingState(
    handle: MessageLifecycleHandle,
    now = new Date(),
  ): Promise<MessageProcessingClaimDecision> {
    if (!handle) return { status: "claimed" };

    if (input.processingClaimRepository?.claimUnprocessedMessage) {
      const ownerToken = ownerTokenFactory();
      const decision = await input.processingClaimRepository.claimUnprocessedMessage(
        handle.messageId,
        ownerToken,
        new Date(now.getTime() - processingHeartbeatTimeoutMs),
        now,
      );
      return {
        status: decision.state,
        ownerToken: decision.ownerToken,
      };
    }

    // Compatibilidade para doubles e consumidores antigos enquanto todos os
    // caminhos migram para o claim com owner persistente.
    if (handle.wasNewInsert) return { status: "claimed" };
    if (!input.processingClaimRepository) return { status: "unavailable" };
    const claimed = await input.processingClaimRepository.claimStaleUnprocessedMessage(
      handle.messageId,
      new Date(now.getTime() - legacyProcessingLeaseMs),
      now,
    );
    return { status: claimed ? "recovered" : "inflight" };
  }

  return {
    processingHeartbeatIntervalMs,

    async beginInboundMessage(message: BeginInboundMessageInput): Promise<MessageLifecycleHandle> {
      const latencyTrace = getCurrentQuestionLatencyTrace() ?? beginCurrentQuestionLatencyTrace({
        userId: message.userId,
        contentType: message.contentType,
        text: message.text,
      });
      const persistenceStartedAt = latencyTrace ? performance.now() : null;
      try {
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
      } finally {
        if (persistenceStartedAt !== null) {
          recordCurrentQuestionPersistenceMs(performance.now() - persistenceStartedAt);
        }
      }
    },

    claimMessageForProcessingState,

    async claimMessageForProcessing(handle: MessageLifecycleHandle, now = new Date()): Promise<boolean> {
      const decision = await claimMessageForProcessingState(handle, now);
      return decision.status === "claimed" || decision.status === "recovered";
    },

    async heartbeatMessageProcessing(
      handle: MessageLifecycleHandle,
      ownerToken: string,
      heartbeatAt = new Date(),
    ): Promise<boolean> {
      if (!handle || !input.processingClaimRepository?.heartbeatOwnedUnprocessedMessage) return true;
      return input.processingClaimRepository.heartbeatOwnedUnprocessedMessage(
        handle.messageId,
        ownerToken,
        heartbeatAt,
      );
    },

    async releaseMessageForRetry(
      handle: MessageLifecycleHandle,
      now = new Date(),
      ownerToken?: string,
    ): Promise<boolean> {
      if (!handle || !input.processingClaimRepository) return false;
      if (ownerToken && input.processingClaimRepository.releaseOwnedUnprocessedMessage) {
        return input.processingClaimRepository.releaseOwnedUnprocessedMessage(handle.messageId, ownerToken);
      }
      if (!input.processingClaimRepository.releaseUnprocessedMessage) return false;
      return input.processingClaimRepository.releaseUnprocessedMessage(
        handle.messageId,
        new Date(now.getTime() - legacyProcessingLeaseMs - 1),
      );
    },

    async completeMessageProcessingClaim(handle: MessageLifecycleHandle, ownerToken?: string): Promise<boolean> {
      if (!handle || !ownerToken || !input.processingClaimRepository?.completeOwnedMessageClaim) return false;
      return input.processingClaimRepository.completeOwnedMessageClaim(handle.messageId, ownerToken);
    },

    async wasMessageAlreadyProcessed(handle: MessageLifecycleHandle): Promise<boolean> {
      if (!handle || handle.wasNewInsert) return false;
      const responseIdempotencyKey = `whatsapp:outbound:${handle.conversationId}:response:${handle.messageId}`;
      const [links, recordedResponse] = await Promise.all([
        input.conversationRepository.findDomainLinksForMessage(handle.messageId),
        input.conversationRepository.findByIdempotencyKey(responseIdempotencyKey),
      ]);
      return links.length > 0 || Boolean(recordedResponse);
    },

    async recordOutboundReply(
      handle: MessageLifecycleHandle,
      reply: { userId: number; text: string; occurredAt?: Date },
    ): Promise<void> {
      if (!handle) return;
      const persistenceStartedAt = getCurrentQuestionLatencyTrace() ? performance.now() : null;
      try {
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
      } finally {
        if (persistenceStartedAt !== null) {
          recordCurrentQuestionPersistenceMs(performance.now() - persistenceStartedAt);
        }
      }
    },

    async recordDomainLink(handle: MessageLifecycleHandle, link: DomainLinkInput): Promise<void> {
      if (!handle) return;
      if (!link.mealId && !link.mealItemId && !link.waterLogId && !link.weightEntryId && !link.exerciseId) return;
      await input.conversationRepository.linkDomainRecord(handle.messageId, link);
    },

    async markMessageProcessed(handle: MessageLifecycleHandle, processedAt = new Date()): Promise<void> {
      if (!handle) return;
      const persistenceStartedAt = getCurrentQuestionLatencyTrace() ? performance.now() : null;
      try {
        await input.conversationRepository.markProcessed(handle.messageId, processedAt);
      } catch (error) {
        if (persistenceStartedAt !== null) {
          recordCurrentQuestionPersistenceMs(performance.now() - persistenceStartedAt);
          recordCurrentQuestionOutcome("error", "persistence_failed");
          finalizeCurrentQuestionLatencyTrace();
        }
        throw error;
      }
      if (persistenceStartedAt !== null) {
        recordCurrentQuestionPersistenceMs(performance.now() - persistenceStartedAt);
        finalizeCurrentQuestionLatencyTrace();
      }
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
const defaultProcessingClaimRepository = createDrizzleWhatsAppProcessingClaimRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
const defaultService = createMessageLifecycleService({
  conversationRepository: defaultConversationRepository,
  enrichmentRepository: defaultEnrichmentRepository,
  processingClaimRepository: defaultProcessingClaimRepository,
});
const lifecycleScope = new AsyncLocalStorage<MessageLifecycleScope>();

function createScope(service: MessageLifecycleService, current?: MessageLifecycleScope): MessageLifecycleScope {
  return {
    service,
    claimedMessageIds: current?.claimedMessageIds ?? new Set<number>(),
    externalMessageIdByMessageId: current?.externalMessageIdByMessageId ?? new Map<number, string>(),
    claimedExternalMessageIds: current?.claimedExternalMessageIds ?? new Set<string>(),
    processingOwnerTokenByMessageId: current?.processingOwnerTokenByMessageId ?? new Map<number, string>(),
    processingHeartbeatTimers: current?.processingHeartbeatTimers ?? new Map<number, ReturnType<typeof setInterval>>(),
    heartbeatInFlightMessageIds: current?.heartbeatInFlightMessageIds ?? new Set<number>(),
    pendingProcessedMessages: current?.pendingProcessedMessages ?? new Map<number, PendingProcessedMessage>(),
  };
}

function getActiveService() {
  return lifecycleScope.getStore()?.service ?? defaultService;
}

function stopProcessingHeartbeat(scope: MessageLifecycleScope, messageId: number) {
  const timer = scope.processingHeartbeatTimers.get(messageId);
  if (timer) clearInterval(timer);
  scope.processingHeartbeatTimers.delete(messageId);
  scope.heartbeatInFlightMessageIds.delete(messageId);
}

function stopAllProcessingHeartbeats(scope: MessageLifecycleScope) {
  for (const messageId of [...scope.processingHeartbeatTimers.keys()]) {
    stopProcessingHeartbeat(scope, messageId);
  }
}

function registerPersistentOwner(
  scope: MessageLifecycleScope,
  handle: NonNullable<MessageLifecycleHandle>,
  ownerToken: string | undefined,
) {
  if (!ownerToken) return;
  scope.processingOwnerTokenByMessageId.set(handle.messageId, ownerToken);
  stopProcessingHeartbeat(scope, handle.messageId);

  const timer = setInterval(() => {
    if (scope.heartbeatInFlightMessageIds.has(handle.messageId)) return;
    scope.heartbeatInFlightMessageIds.add(handle.messageId);
    void scope.service
      .heartbeatMessageProcessing(handle, ownerToken, new Date())
      .finally(() => scope.heartbeatInFlightMessageIds.delete(handle.messageId));
  }, scope.service.processingHeartbeatIntervalMs);
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") timer.unref();
  scope.processingHeartbeatTimers.set(handle.messageId, timer);
}

async function flushProcessedMessages(scope: MessageLifecycleScope) {
  const pending = [...scope.pendingProcessedMessages.values()];
  scope.pendingProcessedMessages.clear();
  for (const entry of pending) {
    await entry.service.markMessageProcessed(entry.handle, entry.processedAt);
    await entry.service.completeMessageProcessingClaim(entry.handle, entry.ownerToken);
    stopProcessingHeartbeat(scope, entry.handle.messageId);
  }
}

async function runOwnedScope<T>(scope: MessageLifecycleScope, operation: () => Promise<T>): Promise<T> {
  return runWithWhatsappInboundCorrelationScope(() => lifecycleScope.run(scope, async () => {
    try {
      const result = await operation();
      await flushProcessedMessages(scope);
      return result;
    } finally {
      // Em erro/crash simulado o claim não é liberado aqui de propósito. O
      // heartbeat para e outro runtime só assume depois da janela de liveness.
      stopAllProcessingHeartbeats(scope);
    }
  }));
}

export async function withMessageLifecycleService<T>(
  service: MessageLifecycleService,
  operation: () => Promise<T>,
): Promise<T> {
  const current = lifecycleScope.getStore();
  const scope = createScope(service, current);
  if (current) return lifecycleScope.run(scope, operation);
  return runOwnedScope(scope, operation);
}

export async function runWithMessageLifecycleRequestScope<T>(operation: () => Promise<T>): Promise<T> {
  if (lifecycleScope.getStore()) return operation();
  return runOwnedScope(createScope(defaultService), operation);
}

export async function beginInboundMessage(input: BeginInboundMessageInput): Promise<MessageLifecycleHandle> {
  const externalMessageId = input.externalMessageId?.trim() || null;
  setCurrentWhatsappInboundExternalMessageId(externalMessageId);

  const handle = await getActiveService().beginInboundMessage(input);
  const scope = lifecycleScope.getStore();
  if (handle && scope && externalMessageId) {
    scope.externalMessageIdByMessageId.set(handle.messageId, externalMessageId);
  }
  return handle;
}

export async function claimMessageForProcessingState(
  handle: MessageLifecycleHandle,
  now = new Date(),
): Promise<MessageProcessingClaimStatus> {
  if (!handle) return "claimed";

  const scope = lifecycleScope.getStore();
  if (scope?.claimedMessageIds.has(handle.messageId)) return "claimed";

  const decision = await getActiveService().claimMessageForProcessingState(handle, now);
  if ((decision.status === "claimed" || decision.status === "recovered") && scope) {
    scope.claimedMessageIds.add(handle.messageId);
    const externalMessageId = scope.externalMessageIdByMessageId.get(handle.messageId);
    if (externalMessageId) scope.claimedExternalMessageIds.add(externalMessageId);
    registerPersistentOwner(scope, handle, decision.ownerToken);
  }
  return decision.status;
}

export async function claimMessageForProcessing(handle: MessageLifecycleHandle, now = new Date()): Promise<boolean> {
  const status = await claimMessageForProcessingState(handle, now);
  return status === "claimed" || status === "recovered";
}

/** Permite que caches locais reconheçam um retry legitimamente assumido pelo claim persistente. */
export function isExternalMessageClaimedInCurrentScope(externalMessageId?: string | null) {
  return Boolean(externalMessageId && lifecycleScope.getStore()?.claimedExternalMessageIds.has(externalMessageId));
}

/**
 * Renova o owner no ponto imediatamente anterior a um efeito externo. Falha
 * fechada: um runtime que perdeu o token não pode continuar enviando resposta.
 */
export async function ensureMessageProcessingOwnership(handle: MessageLifecycleHandle) {
  if (!handle) return true;
  const scope = lifecycleScope.getStore();
  const ownerToken = scope?.processingOwnerTokenByMessageId.get(handle.messageId);
  if (!scope || !ownerToken) return true;

  const owned = await scope.service.heartbeatMessageProcessing(handle, ownerToken, new Date());
  if (!owned) throw new WhatsAppProcessingOwnershipLostError();
  return true;
}

export async function releaseMessageForRetry(handle: MessageLifecycleHandle, now = new Date()) {
  if (!handle) return false;
  const scope = lifecycleScope.getStore();
  const ownerToken = scope?.processingOwnerTokenByMessageId.get(handle.messageId);
  const released = await getActiveService().releaseMessageForRetry(handle, now, ownerToken);
  if (released) {
    scope?.claimedMessageIds.delete(handle.messageId);
    scope?.processingOwnerTokenByMessageId.delete(handle.messageId);
    if (scope) stopProcessingHeartbeat(scope, handle.messageId);
    const externalMessageId = scope?.externalMessageIdByMessageId.get(handle.messageId);
    if (externalMessageId) scope?.claimedExternalMessageIds.delete(externalMessageId);
  }
  return released;
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
  if (!handle) return;
  if (shouldReleaseCurrentQuestionForDeliveryRetry()) {
    if (claimCurrentQuestionDeliveryRetryRelease()) {
      await releaseMessageForRetry(handle, processedAt);
    }
    throw new WhatsAppQuestionDeliveryRetryableError();
  }

  const scope = lifecycleScope.getStore();
  if (!scope) {
    await getActiveService().markMessageProcessed(handle, processedAt);
    return;
  }

  scope.pendingProcessedMessages.set(handle.messageId, {
    service: getActiveService(),
    handle,
    processedAt,
    ownerToken: scope.processingOwnerTokenByMessageId.get(handle.messageId),
  });
}

export async function enrichInboundMessage(
  externalMessageId: string | null | undefined,
  input: EnrichWhatsAppConversationMessageInput,
): Promise<boolean> {
  return getActiveService().enrichInboundMessage(externalMessageId, input);
}
