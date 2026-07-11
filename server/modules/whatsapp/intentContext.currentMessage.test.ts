import { afterEach, describe, expect, it, vi } from "vitest";
import type { WhatsAppConversationMessageRecord, WhatsAppConversationRepository } from "../../repositories/whatsappConversationRepository";

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
  logInferenceEvent: vi.fn(),
}));

const { buildWhatsappIntentContext } = await import("./intentContext");
const originalEnv = { ...process.env };

function message(id: number, text: string, occurredAt: Date): WhatsAppConversationMessageRecord {
  return {
    id,
    conversationId: 1,
    userId: 1,
    direction: "inbound",
    channel: "whatsapp",
    externalMessageId: `wamid.${id}`,
    idempotencyKey: `whatsapp:inbound:wamid.${id}`,
    contentType: "text",
    rawTextStored: false,
    text: null,
    sanitizedText: text,
    transcript: null,
    sanitizedTranscript: null,
    mediaStorageKey: null,
    mediaMimeType: null,
    captionText: null,
    privacyPolicyVersion: null,
    retentionExpiresAt: null,
    respondsToMessageId: null,
    processedAt: null,
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  } as WhatsAppConversationMessageRecord;
}

describe("intent context current message boundary", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("não duplica a mensagem corrente no histórico entregue ao classificador", async () => {
    process.env.WHATSAPP_CONTEXT_READ_MODE = "persistent";
    process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT = "100";
    const receivedAt = new Date("2026-07-11T12:00:00.000Z");
    const repository = {
      findRecentMessagesByUser: vi.fn(async () => [
        message(1, "mensagem anterior", new Date(receivedAt.getTime() - 60_000)),
        message(2, "mensagem corrente", receivedAt),
      ]),
    } as unknown as WhatsAppConversationRepository;

    const context = await buildWhatsappIntentContext(1, { receivedAt, conversationRepository: repository });

    expect(context.recentTurns.map(turn => turn.text)).toEqual(["mensagem anterior"]);
    expect(context.contextRead.persistentCount).toBe(1);
    expect(context.conversationActive).toBe(true);
  });
});
