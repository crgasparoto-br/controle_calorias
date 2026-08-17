import { getDb, logPersistenceWarning } from "../../db";
import { isCoffeeWithAddedSugar } from "../../foodSemanticCompatibility";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { claimWhatsAppTextPendingOperation } from "./interactiveCallback";
import {
  buildWhatsappClosedDecisionReply,
  type WhatsappInteractionAction,
} from "./interactionPresentation";
import type {
  WhatsappInteractionTextClassification,
  WhatsappInteractionTextInput,
  WhatsappInteractionTextResult,
} from "./interactionTextHandlers";
import type { WhatsappIntentFoodItem } from "./intentSchema";
import { supersedeActiveWhatsappPendingOperations } from "./pendingOperationPrecedence";
import {
  buildWhatsAppActionCancelledReplyMessage,
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppRecoverableErrorReplyMessage,
} from "./replyMessages";
import {
  isStandaloneWhatsappCancellationWord,
  normalizeStandaloneWhatsappCommand,
} from "./standaloneCommandWords";

export const PENDING_COFFEE_PREPARATION_CLARIFICATION_TYPE =
  "coffee_preparation_clarification";
export const PENDING_COFFEE_PREPARATION_CLARIFICATION_ORIGIN =
  "coffeePreparationClarification";
export const COFFEE_PREPARATION_CLARIFICATION_INTERACTION_ID =
  "coffee_preparation.sugar_choice";
export const PENDING_COFFEE_PREPARATION_CLARIFICATION_TTL_MS = 10 * 60 * 1000;

export type CoffeePreparationChoice = "without_sugar" | "with_sugar";
export type CoffeePreparationClassification =
  | "ambiguous"
  | CoffeePreparationChoice
  | "other";

