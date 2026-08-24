import { beforeEach, describe, expect, it, vi } from "vitest";

const logInferenceEventMock = vi.hoisted(() => vi.fn());

const repositoryMock = vi.hoisted(() => ({
  createOrGetActiveConversation: vi.fn(),
  appendMessage: vi.fn(),
  findByIdempotencyKey: vi.fn(),
  linkResponse: vi.fn(),
  linkDomainRecord: vi.fn(),
  findRecentMessages: vi.fn(),
  findRecentMessagesByUser: vi.fn(),
  findDomainLinksForMessage: vi.fn(),
  markProcessed: vi.fn(),
}));

vi.mock("../../repositories/whatsappConversationRepository", () => ({
  createDrizzleWhatsAppConversationRepository: () => repositoryMock,
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  logPersistenceWarning: vi.fn(),
  logInferenceEvent: logInferenceEventMock,
}));

import { beginInboundMessage, markMessageProcessed, recordDomainLink, recordOutboundReply, wasMessageAlreadyProcessed } from "./messageLifecycle";
import {
  recordCurrentQuestionAiStage,
  recordCurrentQuestionDeliveryOutcome,
  recordCurrentQuestionOutcome,
  runWithQuestionLatencyContext,
} from "./questionLatencyContext";

describe("whatsapp messageLifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cria a conversa e grava a mensagem de entrada, retornando o handle", async () => {
    repositoryMock.createOrGetActiveConversation.mockResolvedValue({ id: 10 });
    repositoryMock.appendMessage.mockResolvedValue({ message: { id: 100 }, wasNewInsert: true });

    const handle = await beginInboundMessage({
      userId: 1,
      whatsappConnectionId: null,
      phoneNumber: "5511999999999",
      externalMessageId: "wamid.abc",
      contentType: "text",
      text: "150g de frango",
      occurredAt: new Date("2026-07-11T12:00:00Z"),
    });

    expect(handle).toEqual({ conversationId: 10, messageId: 100, wasNewInsert: true });
    expect(repositoryMock.createOrGetActiveConversation).toHaveBeenCalledWith(1, null, "5511999999999");
    expect(repositoryMock.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 10, userId: 1, direction: "inbound", externalMessageId: "wamid.abc" }),
    );
  });

  it("retorna null quando não há conversa disponível (sem banco)", async () => {
    repositoryMock.createOrGetActiveConversation.mockResolvedValue(null);

    const handle = await beginInboundMessage({
      userId: 1,
      whatsappConnectionId: null,
      phoneNumber: "5511999999999",
      contentType: "text",
      occurredAt: new Date(),
    });

    expect(handle).toBeNull();
    expect(repositoryMock.appendMessage).not.toHaveBeenCalled();
  });

  it("reentrega do mesmo externalMessageId retorna o mesmo handle (idempotência delegada ao repositório)", async () => {
    repositoryMock.createOrGetActiveConversation.mockResolvedValue({ id: 10 });
    repositoryMock.appendMessage
      .mockResolvedValueOnce({ message: { id: 100 }, wasNewInsert: true })
      .mockResolvedValueOnce({ message: { id: 100 }, wasNewInsert: false });

    const input = {
      userId: 1,
      whatsappConnectionId: null,
      phoneNumber: "5511999999999",
      externalMessageId: "wamid.redelivered",
      contentType: "text" as const,
      text: "150g de frango",
      occurredAt: new Date("2026-07-11T12:00:00Z"),
    };

    const first = await beginInboundMessage(input);
    const second = await beginInboundMessage(input);

    expect(first).toEqual({ conversationId: 10, messageId: 100, wasNewInsert: true });
    expect(second).toEqual({ conversationId: 10, messageId: 100, wasNewInsert: false });
  });

  it("isola conversas/mensagens entre usuários diferentes", async () => {
    repositoryMock.createOrGetActiveConversation
      .mockResolvedValueOnce({ id: 10 })
      .mockResolvedValueOnce({ id: 20 });
    repositoryMock.appendMessage
      .mockResolvedValueOnce({ message: { id: 100 }, wasNewInsert: true })
      .mockResolvedValueOnce({ message: { id: 200 }, wasNewInsert: true });

    const handleA = await beginInboundMessage({
      userId: 1, whatsappConnectionId: null, phoneNumber: "5511111111111",
      contentType: "text", text: "a", occurredAt: new Date(),
    });
    const handleB = await beginInboundMessage({
      userId: 2, whatsappConnectionId: null, phoneNumber: "5511222222222",
      contentType: "text", text: "b", occurredAt: new Date(),
    });

    expect(handleA).toEqual({ conversationId: 10, messageId: 100, wasNewInsert: true });
    expect(handleB).toEqual({ conversationId: 20, messageId: 200, wasNewInsert: true });
  });

  it("detecta mensagem já processada (reentrega com domínio já vinculado) — issue #767", async () => {
    repositoryMock.findDomainLinksForMessage.mockResolvedValue([{ id: 1, messageId: 100, mealId: 42 }]);

    const alreadyProcessed = await wasMessageAlreadyProcessed({ conversationId: 10, messageId: 100, wasNewInsert: false });
    expect(alreadyProcessed).toBe(true);

    const freshInsert = await wasMessageAlreadyProcessed({ conversationId: 10, messageId: 100, wasNewInsert: true });
    expect(freshInsert).toBe(false);

    expect(await wasMessageAlreadyProcessed(null)).toBe(false);
  });

  it("grava a resposta de saída e vincula à mensagem de entrada", async () => {
    repositoryMock.appendMessage.mockResolvedValue({ message: { id: 101 }, wasNewInsert: true });

    await recordOutboundReply({ conversationId: 10, messageId: 100, wasNewInsert: true }, { userId: 1, text: "Registrado!" });

    expect(repositoryMock.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 10,
        userId: 1,
        direction: "outbound",
        contentType: "text",
        text: "Registrado!",
        respondsToMessageId: 100,
      }),
    );
    expect(repositoryMock.linkResponse).toHaveBeenCalledWith(100, 101);
  });

  it("não faz nada ao gravar resposta quando o handle é nulo (sem banco)", async () => {
    await recordOutboundReply(null, { userId: 1, text: "Registrado!" });

    expect(repositoryMock.appendMessage).not.toHaveBeenCalled();
    expect(repositoryMock.linkResponse).not.toHaveBeenCalled();
  });

  it("vincula a mensagem a um registro de domínio (refeição)", async () => {
    await recordDomainLink({ conversationId: 10, messageId: 100, wasNewInsert: true }, { mealId: 42 });

    expect(repositoryMock.linkDomainRecord).toHaveBeenCalledWith(100, { mealId: 42 });
  });

  it("não vincula domínio quando nenhum id de domínio é informado", async () => {
    await recordDomainLink({ conversationId: 10, messageId: 100, wasNewInsert: true }, {});

    expect(repositoryMock.linkDomainRecord).not.toHaveBeenCalled();
  });

  it("marca a mensagem como processada", async () => {
    const processedAt = new Date("2026-07-11T12:05:00Z");
    await markMessageProcessed({ conversationId: 10, messageId: 100, wasNewInsert: true }, processedAt);

    expect(repositoryMock.markProcessed).toHaveBeenCalledWith(100, processedAt);
  });

  it("não faz nada ao marcar processada quando o handle é nulo", async () => {
    await markMessageProcessed(null);

    expect(repositoryMock.markProcessed).not.toHaveBeenCalled();
  });

  it("mede persistência real e só fecha a latência QUESTION após markProcessed", async () => {
    repositoryMock.createOrGetActiveConversation.mockResolvedValue({ id: 10 });
    repositoryMock.appendMessage.mockResolvedValue({ message: { id: 100 }, wasNewInsert: true });
    repositoryMock.markProcessed.mockResolvedValue(undefined);

    await runWithQuestionLatencyContext(async () => {
      const handle = await beginInboundMessage({
        userId: 1,
        whatsappConnectionId: null,
        phoneNumber: "5511999999999",
        externalMessageId: "wamid.question-latency",
        contentType: "text",
        text: "/ quanto de proteína devo consumir?",
        occurredAt: new Date("2026-08-17T18:00:00Z"),
      });
      recordCurrentQuestionAiStage({
        contextScope: "full",
        dbMs: 3,
        contextMs: 4,
        llmMs: 5,
        configuredProvider: "openai",
        configuredModel: "gpt-test",
        effectiveProvider: "openai",
        effectiveModel: "gpt-test",
        attempts: 1,
        fallbackOccurred: false,
        webSearchAvailable: true,
        webSearchExecuted: false,
      });
      recordCurrentQuestionOutcome("success", null);
      recordCurrentQuestionDeliveryOutcome(true);

      expect(logInferenceEventMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ eventType: "whatsapp.ai_question.latency" }),
      );
      await markMessageProcessed(handle);
    });

    const latencyCall = logInferenceEventMock.mock.calls.find(([event]) => event.eventType === "whatsapp.ai_question.latency");
    expect(latencyCall).toBeDefined();
    const payload = JSON.parse(latencyCall![0].detail);
    expect(payload).toEqual(expect.objectContaining({
      schemaVersion: 2,
      boundary: "inbound_persistence_to_processed_reply",
      context_scope: "full",
      persist_ms: expect.any(Number),
      total_ms: expect.any(Number),
      delivery_ok: true,
      outcome: "success",
      error_code: null,
    }));
    expect(payload.total_ms).toBeGreaterThanOrEqual(payload.persist_ms);
  });

  it("inclui falha de persistência no mesmo evento fim a fim em vez de descartá-la", async () => {
    repositoryMock.createOrGetActiveConversation.mockResolvedValue({ id: 10 });
    repositoryMock.appendMessage.mockResolvedValue({ message: { id: 100 }, wasNewInsert: true });
    repositoryMock.markProcessed.mockRejectedValueOnce(new Error("synthetic persistence failure"));

    await expect(runWithQuestionLatencyContext(async () => {
      const handle = await beginInboundMessage({
        userId: 1,
        whatsappConnectionId: null,
        phoneNumber: "5511999999999",
        externalMessageId: "wamid.question-latency-failure",
        contentType: "text",
        text: "/ como está meu consumo hoje?",
        occurredAt: new Date("2026-08-17T18:00:00Z"),
      });
      recordCurrentQuestionOutcome("success", null);
      recordCurrentQuestionDeliveryOutcome(true);
      await markMessageProcessed(handle);
    })).rejects.toThrow("synthetic persistence failure");

    const latencyCall = logInferenceEventMock.mock.calls.find(([event]) => event.eventType === "whatsapp.ai_question.latency");
    expect(latencyCall).toBeDefined();
    const payload = JSON.parse(latencyCall![0].detail);
    expect(payload).toEqual(expect.objectContaining({
      persist_ms: expect.any(Number),
      outcome: "error",
      error_code: "persistence_failed",
    }));
  });
});
