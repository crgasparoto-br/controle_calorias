/**
 * Ponto único de precedência do WhatsApp.
 *
 * O registro executável de interações é a fonte única de tipos, ações e
 * resolvedores de callbacks. Respostas textuais a pendências passam pelo mesmo
 * gate no webhook real, no áudio transcrito e no simulador.
 */
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { executeWhatsappAiQuestionIntent, isWhatsappAiQuestionText } from "./aiQuestionAssistant";
import { executeWhatsappDeleteIntent } from "./deleteIntent";
import { resolvePendingWhatsappFoodClarification } from "./foodClarificationGate";
import { claimWhatsAppInteractiveCallback } from "./interactiveCallback";
import {
  completeWhatsappRegisteredCallback,
  describeWhatsappRegisteredInteraction,
  isExpectedWhatsappRegisteredAction,
  listWhatsappRegisteredPendingTypes,
} from "./interactionRegistry";
import { buildWhatsAppCallbackUnavailableReplyMessage } from "./replyMessages";

export type WhatsAppInteractiveCallbackResult = {
  handled: true;
  action?: string;
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  interactiveReply?: import("./replyContract").WhatsAppLogicalReply;
};

export type WhatsAppPrecedenceGateResult =
  | { step: "ai_question"; result: NonNullable<Awaited<ReturnType<typeof executeWhatsappAiQuestionIntent>>> }
  | { step: "interactive_callback"; result: WhatsAppInteractiveCallbackResult }
  | { step: "delete_intent"; result: NonNullable<Awaited<ReturnType<typeof executeWhatsappDeleteIntent>>> }
  | { step: "pending_interaction"; result: WhatsAppInteractiveCallbackResult }
  | { step: "continue_pipeline" };

function buildUnavailableInteractiveCallbackResult(reason = "invalid_or_unavailable"): WhatsAppInteractiveCallbackResult {
  return {
    handled: true,
    reply: buildWhatsAppCallbackUnavailableReplyMessage(),
    eventType: "whatsapp.interactive_callback.unavailable",
    detail: `Callback bloqueado antes de qualquer classificador ou fallback. reason=${reason}`,
    data: { callbackBlocked: true, callbackBlockReason: reason },
  };
}

async function resolveWhatsAppInteractiveCallback(
  userId: number,
  interactiveReplyId: string,
  receivedAt?: Date,
  sourcePhone?: string | null,
  userTimezone?: string | null,
): Promise<WhatsAppInteractiveCallbackResult> {
  const claim = await claimWhatsAppInteractiveCallback(userId, interactiveReplyId, receivedAt, {
    sourcePhone,
    expectedTypes: listWhatsappRegisteredPendingTypes(),
    isExpectedAction: isExpectedWhatsappRegisteredAction,
  });
  if (claim.status !== "claimed") {
    return buildUnavailableInteractiveCallbackResult(claim.status);
  }

  const description = describeWhatsappRegisteredInteraction(claim.pendingOperation);
  const completed = await completeWhatsappRegisteredCallback({
    userId,
    pendingOperation: claim.pendingOperation,
    action: claim.action,
    receivedAt,
    userTimezone,
  });
  if (!completed) return buildUnavailableInteractiveCallbackResult("unregistered_dispatch");
  const completedResult = completed as WhatsAppInteractiveCallbackResult;

  return {
    ...completedResult,
    detail: `${completedResult.detail} interaction=${JSON.stringify({
      interactionId: description?.interaction.id ?? null,
      origin: description?.interaction.origin ?? claim.pendingOperation.origin,
      classification: description?.interaction.classification ?? null,
      component: description?.component ?? null,
      actionCount: description?.actions.length ?? null,
      lifecycle: "consumed",
    })}`,
    data: {
      ...(completedResult.data ?? {}),
      pendingOperationId: claim.pendingOperation.id,
      pendingType: claim.pendingOperation.type,
      interactionId: description?.interaction.id ?? null,
      interactionComponent: description?.component ?? null,
      interactionActionCount: description?.actions.length ?? null,
      callbackBlocked: false,
    },
  };
}

export async function resolveWhatsAppPrecedenceGate(input: {
  userId: number;
  text?: string | null;
  receivedAt?: Date;
  userTimezone?: string | null;
  interactiveReplyId?: string | null;
  sourcePhone?: string | null;
  messageId?: string | null;
}): Promise<WhatsAppPrecedenceGateResult> {
  if (input.interactiveReplyId) {
    const result = await resolveWhatsAppInteractiveCallback(
      input.userId,
      input.interactiveReplyId,
      input.receivedAt,
      input.sourcePhone,
      input.userTimezone,
    );
    return { step: "interactive_callback", result };
  }

  if (isWhatsappAiQuestionText(input.text)) {
    const result = await executeWhatsappAiQuestionIntent(input.userId, {
      text: input.text,
      receivedAt: input.receivedAt,
      userTimezone: input.userTimezone,
    });
    if (result) return { step: "ai_question", result };
  }

  const deleteIntent = await executeWhatsappDeleteIntent(input.userId, {
    text: input.text,
    receivedAt: input.receivedAt,
    timeZone: input.userTimezone,
    entrypoint: "messageRouter.precedenceGate",
  });
  if (deleteIntent) return { step: "delete_intent", result: deleteIntent };

  const pendingInteraction = await resolvePendingWhatsappFoodClarification({
    userId: input.userId,
    text: input.text,
    receivedAt: input.receivedAt,
    userTimezone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
    messageId: input.messageId,
  });
  if (pendingInteraction) {
    return { step: "pending_interaction", result: pendingInteraction };
  }

  return { step: "continue_pipeline" };
}
