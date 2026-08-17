import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatsAppConversationMessageRecord, WhatsAppConversationRepository } from "../../repositories/whatsappConversationRepository";

const { compareMock, isEnabledMock } = vi.hoisted(() => ({
  compareMock: vi.fn(async () => undefined),
  isEnabledMock: vi.fn(() => true),
}));

vi.mock("../meals/service", () => ({ listMeals: vi.fn(async () => []) }));
vi.mock("./contextMemory", () => ({ retrieveWhatsappContextMemory: vi.fn(() => ({ llmContext: [] })) }));
vi.mock("./conversationSummaryService", () => ({ getOrRefreshConversationSummary: vi.fn(async () => null) }));
vi.mock("./shadowIntentComparison", () => ({
  compareWhatsappIntentInShadow: compareMock,
  isShadowIntentComparisonEnabled: isEnabledMock,
}));
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
const { clearConversationHistory, recordConversationTurn } = await import("./conversationHistory");
const originalEnv = { ...process.env };
const userId = 7_680_010;
const receivedAt = new Date("2026-07-11T12:00:00.000Z");

function message(id: number, text: string, occurredAt: Date): WhatsAppConversationMessageRecord {
  return {
    id,
    conversationId: 1,
    userId,
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

function repository(): WhatsAppConversationRepository {
  return {
    findRecentMessagesByUser: vi.fn(async () => [
      message(1, "histórico persistente", new Date(receivedAt.getTime() - 60_000)),
      message(2, "corrija o segundo", receivedAt),
    ]),
  } as unknown as WhatsAppConversationRepository;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    WHATSAPP_CONTEXT_READ_MODE_TEXT: "shadow",
    WHATSAPP_CONTEXT_ROLLOUT_PERCENT_TEXT: "100",
    WHATSAPP_CONTEXT_SHADOW_COMPARE_INTENT: "true",
  };
  clearConversationHistory(userId);
  recordConversationTurn(userId, "histórico legado", "resposta legada", receivedAt.getTime() - 60_000);
  compareMock.mockClear();
  isEnabledMock.mockReset();
  isEnabledMock.mockReturnValue(true);
});

afterEach(() => {
  process.env = { ...originalEnv };
  clearConversationHistory(userId);
});

describe("intent context structured shadow comparison", () => {
  it("mantém o contexto legado como resposta e compara o alvo persistente separadamente", async () => {
    const context = await buildWhatsappIntentContext(userId, {
      receivedAt,
      flow: "text",
      conversationRepository: repository(),
    });

    expect(context.contextRead).toEqual(expect.objectContaining({ mode: "shadow", source: "legacy" }));
    expect(context.recentTurns.map(turn => turn.text)).toEqual(["histórico legado", "resposta legada"]);
    expect(compareMock).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      text: "corrija o segundo",
      flow: "text",
      legacyContext: expect.objectContaining({
        contextRead: expect.objectContaining({ source: "legacy" }),
      }),
      persistentContext: expect.objectContaining({
        recentTurns: [expect.objectContaining({ text: "histórico persistente" })],
        contextRead: expect.objectContaining({ source: "persistent" }),
      }),
    }));
  });

  it("não executa comparação funcional quando o opt-in está desativado", async () => {
    isEnabledMock.mockReturnValue(false);
    await buildWhatsappIntentContext(userId, {
      receivedAt,
      flow: "text",
      conversationRepository: repository(),
    });
    expect(compareMock).not.toHaveBeenCalled();
  });
});
