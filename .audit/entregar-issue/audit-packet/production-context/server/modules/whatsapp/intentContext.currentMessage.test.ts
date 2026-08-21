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

function message(
  id: number,
  text: string,
  occurredAt: Date,
  conversationId = 1,
): WhatsAppConversationMessageRecord {
  return {
    id,
    conversationId,
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

  it("usa timestamp somente quando há uma única mensagem inbound correspondente", async () => {
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

  it("correlaciona pela identidade da Meta sem remover uma mensagem concorrente no mesmo segundo", async () => {
    process.env.WHATSAPP_CONTEXT_READ_MODE = "persistent";
    process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT = "100";
    const receivedAt = new Date("2026-07-11T12:00:00.000Z");
    const repository = {
      findRecentMessagesByUser: vi.fn(async () => [
        message(1, "mensagem anterior", new Date(receivedAt.getTime() - 60_000)),
        message(2, "mensagem corrente A", receivedAt),
        message(3, "mensagem concorrente B", receivedAt),
      ]),
    } as unknown as WhatsAppConversationRepository;

    const context = await buildWhatsappIntentContext(1, {
      receivedAt,
      currentInboundExternalMessageId: "wamid.2",
      conversationRepository: repository,
    });

    expect(context.recentTurns.map(turn => turn.text)).toEqual([
      "mensagem anterior",
      "mensagem concorrente B",
    ]);
    expect(context.contextRead.persistentCount).toBe(2);
  });

  it("correlaciona pela identidade mesmo quando o timestamp recebido diverge do persistido", async () => {
    process.env.WHATSAPP_CONTEXT_READ_MODE = "persistent";
    process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT = "100";
    const receivedAt = new Date("2026-07-11T12:00:00.005Z");
    const persistedAt = new Date("2026-07-11T12:00:00.000Z");
    const repository = {
      findRecentMessagesByUser: vi.fn(async () => [
        message(1, "mensagem anterior", new Date(receivedAt.getTime() - 60_000)),
        message(2, "mensagem corrente", persistedAt),
      ]),
    } as unknown as WhatsAppConversationRepository;

    const context = await buildWhatsappIntentContext(1, {
      receivedAt,
      currentInboundExternalMessageId: "wamid.2",
      conversationRepository: repository,
    });

    expect(context.recentTurns.map(turn => turn.text)).toEqual(["mensagem anterior"]);
  });

  it("não remove um irmão arbitrário quando o timestamp é ambíguo e a identidade não foi informada", async () => {
    process.env.WHATSAPP_CONTEXT_READ_MODE = "persistent";
    process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT = "100";
    const receivedAt = new Date("2026-07-11T12:00:00.000Z");
    const repository = {
      findRecentMessagesByUser: vi.fn(async () => [
        message(2, "mensagem A", receivedAt),
        message(3, "mensagem B", receivedAt),
      ]),
    } as unknown as WhatsAppConversationRepository;

    const context = await buildWhatsappIntentContext(1, { receivedAt, conversationRepository: repository });

    expect(context.recentTurns.map(turn => turn.text)).toEqual(["mensagem A", "mensagem B"]);
  });

  it("não reutiliza a conversa expirada na primeira mensagem de uma nova conversa lógica", async () => {
    process.env.WHATSAPP_CONTEXT_READ_MODE = "persistent";
    process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT = "100";
    const receivedAt = new Date("2026-07-11T12:31:00.000Z");
    const repository = {
      findRecentMessagesByUser: vi.fn(async () => [
        message(1, "SEGREDO_DA_CONVERSA_EXPIRADA", new Date("2026-07-11T12:00:00.000Z"), 10),
        message(2, "primeira mensagem da nova conversa", receivedAt, 20),
      ]),
    } as unknown as WhatsAppConversationRepository;

    const context = await buildWhatsappIntentContext(1, {
      receivedAt,
      currentInboundExternalMessageId: "wamid.2",
      conversationRepository: repository,
    });

    expect(context.conversationActive).toBe(false);
    expect(context.recentTurns).toEqual([]);
    expect(context.contextRead.persistentCount).toBe(0);
  });

  it("avalia expiração depois de excluir a mensagem corrente", async () => {
    process.env.WHATSAPP_CONTEXT_READ_MODE = "persistent";
    process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT = "100";
    const receivedAt = new Date("2026-07-11T12:00:00.000Z");
    const repository = {
      findRecentMessagesByUser: vi.fn(async () => [
        message(1, "contexto expirado", new Date(receivedAt.getTime() - 31 * 60_000)),
        message(2, "mensagem corrente", receivedAt),
      ]),
    } as unknown as WhatsAppConversationRepository;

    const context = await buildWhatsappIntentContext(1, {
      receivedAt,
      currentInboundExternalMessageId: "wamid.2",
      conversationRepository: repository,
    });

    expect(context.conversationActive).toBe(false);
    expect(context.recentTurns).toEqual([]);
    expect(context.contextRead.persistentCount).toBe(0);
  });
});
