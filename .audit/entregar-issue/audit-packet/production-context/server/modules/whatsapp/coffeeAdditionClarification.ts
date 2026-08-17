import { normalizeMeasurementUnit } from "../../../shared/measurementUnits";
import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { claimWhatsAppTextPendingOperation } from "./interactiveCallback";
import type { CoffeeAdditionIntent, WhatsappIntentResult } from "./intent/types";
import type { WhatsappInteractionAction } from "./interactionPresentation";
import type {
  WhatsappInteractionTextClassification,
  WhatsappInteractionTextInput,
  WhatsappInteractionTextResult,
} from "./interactionTextHandlers";
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

export const PENDING_COFFEE_ADDITION_CLARIFICATION_TYPE = "coffee_addition_clarification";
export const PENDING_COFFEE_ADDITION_CLARIFICATION_ORIGIN = "coffeeAdditionClarification";
export const PENDING_COFFEE_ADDITION_CLARIFICATION_TTL_MS = 10 * 60 * 1000;
export const COFFEE_ADDITION_CLARIFICATION_INTERACTION_ID = "coffee_addition.missing_field";

export const COFFEE_ADDITION_CLARIFICATION_ACTIONS = [
  { id: "provide_missing", label: "Informar dado", effect: "complete_coffee_addition_once" },
  { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
] as const satisfies readonly WhatsappInteractionAction[];

type MissingCoffeeAdditionField = "quantity" | "meal";

export type PendingCoffeeAdditionClarification = {
  contractVersion: 1;
  interactionId: typeof COFFEE_ADDITION_CLARIFICATION_INTERACTION_ID;
  kind: "coffee_addition_clarification";
  originalText: string;
  originalReceivedAt: string;
  missingField: MissingCoffeeAdditionField;
  cups: number;
  unit: string | null;
  mealLabel: string | null;
  instructionText: string;
  actions: WhatsappInteractionAction[];
};

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

function normalizeText(value: string) {
  return normalizeStandaloneWhatsappCommand(value)
    .replace(/\s+/g, " ")
    .trim();
}

function formatQuantity(addition: Pick<CoffeeAdditionIntent, "cups" | "unit">) {
  const unit = addition.unit === "copo"
    ? (addition.cups === 1 ? "copo" : "copos")
    : (addition.cups === 1 ? "xícara" : "xícaras");
  return `${addition.cups} ${unit}`;
}

function buildInstruction(missingField: MissingCoffeeAdditionField, addition: CoffeeAdditionIntent) {
  if (missingField === "quantity") {
    return `Entendi que você quer adicionar café sem açúcar à refeição ${addition.mealLabel}. Me diga apenas a quantidade, por exemplo: 3 xícaras.`;
  }
  return `Entendi que você quer adicionar ${formatQuantity(addition)} de café sem açúcar. Me diga apenas a refeição, por exemplo: café da manhã.`;
}

export function isPendingCoffeeAdditionClarification(value: unknown): value is PendingCoffeeAdditionClarification {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<PendingCoffeeAdditionClarification>;
  return target.contractVersion === 1
    && target.interactionId === COFFEE_ADDITION_CLARIFICATION_INTERACTION_ID
    && target.kind === "coffee_addition_clarification"
    && (target.missingField === "quantity" || target.missingField === "meal")
    && typeof target.originalText === "string"
    && typeof target.originalReceivedAt === "string"
    && typeof target.cups === "number"
    && (target.unit === null || typeof target.unit === "string")
    && (target.mealLabel === null || typeof target.mealLabel === "string")
    && typeof target.instructionText === "string"
    && Array.isArray(target.actions);
}

export function parseCoffeeAdditionClarificationQuantity(text?: string | null) {
  const normalized = normalizeText(text ?? "");
  const match = normalized.match(/^(\d+(?:[,.]\d+)?)\s*(xicaras?|copos?)$/i);
  if (!match) return null;
  const quantity = Number(match[1].replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const unit = normalizeMeasurementUnit(match[2]);
  if (unit !== "xícara" && unit !== "copo") return null;
  return { quantity, unit };
}

export function parseCoffeeAdditionClarificationMeal(text?: string | null) {
  const normalized = normalizeText(text ?? "")
    .replace(/^(?:no|na|ao|a|para o|para a)\s+(?:refeicao\s+)?/, "")
    .replace(/^refeicao\s+/, "")
    .trim();
  const meals: Array<[RegExp, string]> = [
    [/^(?:cafe da manha|desjejum|cafe)$/i, "café da manhã"],
    [/^almoco$/i, "almoço"],
    [/^jantar$/i, "jantar"],
    [/^lanche da tarde$/i, "lanche da tarde"],
    [/^lanche$/i, "lanche"],
    [/^ceia$/i, "ceia"],
    [/^pre[ -]?treino$/i, "pré-treino"],
    [/^pos[ -]?treino$/i, "pós-treino"],
  ];
  return meals.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

export async function createWhatsappCoffeeAdditionClarification(input: {
  userId: number;
  originalText: string;
  addition: CoffeeAdditionIntent;
  receivedAt: Date;
}): Promise<WhatsappIntentResult> {
  const missingField: MissingCoffeeAdditionField | null = !input.addition.cups && input.addition.mealLabel
    ? "quantity"
    : input.addition.cups && !input.addition.mealLabel
      ? "meal"
      : null;

  if (!missingField) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage(
        "Entendi que você quer adicionar café sem açúcar. Me diga a quantidade e a refeição. Exemplo: adicionar 3 xícaras de café sem açúcar à refeição café da manhã.",
      ),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido para adicionar café sem açúcar sem quantidade nem refeição explícitas.",
    };
  }

  if (!(await supersedeActiveWhatsappPendingOperations(input.userId, input.receivedAt))) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui substituir uma pergunta pendente com segurança. Envie CANCELAR e repita o comando completo.",
      ),
      eventType: "whatsapp.coffee_addition_clarification.pending_replacement_blocked",
      detail: "Clarificação parcial de café não conseguiu substituir a pendência anterior.",
      data: { fallbackBlocked: true, fallbackBlockReason: "pending_replacement_failed" },
    };
  }

  const instructionText = buildInstruction(missingField, input.addition);
  const target: PendingCoffeeAdditionClarification = {
    contractVersion: 1,
    interactionId: COFFEE_ADDITION_CLARIFICATION_INTERACTION_ID,
    kind: "coffee_addition_clarification",
    originalText: input.originalText,
    originalReceivedAt: input.receivedAt.toISOString(),
    missingField,
    cups: input.addition.cups,
    unit: input.addition.unit,
    mealLabel: input.addition.mealLabel,
    instructionText,
    actions: COFFEE_ADDITION_CLARIFICATION_ACTIONS.map(action => ({ ...action })),
  };

  const created = await pendingOperationRepository.createPendingOperation({
    userId: input.userId,
    type: PENDING_COFFEE_ADDITION_CLARIFICATION_TYPE,
    origin: PENDING_COFFEE_ADDITION_CLARIFICATION_ORIGIN,
    target,
    ttlMs: PENDING_COFFEE_ADDITION_CLARIFICATION_TTL_MS,
    now: input.receivedAt,
  });

  if (!created) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui guardar essa pergunta com segurança. Envie novamente o comando completo com quantidade e refeição.",
      ),
      eventType: "whatsapp.coffee_addition_clarification.persistence_unavailable",
      detail: "Clarificação parcial de café não foi persistida; nenhuma pergunta órfã foi enviada.",
      data: { fallbackBlocked: true, fallbackBlockReason: "persistence_unavailable" },
    };
  }

  return {
    handled: true,
    action: "clarification_needed",
    reply: buildWhatsAppClarificationReplyMessage(instructionText),
    eventType: "whatsapp.intent.clarification_needed",
    detail: missingField === "quantity"
      ? "Pedido para adicionar café sem açúcar com refeição reconhecida e quantidade ausente; contexto persistido."
      : "Pedido para adicionar café sem açúcar com quantidade reconhecida e refeição ausente; contexto persistido.",
    data: {
      pendingOperationId: created.id,
      pendingType: PENDING_COFFEE_ADDITION_CLARIFICATION_TYPE,
      interactionId: COFFEE_ADDITION_CLARIFICATION_INTERACTION_ID,
      interactionComponent: "text",
      interactionActionCount: target.actions.length,
      preservedMealLabel: target.mealLabel,
      preservedQuantity: target.cups || null,
      preservedUnit: target.unit,
      missingField,
    },
  };
}

