/**
 * Baseline de caracterização do contrato de respostas do WhatsApp (issue #780).
 *
 * Protege, através do entrypoint real (handleWhatsAppPersistentContextWebhook):
 * quantidade/ordem das mensagens físicas por fluxo, separação entre acknowledgement
 * e resposta funcional, gravação única da resposta no lifecycle, ausência de efeito
 * de domínio em solicitações informativas, e falha de envio sem re-execução.
 *
 * Os textos legados NÃO são contrato: as asserções usam efeitos, contagem e ordem.
 * Matriz canônica: docs/testing/whatsapp-response-contract-regression.md.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppendMessageInput,
  DomainLinkInput,
  WhatsAppConversationRepository,
} from "./repositories/whatsappConversationRepository";
import type { WhatsAppProcessingClaimRepository } from "./repositories/whatsappProcessingClaimRepository";

const processMealInputMock = vi.fn(async () => ({
  detectedMealLabel: "Refeição",
  sourceText: "alimento de teste",
  confidence: 0.95,
  needsConfirmation: false,
  reasoning: "Baseline de caracterização.",
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

vi.mock("./storage", () => ({
  storagePut: vi.fn(async (sourceKey: string) => {
    const key = `private/media/${crypto.randomUUID()}${sourceKey.includes("audio") ? ".ogg" : ".jpg"}`;
    return { key, url: `https://storage.test/${key}` };
  }),
}));

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
const { __resetWhatsAppTextIntentContextForTests } = await import("./whatsappIntentWebhook");
const { handleWhatsAppPersistentContextWebhook } = await import("./whatsappPersistentContextWebhook");
const { upsertUserWhatsappConnection, listUserWaterLogs } = await import("./db");

type StoredMessage = {
  id: number;
  conversationId: number;
  userId: number;
  direction: "inbound" | "outbound";
  externalMessageId: string | null;
  idempotencyKey: string;
  contentType: string;
  text: string | null;
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

/** Classificação das mensagens físicas enviadas à Cloud API nesta execução. */
type OutboundSend =
  | { kind: "read_receipt" }
  | { kind: "text"; body: string }
  | { kind: "interactive"; body: string }
  | { kind: "image"; caption: string };

