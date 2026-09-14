import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoverableWhatsappQuestion } from "../../repositories/whatsappQuestionRecoveryRepository";

const mocks = vi.hoisted(() => ({
  wasProcessed: vi.fn(),
  claim: vi.fn(),
  begin: vi.fn(),
  markProcessed: vi.fn(),
  resolveGate: vi.fn(),
  sendReply: vi.fn(),
  recordTurn: vi.fn(),
  logInference: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: async () => null,
  logPersistenceWarning: vi.fn(),
  logInferenceEvent: mocks.logInference,
}));
vi.mock("./messageLifecycle", () => ({
  beginInboundMessage: mocks.begin,
  claimMessageForProcessingState: mocks.claim,
  markMessageProcessed: mocks.markProcessed,
  wasMessageAlreadyProcessed: mocks.wasProcessed,
  runWithMessageLifecycleRequestScope: async (operation: () => Promise<unknown>) => operation(),
}));
vi.mock("./messageRouter", () => ({
  resolveWhatsAppPrecedenceGate: mocks.resolveGate,
}));
vi.mock("./logicalReplyDelivery", () => ({
  sendWhatsAppLogicalDomainReply: mocks.sendReply,
}));
vi.mock("./conversationHistory", () => ({
  recordConversationTurn: mocks.recordTurn,
}));
vi.mock("./timeZoneContext", () => ({
  resolveWhatsAppOperationTimeZone: vi.fn(async () => ({
    timeZone: "America/Sao_Paulo",
    source: "default",
  })),
}));
vi.mock("./questionLatencyContext", () => ({
  runWithQuestionLatencyContext: <T>(operation: () => T) => operation(),
}));

const {
  recoverPendingWhatsappQuestion,
  runWhatsappQuestionRecoveryCycle,
} = await import("./questionRecovery");

const candidate: RecoverableWhatsappQuestion = {
  messageId: 1061,
  conversationId: 77,
  userId: 42,
  phoneNumber: "5511999999999",
  externalMessageId: "wamid.question-recovery-1061",
  text: "/ Qual opção para um jantar rico em proteínas?",
  occurredAt: new Date("2026-09-13T23:56:24.000Z"),
};

function aiQuestionResult() {
  return {
    step: "ai_question" as const,
    result: {
      handled: true as const,
      action: "ai_question_answered" as const,
      reply: "Uma opção é frango grelhado com legumes.",
      eventType: "whatsapp.ai_question.answered",
      detail: "Pergunta respondida.",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.begin.mockResolvedValue({
    conversationId: candidate.conversationId,
    messageId: candidate.messageId,
    wasNewInsert: false,
  });
  mocks.wasProcessed.mockResolvedValue(false);
  mocks.claim.mockResolvedValue("recovered");
  mocks.resolveGate.mockResolvedValue(aiQuestionResult());
  mocks.sendReply.mockResolvedValue({
    result: { primaryOk: true, ok: true },
  });
  mocks.markProcessed.mockResolvedValue(undefined);
});

describe("#1061 — recovery durável de QUESTION", () => {
  it("retoma um inbound persistido sem depender de novo POST da Meta", async () => {
    const repository = {
      findRecoverableQuestions: vi.fn(async () => [candidate]),
    };

    const result = await runWhatsappQuestionRecoveryCycle({
      repository,
      now: new Date("2026-09-14T00:00:00.000Z"),
      horizonMs: 20 * 60 * 1000,
      limit: 10,
    });

    expect(repository.findRecoverableQuestions).toHaveBeenCalledTimes(1);
    expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({
      externalMessageId: candidate.externalMessageId,
      text: candidate.text,
      phoneNumber: candidate.phoneNumber,
    }));
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.resolveGate).toHaveBeenCalledWith(expect.objectContaining({
      userId: candidate.userId,
      text: candidate.text,
      sourcePhone: candidate.phoneNumber,
      messageId: candidate.externalMessageId,
    }));
    expect(mocks.sendReply).toHaveBeenCalledWith(expect.objectContaining({
      to: candidate.phoneNumber,
      userId: candidate.userId,
      replyText: "Uma opção é frango grelhado com legumes.",
    }));
    expect(mocks.markProcessed).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      candidates: 1,
      outcomes: [{ messageId: 1061, outcome: "recovered" }],
    });
  });

  it("não rouba owner ainda ativo", async () => {
    mocks.claim.mockResolvedValue("inflight");

    await expect(recoverPendingWhatsappQuestion(candidate)).resolves.toBe("inflight");

    expect(mocks.resolveGate).not.toHaveBeenCalled();
    expect(mocks.sendReply).not.toHaveBeenCalled();
    expect(mocks.markProcessed).not.toHaveBeenCalled();
  });

  it("finaliza processedAt sob ownership sem duplicar IA/outbound quando a resposta funcional já foi persistida", async () => {
    mocks.wasProcessed.mockResolvedValue(true);

    await expect(recoverPendingWhatsappQuestion(candidate)).resolves.toBe("completed_existing");

    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.resolveGate).not.toHaveBeenCalled();
    expect(mocks.sendReply).not.toHaveBeenCalled();
    expect(mocks.markProcessed).toHaveBeenCalledTimes(1);
  });

  it("não rouba owner ativo mesmo quando a resposta funcional já está persistida", async () => {
    mocks.wasProcessed.mockResolvedValue(true);
    mocks.claim.mockResolvedValue("inflight");

    await expect(recoverPendingWhatsappQuestion(candidate)).resolves.toBe("inflight");

    expect(mocks.resolveGate).not.toHaveBeenCalled();
    expect(mocks.sendReply).not.toHaveBeenCalled();
    expect(mocks.markProcessed).not.toHaveBeenCalled();
  });

  it("mantém o inbound pendente quando a resposta final não foi entregue", async () => {
    mocks.sendReply.mockResolvedValue({
      result: { primaryOk: false, ok: false },
    });

    await expect(recoverPendingWhatsappQuestion(candidate)).resolves.toBe("delivery_pending");

    expect(mocks.resolveGate).toHaveBeenCalledTimes(1);
    expect(mocks.markProcessed).not.toHaveBeenCalled();
  });
});
