import type { WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import {
  buildWhatsappClosedDecisionReply,
  buildWhatsappInteractionTelemetry,
  type WhatsappInteractionAction,
} from "./interactionPresentation";
import type { WhatsAppLogicalReply } from "./replyContract";
import { buildWhatsAppCallbackResourceNotFoundReplyMessage } from "./replyMessages";
import type { WhatsappDeleteIntentDetection } from "./deleteIntentDetection";

export const CONFIRM_ACTION = "confirm";
export const CANCEL_ACTION = "cancel";
export const SELECT_ACTION_PREFIX = "select:";
export const PENDING_DELETE_TYPE = "delete";
export const PENDING_DELETE_ORIGIN = "deleteIntent";
export const PENDING_DELETE_TTL_MS = 10 * 60 * 1000;

export type PendingDeleteIntent = {
  kind: "delete_meal" | "delete_food_from_meal";
  mealId: number;
  mealLabel: string;
  mealOccurredAt: string;
  itemIndex?: number;
  itemName?: string;
};

export type PendingDeleteSelection = {
  kind: "selection";
  targetLabel: string;
  targetFoodName?: string;
  candidates: PendingDeleteIntent[];
};

export type PendingDeleteOperation = PendingDeleteIntent | PendingDeleteSelection;

export type WhatsappDeleteIntentResult = {
  handled: true;
  action: "clarification_needed" | "meal_deleted" | "meal_item_deleted" | "delete_cancelled";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown>;
  interactiveReply?: WhatsAppLogicalReply;
};

export type DeleteExecutionInput = {
  text?: string | null;
  timeZone?: string | null;
  receivedAt?: Date;
  entrypoint?: string;
};

export function formatMealReference(
  pending: Pick<PendingDeleteIntent, "mealLabel" | "mealOccurredAt">,
  timeZone: string,
) {
  const date = new Date(pending.mealOccurredAt);
  const time = Number.isNaN(date.getTime())
    ? ""
    : ` às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone })}`;
  return `${pending.mealLabel}${time}`;
}

function buildPendingMealDeleteReply(pending: PendingDeleteIntent, timeZone: string) {
  return [
    `Encontrei a refeição: ${formatMealReference(pending, timeZone)}.`,
    "Responda SIM para confirmar a exclusão dessa refeição ou CANCELAR para desistir.",
    "Não excluí nada ainda e não registrei nenhum alimento novo.",
  ].join("\n\n");
}

function buildPendingFoodDeleteReply(pending: PendingDeleteIntent, timeZone: string) {
  return [
    `Encontrei o item ${pending.itemName} em ${formatMealReference(pending, timeZone)}.`,
    "Responda SIM para confirmar a remoção desse alimento ou CANCELAR para desistir.",
    "Não removi nada ainda e não registrei nenhum alimento novo.",
  ].join("\n\n");
}

export function buildDeleteConfirmationActions(): WhatsappInteractionAction[] {
  return [
    { id: CONFIRM_ACTION, label: "Confirmar", effect: "apply_delete" },
    { id: CANCEL_ACTION, label: "Cancelar", effect: "cancel_delete" },
  ];
}

export function buildDeleteSelectionActions(
  candidates: PendingDeleteIntent[],
  timeZone: string,
): WhatsappInteractionAction[] {
  return [
    ...candidates.map((candidate, index) => ({
      id: `${SELECT_ACTION_PREFIX}${index}`,
      label: `${index + 1}. ${candidate.kind === "delete_meal" ? candidate.mealLabel : candidate.itemName ?? "Alimento"}`,
      description: candidate.kind === "delete_meal"
        ? formatMealReference(candidate, timeZone)
        : candidate.mealLabel,
      effect: "select_candidate",
    })),
    { id: CANCEL_ACTION, label: "Cancelar", effect: "cancel_delete" },
  ];
}

export function buildRoutingData(extra: Record<string, unknown> = {}) {
  return {
    executor: PENDING_DELETE_ORIGIN,
    fallbackBlocked: true,
    fallbackBlockReason: "destructive_intent",
    ...extra,
  };
}

function buildConfirmationInteraction(pending: PendingDeleteIntent, pendingOperationId?: number) {
  const actions = buildDeleteConfirmationActions();
  return {
    id: pendingOperationId ?? null,
    state: "open",
    type: "confirmation",
    target: {
      kind: pending.kind,
      mealId: pending.mealId,
      mealLabel: pending.mealLabel,
      mealOccurredAt: pending.mealOccurredAt,
      itemIndex: pending.itemIndex ?? null,
      itemName: pending.itemName ?? null,
    },
    actions,
    allowedEffects: ["select", "confirm", "cancel", "delete_once"],
    forbiddenEffects: ["nutrition_fallback", "meal_creation", "delete_without_confirmation"],
  };
}

export function buildPendingResult(
  pending: PendingDeleteIntent,
  pendingOperationId: number | undefined,
  timeZone: string,
): WhatsappDeleteIntentResult {
  const reply = pending.kind === "delete_meal"
    ? buildPendingMealDeleteReply(pending, timeZone)
    : buildPendingFoodDeleteReply(pending, timeZone);
  const actions = buildDeleteConfirmationActions();
  return {
    handled: true,
    action: "clarification_needed",
    reply,
    ...(pendingOperationId
      ? { interactiveReply: buildWhatsappClosedDecisionReply({ bodyText: reply, pendingOperationId, actions }) }
      : {}),
    eventType: pending.kind === "delete_meal"
      ? "whatsapp.intent.delete_meal_confirmation_requested"
      : "whatsapp.intent.delete_food_confirmation_requested",
    detail: pending.kind === "delete_meal"
      ? "Confirmação solicitada antes de excluir refeição pelo WhatsApp."
      : "Confirmação solicitada antes de remover alimento pelo WhatsApp.",
    data: buildRoutingData({
      deleteIntentKind: pending.kind,
      mealId: pending.mealId,
      itemIndex: pending.itemIndex ?? null,
      pendingOperationId: pendingOperationId ?? null,
      pendingType: "confirmation",
      pendingState: "open",
      candidateCount: 1,
      destructiveActionBlocked: true,
      interaction: buildConfirmationInteraction(pending, pendingOperationId),
      ...buildWhatsappInteractionTelemetry({
        interactionId: "delete.confirmation",
        origin: PENDING_DELETE_ORIGIN,
        classification: "closed",
        actions,
        lifecycle: "created",
      }),
    }),
  };
}

export function buildPendingReminderResult(
  pending: PendingDeleteIntent,
  pendingOperationId: number,
  timeZone: string,
): WhatsappDeleteIntentResult {
  const result = buildPendingResult(pending, pendingOperationId, timeZone);
  return {
    ...result,
    eventType: pending.kind === "delete_meal"
      ? "whatsapp.intent.delete_meal_confirmation_still_pending"
      : "whatsapp.intent.delete_food_confirmation_still_pending",
    detail: "Resposta incompatível reapresentou a mesma confirmação destrutiva sem consumir a pendência.",
  };
}

export function buildPendingReplacementBlockedResult(): WhatsappDeleteIntentResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: "Não consegui substituir a ação pendente com segurança. Nada foi excluído ou registrado. Cancele a ação anterior e envie novamente o pedido de exclusão.",
    eventType: "whatsapp.intent.delete_pending_replacement_blocked",
    detail: "Nova intenção destrutiva bloqueada porque a pendência anterior não pôde ser marcada como substituída.",
    data: buildRoutingData({ destructiveActionBlocked: true, pendingState: "blocked" }),
  };
}