describe("Baseline do contrato de respostas do WhatsApp (issue #780)", () => {
  let sends: OutboundSend[] = [];
  let failMessageSends = false;

  function classifySend(payload: Record<string, any>): OutboundSend {
    if (payload.status === "read") return { kind: "read_receipt" };
    if (payload.type === "image") return { kind: "image", caption: payload.image?.caption ?? "" };
    if (payload.type === "interactive") return { kind: "interactive", body: payload.interactive?.body?.text ?? "" };
    return { kind: "text", body: payload.text?.body ?? "" };
  }

  function outboundMessages() {
    return sends.filter(send => send.kind !== "read_receipt");
  }

  beforeEach(() => {
    sends = [];
    failMessageSends = false;
    processMealInputMock.mockClear();
    resetAllMessageDeduplicationCachesForTests();
    __resetWhatsAppTextIntentContextForTests();
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/messages")) {
        const payload = JSON.parse(String(init?.body ?? "{}"));
        if (payload.status !== "read" && failMessageSends) {
          return { ok: false, status: 500, statusText: "failed", json: async () => ({}) } as Response;
        }
        sends.push(classifySend(payload));
        return { ok: true, status: 200, statusText: "ok", json: async () => ({}) } as Response;
      }
      if (url.includes("graph.facebook.com")) {
        const mediaId = url.split("/").pop() ?? "media";
        return { ok: true, json: async () => ({ url: `https://media.test/${mediaId}`, mime_type: "image/jpeg" }) } as Response;
      }
      if (url.includes("media.test")) {
        return {
          ok: true,
          headers: { get: () => "image/jpeg" },
          arrayBuffer: async () => new TextEncoder().encode("binary-media").buffer,
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  async function deliver(state: SharedState, phone: string, message: Record<string, unknown>) {
    resetAllMessageDeduplicationCachesForTests();
    const response = createResponse();
    await withMessageLifecycleService(createRuntime(state), () =>
      handleWhatsAppPersistentContextWebhook(createRequest(phone, message) as never, response as never),
    );
    expect(response.statusCode).toBe(200);
    return response;
  }

  it("imagem de refeição: fast path sem ack, sequência física ordenada e uma resposta gravada", async () => {
    const userId = 8_200_001;
    const phone = "5511820000001";
    await upsertUserWhatsappConnection({ userId, phoneNumber: phone, displayName: "Baseline Imagem" });
    const state = createSharedState();

    await deliver(state, phone, {
      id: "wamid-baseline-image-1",
      timestamp: "1783742400",
      type: "image",
      image: { id: "image-baseline-1", mime_type: "image/jpeg", caption: "almoço" },
    });

    // Ação de domínio executada uma única vez e vinculada à mensagem inbound.
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
    expect(state.domainLinks.filter(entry => entry.link.mealId)).toHaveLength(1);

    // Contrato final (#785): fast path sem ack — read receipt, resposta funcional, imagem auxiliar.
    expect(sends.map(send => send.kind)).toEqual(["read_receipt", "text", "image"]);
    const [functionalReply] = outboundMessages() as Array<{ kind: "text"; body: string }>;
    expect(functionalReply.body).not.toContain("estou processando");

    // Exatamente uma resposta funcional gravada no lifecycle; o ack não é gravado.
    const outboundRecorded = state.messages.filter(message => message.direction === "outbound");
    expect(outboundRecorded).toHaveLength(1);
    expect(outboundRecorded[0].text).toBe(functionalReply.body);

    // processedAt finalizado no escopo bem-sucedido.
    const inbound = state.messages.find(message => message.externalMessageId === "wamid-baseline-image-1");
    expect(inbound?.processedAt).not.toBeNull();
  });

  it("texto nutricional pelo fallback: fast path sem ack e gravação única", async () => {
    const userId = 8_200_002;
    const phone = "5511820000002";
    await upsertUserWhatsappConnection({ userId, phoneNumber: phone, displayName: "Baseline Texto" });
    const state = createSharedState();

    await deliver(state, phone, {
      id: "wamid-baseline-text-1",
      timestamp: "1783742500",
      type: "text",
      text: { body: "100g arroz branco" },
    });

    expect(processMealInputMock).toHaveBeenCalledTimes(1);
    expect(state.domainLinks.filter(entry => entry.link.mealId)).toHaveLength(1);
    expect(sends.map(send => send.kind)).toEqual(["read_receipt", "text"]);

    const outboundRecorded = state.messages.filter(message => message.direction === "outbound");
    expect(outboundRecorded).toHaveLength(1);
    expect(outboundRecorded[0].text).not.toContain("estou processando");
  });

  it("água por texto: intent responde sem ack, registra hidratação uma vez e reentrega não repete efeitos", async () => {
    const userId = 8_200_003;
    const phone = "5511820000003";
    await upsertUserWhatsappConnection({ userId, phoneNumber: phone, displayName: "Baseline Água" });
    const state = createSharedState();
    const message = {
      id: "wamid-baseline-water-1",
      timestamp: "1783742600",
      type: "text",
      text: { body: "bebi 300 ml de água" },
    };

    await deliver(state, phone, message);

    expect(await listUserWaterLogs(userId)).toHaveLength(1);
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(sends.map(send => send.kind)).toEqual(["text"]);
    expect(state.messages.filter(entry => entry.direction === "outbound")).toHaveLength(1);

    // Reentrega do mesmo message.id: nenhum novo efeito nem nova resposta funcional.
    const retry = await deliver(state, phone, message);
    expect(retry.body).toEqual(expect.objectContaining({ ok: true, deduplicated: true }));
    expect(await listUserWaterLogs(userId)).toHaveLength(1);
    expect(sends.map(send => send.kind)).toEqual(["text"]);
    expect(state.messages.filter(entry => entry.direction === "outbound")).toHaveLength(1);
  });

  it("solicitação informativa (peso sem valor): responde clarificação sem criar registro de domínio", async () => {
    const userId = 8_200_004;
    const phone = "5511820000004";
    await upsertUserWhatsappConnection({ userId, phoneNumber: phone, displayName: "Baseline Clarificação" });
    const state = createSharedState();

    await deliver(state, phone, {
      id: "wamid-baseline-clarify-1",
      timestamp: "1783742700",
      type: "text",
      text: { body: "quero registrar meu peso" },
    });

    expect(state.domainLinks).toHaveLength(0);
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(sends.map(send => send.kind)).toEqual(["text"]);
    const inbound = state.messages.find(message => message.externalMessageId === "wamid-baseline-clarify-1");
    expect(inbound?.processedAt).not.toBeNull();
  });

  it("falha de envio: domínio executa uma vez, nada é gravado como resposta e a reentrega não reprocessa como refeição", async () => {
    const userId = 8_200_005;
    const phone = "5511820000005";
    await upsertUserWhatsappConnection({ userId, phoneNumber: phone, displayName: "Baseline Falha de Envio" });
    const state = createSharedState();
    const message = {
      id: "wamid-baseline-water-failure",
      timestamp: "1783742800",
      type: "text",
      text: { body: "bebi 250 ml de água" },
    };

    failMessageSends = true;
    await deliver(state, phone, message);

    // A mutação de domínio aconteceu, mas nenhuma resposta funcional foi gravada.
    expect(await listUserWaterLogs(userId)).toHaveLength(1);
    expect(state.messages.filter(entry => entry.direction === "outbound")).toHaveLength(0);

    // A reentrega com transporte saudável não reexecuta a mutação nem desvia para o fluxo nutricional.
    failMessageSends = false;
    const retry = await deliver(state, phone, message);
    expect(retry.body).toEqual(expect.objectContaining({ ok: true, deduplicated: true }));
    expect(await listUserWaterLogs(userId)).toHaveLength(1);
    expect(processMealInputMock).not.toHaveBeenCalled();
  });
});
