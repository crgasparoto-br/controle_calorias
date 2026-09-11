import type { WhatsAppLogicalReplySendResult } from "./replyTransport";

export const WHATSAPP_QUESTION_FINAL_RETRY_ORIGIN = "whatsapp.ai_question.final_retry";

export function isRetryableQuestionDeliveryFailure(result: WhatsAppLogicalReplySendResult) {
  const primary = result.sends[0];
  if (!primary || primary.effectiveOk) return false;
  if (primary.category === "network") return true;
  if (primary.category !== "provider") return false;

  const status = primary.providerStatus;
  return status === 408
    || status === 409
    || status === 425
    || status === 429
    || (typeof status === "number" && status >= 500);
}

export class WhatsAppQuestionDeliveryRetryableError extends Error {
  readonly code = "whatsapp_question_delivery_retryable";

  constructor() {
    super("WhatsApp question final reply was not delivered; inbound remains retryable.");
    this.name = "WhatsAppQuestionDeliveryRetryableError";
  }
}
