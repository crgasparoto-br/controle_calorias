import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppendMessageInput,
  DomainLinkInput,
  WhatsAppConversationRepository,
} from "./repositories/whatsappConversationRepository";
import type { WhatsAppConversationMessageEnrichmentRepository } from "./repositories/whatsappConversationMessageEnrichmentRepository";
import type { WhatsAppProcessingClaimRepository } from "./repositories/whatsappProcessingClaimRepository";

const processMealInputMock = vi.fn(async () => ({
  detectedMealLabel: "Refeição",
  sourceText: "alimento de teste",
  confidence: 0.95,
  needsConfirmation: false,
  reasoning: "Regressão multicanal.",
  items: [{
    foodName: "Arroz",
    canonicalName: "Arroz branco cozido",
    portionText: "100 g",
    servings: 1,
    estimatedGrams: 100,
    calories: 130,
    protein: 2.7,
    carbs: 28,
    fat: 0.3,
    confidence: 0.95,
    source: "catalog" as const,
  }],
  totals: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
}));

vi.mock("./nutritionEngine", async () => {
  const actual = await vi.importActual<typeof import("./nutritionEngine")>("./nutritionEngine");
  return { ...actual, processMealInput: processMealInputMock };
});

vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: vi.fn(async () => ({ text: "100g arroz branco", language: "pt", segments: [] })),
}));

vi.mock("./storage", async () => {
  const { notifyWhatsAppMediaPersisted } = await vi.importActual<typeof import("./modules/whatsapp/mediaPersistenceCorrelation")>(
    "./modules/whatsapp/mediaPersistenceCorrelation",
  );
  return {
    storagePut: vi.fn(async (sourceKey: string, _data: unknown, mimeType: string) => {
      const extension = sourceKey.includes("audio") ? ".ogg" : ".jpg";
      const storedKey = `private/media/${crypto.randomUUID()}${extension}`;
      await notifyWhatsAppMediaPersisted(sourceKey, storedKey, mimeType);
      return { key: storedKey, url: `https://storage.test/${storedKey}` };
    }),
  };
});

vi.mock("./modules/whatsapp/annotatedImage", () => ({
  generateAnnotatedMealImage: vi.fn(async () => ({
    url: "https://storage.test/public/media/annotated.png",
    storageKey: "public/media/annotated.png",
    mimeType: "image/png",
  })),
}));

vi.mock("./modules/quickEdit/service", () => ({
  tryCreateQuickEditLinkForMeal: vi.fn(async () => null),
}));

const {
  createMessageLifecycleService,
  withMessageLifecycleService,
} = await import("./modules/whatsapp/messageLifecycle");
const { resetAllMessageDeduplicationCachesForTests } = await import("./modules/whatsapp/messageDeduplicationCache");
const { handleWhatsAppPersistentContextWebhook } = await import("./whatsappPersistentContextWebhook");
const { upsertUserWhatsappConnection } = await import("./db");

