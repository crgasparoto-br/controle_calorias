import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { getDb, logPersistenceWarning } from "../../db";
import { isCoffeeWithAddedSugar } from "../../foodSemanticCompatibility";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { executeConfirmedWhatsAppMealRegistration } from "./confirmedMealRegistration";
import { isCompleteWhatsappCommand } from "./foodClarificationContract";
import { requestWhatsappCaloricComplementQuantityClarification } from "./foodQuantityClarification";
import { claimWhatsAppTextPendingOperation } from "./interactiveCallback";
import { normalizeStandaloneWhatsappCommand } from "./standaloneCommandWords";

export const PENDING_MEAL_INTENT_REGISTRATION_DETAILS_TYPE =
  "meal_intent_registration_details";
export const PENDING_MEAL_INTENT_REGISTRATION_DETAILS_ORIGIN =
  "mealIntentRegistrationDetailsInteraction";
export const MEAL_INTENT_REGISTRATION_DETAILS_INTERACTION_ID =
  "meal_intent_decision.registration_details";
const DETAILS_TTL_MS = 10 * 60 * 1000;

export const MEAL_INTENT_REGISTRATION_DETAILS_ACTIONS = [
  { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
] as const;

export type PendingMealIntentRegistrationDetails = {
  contractVersion: 1;
  interactionId: typeof MEAL_INTENT_REGISTRATION_DETAILS_INTERACTION_ID;
  kind: "meal_intent_registration_details";
  originalText: string;
  registrationText: string;
  normalizedText: string;
  inboundMessageId: string | null;
  prompt: string;
  attempts: number;
  actions: Array<{ id: string; label: string; effect: string }>;
};

function normalizeRegistrationDetailsText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export function isPendingMealIntentRegistrationDetails(
  value: unknown,
): value is PendingMealIntentRegistrationDetails {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<PendingMealIntentRegistrationDetails>;
  return target.contractVersion === 1
    && target.interactionId === MEAL_INTENT_REGISTRATION_DETAILS_INTERACTION_ID
    && target.kind === "meal_intent_registration_details"
    && typeof target.originalText === "string"
    && typeof target.registrationText === "string"
    && typeof target.prompt === "string"
    && typeof target.attempts === "number"
    && Array.isArray(target.actions);
}

function isSugarQuantityPrompt(input: {
  registrationText: string;
  prompt: string;
}) {
  return isCoffeeWithAddedSugar(input.registrationText)
    && /\baçúcar\b/i.test(input.prompt);
}

export async function createWhatsappMealIntentRegistrationDetailsInteraction(input: {
  userId: number;
  originalText: string;
  registrationText?: string;
  inboundMessageId?: string | null;
  prompt: string;
  attempts?: number;
  receivedAt?: Date;
}) {
  const registrationText = (input.registrationText ?? input.originalText).trim();
  if (isSugarQuantityPrompt({ registrationText, prompt: input.prompt })) {
    const clarification = await requestWhatsappCaloricComplementQuantityClarification({
      userId: input.userId,
      originalFoodText: registrationText,
      operation: {
        kind: "register",
        occurredAt: (input.receivedAt ?? new Date()).toISOString(),
      },
      receivedAt: input.receivedAt,
      messageId: input.inboundMessageId,
    });
    return {
      ...clarification,
      detail: `${clarification.detail} Texto original retomado após a escolha Registrar.`,
      data: {
        ...(clarification.data ?? {}),
        originalTextPreserved: true,
        originalTextResumed: true,
        ambiguityReclassified: false,
      },
    };
  }

  const target: PendingMealIntentRegistrationDetails = {
    contractVersion: 1,
    interactionId: MEAL_INTENT_REGISTRATION_DETAILS_INTERACTION_ID,
    kind: "meal_intent_registration_details",
    originalText: input.originalText.trim(),
    registrationText,
    normalizedText: normalizeRegistrationDetailsText(input.originalText),
    inboundMessageId: input.inboundMessageId?.trim() || null,
    prompt: input.prompt.trim(),
    attempts: input.attempts ?? 1,
    actions: [...MEAL_INTENT_REGISTRATION_DETAILS_ACTIONS],
  };
  const created = await repository.createPendingOperation({
    userId: input.userId,
    type: PENDING_MEAL_INTENT_REGISTRATION_DETAILS_TYPE,
    origin: PENDING_MEAL_INTENT_REGISTRATION_DETAILS_ORIGIN,
    target,
    ttlMs: DETAILS_TTL_MS,
    now: input.receivedAt,
  });
  if (!created) return null;
  return {
    handled: true as const,
    action: "clarification_needed" as const,
    reply: target.prompt,
    eventType: "whatsapp.meal_intent_decision.registration_details_requested",
    detail:
      "Clarificação alimentar aberta preservou o texto original e solicita somente o dado ainda ausente.",
    data: {
      interactionId: target.interactionId,
      pendingOperationId: created.id,
      pendingType: created.type,
      originalTextPreserved: true,
      interactionClassification: "open",
      interactionComponent: "text",
      interactionLifecycle: "created",
    },
  };
}

function parseDetailsAction(text?: string | null) {
  const raw = text?.trim() ?? "";
  if (isCompleteWhatsappCommand(raw)) return null;
  const normalized = normalizeStandaloneWhatsappCommand(raw);
  if (!normalized) return null;
  if (["cancelar", "cancela", "cancele", "nao", "0"].includes(normalized)) {
    return "cancel" as const;
  }
  if (["registrar", "registrar alimento", "registrar consumo", "registre", "registra"].includes(normalized)) {
    return null;
  }
  return "provide_details" as const;
}

export function classifyMealIntentRegistrationDetailsText(
  target: unknown,
  text?: string | null,
): "resolve" | "invalid" {
  if (!isPendingMealIntentRegistrationDetails(target)) return "invalid";
  return parseDetailsAction(text) ? "resolve" : "invalid";
}

function combineRegistrationText(base: string, details: string) {
  const quantityOnly = /^\s*\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?|x[ií]caras?|copos?|colheres?|unidades?|fatias?)\s*$/i;
  return quantityOnly.test(details)
    ? `${details.trim()} de ${base.trim()}`
    : `${base.trim()}. Detalhes adicionais: ${details.trim()}`;
}

