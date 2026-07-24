import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { getCurrentWhatsappInboundExternalMessageId } from "./inboundCorrelationContext";
import { claimWhatsAppTextPendingOperation } from "./interactiveCallback";
import {
  buildWhatsappClosedDecisionReply,
  buildWhatsappInteractionTelemetry,
  type WhatsappInteractionAction,
} from "./interactionPresentation";
import { executeConfirmedWhatsAppMealRegistration } from "./confirmedMealRegistration";
import { createWhatsappMealIntentRegistrationDetailsInteraction } from "./mealIntentRegistrationDetailsInteraction";
import type { WhatsAppLogicalReply } from "./replyContract";
import { normalizeStandaloneWhatsappCommand } from "./standaloneCommandWords";

export const PENDING_MEAL_INTENT_DECISION_TYPE = "meal_intent_decision";
export const PENDING_MEAL_INTENT_DECISION_ORIGIN = "mealIntentDecisionInteraction";
export const MEAL_INTENT_DECISION_INTERACTION_ID =
  "meal_intent_decision.consume_or_suggest";
export const MEAL_INTENT_DECISION_PROMPT =
  "Você quer registrar essa refeição como consumida ou receber uma sugestão de refeição com esses alimentos?";

const PENDING_MEAL_INTENT_DECISION_TTL_MS = 10 * 60 * 1000;