export function buildCallbackResourceNotFoundResult(): WhatsappDeleteIntentResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: buildWhatsAppCallbackResourceNotFoundReplyMessage(),
    eventType: "whatsapp.intent.delete_callback_resource_not_found",
    detail: "Callback de exclusão resolvido, mas o alvo não corresponde mais ao estado esperado.",
    data: buildRoutingData({ destructiveActionBlocked: true, pendingState: "blocked" }),
  };
}

export function buildClarificationResult(detection: WhatsappDeleteIntentDetection): WhatsappDeleteIntentResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: detection.reply,
    eventType: detection.eventType,
    detail: detection.detail,
    data: buildRoutingData({
      deleteIntentKind: detection.kind,
      targetFoodName: detection.targetFoodName ?? null,
      targetMealLabel: detection.targetMealLabel ?? null,
      contextReference: detection.contextReference ?? null,
      pendingType: "clarification",
      pendingState: "open",
      destructiveActionBlocked: true,
      interaction: {
        id: null,
        state: "open",
        type: "clarification",
        actions: [],
        forbiddenEffects: ["nutrition_fallback", "meal_creation", "delete_without_confirmation"],
      },
    }),
  };
}

export function buildCancellationResult(): WhatsappDeleteIntentResult {
  return {
    handled: true,
    action: "delete_cancelled",
    reply: "Tudo certo. Não excluí nenhum registro.",
    eventType: "whatsapp.intent.delete_cancelled",
    detail: "Exclusão pendente cancelada por mensagem no WhatsApp.",
    data: buildRoutingData({ destructiveActionCancelled: true, pendingState: "cancelled" }),
  };
}

