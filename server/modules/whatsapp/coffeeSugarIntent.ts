import { isCoffeeWithAddedSugar } from "../../foodSemanticCompatibility";
import { executeConfirmedWhatsAppMealRegistration } from "./confirmedMealRegistration";
import { requestWhatsappCaloricComplementQuantityClarification } from "./foodQuantityClarification";
import type { WhatsappIntentResult } from "./intent/types";
import { buildWhatsAppRecoverableErrorReplyMessage } from "./replyMessages";

export function isCoffeeSugarRegistrationText(text: string) {
  if (!isCoffeeWithAddedSugar(text)) return false;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return !/\b(?:adicionar|adicione|adiciona|inclua|incluir|trocar|troque|substituir|substitua|corrigir|corrija)\b/.test(normalized);
}

export async function handleCoffeeSugarRegistrationIntent(input: {
  userId: number;
  text: string;
  receivedAt: Date;
  userTimezone: string;
  messageId: string;
}): Promise<WhatsappIntentResult> {
  const outcome = await executeConfirmedWhatsAppMealRegistration({
    userId: input.userId,
    registrationText: input.text,
    originalText: input.text,
    occurredAt: input.receivedAt,
    userTimezone: input.userTimezone,
  });

  if (outcome.status === "registered") return outcome.result;

  if (outcome.status === "details_needed") {
    return requestWhatsappCaloricComplementQuantityClarification({
      userId: input.userId,
      originalFoodText: input.text,
      operation: {
        kind: "register",
        occurredAt: input.receivedAt.toISOString(),
      },
      receivedAt: input.receivedAt,
      messageId: input.messageId,
    });
  }

  return {
    handled: true,
    action: "food_clarification_unavailable",
    reply: buildWhatsAppRecoverableErrorReplyMessage(outcome.prompt),
    eventType:
      outcome.status === "safe_to_retry"
        ? "whatsapp.food_clarification.processing_retryable"
        : "whatsapp.food_clarification.persistence_verification_required",
    detail: outcome.detail,
    data: {
      originalTextPreserved: true,
      retryBlockedToPreventDuplicate:
        outcome.status === "blocked_after_possible_mutation",
    },
  };
}