type StoredMessage = {
  id: number;
  conversationId: number;
  userId: number;
  direction: "inbound" | "outbound";
  externalMessageId: string | null;
  idempotencyKey: string;
  contentType: "text" | "image" | "audio" | "multimodal" | "system";
  text: string | null;
  sanitizedText: string | null;
  transcript: string | null;
  sanitizedTranscript: string | null;
  captionText: string | null;
  mediaStorageKey: string | null;
  mediaMimeType: string | null;
  respondsToMessageId: number | null;
  occurredAt: Date;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type SharedState = {
  messages: StoredMessage[];
  domainLinks: Array<{ messageId: number; link: DomainLinkInput }>;
  nextMessageId: number;
};

function createSharedState(): SharedState {
  return { messages: [], domainLinks: [], nextMessageId: 1 };
}

function buildIdempotencyKey(input: AppendMessageInput) {
  return input.externalMessageId
    ? `whatsapp:${input.direction}:${input.externalMessageId}`
    : `whatsapp:${input.direction}:${input.conversationId}:${input.respondsToMessageId ?? "root"}:${crypto.randomUUID()}`;
}

function createInMemoryConversationRepository(state: SharedState): WhatsAppConversationRepository {
  return {
    async createOrGetActiveConversation(userId, whatsappConnectionId, phoneNumber, now = new Date()) {
      return {
        id: userId,
        userId,
        whatsappConnectionId,
        phoneNumber,
        status: "active",
        startedAt: now,
        lastActivityAt: now,
        endedAt: null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      } as never;
    },
    async appendMessage(input) {
      const idempotencyKey = buildIdempotencyKey(input);
      const existing = state.messages.find(message => message.idempotencyKey === idempotencyKey);
      if (existing) return { message: existing as never, wasNewInsert: false };

      const now = new Date();
      const message: StoredMessage = {
        id: state.nextMessageId++,
        conversationId: input.conversationId,
        userId: input.userId,
        direction: input.direction,
        externalMessageId: input.externalMessageId ?? null,
        idempotencyKey,
        contentType: input.contentType,
        text: input.text ?? null,
        sanitizedText: input.text ?? null,
        transcript: input.transcript ?? null,
        sanitizedTranscript: input.transcript ?? null,
        captionText: input.captionText ?? null,
        mediaStorageKey: input.mediaStorageKey ?? null,
        mediaMimeType: input.mediaMimeType ?? null,
        respondsToMessageId: input.respondsToMessageId ?? null,
        occurredAt: input.occurredAt,
        processedAt: input.processedAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      state.messages.push(message);
      return { message: message as never, wasNewInsert: true };
    },
    async findByIdempotencyKey(idempotencyKey) {
      return (state.messages.find(message => message.idempotencyKey === idempotencyKey) ?? null) as never;
    },
    async linkResponse() {},
    async linkDomainRecord(messageId, link) {
      state.domainLinks.push({ messageId, link });
    },
    async findRecentMessages(conversationId, limit = 20) {
      return state.messages.filter(message => message.conversationId === conversationId).slice(-limit) as never;
    },
    async findRecentMessagesByUser(userId, limit = 20) {
      return state.messages.filter(message => message.userId === userId).slice(-limit) as never;
    },
    async findMessagesBefore(conversationId, beforeOccurredAt, beforeId, limit = 20) {
      return state.messages
        .filter(message => message.conversationId === conversationId && (message.occurredAt < beforeOccurredAt || message.id < beforeId))
        .slice(-limit) as never;
    },
    async findDomainLinksForMessage(messageId) {
      return state.domainLinks.filter(entry => entry.messageId === messageId).map((entry, index) => ({ id: index + 1, messageId, ...entry.link })) as never;
    },
    async markProcessed(messageId, processedAt = new Date()) {
      const message = state.messages.find(candidate => candidate.id === messageId);
      if (message) {
        message.processedAt = processedAt;
        message.updatedAt = processedAt;
      }
    },
    async insertConversationSummary() {},
    async findLatestConversationSummary() { return null; },
    async purgeExpiredRawText() { return 0; },
    async purgeExpiredSanitizedText() { return 0; },
    async purgeExpiredAuditRows() { return 0; },
  };
}

function createEnrichmentRepository(state: SharedState): WhatsAppConversationMessageEnrichmentRepository {
  return {
    async enrichInboundMessageByExternalId(externalMessageId, input) {
      const message = state.messages.find(candidate => candidate.direction === "inbound" && candidate.externalMessageId === externalMessageId);
      if (!message) return false;
      if (input.transcript) {
        message.transcript = input.transcript;
        message.sanitizedTranscript = input.transcript;
      }
      if (input.mediaStorageKey) message.mediaStorageKey = input.mediaStorageKey;
      if (input.mediaMimeType) message.mediaMimeType = input.mediaMimeType;
      message.updatedAt = new Date();
      return true;
    },
  };
}

function createClaimRepository(state: SharedState): WhatsAppProcessingClaimRepository {
  return {
    async claimStaleUnprocessedMessage(messageId, staleBefore, claimedAt = new Date()) {
      const message = state.messages.find(candidate => candidate.id === messageId);
      if (!message || message.processedAt || message.updatedAt >= staleBefore) return false;
      message.updatedAt = claimedAt;
      return true;
    },
  };
}

function createRuntime(state: SharedState) {
  return createMessageLifecycleService({
    conversationRepository: createInMemoryConversationRepository(state),
    enrichmentRepository: createEnrichmentRepository(state),
    processingClaimRepository: createClaimRepository(state),
  });
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    send(payload: unknown) { this.body = payload; return this; },
  };
}

function createRequest(phone: string, message: Record<string, unknown>) {
  return {
    body: {
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: "phone-number-test", display_phone_number: "5511000000000" },
            messages: [{ from: phone, ...message }],
          },
        }],
      }],
    },
  };
}

