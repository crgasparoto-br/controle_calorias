import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { getDb, logPersistenceWarning } from "../../db";
import type { MealInferenceError } from "../../nutritionEngine";
import { isCoffeeWithAddedSugar } from "../../foodSemanticCompatibility";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { executeConfirmedWhatsAppMealRegistration } from "./confirmedMealRegistration";
import { isCompleteWhatsappCommand } from "./foodClarificationContract";
import { requestWhatsappCaloricComplementQuantityClarification } from "./foodQuantityClarification";
import { claimWhatsAppTextPendingOperation } from "./interactiveCallback";
import {
  analyzeRegistrationDetailsIdentityReply,
  mergePendingCountableSegment,
  mergePendingIdentity,
  parsePendingIdentityContext,
} from "./registrationDetailsIdentity";
import { normalizeStandaloneWhatsappCommand } from "./standaloneCommandWords";
import type { CountableRegistrationContinuation } from "./countableFoodRegistrationGate";
import type { CanonicalFoodAdditionItem } from "./intent/canonicalFoodAdditionResolution";
import type { FoodAdditionIntent } from "./intent/types";

export const PENDING_MEAL_INTENT_REGISTRATION_DETAILS_TYPE =
  "meal_intent_registration_details";
export const PENDING_MEAL_INTENT_REGISTRATION_DETAILS_ORIGIN =
  "mealIntentRegistrationDetailsInteraction";
export const MEAL_INTENT_REGISTRATION_DETAILS_INTERACTION_ID =
  "meal_intent_decision.registration_details";
const DETAILS_TTL_MS = 10 * 60 * 1000;

export type FoodAdditionIdentityContinuation = {
  addition: Omit<FoodAdditionIntent, "date"> & { date: string };
  itemIndex: number;
  expectedMealId: number;
  expectedMealLabel: string;
  expectedOccurredAt: string;
  receivedAt: string;
  userTimezone: string;
  clarification: NonNullable<MealInferenceError["context"]>;
  resolvedItems: CanonicalFoodAdditionItem[];
};

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
  countableContext?: CountableRegistrationContinuation;
  foodAdditionContext?: FoodAdditionIdentityContinuation;
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
  countableContext?: CountableRegistrationContinuation;
  foodAdditionContext?: FoodAdditionIdentityContinuation;
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
    ...(input.countableContext
      ? { countableContext: input.countableContext }
      : {}),
    ...(input.foodAdditionContext
      ? { foodAdditionContext: input.foodAdditionContext }
      : {}),
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
      ...((input.countableContext || input.foodAdditionContext)
        ? {
            clarificationReason:
              (input.countableContext?.clarification ?? input.foodAdditionContext?.clarification)?.clarificationReason,
            alternatives:
              (input.countableContext?.clarification ?? input.foodAdditionContext?.clarification)?.alternatives,
          }
        : {}),
    },
  };
}

function getPendingIdentityContext(target: PendingMealIntentRegistrationDetails) {
  const countableContext = target.countableContext;
  if (countableContext) {
    return parsePendingIdentityContext({
      segment: countableContext.registrationSegments[countableContext.itemIndex],
    });
  }

  const foodAdditionContext = target.foodAdditionContext;
  const item = foodAdditionContext?.addition.items[foodAdditionContext.itemIndex];
  if (!item) return null;
  return parsePendingIdentityContext({
    fallbackIdentity: item.foodName,
    fallbackQuantity: item.quantity,
    fallbackUnit: item.unit,
  });
}

function parseDetailsAction(
  target: PendingMealIntentRegistrationDetails,
  text?: string | null,
) {
  const raw = text?.trim() ?? "";
  const normalized = normalizeStandaloneWhatsappCommand(raw);
  if (!normalized) return null;
  if (["cancelar", "cancela", "cancele", "nao", "0"].includes(normalized)) {
    return "cancel" as const;
  }
  if (["registrar", "registrar alimento", "registrar consumo", "registre", "registra"].includes(normalized)) {
    return null;
  }

  const completeCommand = isCompleteWhatsappCommand(raw);
  const identityContext = getPendingIdentityContext(target);
  if (identityContext) {
    const analysis = analyzeRegistrationDetailsIdentityReply({
      text: raw,
      ...identityContext,
      isCompleteCommand: completeCommand,
    });
    if (analysis.kind === "compatible" || analysis.kind === "quantity_conflict") {
      return "provide_details" as const;
    }
    if (analysis.kind === "invalid" && !completeCommand) {
      return "provide_details" as const;
    }
    return null;
  }

  if (completeCommand) return null;
  return "provide_details" as const;
}

