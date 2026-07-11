import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatsAppConversationMessageRecord } from "../../repositories/whatsappConversationRepository";
import { WHATSAPP_CONVERSATION_ACTIVE_TTL_MS } from "./conversationPolicy";

const { listMealsMock, retrieveWhatsappContextMemoryMock, findRecentMessagesByUserMock, getOrRefreshConversationSummaryMock, logInferenceEventMock } = vi.hoisted(() => ({
  listMealsMock: vi.fn(async () => []),
  retrieveWhatsappContextMemoryMock: vi.fn(() => ({ llmContext: [] })),
  findRecentMessagesByUserMock: vi.fn(async () => []),
  getOrRefreshConversationSummaryMock: vi.fn(async () => null),
  logInferenceEventMock: vi.fn(),
}));

vi.mock("../meals/service", () => ({ listMeals: listMealsMock }));
vi.mock("./contextMemory", () => ({ retrieveWhatsappContextMemory: retrieveWhatsappContextMemoryMock }));
vi.mock("../../repositories/whatsappConversationRepository", async importOriginal => {
  const actual = await importOriginal<typeof import("../../repositories/whatsappConversationRepository")>();
  return {
    ...actual,
    createDrizzleWhatsAppConversationRepository: () => ({ findRecentMessagesByUser: findRecentMessagesByUserMock }),
  };
});
vi.mock("./conversationSummaryService", () => ({ getOrRefreshConversationSummary: getOrRefreshConversationSummaryMock }));
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  logPersistenceWarning: vi.fn(),
  logInferenceEvent: logInferenceEventMock,
}));

import { buildWhatsappIntentContext } from "./intentContext";

const originalEnv = { ...process.env };

function buildMessage(overrides: Partial<WhatsAppConversationMessageRecord> & { id: number; occurredAt: Date }): WhatsAppConversationMessageRecord {
  return {
    id: overrides.id,
    conversationId: 1,
    userId: 1,
    direction: "inbound",
    channel: "whatsapp",
    externalMessageId: `wamid.${overrides.id}`,
    idempotencyKey: `whatsapp:inbound:wamid.${overrides.id}`,
    contentType: "text",
    rawTextStored: false,
    text: null,
    sanitizedText: null,
    transcript: null,
    sanitizedTranscript: null,
    mediaStorageKey: null,
    mediaMimeType: null,
    captionText: null,
    privacyPolicyVersion: null,
    retentionExpiresAt: null,
    respondsToMessageId: null,
    processedAt: null,
    createdAt: overrides.occurredAt,
    updatedAt: overrides.occurredAt,
    ...overrides,
  } as WhatsAppConversationMessageRecord;
}

