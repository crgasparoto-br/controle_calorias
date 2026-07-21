/**
 * Ponto único de roteamento por precedência do WhatsApp.
 *
 * Ordem efetiva:
 * 1. callback interativo válido;
 * 2. pergunta explícita iniciada por `/`;
 * 3. resposta curta compatível com pendência destrutiva;
 * 4. novo comando destrutivo completo, que substitui pendência incompatível;
 * 5. resolução de pendência alimentar persistida;
 * 6. confirmação genérica e demais intents.
 */
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { getDb, logPersistenceWarning } from "../../db";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";
import { executeWhatsappAiQuestionIntent, isWhatsappAiQuestionText } from "./aiQuestionAssistant";
import { handlePendingWhatsAppConfirmation, completeWhatsappGenericConfirmationCallback, PENDING_CONFIRMATION_TYPE } from "./webhookTextCommands";
import { claimWhatsAppInteractiveCallback } from "./interactiveCallback";
import {
  completeWhatsappDeleteInteractiveCallback,
  executeWhatsappDeleteIntent,
  PENDING_DELETE_TYPE,
} from "./deleteIntent";
import { completeMealItemSelectionInteractiveCallback, PENDING_MEAL_ITEM_SELECTION_TYPE } from "./mealItemSelectionCallback";
import {
  completeWhatsappPeriodReportCallback,
  isExpectedWhatsappPeriodReportAction,
  PENDING_PERIOD_REPORT_TYPE,
} from "./periodReportClarification";
import {
  completeClaimedWhatsappFoodClarificationCallback,
  isExpectedWhatsappFoodClarificationAction,
  isPendingFoodClarificationTarget,
  PENDING_FOOD_CLARIFICATION_TYPE,
  type WhatsappFoodClarificationResult,
} from "./foodClarification";
import { resolvePendingWhatsappFoodClarification } from "./foodClarificationGate";
import { buildWhatsAppCallbackUnavailableReplyMessage } from "./replyMessages";
import type { WhatsAppWebhookMessage } from "./webhookUtils";

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

const PENDING_PROFESSIONAL_ACCESS_TYPE = "professional_access";

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
  | { step: "food_clarification"; result: WhatsappFoodClarificationResult }
  | { step: "generic_confirmation"; result: NonNullable<Awaited<ReturnType<typeof handlePendingWhatsAppConfirmation>>> }
  | { step: "continue_pipeline" };

function buildUnavailableInteractiveCallbackResult(): WhatsAppInteractiveCallbackResult {
  return {
    handled: true,
    reply: buildWhatsAppCallbackUnavailableReplyMessage(),
    eventType: "whatsapp.interactive_callback.unavailable",
    detail: "Callback de botão/lista inválido, expirado, já consumido ou cancelado.",
  };
}

async function resolveWhatsAppInteractiveCallback(
  userId: number,
  interactiveReplyId: string,
  receivedAt?: Date,
  sourcePhone?: string | null,
  userTimezone?: string | null,
): Promise<WhatsAppInteractiveCallbackResult> {
  const expectedTypes = [
    PENDING_DELETE_TYPE,
    PENDING_MEAL_ITEM_SELECTION_TYPE,
    PENDING_CONFIRMATION_TYPE,
    PENDING_PROFESSIONAL_ACCESS_TYPE,
    PENDING_PERIOD_REPORT_TYPE,
    PENDING_FOOD_CLARIFICATION_TYPE,
  ] as const;
  const claim = await claimWhatsAppInteractiveCallback(userId, interactiveReplyId, receivedAt, {
    sourcePhone,
    expectedTypes,
    isExpectedAction: (type, action, pendingOperation) => {
      if (type === PENDING_PROFESSIONAL_ACCESS_TYPE) return action === "authorize" || action === "reject";
      if (type === PENDING_CONFIRMATION_TYPE) return action === "confirm" || action === "cancel";
      if (type === PENDING_PERIOD_REPORT_TYPE) return isExpectedWhatsappPeriodReportAction(action);
      if (type === PENDING_FOOD_CLARIFICATION_TYPE) {
        return isPendingFoodClarificationTarget(pendingOperation.target)
          && isExpectedWhatsappFoodClarificationAction(pendingOperation.target, action);
      }
      if (type === PENDING_DELETE_TYPE || type === PENDING_MEAL_ITEM_SELECTION_TYPE) {
        return action === "confirm" || action === "cancel" || /^select:\d+$/.test(action);
      }
      return false;
    },
  });
  if (claim.status !== "claimed") {
    return buildUnavailableInteractiveCallbackResult();
  }

  switch (claim.pendingOperation.type) {
    case PENDING_DELETE_TYPE:
      return completeWhatsappDeleteInteractiveCallback(userId, claim.pendingOperation, claim.action, userTimezone ?? undefined);
    case PENDING_MEAL_ITEM_SELECTION_TYPE:
      return completeMealItemSelectionInteractiveCallback(userId, claim.pendingOperation, claim.action);
    case PENDING_CONFIRMATION_TYPE:
      return completeWhatsappGenericConfirmationCallback(userId, claim.pendingOperation, claim.action);
    case PENDING_PERIOD_REPORT_TYPE:
      return completeWhatsappPeriodReportCallback(userId, claim.action, receivedAt);
    case PENDING_FOOD_CLARIFICATION_TYPE:
      return completeClaimedWhatsappFoodClarificationCallback({
        userId,
        pendingOperation: claim.pendingOperation,
        action: claim.action,
        receivedAt,
        userTimezone,
      });
    case PENDING_PROFESSIONAL_ACCESS_TYPE: {
      const { completeWhatsAppProfessionalAccessCallback } = await import("../professionals/service");
      return completeWhatsAppProfessionalAccessCallback(userId, claim.pendingOperation, claim.action);
    }
    default:
      return buildUnavailableInteractiveCallbackResult();
  }
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
    if (result) {
      return { step: "ai_question", result };
    }
  }

  const deleteIntent = await executeWhatsappDeleteIntent(input.userId, {
    text: input.text,
    receivedAt: input.receivedAt,
    timeZone: input.userTimezone,
    entrypoint: "messageRouter.precedenceGate",
  });
  if (deleteIntent) {
    return { step: "delete_intent", result: deleteIntent };
  }

  const foodClarification = await resolvePendingWhatsappFoodClarification({
    userId: input.userId,
    text: input.text,
    receivedAt: input.receivedAt,
    userTimezone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
    messageId: input.messageId,
  });
  if (foodClarification) {
    return { step: "food_clarification", result: foodClarification };
  }

  const pending = await pendingOperationRepository.getActivePendingOperation(input.userId, input.receivedAt);
  if (pending && pending.type === PENDING_CONFIRMATION_TYPE) {
    const message: WhatsAppWebhookMessage = { text: { body: input.text ?? "" } };
    const result = await handlePendingWhatsAppConfirmation(message, input.userId);
    if (result) {
      return { step: "generic_confirmation", result };
    }
  }

  return { step: "continue_pipeline" };
}
