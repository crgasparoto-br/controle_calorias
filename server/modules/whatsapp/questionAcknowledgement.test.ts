import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWithIrreversibleEffectFence } from "../../_core/effectFenceContext";

const sendWhatsAppLogicalReplyMock = vi.fn();
vi.mock("./replyTransport", () => ({
  sendWhatsAppLogicalReply: sendWhatsAppLogicalReplyMock,
}));

const recordCurrentQuestionAcknowledgementOutcomeMock = vi.fn();
vi.mock("./questionLatencyContext", () => ({
  recordCurrentQuestionAcknowledgementOutcome: recordCurrentQuestionAcknowledgementOutcomeMock,
}));

const {
  sendWhatsAppAiQuestionAcknowledgement,
  WHATSAPP_AI_QUESTION_ACK_REPLY,
} = await import("./questionAcknowledgement");

describe("sendWhatsAppAiQuestionAcknowledgement", () => {
  beforeEach(() => {
    sendWhatsAppLogicalReplyMock.mockReset();
    recordCurrentQuestionAcknowledgementOutcomeMock.mockReset();
  });

  it("usa posição idempotente própria e registra sucesso do ACK", async () => {
    sendWhatsAppLogicalReplyMock.mockResolvedValue({ primaryOk: true });

    const result = await sendWhatsAppAiQuestionAcknowledgement({
      to: "5511999999999",
      sourceMessageId: "wamid.1061",
    });

    expect(result).toBe(true);
    expect(sendWhatsAppLogicalReplyMock).toHaveBeenCalledWith(
      "5511999999999",
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ type: "text", body: WHATSAPP_AI_QUESTION_ACK_REPLY }),
        ]),
      }),
      undefined,
      {
        origin: "whatsapp.ai_question.ack",
        traceId: "wamid.1061:question-ack",
      },
    );
    expect(recordCurrentQuestionAcknowledgementOutcomeMock).toHaveBeenCalledWith(true);
  });


  it("nao envia ACK quando o runtime perdeu ownership antes do efeito", async () => {
    sendWhatsAppLogicalReplyMock.mockResolvedValue({ primaryOk: true });

    const result = await runWithIrreversibleEffectFence(
      async () => { throw new Error("processing_owner_lost"); },
      () => sendWhatsAppAiQuestionAcknowledgement({
        to: "5511999999999",
        sourceMessageId: "wamid.1061-stale-owner",
      }),
    );

    expect(result).toBe(false);
    expect(sendWhatsAppLogicalReplyMock).not.toHaveBeenCalled();
    expect(recordCurrentQuestionAcknowledgementOutcomeMock).toHaveBeenCalledWith(false);
  });

  it("trata falha do transporte como best-effort sem propagar erro", async () => {
    sendWhatsAppLogicalReplyMock.mockRejectedValue(new Error("falha sintética"));

    await expect(sendWhatsAppAiQuestionAcknowledgement({
      to: "5511999999999",
      sourceMessageId: "wamid.1061-fail",
    })).resolves.toBe(false);
    expect(recordCurrentQuestionAcknowledgementOutcomeMock).toHaveBeenCalledWith(false);
  });
});
