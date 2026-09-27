import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { processMealInput, type MealProcessingResult } from "../../nutritionEngine";
import { claimWhatsAppTextPendingOperation } from "./interactiveCallback";
import {
  buildWhatsappClosedDecisionReply,
  buildWhatsappInteractionTelemetry,
  type WhatsappInteractionAction,
} from "./interactionPresentation";
import type {
  WhatsappInteractionTextClassification,
  WhatsappInteractionTextInput,
  WhatsappInteractionTextResult,
} from "./interactionTextHandlers";
import { buildWhatsAppActionCancelledReplyMessage, buildWhatsAppRecoverableErrorReplyMessage } from "./replyMessages";
import { buildWhatsAppMealCalculationReplyMessage } from "./replyMessages";
import type { WhatsAppLogicalReply } from "./replyContract";
import { normalizeStandaloneWhatsappCommand } from "./standaloneCommandWords";
import { supersedeActiveWhatsappPendingOperations } from "./pendingOperationPrecedence";

export const PENDING_QUESTION_MEAL_CALCULATION_TYPE = "question_meal_calculation";
export const PENDING_QUESTION_MEAL_CALCULATION_ORIGIN = "aiQuestionAssistant";
export const QUESTION_MEAL_CALCULATION_INTERACTION_ID = "question.meal_calculation";
export const QUESTION_MEAL_CALCULATION_TTL_MS = 10 * 60 * 1000;

const QUESTION_MEAL_CALCULATION_SOURCE_TEXT =
  "1 fatia de pão integral, 20 g de mussarela e 6 tomates-cereja";
const QUESTION_MEAL_CALCULATION_PROMPT =
  "Quer que eu calcule as calorias dessa opção?";

export const QUESTION_MEAL_CALCULATION_ACTIONS = [
  { id: "calculate", label: "Calcular", effect: "calculate_suggestion_once" },
  { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
] as const satisfies readonly WhatsappInteractionAction[];

export type QuestionMealCalculationAction =
  (typeof QUESTION_MEAL_CALCULATION_ACTIONS)[number]["id"];

type QuestionMealCalculationSnapshot = Pick<
  MealProcessingResult,
  "detectedMealLabel" | "sourceText" | "confidence" | "reasoning" | "items" | "totals"
>;

export type PendingQuestionMealCalculation = {
  contractVersion: 1;
  interactionId: typeof QUESTION_MEAL_CALCULATION_INTERACTION_ID;
  kind: "question_meal_calculation";
  originalQuestion: string;
  inboundMessageId: string | null;
  userTimezone: string;
  option: QuestionMealCalculationSnapshot;
  actions: WhatsappInteractionAction[];
};

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

function hasCanonicalActions(value: unknown): value is WhatsappInteractionAction[] {
  if (!Array.isArray(value) || value.length !== QUESTION_MEAL_CALCULATION_ACTIONS.length) return false;
  return QUESTION_MEAL_CALCULATION_ACTIONS.every((expected, index) => {
    const candidate = value[index] as Partial<WhatsappInteractionAction> | undefined;
    return candidate?.id === expected.id
      && candidate.label === expected.label
      && candidate.effect === expected.effect;
  });
}

function isSnapshot(value: unknown): value is QuestionMealCalculationSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<QuestionMealCalculationSnapshot>;
  return typeof snapshot.detectedMealLabel === "string"
    && typeof snapshot.sourceText === "string"
    && typeof snapshot.confidence === "number"
    && typeof snapshot.reasoning === "string"
    && Array.isArray(snapshot.items)
    && snapshot.items.length > 0
    && Boolean(snapshot.totals)
    && typeof snapshot.totals?.calories === "number"
    && typeof snapshot.totals?.protein === "number"
    && typeof snapshot.totals?.carbs === "number"
    && typeof snapshot.totals?.fat === "number";
}

export function isPendingQuestionMealCalculation(
  value: unknown,
): value is PendingQuestionMealCalculation {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<PendingQuestionMealCalculation>;
  return target.contractVersion === 1
    && target.interactionId === QUESTION_MEAL_CALCULATION_INTERACTION_ID
    && target.kind === "question_meal_calculation"
    && typeof target.originalQuestion === "string"
    && target.originalQuestion.trim().length > 0
    && (target.inboundMessageId === null || typeof target.inboundMessageId === "string")
    && typeof target.userTimezone === "string"
    && isSnapshot(target.option)
    && hasCanonicalActions(target.actions);
}

