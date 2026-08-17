import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatsAppConversationMessageRecord, WhatsAppConversationRepository } from "../../repositories/whatsappConversationRepository";

const logInferenceEventMock = vi.fn();

vi.mock("../meals/service", () => ({ listMeals: vi.fn(async () => []) }));
vi.mock("./contextMemory", () => ({ retrieveWhatsappContextMemory: vi.fn(() => ({ llmContext: [] })) }));
vi.mock("./conversationSummaryService", () => ({ getOrRefreshConversationSummary: vi.fn(async () => null) }));
vi.mock("../../repositories/whatsappConversationRepository", async importOriginal => {
  const actual = await importOriginal<typeof import("../../repositories/whatsappConversationRepository")>();
  return { ...actual, createDrizzleWhatsAppConversationRepository: () => ({ findRecentMessagesByUser: vi.fn(async () => []) }) };
});
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  logPersistenceWarning: vi.fn(),
  logInferenceEvent: logInferenceEventMock,
}));

const { buildWhatsappIntentContext } = await import("./intentContext");
const { recordConversationTurn, clearConversationHistory } = await import("./conversationHistory");

const originalEnv = { ...process.env };
const userId = 7_680_001;
const receivedAt = new Date("2026-07-11T12:00:00.000Z");

function message(): WhatsAppConversationMessageRecord {
  return {
    id: 10,
    conversationId: 20,
    userId,
    direction: "inbound",
    channel: "whatsapp",
    externalMessageId: "wamid.persisted",
    idempotencyKey: "whatsapp:inbound:wamid.persisted",
    contentType: "text",
    rawTextStored: false,
    text: null,
    sanitizedText: "contexto persistido",
    transcript: null,
    sanitizedTranscript: null,
    mediaStorageKey: null,
    mediaMimeType: null,
    captionText: null,
    privacyPolicyVersion: null,
    retentionExpiresAt: null,
    respondsToMessageId: null,
    processedAt: receivedAt,
    occurredAt: new Date(receivedAt.getTime() - 1_000),
    createdAt: new Date(receivedAt.getTime() - 1_000),
    updatedAt: receivedAt,
  } as WhatsAppConversationMessageRecord;
}

function repository(messages: WhatsAppConversationMessageRecord[]): WhatsAppConversationRepository {
  return {
    findRecentMessagesByUser: vi.fn(async () => messages),
  } as unknown as WhatsAppConversationRepository;
}

describe("intent context rollout", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    clearConversationHistory(userId);
    logInferenceEventMock.mockClear();
    recordConversationTurn(userId, "contexto legado", "resposta legada", receivedAt.getTime() - 2_000);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    clearConversationHistory(userId);
  });

  it("compara em shadow sem alterar a resposta funcional", async () => {
    process.env.WHATSAPP_CONTEXT_READ_MODE_TEXT = "shadow";
    const persisted = [message()];
    const context = await buildWhatsappIntentContext(userId, {
      receivedAt,
      flow: "text",
      conversationRepository: repository(persisted),
    });

    expect(context.contextRead).toEqual(expect.objectContaining({ mode: "shadow", source: "legacy", equivalent: false }));
    expect(context.recentTurns.map(turn => turn.text)).toEqual(["contexto legado", "resposta legada"]);
    expect(persisted).toHaveLength(1);
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: "whatsapp.history.shadow_divergence" }));
  });

  it("ativa leitura persistente por fluxo e percentual", async () => {
    process.env.WHATSAPP_CONTEXT_READ_MODE_AUDIO = "persistent";
    process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT_AUDIO = "100";
    const context = await buildWhatsappIntentContext(userId, {
      receivedAt,
      flow: "audio",
      conversationRepository: repository([message()]),
    });

    expect(context.contextRead).toEqual(expect.objectContaining({ mode: "persistent", flow: "audio", source: "persistent" }));
    expect(context.recentTurns.map(turn => turn.text)).toEqual(["contexto persistido"]);
  });

  it("faz rollback para legado sem apagar mensagens persistidas", async () => {
    process.env.WHATSAPP_CONTEXT_READ_MODE_TEXT = "legacy";
    const persisted = [message()];
    const context = await buildWhatsappIntentContext(userId, {
      receivedAt,
      flow: "text",
      conversationRepository: repository(persisted),
    });

    expect(context.contextRead).toEqual(expect.objectContaining({ mode: "legacy", source: "legacy" }));
    expect(context.recentTurns.map(turn => turn.text)).toEqual(["contexto legado", "resposta legada"]);
    expect(persisted.map(entry => entry.externalMessageId)).toEqual(["wamid.persisted"]);
  });
});