export const MEAL_INTENT_DECISION_ACTIONS = [
  { id: "register", label: "Registrar", effect: "register_original_meal_once" },
  {
    id: "suggest",
    label: "Receber sugestão",
    effect: "suggest_from_original_text_without_persistence",
  },
  { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
] as const satisfies readonly WhatsappInteractionAction[];

export type MealIntentDecisionAction =
  (typeof MEAL_INTENT_DECISION_ACTIONS)[number]["id"];

export type PendingMealIntentDecision = {
  contractVersion: 1;
  interactionId: typeof MEAL_INTENT_DECISION_INTERACTION_ID;
  kind: "meal_intent_decision";
  originalText: string;
  normalizedText: string;
  inboundMessageId: string | null;
  interpretedIntent: {
    intent: "ambiguous";
    possibleIntents: ["add_foods_to_meal", "meal_suggestion"];
    confidence: number | null;
    mealLabel: string | null;
  };
  actions: WhatsappInteractionAction[];
};

const pendingOperationRepository =
  createDrizzleWhatsAppPendingOperationRepository({
    getDb,
    onWarning: logPersistenceWarning,
  });

export function normalizeMealIntentDecisionText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasCanonicalMealIntentDecisionActions(value: unknown) {
  if (!Array.isArray(value) || value.length !== MEAL_INTENT_DECISION_ACTIONS.length) {
    return false;
  }
  return MEAL_INTENT_DECISION_ACTIONS.every((expected, index) => {
    const candidate = value[index] as Partial<WhatsappInteractionAction> | undefined;
    return candidate?.id === expected.id
      && candidate.label === expected.label
      && candidate.effect === expected.effect;
  });
}

export function isPendingMealIntentDecision(
  value: unknown
): value is PendingMealIntentDecision {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<PendingMealIntentDecision>;
  const interpretedIntent = target.interpretedIntent;
  return (
    target.contractVersion === 1 &&
    target.interactionId === MEAL_INTENT_DECISION_INTERACTION_ID &&
    target.kind === "meal_intent_decision" &&
    typeof target.originalText === "string" &&
    target.originalText.trim().length > 0 &&
    typeof target.normalizedText === "string" &&
    (typeof target.inboundMessageId === "string" ||
      target.inboundMessageId === null) &&
    interpretedIntent?.intent === "ambiguous" &&
    Array.isArray(interpretedIntent.possibleIntents) &&
    interpretedIntent.possibleIntents[0] === "add_foods_to_meal" &&
    interpretedIntent.possibleIntents[1] === "meal_suggestion" &&
    hasCanonicalMealIntentDecisionActions(target.actions)
  );
}

export function buildWhatsappMealIntentDecisionReply(
  pendingOperationId: number,
  bodyText = MEAL_INTENT_DECISION_PROMPT
): WhatsAppLogicalReply {
  return buildWhatsappClosedDecisionReply({
    bodyText,
    pendingOperationId,
    actions: [...MEAL_INTENT_DECISION_ACTIONS],
  });
}

function buildPersistenceFailure() {
  return {
    handled: true as const,
    action: "clarification_needed" as const,
    reply:
      "Não consegui guardar essa escolha com segurança. Nada foi registrado. Reenvie a descrição completa da refeição para tentar novamente.",
    eventType: "whatsapp.meal_intent_decision.persistence_failed",
    detail:
      "Interação consumo x sugestão não foi enviada porque a pendência não pôde ser persistida.",
    data: {
      fallbackBlocked: true,
      fallbackBlockReason: "meal_intent_decision_persistence_failed",
      interactionId: MEAL_INTENT_DECISION_INTERACTION_ID,
      interactionLifecycle: "blocked",
    },
  };
}

export async function createWhatsappMealIntentDecisionInteraction(input: {
  userId: number;
  originalText: string;
  receivedAt?: Date;
  messageId?: string | null;
  confidence?: number | null;
  mealLabel?: string | null;
}) {
  const originalText = input.originalText.trim();
  const target: PendingMealIntentDecision = {
    contractVersion: 1,
    interactionId: MEAL_INTENT_DECISION_INTERACTION_ID,
    kind: "meal_intent_decision",
    originalText,
    normalizedText: normalizeMealIntentDecisionText(originalText),
    inboundMessageId:
      input.messageId?.trim() ||
      getCurrentWhatsappInboundExternalMessageId()?.trim() ||
      null,
    interpretedIntent: {
      intent: "ambiguous",
      possibleIntents: ["add_foods_to_meal", "meal_suggestion"],
      confidence:
        typeof input.confidence === "number" ? input.confidence : null,
      mealLabel: input.mealLabel?.trim() || null,
    },
    actions: [...MEAL_INTENT_DECISION_ACTIONS],
  };

  const created = await pendingOperationRepository.createPendingOperation({
    userId: input.userId,
    type: PENDING_MEAL_INTENT_DECISION_TYPE,
    origin: PENDING_MEAL_INTENT_DECISION_ORIGIN,
    ttlMs: PENDING_MEAL_INTENT_DECISION_TTL_MS,
    now: input.receivedAt,
    target,
  });
  if (!created) return buildPersistenceFailure();

  return {
    handled: true as const,
    action: "clarification_needed" as const,
    reply: MEAL_INTENT_DECISION_PROMPT,
    eventType: "whatsapp.meal_intent_decision.requested",
    detail:
      "Ambiguidade consumo x sugestão persistida antes do envio da pergunta fechada.",
    data: {
      pendingOperationId: created.id,
      pendingType: created.type,
      originalTextPreserved: true,
      inboundMessageCorrelated: Boolean(target.inboundMessageId),
      ...buildWhatsappInteractionTelemetry({
        interactionId: target.interactionId,
        origin: PENDING_MEAL_INTENT_DECISION_ORIGIN,
        classification: "closed",
        actions: target.actions,
        lifecycle: "created",
      }),
    },
    interactiveReply: buildWhatsappMealIntentDecisionReply(created.id),
  };
}

export function parseMealIntentDecisionTextAction(
  text?: string | null
): MealIntentDecisionAction | null {
  const normalized = normalizeStandaloneWhatsappCommand(text ?? "");
  if (!normalized) return null;
  if (["cancelar", "cancela", "cancele", "nao", "0"].includes(normalized))
    return "cancel";
  if (
    [
      "registrar",
      "registrar alimento",
      "registrar consumo",
      "registre",
      "registra",
      "consumi",
      "consumida",
      "1",
    ].includes(normalized)
  )
    return "register";
  if (
    [
      "sugestao",
      "receber sugestao",
      "receber uma sugestao",
      "quero sugestao",
      "quero uma sugestao",
      "sugerir",
      "sugira",
      "2",
    ].includes(normalized)
  )
    return "suggest";
  return null;
}

export function classifyMealIntentDecisionText(
  target: unknown,
  text?: string | null
): "resolve" | "invalid" {
  if (!isPendingMealIntentDecision(target)) return "invalid";
  return parseMealIntentDecisionTextAction(text) ? "resolve" : "invalid";
}

export async function completeWhatsappMealIntentDecisionCallback(input: {
  userId: number;
  pendingOperation: Pick<WhatsAppPendingOperationRecord, "target">;
  action: string;
  receivedAt?: Date;
  userTimezone?: string | null;
}) {
  const target = input.pendingOperation.target;
  if (
    !isPendingMealIntentDecision(target) ||
    !MEAL_INTENT_DECISION_ACTIONS.some(candidate => candidate.id === input.action)
  ) {
    return {
      handled: true as const,
      action: "clarification_needed" as const,
      reply:
        "Essa escolha não está mais disponível. Envie novamente a descrição completa da refeição.",
      eventType: "whatsapp.meal_intent_decision.unavailable",
      detail:
        "Ação ou contrato inválido bloqueado sem reclassificação nem persistência nutricional.",
    };
  }

  if (input.action === "cancel") {
    return {
      handled: true as const,
      action: "meal_intent_decision_cancelled",
      reply: "Tudo certo. Nada foi registrado.",
      eventType: "whatsapp.meal_intent_decision.cancelled",
      detail: "Interação consumo x sugestão cancelada sem efeito de domínio.",
      data: { originalTextPreserved: true },
    };
  }

  if (input.action === "suggest") {
    const { executeConfirmedWhatsAppFoodSuggestion } = await import(
      "./foodAssistant"
    );
    const suggestion = executeConfirmedWhatsAppFoodSuggestion(
      target.originalText
    );
    return {
      ...suggestion,
      action: "meal_intent_decision_suggestion",
      eventType: "whatsapp.meal_intent_decision.suggestion",
      detail: `${suggestion.detail} Texto original recuperado da pendência específica; nenhum consumo foi persistido.`,
      data: {
        ...(suggestion.data ?? {}),
        originalTextPreserved: true,
        originalTextResumed: true,
        consumptionPersisted: false,
      },
    };
  }

  const outcome = await executeConfirmedWhatsAppMealRegistration({
    userId: input.userId,
    registrationText: target.originalText,
    originalText: target.originalText,
    occurredAt: input.receivedAt ?? new Date(),
    userTimezone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
  });

  if (outcome.status === "registered") {
    return {
      ...outcome.result,
      detail: `${outcome.result.detail} Texto original retomado após a escolha Registrar.`,
      data: {
        ...(outcome.result.data ?? {}),
        originalTextPreserved: true,
        originalTextResumed: true,
        ambiguityReclassified: false,
      },
    };
  }

  if (outcome.status === "details_needed") {
    const details = await createWhatsappMealIntentRegistrationDetailsInteraction({
      userId: input.userId,
      originalText: target.originalText,
      registrationText: target.originalText,
      inboundMessageId: target.inboundMessageId,
      prompt: outcome.prompt,
      receivedAt: input.receivedAt,
    });
    return details ?? {
      handled: true as const,
      action: "clarification_needed" as const,
      reply:
        "Não consegui manter a solicitação de detalhes com segurança. Nada foi registrado. Envie novamente a descrição completa da refeição.",
      eventType: "whatsapp.meal_intent_decision.registration_details_restore_failed",
      detail: "Clarificação alimentar específica não pôde ser persistida.",
      data: { retryRequiresFullMessage: true, originalTextPreserved: true },
    };
  }

  if (outcome.status === "safe_to_retry") {
    const recreated = await pendingOperationRepository.createPendingOperation({
      userId: input.userId,
      type: PENDING_MEAL_INTENT_DECISION_TYPE,
      origin: PENDING_MEAL_INTENT_DECISION_ORIGIN,
      target,
      ttlMs: PENDING_MEAL_INTENT_DECISION_TTL_MS,
      now: input.receivedAt,
    });
    if (recreated) {
      return {
        handled: true as const,
        action: "clarification_needed" as const,
        reply: outcome.prompt,
        eventType: "whatsapp.meal_intent_decision.registration_retry_restored",
        detail: outcome.detail,
        data: {
          pendingOperationId: recreated.id,
          pendingType: recreated.type,
          originalTextPreserved: true,
          interactionId: MEAL_INTENT_DECISION_INTERACTION_ID,
          interactionLifecycle: "created",
        },
        interactiveReply: buildWhatsappMealIntentDecisionReply(
          recreated.id,
          outcome.prompt,
        ),
      };
    }
  }

  return {
    handled: true as const,
    action: "clarification_needed" as const,
    reply: outcome.prompt,
    eventType: "whatsapp.meal_intent_decision.registration_blocked_after_mutation",
    detail: outcome.detail,
    data: {
      retryBlocked: outcome.status === "blocked_after_possible_mutation",
      originalTextPreserved: true,
      ambiguityReclassified: false,
    },
  };
}

export async function resolveWhatsappMealIntentDecisionText(input: {
  userId: number;
  pendingOperation: WhatsAppPendingOperationRecord;
  text?: string | null;
  receivedAt?: Date;
  userTimezone: string;
}) {
  const action = parseMealIntentDecisionTextAction(input.text);
  if (!action) return null;
  const claim = await claimWhatsAppTextPendingOperation(
    input.userId,
    PENDING_MEAL_INTENT_DECISION_TYPE,
    action,
    input.receivedAt
  );
  if (claim.status !== "claimed") return null;
  return completeWhatsappMealIntentDecisionCallback({
    userId: input.userId,
    pendingOperation: claim.pendingOperation,
    action,
    receivedAt: input.receivedAt,
    userTimezone: input.userTimezone,
  });
}