function normalizeQuestion(value: string) {
  return normalizeStandaloneWhatsappCommand(value).replace(/\s+/g, " ").trim();
}

/**
 * Only this explicit, supported QUESTION shape may create a future calculation.
 * Arbitrary AI prose never becomes an executable continuation.
 */
export function supportsQuestionMealCalculation(question: string) {
  const normalized = normalizeQuestion(question);
  return /\b(?:opcao|sugestao|ideia)\b/.test(normalized)
    && /\bcafe da tarde\b/.test(normalized);
}

export function getQuestionMealCalculationSourceText() {
  return QUESTION_MEAL_CALCULATION_SOURCE_TEXT;
}

function buildInteractiveReply(pendingOperationId: number): WhatsAppLogicalReply {
  return buildWhatsappClosedDecisionReply({
    bodyText: QUESTION_MEAL_CALCULATION_PROMPT,
    pendingOperationId,
    actions: [...QUESTION_MEAL_CALCULATION_ACTIONS],
  });
}

function buildPendingResult(
  pending: WhatsAppPendingOperationRecord,
  lifecycle: "created" | "represented" = "created",
): WhatsappInteractionTextResult {
  const target = pending.target as PendingQuestionMealCalculation;
  return {
    handled: true,
    action: "clarification_needed",
    reply: QUESTION_MEAL_CALCULATION_PROMPT,
    eventType: lifecycle === "created"
      ? "whatsapp.question_meal_calculation.requested"
      : "whatsapp.question_meal_calculation.represented",
    detail: lifecycle === "created"
      ? "Continuação de cálculo persistida antes da pergunta de confirmação."
      : "Continuação de cálculo reconstruída da pendência persistida sem consumir a operação.",
    data: {
      pendingOperationId: pending.id,
      pendingType: pending.type,
      interactionId: target.interactionId,
      interactionLifecycle: lifecycle,
      structuredContinuation: true,
      calculationSnapshotPreserved: true,
      preservedItemCount: target.option.items.length,
    },
    interactiveReply: buildInteractiveReply(pending.id),
  };
}

function buildPersistenceFailure(): WhatsappInteractionTextResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: buildWhatsAppRecoverableErrorReplyMessage(
      "Não consegui guardar essa opção calculável com segurança. Nada foi registrado; envie a pergunta novamente.",
    ),
    eventType: "whatsapp.question_meal_calculation.persistence_failed",
    detail: "A continuação estruturada não foi persistida; a oferta de confirmação foi bloqueada.",
    data: {
      fallbackBlocked: true,
      fallbackBlockReason: "question_meal_calculation_persistence_failed",
      interactionId: QUESTION_MEAL_CALCULATION_INTERACTION_ID,
      interactionLifecycle: "blocked",
    },
  };
}

export async function createQuestionMealCalculationContinuation(input: {
  userId: number;
  question: string;
  receivedAt?: Date;
  messageId?: string | null;
  userTimezone?: string | null;
}): Promise<WhatsappInteractionTextResult | null> {
  if (!supportsQuestionMealCalculation(input.question)) return null;

  const receivedAt = input.receivedAt ?? new Date();
  const timeZone = input.userTimezone ?? DEFAULT_APP_TIME_ZONE;
  const inboundMessageId = input.messageId?.trim() || null;
  const existing = await pendingOperationRepository.getActivePendingOperation(input.userId, receivedAt);
  if (
    existing
    && existing.type === PENDING_QUESTION_MEAL_CALCULATION_TYPE
    && isPendingQuestionMealCalculation(existing.target)
    && inboundMessageId
    && existing.target.inboundMessageId === inboundMessageId
  ) {
    return buildPendingResult(existing);
  }

  let option: MealProcessingResult;
  try {
    option = await processMealInput({
      text: QUESTION_MEAL_CALCULATION_SOURCE_TEXT,
      occurredAt: receivedAt,
      timeZone,
    });
  } catch {
    return null;
  }
  if (!option.items.length) return null;

  if (!(await supersedeActiveWhatsappPendingOperations(input.userId, receivedAt))) {
    return buildPersistenceFailure();
  }

  const target: PendingQuestionMealCalculation = {
    contractVersion: 1,
    interactionId: QUESTION_MEAL_CALCULATION_INTERACTION_ID,
    kind: "question_meal_calculation",
    originalQuestion: input.question.trim(),
    inboundMessageId,
    userTimezone: timeZone,
    option: {
      detectedMealLabel: option.detectedMealLabel,
      sourceText: option.sourceText,
      confidence: option.confidence,
      reasoning: option.reasoning,
      items: option.items.map(item => ({ ...item })),
      totals: { ...option.totals },
    },
    actions: QUESTION_MEAL_CALCULATION_ACTIONS.map(action => ({ ...action })),
  };

  const created = await pendingOperationRepository.createPendingOperation({
    userId: input.userId,
    type: PENDING_QUESTION_MEAL_CALCULATION_TYPE,
    origin: PENDING_QUESTION_MEAL_CALCULATION_ORIGIN,
    target,
    ttlMs: QUESTION_MEAL_CALCULATION_TTL_MS,
    now: receivedAt,
    dedupeKey: inboundMessageId
      ? `${PENDING_QUESTION_MEAL_CALCULATION_TYPE}:${inboundMessageId}`
      : null,
  });
  if (!created) return buildPersistenceFailure();

  return buildPendingResult(created);
}