describe("buildWhatsappIntentContext", () => {
  const receivedAt = new Date("2026-07-11T12:00:00Z");

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      WHATSAPP_CONTEXT_READ_MODE: "persistent",
      WHATSAPP_CONTEXT_ROLLOUT_PERCENT: "100",
    };
    listMealsMock.mockReset();
    listMealsMock.mockResolvedValue([]);
    retrieveWhatsappContextMemoryMock.mockReset();
    retrieveWhatsappContextMemoryMock.mockReturnValue({ llmContext: [] });
    findRecentMessagesByUserMock.mockReset();
    findRecentMessagesByUserMock.mockResolvedValue([]);
    getOrRefreshConversationSummaryMock.mockReset();
    getOrRefreshConversationSummaryMock.mockResolvedValue(null);
    logInferenceEventMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("retorna contexto v2 vazio quando não há histórico persistido", async () => {
    const context = await buildWhatsappIntentContext(1, { receivedAt });
    expect(context.version).toBe("whatsapp-intent-context/v2");
    expect(context.recentTurns).toEqual([]);
    expect(context.conversationSummary).toBeNull();
    expect(context.truncated).toBe(false);
    expect(context.conversationActive).toBe(false);
  });

  it("mantém 2, 3, 4 e 8 interações dentro do orçamento sem gerar resumo quando cabem", async () => {
    for (const count of [2, 3, 4, 8]) {
      findRecentMessagesByUserMock.mockResolvedValue(
        Array.from({ length: count }, (_, i) =>
          buildMessage({ id: i + 1, sanitizedText: `mensagem ${i + 1}`, occurredAt: new Date(receivedAt.getTime() - (count - i) * 1000) }),
        ),
      );
      const context = await buildWhatsappIntentContext(1, { receivedAt });
      expect(context.recentTurns).toHaveLength(count);
      expect(context.truncated).toBe(false);
    }
  });

  it("mantém 10 interações inteiras dentro do orçamento", async () => {
    findRecentMessagesByUserMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        buildMessage({ id: i + 1, sanitizedText: `mensagem ${i + 1}`, occurredAt: new Date(receivedAt.getTime() - (10 - i) * 1000) }),
      ),
    );
    const context = await buildWhatsappIntentContext(1, { receivedAt });
    expect(context.truncated).toBe(false);
    expect(context.recentTurns).toHaveLength(10);
  });

  it("gera resumo quando há 20 interações", async () => {
    const count = 20;
    findRecentMessagesByUserMock.mockResolvedValue(
      Array.from({ length: count }, (_, i) =>
        buildMessage({ id: i + 1, sanitizedText: `mensagem ${i + 1}`, occurredAt: new Date(receivedAt.getTime() - (count - i) * 1000) }),
      ),
    );
    getOrRefreshConversationSummaryMock.mockResolvedValue({ summaryText: "resumo", fromMessageId: 1, toMessageId: count - 12 });
    const context = await buildWhatsappIntentContext(1, { receivedAt });
    expect(context.truncated).toBe(true);
    expect(context.recentTurns.length).toBeLessThan(count);
    expect(context.conversationSummary).toEqual({ summaryText: "resumo", fromMessageId: 1, toMessageId: count - 12 });
  });

  it("currentDomainSnapshot sempre consulta o banco, nunca o resumo", async () => {
    listMealsMock.mockResolvedValue([{ id: 99, mealLabel: "Almoço", occurredAt: receivedAt.toISOString(), items: [] }]);
    getOrRefreshConversationSummaryMock.mockResolvedValue({ summaryText: "usuário mencionou 999g de arroz ontem", fromMessageId: 1, toMessageId: 2 });
    findRecentMessagesByUserMock.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => buildMessage({ id: i + 1, sanitizedText: `msg ${i + 1}`, occurredAt: new Date(receivedAt.getTime() - (15 - i) * 1000) })),
    );
    const context = await buildWhatsappIntentContext(1, { receivedAt });
    expect(context.currentDomainSnapshot.latestMeal?.id).toBe(99);
    expect(listMealsMock).toHaveBeenCalledWith(1);
  });

  it("conversationActive é false quando a última mensagem é mais antiga que o TTL", async () => {
    findRecentMessagesByUserMock.mockResolvedValue([
      buildMessage({ id: 1, sanitizedText: "mensagem antiga", occurredAt: new Date(receivedAt.getTime() - WHATSAPP_CONVERSATION_ACTIVE_TTL_MS - 1000) }),
    ]);
    expect((await buildWhatsappIntentContext(1, { receivedAt })).conversationActive).toBe(false);
  });

  it("conversationActive é true quando a última mensagem está dentro do TTL", async () => {
    findRecentMessagesByUserMock.mockResolvedValue([
      buildMessage({ id: 1, sanitizedText: "mensagem recente", occurredAt: new Date(receivedAt.getTime() - 1000) }),
    ]);
    expect((await buildWhatsappIntentContext(1, { receivedAt })).conversationActive).toBe(true);
  });

  it("isola o histórico entre usuários diferentes", async () => {
    await buildWhatsappIntentContext(42, { receivedAt });
    expect(findRecentMessagesByUserMock).toHaveBeenCalledWith(42, expect.any(Number));
  });

  it("inclui texto, imagem e áudio na mesma janela recente", async () => {
    findRecentMessagesByUserMock.mockResolvedValue([
      buildMessage({ id: 1, contentType: "text", sanitizedText: "150g de arroz", occurredAt: new Date(receivedAt.getTime() - 3000) }),
      buildMessage({ id: 2, contentType: "image", captionText: "minha refeição", occurredAt: new Date(receivedAt.getTime() - 2000) }),
      buildMessage({ id: 3, contentType: "audio", sanitizedTranscript: "no jantar comi frango", occurredAt: new Date(receivedAt.getTime() - 1000) }),
    ]);
    const context = await buildWhatsappIntentContext(1, { receivedAt });
    expect(context.recentTurns.map(t => t.text)).toEqual(["150g de arroz", "minha refeição", "no jantar comi frango"]);
  });

  describe("observabilidade", () => {
    it("registra context_missing sem conteúdo de mensagem", async () => {
      await buildWhatsappIntentContext(1, { receivedAt });
      const call = logInferenceEventMock.mock.calls.find(([entry]) => entry.eventType === "whatsapp.history.context_missing");
      expect(call).toBeDefined();
      expect(JSON.parse(call![0].detail)).toEqual(expect.objectContaining({ messageCount: 0 }));
      expect(call![0].detail).not.toMatch(/arroz|frango|refeição/);
    });

    it("registra context_found e context_truncated", async () => {
      findRecentMessagesByUserMock.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) =>
          buildMessage({ id: i + 1, sanitizedText: `mensagem ${i + 1}`, occurredAt: new Date(receivedAt.getTime() - (20 - i) * 1000) }),
        ),
      );
      await buildWhatsappIntentContext(1, { receivedAt });
      const foundCall = logInferenceEventMock.mock.calls.find(([entry]) => entry.eventType === "whatsapp.history.context_found");
      expect(foundCall).toBeDefined();
      expect(JSON.parse(foundCall![0].detail)).toEqual(expect.objectContaining({ messageCount: 20 }));
      const truncatedCall = logInferenceEventMock.mock.calls.find(([entry]) => entry.eventType === "whatsapp.history.context_truncated");
      expect(truncatedCall).toBeDefined();
      const truncatedDetail = JSON.parse(truncatedCall![0].detail);
      expect(truncatedDetail.originalCount).toBe(20);
      expect(truncatedDetail.truncatedCount).toBeLessThan(20);
    });
  });
});