export function classifyCoffeeAdditionClarificationText(
  target: unknown,
  text?: string | null,
): WhatsappInteractionTextClassification {
  if (!isPendingCoffeeAdditionClarification(target)) return "invalid";
  if (isStandaloneWhatsappCancellationWord(text)) return "resolve";
  return target.missingField === "quantity"
    ? (parseCoffeeAdditionClarificationQuantity(text) ? "resolve" : "invalid")
    : (parseCoffeeAdditionClarificationMeal(text) ? "resolve" : "invalid");
}

export async function resolveCoffeeAdditionClarificationText(
  input: WhatsappInteractionTextInput,
): Promise<WhatsappInteractionTextResult | null> {
  const target = input.pendingOperation.target;
  if (!isPendingCoffeeAdditionClarification(target)) return null;
  const cancel = isStandaloneWhatsappCancellationWord(input.text);
  const quantity = target.missingField === "quantity"
    ? parseCoffeeAdditionClarificationQuantity(input.text)
    : null;
  const mealLabel = target.missingField === "meal"
    ? parseCoffeeAdditionClarificationMeal(input.text)
    : null;
  if (!cancel && !quantity && !mealLabel) return null;

  const action = cancel ? "cancel" : "provide_missing";
  const claim = await claimWhatsAppTextPendingOperation(
    input.userId,
    PENDING_COFFEE_ADDITION_CLARIFICATION_TYPE,
    action,
    input.receivedAt,
  );
  if (claim.status !== "claimed") return null;

  if (cancel) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppActionCancelledReplyMessage("Tudo certo. Não adicionei o café."),
      eventType: "whatsapp.coffee_addition_clarification.cancelled",
      detail: "Clarificação parcial de café cancelada sem mutação.",
      data: { interactionLifecycle: "cancelled" },
    };
  }

  const completed: CoffeeAdditionIntent = {
    cups: quantity?.quantity ?? target.cups,
    unit: quantity?.unit ?? target.unit,
    mealLabel: mealLabel ?? target.mealLabel,
  };
  const originalReceivedAt = new Date(target.originalReceivedAt);
  const referenceDate = Number.isFinite(originalReceivedAt.getTime())
    ? originalReceivedAt
    : (input.receivedAt ?? new Date());
  const { handleCoffeeAdditionIntent } = await import("./intent/foodAdditionHandlers");
  const result = await handleCoffeeAdditionIntent(
    input.userId,
    target.originalText,
    completed,
    referenceDate,
    input.userTimezone,
  );
  return {
    ...result,
    detail: `${result.detail} Clarificação parcial retomada com contexto persistido.`,
    data: {
      ...(result.data ?? {}),
      originalTextPreserved: true,
      originalReceivedAtPreserved: true,
      preservedMealLabel: target.mealLabel,
      preservedQuantity: target.cups || null,
      preservedUnit: target.unit,
    },
  };
}

