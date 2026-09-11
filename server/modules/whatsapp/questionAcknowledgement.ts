import { logicalReplyFromLegacyText } from "./replyContract";
import { sendWhatsAppLogicalReply } from "./replyTransport";
import { recordCurrentQuestionAcknowledgementOutcome } from "./questionLatencyContext";

export const WHATSAPP_AI_QUESTION_ACK_REPLY = "✅ Recebi sua pergunta. Estou preparando a resposta…";

export async function sendWhatsAppAiQuestionAcknowledgement(input: {
  to: string;
  sourceMessageId: string;
}) {
  try {
    const result = await sendWhatsAppLogicalReply(
      input.to,
      logicalReplyFromLegacyText(WHATSAPP_AI_QUESTION_ACK_REPLY),
      undefined,
      {
        origin: "whatsapp.ai_question.ack",
        traceId: `${input.sourceMessageId}:question-ack`,
      },
    );
    recordCurrentQuestionAcknowledgementOutcome(result.primaryOk);
    return result.primaryOk;
  } catch {
    recordCurrentQuestionAcknowledgementOutcome(false);
    return false;
  }
}
