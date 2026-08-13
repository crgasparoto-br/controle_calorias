import { isCoffeeWithAddedSugar } from "../../foodSemanticCompatibility";
import { executeConfirmedWhatsAppMealRegistration } from "./confirmedMealRegistration";
import { requestWhatsappCaloricComplementQuantityClarification } from "./foodQuantityClarification";
import type { WhatsappIntentResult } from "./intent/types";
import { buildWhatsAppRecoverableErrorReplyMessage } from "./replyMessages";
import { tryExecuteWhatsappStructuredCoffeeIntent } from "./structuredCoffeeIntentActions";

function normalizeCoffeeRegistrationText(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutMealLabel(text: string) {
  return normalizeCoffeeRegistrationText(text)
    .replace(/\bcafe da manha\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericCoffeePreparationRegistrationText(text: string) {
  const normalized = withoutMealLabel(text);
  if (!/(?:^|\s)cafe(?:\s|$)/.test(normalized)) return false;
  if (/\bcafe\b[^,.;]*\b(?:sem acucar|sem adicao de acucar|com acucar|puro|preto|natural|adocado|acucarado)\b/.test(normalized)) {
    return false;
  }
  if (/\bcafe\b[^,.;]*\b(?:leite|mel|creme|chantilly|condensad[oa]|chocolate|cacau)\b/.test(normalized)) {
    return false;
  }
  if (/\b(?:remover|remova|apagar|apague|excluir|exclua|trocar|troque|substituir|substitua|corrigir|corrija)\b/.test(normalized)) {
    return false;
  }
  if (/\b(?:quanto|quantas|quantos|caloria|calorias|proteina|proteinas|carboidrato|carboidratos|gordura|gorduras)\b/.test(normalized)) {
    return false;
  }

  const bareCoffee = normalized === "cafe";
  const explicitQuantity = /\b\d+(?:[.,]\d+)?\s*(?:xicara|xicaras|copo|copos|ml|g|grama|gramas|porcao|porcoes)\b/.test(normalized);
  const registrationVerb = /\b(?:almocei|jantei|comi|lanchei|ceei|tomei|bebi|registrei|registrar|registre|registra|adicionar|adicione|adiciona|inclua|incluir|lance|lancar)\b/.test(normalized);
  return bareCoffee || explicitQuantity || registrationVerb;
}

function looksLikeAmbiguousMealIntentDecision(normalized: string) {
  if (/\b(?:almocei|jantei|comi|lanchei|ceei|tomei|bebi|registrei|registrar|registre)\b/.test(normalized)) {
    return false;
  }
  return /\b(?:cafe da manha|cafe|almoco|jantar|lanche|ceia)\b(?:\s+[a-z0-9]+){0,3}\s+com\s+\S+/.test(normalized);
}

export function isCoffeeSugarRegistrationText(text: string) {
  if (isGenericCoffeePreparationRegistrationText(text)) return true;
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
  if (isGenericCoffeePreparationRegistrationText(input.text)) {
    const preflight = await tryExecuteWhatsappStructuredCoffeeIntent(input.userId, {
      text: input.text,
      receivedAt: input.receivedAt,
      messageId: input.messageId,
      userTimezone: input.userTimezone,
    });
    if (preflight.matched) {
      return {
        handled: true,
        action: "clarification_needed",
        reply: preflight.result.reply,
        eventType: preflight.result.eventType,
        detail: preflight.result.detail,
        ...(preflight.result.data ? { data: preflight.result.data } : {}),
        ...(preflight.result.interactiveReply
          ? { interactiveReply: preflight.result.interactiveReply }
          : {}),
      };
    }
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui confirmar o preparo do café com segurança. Nada foi registrado; envie novamente a mensagem completa.",
      ),
      eventType: "whatsapp.coffee_preparation_clarification.fallback_blocked",
      detail: "Café genérico foi bloqueado antes de qualquer fallback nutricional ou mutação.",
      data: {
        fallbackBlocked: true,
        fallbackBlockReason: "generic_coffee_preflight_unavailable",
      },
    };
  }

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
    action: "food_clarification_unavaile",
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