export function classifyMealIntentRegistrationDetailsText(
  target: unknown,
  text?: string | null,
): "resolve" | "invalid" {
  if (!isPendingMealIntentRegistrationDetails(target)) return "invalid";
  return parseDetailsAction(target, text) ? "resolve" : "invalid";
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
    countableContext: input.target.countableContext
      ? {
          ...input.target.countableContext,
          registrationSegments: input.registrationText.split("\n"),
        }
      : undefined,
    foodAdditionContext: input.target.foodAdditionContext,
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
  if (!isPendingMealIntentRegistrationDetails(target)) return null;
  const action = parseDetailsAction(target, input.text);
  if (!action) return null;
  if (input.pendingOperation.userId !== input.userId) return null;

  const details = input.text?.trim() ?? "";
  const identityContext = getPendingIdentityContext(target);
  if (identityContext && action !== "cancel") {
    const analysis = analyzeRegistrationDetailsIdentityReply({
      text: details,
      ...identityContext,
      isCompleteCommand: isCompleteWhatsappCommand(details),
    });
    if (analysis.kind !== "compatible") {
      return {
        handled: true as const,
        action: "clarification_needed" as const,
        reply: target.prompt,
        eventType: "whatsapp.meal_intent_decision.invalid_identity_details",
        detail: analysis.kind === "quantity_conflict"
          ? "Resposta de identidade conflita com a quantidade ou unidade já conhecida; pendência preservada sem efeito."
          : "Resposta não identifica uma única variante compatível; pendência preservada sem efeito.",
        data: { originalTextPreserved: true },
      };
    }
  }

  const claim = await claimWhatsAppTextPendingOperation(
    input.userId,
    PENDING_MEAL_INTENT_REGISTRATION_DETAILS_TYPE,
    action,
    input.receivedAt,
    input.pendingOperation.id
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

  const foodAdditionContext = target.foodAdditionContext;
  if (foodAdditionContext) {
    const items = foodAdditionContext.addition.items.map(item => ({ ...item }));
    const currentItem = items[foodAdditionContext.itemIndex];
    if (!currentItem) {
      return {
        handled: true as const,
        action: "clarification_needed" as const,
        reply: "Não consegui retomar o alimento pendente com segurança. Nada foi alterado. Envie novamente o pedido completo.",
        eventType: "whatsapp.meal_intent_decision.food_addition_identity_context_invalid",
        detail: "Contexto persistido da adição não contém o item pendente esperado.",
        data: { retryRequiresFullMessage: true, originalTextPreserved: true },
      };
    }
    items[foodAdditionContext.itemIndex] = {
      ...currentItem,
      foodName: mergePendingIdentity(currentItem.foodName, details),
    };
    const { handleFoodAdditionIntent } = await import("./intent/foodAdditionHandlers");
    return handleFoodAdditionIntent(
      input.userId,
      {
        mealLabel: foodAdditionContext.addition.mealLabel,
        date: new Date(foodAdditionContext.addition.date),
        items,
      },
      foodAdditionContext.userTimezone || input.userTimezone || DEFAULT_APP_TIME_ZONE,
      {
        originalText: target.originalText,
        receivedAt: new Date(foodAdditionContext.receivedAt),
        messageId: target.inboundMessageId,
        expectedMealId: foodAdditionContext.expectedMealId,
        expectedMealLabel: foodAdditionContext.expectedMealLabel,
        expectedOccurredAt: foodAdditionContext.expectedOccurredAt,
        resolvedItems: foodAdditionContext.resolvedItems,
      },
    );
  }

  const context = target.countableContext;
  const registrationSegments = context
    ? [...context.registrationSegments]
    : null;
  if (context && registrationSegments) {
    const pendingSegment = registrationSegments[context.itemIndex];
    if (!pendingSegment) {
      return {
        handled: true as const,
        action: "clarification_needed" as const,
        reply: "Não consegui retomar o alimento pendente com segurança. Nada foi registrado. Envie novamente a descrição completa da refeição.",
        eventType: "whatsapp.meal_intent_decision.countable_identity_context_invalid",
        detail: "Contexto persistido não contém o segmento alimentar pendente esperado.",
        data: { retryRequiresFullMessage: true, originalTextPreserved: true },
      };
    }
    registrationSegments[context.itemIndex] =
      mergePendingCountableSegment(pendingSegment, details);
  }
  const registrationText =
    registrationSegments?.join("\n") ??
    combineRegistrationText(target.registrationText, details);
  const outcome = await executeConfirmedWhatsAppMealRegistration({
    userId: input.userId,
    registrationText,
    originalText: target.originalText,
    occurredAt: context
      ? new Date(context.occurredAt)
      : (input.receivedAt ?? new Date()),
    userTimezone:
      context?.userTimezone || input.userTimezone || DEFAULT_APP_TIME_ZONE,
    resolvedSegments: context?.resolvedSegments,
    inboundMessageId: target.inboundMessageId,
  });

  if (outcome.status === "clarification_requested") return outcome.result;

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