export function parseQuestionMealCalculationAction(
  text?: string | null,
): QuestionMealCalculationAction | null {
  const normalized = normalizeStandaloneWhatsappCommand(text ?? "");
  if (["nao", "cancelar", "cancele", "cancela", "0"].includes(normalized)) return "cancel";
  if (["sim", "pode", "pode sim", "quero", "ok", "certo", "calcule", "calcular", "faca isso", "faz isso", "1"].includes(normalized)) return "calculate";
  return null;
}

export function classifyQuestionMealCalculationText(
  target: unknown,
  text?: string | null,
): WhatsappInteractionTextClassification {
  if (!isPendingQuestionMealCalculation(target)) return "invalid";
  return parseQuestionMealCalculationAction(text) ? "resolve" : "invalid";
}

function buildCalculationResult(target: PendingQuestionMealCalculation, userId: number) {
  const option = target.option;
  return {
    handled: true as const,
    action: "question_meal_calculation_completed",
    reply: buildWhatsAppMealCalculationReplyMessage({
      ...option,
      imageUrl: undefined,
      audioUrl: undefined,
      transcript: undefined,
      needsConfirmation: false,
    }, { timeZone: target.userTimezone }),
    eventType: "whatsapp.question_meal_calculation.completed",
    detail: "Cálculo executado uma única vez a partir do snapshot nutricional persistido; nenhum consumo foi registrado.",
    data: {
      userId,
      interactionId: target.interactionId,
      structuredContinuation: true,
      calculationSnapshotPreserved: true,
      consumptionPersisted: false,
      executedOnce: true,
      itemCount: option.items.length,
    },
  };
}

async function recreateAfterRecoverableFailure(input: {
  userId: number;
  pendingOperation: WhatsAppPendingOperationRecord;
  receivedAt?: Date;
}) {
  const target = input.pendingOperation.target;
  if (!isPendingQuestionMealCalculation(target)) return buildPersistenceFailure();
  const recoveryDedupeKey = target.inboundMessageId
    ? `${PENDING_QUESTION_MEAL_CALCULATION_TYPE}:${target.inboundMessageId}:recovery`
    : `${PENDING_QUESTION_MEAL_CALCULATION_TYPE}:recovery:${input.pendingOperation.id}`;
  const recreated = await pendingOperationRepository.createPendingOperation({
    userId: input.userId,
    type: PENDING_QUESTION_MEAL_CALCULATION_TYPE,
    origin: PENDING_QUESTION_MEAL_CALCULATION_ORIGIN,
    target,
    ttlMs: QUESTION_MEAL_CALCULATION_TTL_MS,
    now: input.receivedAt,
    dedupeKey: recoveryDedupeKey,
  });
  if (!recreated) return buildPersistenceFailure();
  return {
    ...buildPendingResult(recreated),
    reply: buildWhatsAppRecoverableErrorReplyMessage(
      "Não consegui concluir o cálculo agora. A opção foi preservada; responda novamente para tentar sem registrar consumo.",
    ),
    eventType: "whatsapp.question_meal_calculation.recovery_requested",
    detail: "Falha recuperável após claim recriou a continuação com o snapshot original, sem declarar sucesso.",
    data: {
      ...(buildPendingResult(recreated).data ?? {}),
      recovery: true,
      retryable: true,
    },
  };
}

/**
 * Reabre uma continuação que já foi consumida quando a resposta primária não
 * chegou ao WhatsApp. A chave estável evita duas pendências quando duas
 * tentativas de recuperação ocorrem ao mesmo tempo.
 */
