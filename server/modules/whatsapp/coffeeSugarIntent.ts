import { isCoffeeWithAddedSugar } from "../../foodSemanticCompatibility";
import { executeConfirmedWhatsAppMealRegistration } from "./confirmedMealRegistration";
import { requestWhatsappCaloricComplementQuantityClarification } from "./foodQuantityClarification";
import type { WhatsappIntentResult } from "./intent/types";
import { buildWhatsAppRecoverableErrorReplyMessage } from "./replyMessages";

function looksLikeAmbiguousMealIntentDecision(normalized: string) {
  if (/\b(?:almocei|jantei|comi|lanchei|ceei|tomei|bebi|registrei|registrar|registre)\b/.test(normalized)) {
    return false;
  }
  return /\b(?:cafe da manha|cafe|almoco|jantar|lanche|ceia)\b(?:\s+[a-z0-9]+){0,3}\s+com\s+\S+/.test(normalized);
}

export function isCoffeeSugarRegistrationText(text: string) {
  if (!isCoffeeWithAddedSugar(text)) return false;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const isMutation = /\b(?:adicionar|adicione|adiciona|inclua|incluir|trocar|troque|substituir|substitua|corrigir|corrija)\b/.test(normalized);
  return !isMutation && !looksLikeAmbiguousMealIntentDecision(normalized);
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