export function rebuildCoffeeAdditionClarification(
  pendingOperation: WhatsAppPendingOperationRecord,
) {
  const target = pendingOperation.target;
  if (!isPendingCoffeeAdditionClarification(target)) return null;
  return { reply: buildWhatsAppClarificationReplyMessage(target.instructionText) };
}

export async function completeWhatsappCoffeeAdditionClarificationCallback(input: {
  userId: number;
  pendingOperation: WhatsAppPendingOperationRecord;
  action: string;
}) {
  const target = input.pendingOperation.target;
  if (!isPendingCoffeeAdditionClarification(target) || input.action !== "cancel") {
    return {
      handled: true as const,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage(target && isPendingCoffeeAdditionClarification(target)
        ? target.instructionText
        : "Essa pergunta não está mais disponível. Envie o comando completo novamente."),
      eventType: "whatsapp.coffee_addition_clarification.unavailable",
      detail: "Callback incompatível com clarificação aberta de café.",
    };
  }
  return {
    handled: true as const,
    action: "clarification_needed",
    reply: buildWhatsAppActionCancelledReplyMessage("Tudo certo. Não adicionei o café."),
    eventType: "whatsapp.coffee_addition_clarification.cancelled",
    detail: "Clarificação parcial de café cancelada sem mutação.",
  };
}