describe("WhatsApp persistent multichannel entrypoint", () => {
  let failMessageSends = false;

  beforeEach(() => {
    processMealInputMock.mockClear();
    resetAllMessageDeduplicationCachesForTests();
    failMessageSends = false;
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/messages")) {
        return { ok: !failMessageSends, status: failMessageSends ? 500 : 200, statusText: failMessageSends ? "failed" : "ok", json: async () => ({}) } as Response;
      }
      if (url.includes("graph.facebook.com")) {
        const mediaId = url.split("/").pop() ?? "media";
        return { ok: true, json: async () => ({ url: `https://media.test/${mediaId}`, mime_type: mediaId.includes("audio") ? "audio/ogg" : "image/jpeg" }) } as Response;
      }
      if (url.includes("media.test")) {
        return {
          ok: true,
          headers: { get: () => (url.includes("audio") ? "audio/ogg" : "image/jpeg") },
          arrayBuffer: async () => new TextEncoder().encode("binary-media").buffer,
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it("preserva texto, imagem e áudio entre reinícios e duas instâncias e deduplica reentregas", async () => {
    const userId = 8_100_001;
    const phone = "5511810000001";
    await upsertUserWhatsappConnection({ userId, phoneNumber: phone, displayName: "Context Test" });

    const state = createSharedState();
    const runtimeA = createRuntime(state);
    const runtimeB = createRuntime(state);
    const deliveries = [
      { runtime: runtimeA, message: { id: "wamid-text-1", timestamp: "1783742400", type: "text", text: { body: "100g arroz branco" } } },
      { runtime: runtimeB, message: { id: "wamid-image-1", timestamp: "1783742460", type: "image", image: { id: "image-media-1", mime_type: "image/jpeg", caption: "jantar" } } },
      { runtime: runtimeA, message: { id: "wamid-audio-1", timestamp: "1783742520", type: "audio", audio: { id: "audio-media-1", mime_type: "audio/ogg" } } },
    ];

    for (const delivery of deliveries) {
      resetAllMessageDeduplicationCachesForTests();
      const response = createResponse();
      await withMessageLifecycleService(delivery.runtime, () =>
        handleWhatsAppPersistentContextWebhook(createRequest(phone, delivery.message) as never, response as never),
      );
      expect(response.statusCode).toBe(200);
    }

    const processedBeforeRetry = processMealInputMock.mock.calls.length;
    for (const delivery of [deliveries[1], deliveries[2]]) {
      resetAllMessageDeduplicationCachesForTests();
      const response = createResponse();
      const alternateRuntime = delivery.runtime === runtimeA ? runtimeB : runtimeA;
      await withMessageLifecycleService(alternateRuntime, () =>
        handleWhatsAppPersistentContextWebhook(createRequest(phone, delivery.message) as never, response as never),
      );
      expect(response.body).toEqual(expect.objectContaining({ ok: true, deduplicated: true }));
    }

    expect(processMealInputMock.mock.calls.length).toBe(processedBeforeRetry);
    const inbound = state.messages.filter(message => message.direction === "inbound");
    expect(inbound.map(message => message.externalMessageId)).toEqual(["wamid-text-1", "wamid-image-1", "wamid-audio-1"]);
    expect(inbound.find(message => message.externalMessageId === "wamid-image-1")).toEqual(expect.objectContaining({
      contentType: "image",
      mediaStorageKey: expect.stringMatching(/^private\/media\//),
      mediaMimeType: "image/jpeg",
    }));
    expect(inbound.find(message => message.externalMessageId === "wamid-audio-1")).toEqual(expect.objectContaining({
      contentType: "audio",
      sanitizedTranscript: "100g arroz branco",
      mediaStorageKey: expect.stringMatching(/^private\/media\//),
      mediaMimeType: "audio/ogg",
    }));
    expect(inbound.every(message => !message.mediaStorageKey?.includes(phone))).toBe(true);
    expect(inbound.every(message => !message.mediaStorageKey?.includes("media-1"))).toBe(true);
  });

  it("não repete domínio quando o envio da resposta falha depois da persistência", async () => {
    const userId = 8_100_002;
    const phone = "5511810000002";
    await upsertUserWhatsappConnection({ userId, phoneNumber: phone, displayName: "Reply Failure Test" });
    const state = createSharedState();
    const runtimeA = createRuntime(state);
    const runtimeB = createRuntime(state);
    const message = { id: "wamid-send-failure", timestamp: "1783742600", type: "image", image: { id: "image-send-failure", mime_type: "image/jpeg" } };

    failMessageSends = true;
    const firstResponse = createResponse();
    await withMessageLifecycleService(runtimeA, () =>
      handleWhatsAppPersistentContextWebhook(createRequest(phone, message) as never, firstResponse as never),
    );
    const processedAfterFailure = processMealInputMock.mock.calls.length;
    expect(processedAfterFailure).toBeGreaterThan(0);

    failMessageSends = false;
    resetAllMessageDeduplicationCachesForTests();
    const retryResponse = createResponse();
    await withMessageLifecycleService(runtimeB, () =>
      handleWhatsAppPersistentContextWebhook(createRequest(phone, message) as never, retryResponse as never),
    );

    expect(retryResponse.body).toEqual(expect.objectContaining({ ok: true, deduplicated: true }));
    expect(processMealInputMock.mock.calls.length).toBe(processedAfterFailure);
    expect(state.messages.filter(entry => entry.direction === "inbound" && entry.externalMessageId === "wamid-send-failure")).toHaveLength(1);
  });
});