async function recreateAfterSafeFailure(input: {
  userId: number;
  target: PendingMealIntentRegistrationDetails;
  registrationText: string;
  prompt: string;
  receivedAt?: Date;
}) {
  return createWhatsappMealIntentRegistrationDetailsInteraction({
    userId: input.userId,
    originalText: input.target.originalText,
    registrationText: input.registrationText,
    inboundMessageId: input.target.inboundMessageId,
    prompt: input.prompt,
    attempts: input.target.attempts + 1,
    receivedAt: input.receivedAt,
  });
}

export async function resolveWhatsappMealIntentRegistrationDetailsText(input: {
  userId: number;
  pendingOperation: WhatsAppPendingOperationRecord;
  text?: string | null;
  receivedAt?: Date;
  userTimezone: string;
}) {
  const target = input.pendingOperation.target;
  const action = parseDetailsAction(input.text);
  if (!isPendingMealIntentRegistrationDetails(target) || !action) return null;
  const claim = await claimWhatsAppTextPendingOperation(
    input.userId,
    PENDING_MEAL_INTENT_REGISTRATION_DETAILS_TYPE,
    action,
    input.receivedAt,
  );
  if (claim.status !== "claimed") return null;

  if (action === "cancel") {
    return {
      handled: true as const,
      action: "meal_intent_decision_cancelled",
      reply: "Tudo certo. Nada foi registrado.",
      eventType: "whatsapp.meal_intent_decision.registration_details_cancelled",
      detail: "Clarificação alimentar complementar cancelada sem mutação.",
      data: { originalTextPreserved: true },
    };
  }

  const details = input.text?.trim() ?? "";
  const registrationText = combineRegistrationText(target.registrationText, details);
  const outcome = await executeConfirmedWhatsAppMealRegistration({
    userId: input.userId,
    registrationText,
    originalText: target.originalText,
    occurredAt: input.receivedAt ?? new Date(),
    userTimezone: input.userTimezone || DEFAULT_APP_TIME_ZONE,
  });

  if (outcome.status === "registered") {
    return {
      ...outcome.result,
      detail: `${outcome.result.detail} Dados complementares foram combinados ao contexto persistido.`,
      data: {
        ...(outcome.result.data ?? {}),
        supplementalDetailsUsed: true,
      },
    };
  }

  if (outcome.status === "blocked_after_possible_mutation") {
    return {
      handled: true as const,
      action: "clarification_needed" as const,
      reply: outcome.prompt,
      eventType: "whatsapp.meal_intent_decision.registration_blocked_after_mutation",
      detail: outcome.detail,
      data: { retryBlocked: true, originalTextPreserved: true },
    };
  }

  const recreated = await recreateAfterSafeFailure({
    userId: input.userId,
    target,
    registrationText,
    prompt: outcome.prompt,
    receivedAt: input.receivedAt,
  });
  return recreated ?? {
    handled: true as const,
    action: "clarification_needed" as const,
    reply:
      "Não consegui manter os detalhes pendentes com segurança. Nada foi registrado. Envie novamente a descrição completa da refeição.",
    eventType: "whatsapp.meal_intent_decision.registration_details_restore_failed",
    detail: "Falha anterior à mutação não conseguiu recriar a clarificação persistente.",
    data: { retryRequiresFullMessage: true, originalTextPreserved: true },
  };
}

export function rebuildWhatsappMealIntentRegistrationDetails(
  pendingOperation: WhatsAppPendingOperationRecord,
) {
  const target = pendingOperation.target;
  if (!isPendingMealIntentRegistrationDetails(target)) return null;
  return { reply: target.prompt };
}

export async function completeWhatsappMealIntentRegistrationDetailsCallback(input: {
  pendingOperation: WhatsAppPendingOperationRecord;
  action: string;
}) {
  const target = input.pendingOperation.target;
  if (!isPendingMealIntentRegistrationDetails(target) || input.action !== "cancel") {
    return null;
  }
  return {
    handled: true as const,
    action: "meal_intent_decision_cancelled",
    reply: "Tudo certo. Nada foi registrado.",
    eventType: "whatsapp.meal_intent_decision.registration_details_cancelled",
    detail: "Clarificação complementar cancelada por callback sem mutação.",
    data: { originalTextPreserved: true },
  };
}