/**
 * Mantém o nome legado, mas aplica a regra central: dois candidatos + Cancelar
 * usam botões; três candidatos + Cancelar usam lista.
 */
export function buildSelectionListReply(
  bodyText: string,
  pendingOperationId: number,
  candidates: PendingDeleteIntent[],
  timeZone: string,
): WhatsAppLogicalReply {
  return buildWhatsappClosedDecisionReply({
    bodyText,
    pendingOperationId,
    actions: buildDeleteSelectionActions(candidates, timeZone),
  });
}

export function buildSelectionResult(input: {
  targetLabel: string;
  targetFoodName?: string;
  candidates: PendingDeleteIntent[];
  pendingOperationId?: number;
  reply: string;
  timeZone: string;
}): WhatsappDeleteIntentResult {
  const selectionKind = input.candidates.every(candidate => candidate.kind === "delete_meal")
    ? "delete_meal"
    : "delete_food_from_meal";
  const actions = buildDeleteSelectionActions(input.candidates, input.timeZone);
  return {
    handled: true,
    action: "clarification_needed",
    reply: input.reply,
    ...(input.pendingOperationId
      ? { interactiveReply: buildWhatsappClosedDecisionReply({ bodyText: input.reply, pendingOperationId: input.pendingOperationId, actions }) }
      : {}),
    eventType: selectionKind === "delete_meal"
      ? "whatsapp.intent.delete_meal_selection_requested"
      : "whatsapp.intent.delete_food_selection_requested",
    detail: selectionKind === "delete_meal"
      ? "Seleção de refeição persistida antes da confirmação; nenhuma refeição foi removida."
      : "Seleção de alimento persistida antes da confirmação; nenhum item foi removido.",
    data: buildRoutingData({
      deleteIntentKind: selectionKind,
      destructiveActionBlocked: true,
      candidateCount: input.candidates.length,
      pendingOperationId: input.pendingOperationId ?? null,
      pendingType: "selection",
      pendingState: "open",
      targetLabel: input.targetLabel,
      targetFoodName: input.targetFoodName ?? null,
      interaction: {
        id: input.pendingOperationId ?? null,
        state: "open",
        type: "selection",
        targetLabel: input.targetLabel,
        targetFoodName: input.targetFoodName ?? null,
        candidates: input.candidates.map((candidate, index) => ({
          order: index + 1,
          kind: candidate.kind,
          mealId: candidate.mealId,
          mealLabel: candidate.mealLabel,
          mealOccurredAt: candidate.mealOccurredAt,
          itemIndex: candidate.itemIndex ?? null,
          itemName: candidate.itemName ?? null,
        })),
        actions,
        allowedEffects: ["select", "cancel"],
        forbiddenEffects: ["nutrition_fallback", "meal_creation", "delete_before_confirmation"],
      },
      ...buildWhatsappInteractionTelemetry({
        interactionId: "delete.candidate_selection",
        origin: PENDING_DELETE_ORIGIN,
        classification: "closed",
        actions,
        lifecycle: "created",
      }),
    }),
  };
}

export function appendDeleteRoutingAudit(result: WhatsappDeleteIntentResult, input: DeleteExecutionInput) {
  const runtimeCommit = process.env.RENDER_GIT_COMMIT
    ?? process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.GITHUB_SHA
    ?? null;
  const audit = {
    entrypoint: input.entrypoint ?? "deleteIntent.direct",
    runtimeCommit,
    executor: PENDING_DELETE_ORIGIN,
    candidateCount: typeof result.data.candidateCount === "number" ? result.data.candidateCount : null,
    pendingOperationId: typeof result.data.pendingOperationId === "number" ? result.data.pendingOperationId : null,
    pendingType: typeof result.data.pendingType === "string" ? result.data.pendingType : null,
    pendingState: typeof result.data.pendingState === "string" ? result.data.pendingState : null,
    fallbackBlocked: result.data.fallbackBlocked === true,
    fallbackBlockReason: result.data.fallbackBlockReason ?? null,
  };
  return {
    ...result,
    detail: `${result.detail} routing=${JSON.stringify(audit)}`,
  };
}

export function isPendingDeleteSelection(
  pending: Pick<WhatsAppPendingOperationRecord, "target">["target"],
): pending is PendingDeleteSelection {
  return Boolean(pending && typeof pending === "object" && (pending as PendingDeleteSelection).kind === "selection");
}
