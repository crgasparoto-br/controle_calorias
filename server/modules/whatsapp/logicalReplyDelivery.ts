import { tryCreateQuickEditLinkForMeal } from "../quickEdit/service";
import { logicalReplyFromLegacyText, withAuxiliaryImage, type WhatsAppLogicalReply } from "./replyContract";
import { sendWhatsAppLogicalReply } from "./replyTransport";
import type { MessageLifecycleHandle } from "./messageLifecycle";
import { getCurrentWhatsappInboundExternalMessageId } from "./inboundCorrelationContext";
import {
  getCurrentQuestionLatencyTrace,
  recordCurrentQuestionDeliveryAttempt,
  recordCurrentQuestionDeliveryOutcome,
} from "./questionLatencyContext";
import {
  isRetryableQuestionDeliveryFailure,
  WHATSAPP_QUESTION_FINAL_RETRY_ORIGIN,
} from "./questionDeliveryRecovery";

export type WhatsAppAuxiliaryImage =
  | { url: string; caption: string }
  | { buffer: Buffer; mimeType?: string; fileName?: string; caption: string };

const QUICK_EDIT_CTA_BODY = "Precisa ajustar algum alimento?";

function canAppendQuickEditCta(reply: WhatsAppLogicalReply) {
  return reply.messages[0]?.type === "text";
}

function withQuickEditCta(reply: WhatsAppLogicalReply, url: string): WhatsAppLogicalReply {
  return {
    ...reply,
    messages: [
      ...reply.messages,
      {
        type: "cta_url",
        bodyText: QUICK_EDIT_CTA_BODY,
        buttonText: "Editar refeição",
        url,
      },
    ],
  };
}

function buildQuestionRetryTraceId(input: { lifecycleHandle?: MessageLifecycleHandle }) {
  const inboundId = getCurrentWhatsappInboundExternalMessageId();
  const stableRoot = inboundId
    ?? (input.lifecycleHandle ? `lifecycle:${input.lifecycleHandle.messageId}` : null);
  const requestId = getCurrentQuestionLatencyTrace()?.requestId;
  return stableRoot && requestId
    ? `${stableRoot}:question-final-retry:${requestId}`
    : undefined;
}

export async function buildWhatsAppLogicalReplyForDelivery(input: {
  userId: number; replyText: string; mealId?: number | null; logicalReply?: WhatsAppLogicalReply; auxiliaryImage?: WhatsAppAuxiliaryImage | null;
}) {
  let reply = input.logicalReply ?? logicalReplyFromLegacyText(input.replyText);
  if (input.mealId && canAppendQuickEditCta(reply)) {
    try {
      const link = await tryCreateQuickEditLinkForMeal({ userId: input.userId, mealId: input.mealId });
      if (link?.url) reply = withQuickEditCta(reply, link.url);
    } catch {
      // Quick edit is optional; the functional nutrition reply must still be delivered.
    }
  }
  if (input.auxiliaryImage) reply = withAuxiliaryImage(reply, input.auxiliaryImage);
  return reply;
}

export async function sendWhatsAppLogicalDomainReply(input: {
  to: string;
  userId: number;
  replyText: string;
  mealId?: number | null;
  logicalReply?: WhatsAppLogicalReply;
  auxiliaryImage?: WhatsAppAuxiliaryImage | null;
  lifecycleHandle?: MessageLifecycleHandle;
}) {
  const reply = await buildWhatsAppLogicalReplyForDelivery(input);
  const lifecycle = input.lifecycleHandle
    ? { handle: input.lifecycleHandle, userId: input.userId }
    : undefined;
  const questionTrace = getCurrentQuestionLatencyTrace();

  if (questionTrace) recordCurrentQuestionDeliveryAttempt(false);
  let result = await sendWhatsAppLogicalReply(input.to, reply, lifecycle);

  if (questionTrace && !result.primaryOk && isRetryableQuestionDeliveryFailure(result)) {
    const retryTraceId = buildQuestionRetryTraceId(input);
    if (retryTraceId) {
      recordCurrentQuestionDeliveryAttempt(true);
      result = await sendWhatsAppLogicalReply(input.to, reply, lifecycle, {
        origin: WHATSAPP_QUESTION_FINAL_RETRY_ORIGIN,
        traceId: retryTraceId,
      });
    }
  }

  recordCurrentQuestionDeliveryOutcome(result.primaryOk);
  return { reply, result };
}

/** Resposta funcional sem usuário/lifecycle, restrita a notificações e orientações sem inbound identificado. */
export async function sendWhatsAppStandaloneLogicalReply(to: string, reply: WhatsAppLogicalReply) {
  const result = await sendWhatsAppLogicalReply(to, reply);
  return { reply, result };
}

export async function sendWhatsAppStandaloneReply(to: string, replyText: string) {
  return sendWhatsAppStandaloneLogicalReply(to, logicalReplyFromLegacyText(replyText));
}