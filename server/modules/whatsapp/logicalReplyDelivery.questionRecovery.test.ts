import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../quickEdit/service", () => ({
  tryCreateQuickEditLinkForMeal: vi.fn(async () => null),
}));

const sendWhatsAppLogicalReplyMock = vi.fn();
vi.mock("./replyTransport", () => ({
  sendWhatsAppLogicalReply: sendWhatsAppLogicalReplyMock,
}));

const recordCurrentQuestionDeliveryAttemptMock = vi.fn();
const recordCurrentQuestionDeliveryOutcomeMock = vi.fn();
vi.mock("./questionLatencyContext", () => ({
  getCurrentQuestionLatencyTrace: () => ({ requestId: "request-1061" }),
  recordCurrentQuestionDeliveryAttempt: recordCurrentQuestionDeliveryAttemptMock,
  recordCurrentQuestionDeliveryOutcome: recordCurrentQuestionDeliveryOutcomeMock,
}));

vi.mock("./inboundCorrelationContext", () => ({
  getCurrentWhatsappInboundExternalMessageId: () => "wamid.1061",
}));

const { sendWhatsAppLogicalDomainReply } = await import("./logicalReplyDelivery");

function failedNetworkResult() {
  return {
    ok: false,
    primaryOk: false,
    primaryEffectiveOk: false,
    recorded: false,
    sends: [{
      message: { type: "text", body: "resposta" },
      role: "primary",
      originalOk: false,
      usedFallback: false,
      effectiveOk: false,
      category: "network",
      sequenceDecision: "stop",
      ok: false,
      detail: "network failure",
    }],
  };
}

function successfulResult() {
  return {
    ok: true,
    primaryOk: true,
    primaryEffectiveOk: true,
    recorded: true,
    sends: [{
      message: { type: "text", body: "resposta" },
      role: "primary",
      originalOk: true,
      usedFallback: false,
      effectiveOk: true,
      category: "none",
      sequenceDecision: "complete",
      ok: true,
      detail: "ok",
    }],
  };
}

describe("question final delivery recovery", () => {
  beforeEach(() => {
    sendWhatsAppLogicalReplyMock.mockReset();
    recordCurrentQuestionDeliveryAttemptMock.mockReset();
    recordCurrentQuestionDeliveryOutcomeMock.mockReset();
  });

  it("faz uma recuperação imediata com identidade física distinta após falha transitória", async () => {
    sendWhatsAppLogicalReplyMock
      .mockResolvedValueOnce(failedNetworkResult())
      .mockResolvedValueOnce(successfulResult());

    const result = await sendWhatsAppLogicalDomainReply({
      to: "5511999999999",
      userId: 1,
      replyText: "resposta",
      lifecycleHandle: { conversationId: 7, messageId: 11, wasNewInsert: true },
    });

    expect(result.result.primaryOk).toBe(true);
    expect(sendWhatsAppLogicalReplyMock).toHaveBeenCalledTimes(2);
    expect(sendWhatsAppLogicalReplyMock.mock.calls[1]?.[3]).toEqual({
      origin: "whatsapp.ai_question.final_retry",
      traceId: "wamid.1061:question-final-retry:request-1061",
    });
    expect(recordCurrentQuestionDeliveryAttemptMock.mock.calls).toEqual([[false], [true]]);
    expect(recordCurrentQuestionDeliveryOutcomeMock).toHaveBeenCalledWith(true);
  });

  it("não repete falha determinística de configuração", async () => {
    const deterministic = failedNetworkResult();
    deterministic.sends[0].category = "config";
    sendWhatsAppLogicalReplyMock.mockResolvedValueOnce(deterministic);

    const result = await sendWhatsAppLogicalDomainReply({
      to: "5511999999999",
      userId: 1,
      replyText: "resposta",
      lifecycleHandle: { conversationId: 7, messageId: 11, wasNewInsert: true },
    });

    expect(result.result.primaryOk).toBe(false);
    expect(sendWhatsAppLogicalReplyMock).toHaveBeenCalledTimes(1);
    expect(recordCurrentQuestionDeliveryAttemptMock.mock.calls).toEqual([[false]]);
    expect(recordCurrentQuestionDeliveryOutcomeMock).toHaveBeenCalledWith(false);
  });
});