export async function recoverQuestionMealCalculationAfterDeliveryFailure(input: {
  userId: number;
  pendingOperationId: number;
  receivedAt?: Date;
}) {
  const pendingOperation = await pendingOperationRepository.getPendingOperationById(
    input.pendingOperationId,
  );
  if (
    !pendingOperation
    || pendingOperation.userId !== input.userId
    || pendingOperation.type !== PENDING_QUESTION_MEAL_CALCULATION_TYPE
    || !isPendingQuestionMealCalculation(pendingOperation.target)
  ) {
    return null;
  }

  const now = input.receivedAt ?? new Date();
  const active = await pendingOperationRepository.getActivePendingOperation(input.userId, now);
  if (
    active
    && active.type === PENDING_QUESTION_MEAL_CALCULATION_TYPE
    && isPendingQuestionMealCalculation(active.target)
  ) {
    return buildPendingResult(active, "represented");
  }

  if (pendingOperation.state === "active") return buildPendingResult(pendingOperation);
  return recreateAfterRecoverableFailure({
    userId: input.userId,
    pendingOperation,
    receivedAt: now,
  });
}

export async function resolveQuestionMealCalculationText(
  input: WhatsappInteractionTextInput,
): Promise<WhatsappInteractionTextResult | null> {
  const target = input.pendingOperation.target;
  if (!isPendingQuestionMealCalculation(target)) return null;
  const action = parseQuestionMealCalculationAction(input.text);
  if (!action) return null;

  const claim = await claimWhatsAppTextPendingOperation(
    input.userId,
    PENDING_QUESTION_MEAL_CALCULATION_TYPE,
    action,
    input.receivedAt,
    input.pendingOperation.id,
  );
  if (claim.status !== "claimed") return null;

  if (action === "cancel") {
    return {
      handled: true,
      action: "question_meal_calculation_cancelled",
      reply: buildWhatsAppActionCancelledReplyMessage("Tudo certo. Não calculei nem registrei a sugestão."),
      eventType: "whatsapp.question_meal_calculation.cancelled",
      detail: "Continuação de cálculo cancelada sem executar a ação.",
      data: {
        interactionId: target.interactionId,
        structuredContinuation: true,
        consumptionPersisted: false,
        pendingOperationId: claim.pendingOperation.id,
        pendingType: claim.pendingOperation.type,
      },
    };
  }

  try {
    return buildCalculationResult(target, input.userId);
  } catch {
    return recreateAfterRecoverableFailure({
      userId: input.userId,
      pendingOperation: claim.pendingOperation,
      receivedAt: input.receivedAt,
    });
  }
}

export function rebuildQuestionMealCalculation(
  pendingOperation: WhatsAppPendingOperationRecord,
) {
  if (!isPendingQuestionMealCalculation(pendingOperation.target)) return null;
  return {
    reply: QUESTION_MEAL_CALCULATION_PROMPT,
    interactiveReply: buildInteractiveReply(pendingOperation.id),
  };
}

export async function completeQuestionMealCalculationCallback(input: {
  userId: number;
  pendingOperation: WhatsAppPendingOperationRecord;
  action: string;
}) {
  const target = input.pendingOperation.target;
  if (!isPendingQuestionMealCalculation(target)) return null;
  if (input.action === "cancel") {
    return {
      handled: true as const,
      action: "question_meal_calculation_cancelled",
      reply: buildWhatsAppActionCancelledReplyMessage("Tudo certo. Não calculei nem registrei a sugestão."),
      eventType: "whatsapp.question_meal_calculation.cancelled",
      detail: "Continuação de cálculo cancelada por callback sem executar a ação.",
      data: {
        interactionId: target.interactionId,
        consumptionPersisted: false,
        pendingOperationId: input.pendingOperation.id,
        pendingType: input.pendingOperation.type,
      },
    };
  }
  if (input.action !== "calculate") return null;
  try {
    return buildCalculationResult(target, input.userId);
  } catch {
    return recreateAfterRecoverableFailure({
      userId: input.userId,
      pendingOperation: input.pendingOperation,
    });
  }
}

export function buildQuestionMealCalculationTelemetry(target: PendingQuestionMealCalculation) {
  return buildWhatsappInteractionTelemetry({
    interactionId: target.interactionId,
    origin: PENDING_QUESTION_MEAL_CALCULATION_ORIGIN,
    classification: "closed",
    actions: target.actions,
    lifecycle: "created",
  });
}

export { QUESTION_MEAL_CALCULATION_PROMPT };