export const COFFEE_PREPARATION_CLARIFICATION_ACTIONS = [
  { id: "without_sugar", label: "Sem açúcar", effect: "complete_coffee_preparation_once" },
  { id: "with_sugar", label: "Com açúcar", effect: "complete_coffee_preparation_once" },
  { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
] as const satisfies readonly WhatsappInteractionAction[];

export type PendingCoffeePreparationClarification = {
  contractVersion: 1;
  interactionId: typeof COFFEE_PREPARATION_CLARIFICATION_INTERACTION_ID;
  kind: "coffee_preparation_clarification";
  originalText: string;
  originalReceivedAt: string;
  inboundMessageId: string | null;
  userTimezone: string;
  mealLabel: string;
  createIfMissing: boolean;
  intentDate: string | null;
  items: WhatsappIntentFoodItem[];
  ambiguousItemIndexes: number[];
  instructionText: string;
  actions: WhatsappInteractionAction[];
};

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

function normalizePreparationText(value: string) {
  return normalizeStandaloneWhatsappCommand(value)
    .replace(/\s+/g, " ")
    .trim();
}

function itemDescription(item: WhatsappIntentFoodItem) {
  return [item.foodName, item.preparation].filter(Boolean).join(" ").trim();
}

export function classifyWhatsappCoffeePreparation(
  item: WhatsappIntentFoodItem,
): CoffeePreparationClassification {
  const description = itemDescription(item);
  const normalized = normalizePreparationText(description);
  if (!/(?:^|\s)cafe(?:\s|$)/.test(normalized)) return "other";

  if (isCoffeeWithAddedSugar(description)) return "with_sugar";
  if (
    /\bsem (?:adicao de )?acucar\b/.test(normalized)
    || /\b(?:puro|preto|natural)\b/.test(normalized)
  ) {
    return "without_sugar";
  }

  if (/\b(?:leite|mel|creme|chantilly|condensad[oa]|chocolate|cacau)\b/.test(normalized)) {
    return "other";
  }

  return "ambiguous";
}

export function qualifyWhatsappCoffeeItem(
  item: WhatsappIntentFoodItem,
  choice: CoffeePreparationChoice,
): WhatsappIntentFoodItem {
  if (classifyWhatsappCoffeePreparation(item) !== "ambiguous") return { ...item };
  const qualifier = choice === "without_sugar" ? "sem açúcar" : "com açúcar";
  return {
    ...item,
    preparation: [item.preparation, qualifier].filter(Boolean).join(" ").trim(),
  };
}

export function parseCoffeePreparationChoice(
  text?: string | null,
): CoffeePreparationChoice | null {
  const normalized = normalizePreparationText(text ?? "");
  if (/^(?:sem acucar|sem adicao de acucar|puro|preto|natural)(?: por favor)?$/.test(normalized)) {
    return "without_sugar";
  }
  if (/^(?:com acucar|adocado|acucarado)(?: por favor)?$/.test(normalized)) {
    return "with_sugar";
  }
  return null;
}

export function isPendingCoffeePreparationClarification(
  value: unknown,
): value is PendingCoffeePreparationClarification {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<PendingCoffeePreparationClarification>;
  return target.contractVersion === 1
    && target.interactionId === COFFEE_PREPARATION_CLARIFICATION_INTERACTION_ID
    && target.kind === "coffee_preparation_clarification"
    && typeof target.originalText === "string"
    && typeof target.originalReceivedAt === "string"
    && (target.inboundMessageId === null || typeof target.inboundMessageId === "string")
    && typeof target.userTimezone === "string"
    && typeof target.mealLabel === "string"
    && typeof target.createIfMissing === "boolean"
    && (target.intentDate === null || typeof target.intentDate === "string")
    && Array.isArray(target.items)
    && Array.isArray(target.ambiguousItemIndexes)
    && target.ambiguousItemIndexes.length > 0
    && typeof target.instructionText === "string"
    && Array.isArray(target.actions);
}

function buildInteractiveReply(
  pendingOperationId: number,
  target: PendingCoffeePreparationClarification,
) {
  return buildWhatsappClosedDecisionReply({
    bodyText: target.instructionText,
    pendingOperationId,
    actions: target.actions,
  });
}

export async function createWhatsappCoffeePreparationClarification(input: {
  userId: number;
  originalText: string;
  receivedAt: Date;
  messageId?: string | null;
  userTimezone: string;
  mealLabel: string;
  createIfMissing: boolean;
  intentDate?: string | null;
  items: WhatsappIntentFoodItem[];
  ambiguousItemIndexes: number[];
}) {
  if (!input.ambiguousItemIndexes.length) return null;

  if (!(await supersedeActiveWhatsappPendingOperations(input.userId, input.receivedAt))) {
    return {
      handled: true as const,
      action: "clarification_needed" as const,
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui substituir uma pergunta pendente com segurança. Envie CANCELAR e repita a mensagem completa.",
      ),
      eventType: "whatsapp.coffee_preparation_clarification.pending_replacement_blocked",
      detail: "Clarificação de preparo do café não conseguiu substituir a pendência anterior.",
      data: { fallbackBlocked: true, fallbackBlockReason: "pending_replacement_failed" },
    };
  }

  const target: PendingCoffeePreparationClarification = {
    contractVersion: 1,
    interactionId: COFFEE_PREPARATION_CLARIFICATION_INTERACTION_ID,
    kind: "coffee_preparation_clarification",
    originalText: input.originalText,
    originalReceivedAt: input.receivedAt.toISOString(),
    inboundMessageId: input.messageId?.trim() || null,
    userTimezone: input.userTimezone,
    mealLabel: input.mealLabel,
    createIfMissing: input.createIfMissing,
    intentDate: input.intentDate?.trim() || null,
    items: input.items.map(item => ({ ...item })),
    ambiguousItemIndexes: [...input.ambiguousItemIndexes],
    instructionText: "Seu café foi sem açúcar ou com açúcar?",
    actions: COFFEE_PREPARATION_CLARIFICATION_ACTIONS.map(action => ({ ...action })),
  };

  const created = await pendingOperationRepository.createPendingOperation({
    userId: input.userId,
    type: PENDING_COFFEE_PREPARATION_CLARIFICATION_TYPE,
    origin: PENDING_COFFEE_PREPARATION_CLARIFICATION_ORIGIN,
    target,
    ttlMs: PENDING_COFFEE_PREPARATION_CLARIFICATION_TTL_MS,
    now: input.receivedAt,
  });

  if (!created) {
    return {
      handled: true as const,
      action: "clarification_needed" as const,
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui guardar a pergunta sobre o preparo do café com segurança. Nada foi registrado; envie a mensagem completa novamente.",
      ),
      eventType: "whatsapp.coffee_preparation_clarification.persistence_unavailable",
      detail: "Clarificação de preparo não foi persistida; nenhuma pergunta órfã foi enviada.",
      data: { fallbackBlocked: true, fallbackBlockReason: "persistence_unavailable" },
    };
  }

  return {
    handled: true as const,
    action: "clarification_needed" as const,
    reply: buildWhatsAppClarificationReplyMessage(target.instructionText),
    interactiveReply: buildInteractiveReply(created.id, target),
    eventType: "whatsapp.coffee_preparation_clarification.requested",
    detail: "Café genérico aguardando escolha persistente de preparo antes de qualquer mutação nutricional.",
    data: {
      pendingOperationId: created.id,
      pendingType: PENDING_COFFEE_PREPARATION_CLARIFICATION_TYPE,
      interactionId: COFFEE_PREPARATION_CLARIFICATION_INTERACTION_ID,
      interactionClassification: "closed",
      interactionLifecycle: "created",
      preservedMealLabel: target.mealLabel,
      preservedIntentDate: target.intentDate,
      preservedItemCount: target.items.length,
      preservedCoffeeIndexes: target.ambiguousItemIndexes,
      originalTextPreserved: true,
    },
  };
}

export function classifyCoffeePreparationClarificationText(
  target: unknown,
  text?: string | null,
): WhatsappInteractionTextClassification {
  if (!isPendingCoffeePreparationClarification(target)) return "invalid";
  if (isStandaloneWhatsappCancellationWord(text)) return "resolve";
  return parseCoffeePreparationChoice(text) ? "resolve" : "invalid";
}

async function resumeCoffeePreparation(input: {
  userId: number;
  target: PendingCoffeePreparationClarification;
  choice: CoffeePreparationChoice;
  receivedAt?: Date;
  userTimezone?: string | null;
}) {
  const { resumeWhatsappStructuredCoffeePreparation } = await import("./llmIntentActions");
  return resumeWhatsappStructuredCoffeePreparation({
    userId: input.userId,
    target: input.target,
    choice: input.choice,
    receivedAt: input.receivedAt,
    userTimezone: input.userTimezone,
  });
}

export async function resolveCoffeePreparationClarificationText(
  input: WhatsappInteractionTextInput,
): Promise<WhatsappInteractionTextResult | null> {
  const target = input.pendingOperation.target;
  if (!isPendingCoffeePreparationClarification(target)) return null;
  const cancel = isStandaloneWhatsappCancellationWord(input.text);
  const choice = parseCoffeePreparationChoice(input.text);
  if (!cancel && !choice) return null;

  const action = cancel ? "cancel" : choice!;
  const claim = await claimWhatsAppTextPendingOperation(
    input.userId,
    PENDING_COFFEE_PREPARATION_CLARIFICATION_TYPE,
    action,
    input.receivedAt,
  );
  if (claim.status !== "claimed") return null;

  if (cancel) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppActionCancelledReplyMessage("Tudo certo. Não registrei o café nem os alimentos acompanhantes."),
      eventType: "whatsapp.coffee_preparation_clarification.cancelled",
      detail: "Clarificação de preparo cancelada sem mutação.",
      data: { interactionLifecycle: "cancelled", originalTextPreserved: true },
    };
  }

  const result = await resumeCoffeePreparation({
    userId: input.userId,
    target,
    choice: choice!,
    receivedAt: input.receivedAt,
    userTimezone: input.userTimezone,
  });
  if (!result) return null;
  return {
    ...result,
    detail: `${result.detail} Preparo do café retomado a partir do contexto persistido.`,
    data: {
      ...(result.data ?? {}),
      originalTextPreserved: true,
      originalReceivedAtPreserved: true,
      preservedMealLabel: target.mealLabel,
      preservedIntentDate: target.intentDate,
      preparationChoice: choice,
    },
  };
}

export function rebuildCoffeePreparationClarification(
  pendingOperation: WhatsAppPendingOperationRecord,
) {
  const target = pendingOperation.target;
  if (!isPendingCoffeePreparationClarification(target)) return null;
  return {
    reply: buildWhatsAppClarificationReplyMessage(target.instructionText),
    interactiveReply: buildInteractiveReply(pendingOperation.id, target),
  };
}

export async function completeWhatsappCoffeePreparationClarificationCallback(input: {
  userId: number;
  pendingOperation: WhatsAppPendingOperationRecord;
  action: string;
  receivedAt?: Date;
  userTimezone?: string | null;
}) {
  const target = input.pendingOperation.target;
  if (!isPendingCoffeePreparationClarification(target)) return null;
  if (input.action === "cancel") {
    return {
      handled: true as const,
      action: "clarification_needed",
      reply: buildWhatsAppActionCancelledReplyMessage("Tudo certo. Não registrei o café nem os alimentos acompanhantes."),
      eventType: "whatsapp.coffee_preparation_clarification.cancelled",
      detail: "Clarificação de preparo cancelada por callback sem mutação.",
      data: { interactionLifecycle: "cancelled", originalTextPreserved: true },
    };
  }
  if (input.action !== "without_sugar" && input.action !== "with_sugar") {
    return null;
  }

  const result = await resumeCoffeePreparation({
    userId: input.userId,
    target,
    choice: input.action,
    receivedAt: input.receivedAt,
    userTimezone: input.userTimezone,
  });
  if (!result) return null;
  return {
    ...result,
    detail: `${result.detail} Preparo do café retomado por callback a partir do contexto persistido.`,
    data: {
      ...(result.data ?? {}),
      originalTextPreserved: true,
      originalReceivedAtPreserved: true,
      preservedMealLabel: target.mealLabel,
      preservedIntentDate: target.intentDate,
      preparationChoice: input.action,
    },
  };
}
