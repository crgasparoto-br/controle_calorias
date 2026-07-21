import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import type { WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import {
  buildDeleteConfirmationActions,
  buildDeleteSelectionActions,
  buildPendingResult,
  isPendingDeleteSelection,
  PENDING_DELETE_TYPE,
  type PendingDeleteOperation,
} from "./deleteIntentContract";
import {
  isExpectedWhatsappFoodClarificationAction,
  isPendingFoodClarificationTarget,
  PENDING_FOOD_CLARIFICATION_TYPE,
  type PendingFoodClarificationTarget,
} from "./foodClarification";
import {
  buildWhatsappIntentClarificationReply,
  completeWhatsappIntentClarificationCallback,
  isExpectedWhatsappIntentClarificationAction,
  isPendingIntentClarification,
  PENDING_INTENT_CLARIFICATION_TYPE,
  type PendingIntentClarification,
} from "./intentClarificationInteraction";
import {
  buildWhatsappClosedDecisionReply,
  buildWhatsappInteractionTelemetry,
  selectWhatsappInteractionComponent,
  type WhatsappInteractionAction,
} from "./interactionPresentation";
import {
  buildMealItemSelectionActions,
  completeMealItemSelectionInteractiveCallback,
  PENDING_MEAL_ITEM_SELECTION_TYPE,
  type PendingMealItemSelection,
} from "./mealItemSelectionCallback";
import {
  buildWhatsappPeriodReportActions,
  buildWhatsappPeriodReportClarificationListReply,
  completeWhatsappPeriodReportCallback,
  isExpectedWhatsappPeriodReportAction,
  PENDING_PERIOD_REPORT_TYPE,
} from "./periodReportClarification";
import type { WhatsAppLogicalReply } from "./replyContract";
import {
  buildGenericConfirmationActions,
  completeWhatsappGenericConfirmationCallback,
  PENDING_CONFIRMATION_TYPE,
  type PendingWhatsAppConfirmation,
} from "./webhookTextCommands";

const PENDING_PROFESSIONAL_ACCESS_TYPE = "professional_access";
export const WHATSAPP_INTERACTION_REGISTRY_VERSION = 2;

export type WhatsappInteractionClassification = "open" | "closed";
export type WhatsappInteractionReconstruction = "pending_target" | "domain_reload";

export type WhatsappRegisteredInteraction = {
  id: string;
  pendingType: string;
  origin: string;
  entrypoints: readonly string[];
  classification: WhatsappInteractionClassification;
  reconstruction: WhatsappInteractionReconstruction;
  invalidResponse: "represent_same_actions" | "text_guidance";
  staleBehavior: "reply_unavailable_request_new_command";
  allowedEffects: readonly string[];
  forbiddenEffects: readonly string[];
  matches: (target: unknown) => boolean;
  actions: (target: unknown) => WhatsappInteractionAction[];
};

const NUTRITION_FORBIDDEN = ["nutrition_fallback", "meal_creation", "llm_reinterpretation"] as const;
const ALL_ENTRYPOINTS = ["whatsappWebhook", "whatsappIntentWebhook", "simulator", "audioTranscription"] as const;

function foodActions(target: unknown): WhatsappInteractionAction[] {
  return isPendingFoodClarificationTarget(target)
    ? target.actions.map(action => ({ ...action }))
    : [];
}

export function buildProfessionalAccessActions(): WhatsappInteractionAction[] {
  return [
    { id: "authorize", label: "Autorizar", effect: "grant_access" },
    { id: "reject", label: "Recusar", effect: "reject_access" },
  ];
}

export const WHATSAPP_INTERACTION_REGISTRY: readonly WhatsappRegisteredInteraction[] = [
  {
    id: "delete.confirmation",
    pendingType: PENDING_DELETE_TYPE,
    origin: "deleteIntent",
    entrypoints: ALL_ENTRYPOINTS,
    classification: "closed",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["confirm", "cancel", "delete_once"],
    forbiddenEffects: [...NUTRITION_FORBIDDEN, "delete_without_confirmation"],
    matches: target => Boolean(target && typeof target === "object" && !isPendingDeleteSelection(target)),
    actions: () => buildDeleteConfirmationActions(),
  },
  {
    id: "delete.candidate_selection",
    pendingType: PENDING_DELETE_TYPE,
    origin: "deleteIntent",
    entrypoints: ALL_ENTRYPOINTS,
    classification: "closed",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["select", "cancel"],
    forbiddenEffects: [...NUTRITION_FORBIDDEN, "delete_before_confirmation"],
    matches: target => isPendingDeleteSelection(target),
    actions: target => isPendingDeleteSelection(target)
      ? buildDeleteSelectionActions(target.candidates, DEFAULT_APP_TIME_ZONE)
      : [],
  },
  {
    id: "meal_item.candidate_selection",
    pendingType: PENDING_MEAL_ITEM_SELECTION_TYPE,
    origin: "mealItemSelectionCallback",
    entrypoints: ALL_ENTRYPOINTS,
    classification: "closed",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["select", "cancel", "mutate_after_selection"],
    forbiddenEffects: [...NUTRITION_FORBIDDEN, "mutate_before_selection"],
    matches: target => Array.isArray((target as { candidates?: unknown[] } | null)?.candidates),
    actions: target => buildMealItemSelectionActions(
      ((target as { candidates?: PendingMealItemSelection["candidates"] } | null)?.candidates) ?? [],
    ),
  },
  {
    id: "generic_confirmation.confirm_cancel",
    pendingType: PENDING_CONFIRMATION_TYPE,
    origin: "webhookTextCommands",
    entrypoints: ALL_ENTRYPOINTS,
    classification: "closed",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["confirm", "cancel", "reclassify_meals"],
    forbiddenEffects: NUTRITION_FORBIDDEN,
    matches: target => Boolean(target && typeof target === "object" && (target as { decision?: string }).decision !== "reclassify_scope"),
    actions: target => buildGenericConfirmationActions(target as PendingWhatsAppConfirmation),
  },
  {
    id: "generic_confirmation.reclassify_scope",
    pendingType: PENDING_CONFIRMATION_TYPE,
    origin: "webhookTextCommands",
    entrypoints: ALL_ENTRYPOINTS,
    classification: "closed",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["confirm", "confirm_all", "cancel", "reclassify_meals"],
    forbiddenEffects: NUTRITION_FORBIDDEN,
    matches: target => Boolean(target && typeof target === "object" && (target as { decision?: string }).decision === "reclassify_scope"),
    actions: target => buildGenericConfirmationActions(target as PendingWhatsAppConfirmation),
  },
  {
    id: "period_report.period_selection",
    pendingType: PENDING_PERIOD_REPORT_TYPE,
    origin: "periodReportClarification",
    entrypoints: ALL_ENTRYPOINTS,
    classification: "closed",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["run_report", "cancel"],
    forbiddenEffects: NUTRITION_FORBIDDEN,
    matches: target => Boolean(target && typeof target === "object"),
    actions: () => buildWhatsappPeriodReportActions(),
  },
  {
    id: "professional_access.authorization",
    pendingType: PENDING_PROFESSIONAL_ACCESS_TYPE,
    origin: "professionals/service",
    entrypoints: ["standaloneOutbound", ...ALL_ENTRYPOINTS],
    classification: "closed",
    reconstruction: "domain_reload",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["grant_access", "reject_access"],
    forbiddenEffects: NUTRITION_FORBIDDEN,
    matches: target => typeof (target as { accessId?: unknown } | null)?.accessId === "string",
    actions: () => buildProfessionalAccessActions(),
  },
  {
    id: "intent_clarification.generic",
    pendingType: PENDING_INTENT_CLARIFICATION_TYPE,
    origin: "intentClarificationInteraction",
    entrypoints: ALL_ENTRYPOINTS,
    classification: "closed",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["ask_food_and_quantity", "ask_correction_details", "run_daily_summary", "cancel"],
    forbiddenEffects: [...NUTRITION_FORBIDDEN, "persist_command_word_as_food"],
    matches: isPendingIntentClarification,
    actions: target => isPendingIntentClarification(target) ? target.actions.map(action => ({ ...action })) : [],
  },
  {
    id: "food_clarification.quantity",
    pendingType: PENDING_FOOD_CLARIFICATION_TYPE,
    origin: "foodClarification",
    entrypoints: ALL_ENTRYPOINTS,
    classification: "open",
    reconstruction: "pending_target",
    invalidResponse: "text_guidance",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["provide_quantity", "cancel", "register_original_food_once"],
    forbiddenEffects: ["persist_command_word_as_food", "implicit_100g_unit"],
    matches: target => isPendingFoodClarificationTarget(target) && target.pendingKind === "quantity",
    actions: foodActions,
  },
  {
    id: "food_clarification.confirmation",
    pendingType: PENDING_FOOD_CLARIFICATION_TYPE,
    origin: "foodClarification",
    entrypoints: ALL_ENTRYPOINTS,
    classification: "closed",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["confirm", "cancel", "register_original_food_once"],
    forbiddenEffects: ["persist_command_word_as_food", "implicit_100g_unit"],
    matches: target => isPendingFoodClarificationTarget(target) && target.pendingKind === "confirmation",
    actions: foodActions,
  },
  {
    id: "food_clarification.selection",
    pendingType: PENDING_FOOD_CLARIFICATION_TYPE,
    origin: "foodClarification",
    entrypoints: ALL_ENTRYPOINTS,
    classification: "closed",
    reconstruction: "pending_target",
    invalidResponse: "represent_same_actions",
    staleBehavior: "reply_unavailable_request_new_command",
    allowedEffects: ["select", "cancel", "register_original_food_once"],
    forbiddenEffects: ["persist_command_word_as_food", "implicit_100g_unit"],
    matches: target => isPendingFoodClarificationTarget(target) && target.pendingKind === "selection",
    actions: foodActions,
  },
] as const;

export function findWhatsappRegisteredInteraction(type: string, target: unknown) {
  return WHATSAPP_INTERACTION_REGISTRY.find(entry => entry.pendingType === type && entry.matches(target)) ?? null;
}

export function listWhatsappRegisteredPendingTypes() {
  return [...new Set(WHATSAPP_INTERACTION_REGISTRY.map(entry => entry.pendingType))];
}

export function isExpectedWhatsappRegisteredAction(
  type: string,
  action: string,
  pendingOperation: WhatsAppPendingOperationRecord,
) {
  const interaction = findWhatsappRegisteredInteraction(type, pendingOperation.target);
  if (!interaction) return false;
  if (type === PENDING_FOOD_CLARIFICATION_TYPE && isPendingFoodClarificationTarget(pendingOperation.target)) {
    return isExpectedWhatsappFoodClarificationAction(pendingOperation.target, action);
  }
  if (type === PENDING_PERIOD_REPORT_TYPE) return isExpectedWhatsappPeriodReportAction(action);
  if (type === PENDING_INTENT_CLARIFICATION_TYPE) return isExpectedWhatsappIntentClarificationAction(action);
  return interaction.actions(pendingOperation.target).some(candidate => candidate.id === action);
}

export function describeWhatsappRegisteredInteraction(pendingOperation: WhatsAppPendingOperationRecord) {
  const interaction = findWhatsappRegisteredInteraction(pendingOperation.type, pendingOperation.target);
  if (!interaction) return null;
  const actions = interaction.actions(pendingOperation.target);
  return {
    interaction,
    actions,
    component: selectWhatsappInteractionComponent(interaction.classification, actions.length),
  };
}

export async function rebuildWhatsappRegisteredInteraction(
  pendingOperation: WhatsAppPendingOperationRecord,
  options?: { timeZone?: string | null },
): Promise<{ reply: string; interactiveReply?: WhatsAppLogicalReply; telemetry: Record<string, unknown> } | null> {
  const described = describeWhatsappRegisteredInteraction(pendingOperation);
  if (!described) return null;
  const { interaction } = described;
  const timeZone = options?.timeZone ?? DEFAULT_APP_TIME_ZONE;
  const actions = interaction.id === "delete.candidate_selection" && isPendingDeleteSelection(pendingOperation.target)
    ? buildDeleteSelectionActions(pendingOperation.target.candidates, timeZone)
    : described.actions;
  let reply = "";
  let interactiveReply: WhatsAppLogicalReply | undefined;

  if (pendingOperation.type === PENDING_DELETE_TYPE) {
    const target = pendingOperation.target as PendingDeleteOperation;
    if (isPendingDeleteSelection(target)) {
      reply = `Ainda preciso da sua escolha sobre "${target.targetLabel ?? target.targetFoodName ?? "o registro"}". Selecione uma opção ou envie CANCELAR.`;
      interactiveReply = buildWhatsappClosedDecisionReply({ bodyText: reply, pendingOperationId: pendingOperation.id, actions });
    } else {
      const rebuilt = buildPendingResult(target, pendingOperation.id, timeZone);
      reply = rebuilt.reply;
      interactiveReply = rebuilt.interactiveReply;
    }
  } else if (pendingOperation.type === PENDING_MEAL_ITEM_SELECTION_TYPE) {
    const target = pendingOperation.target as PendingMealItemSelection;
    reply = `Ainda preciso saber qual item devo usar para ${target.contextLabel}. Selecione uma opção ou envie CANCELAR.`;
    interactiveReply = buildWhatsappClosedDecisionReply({ bodyText: reply, pendingOperationId: pendingOperation.id, actions });
  } else if (pendingOperation.type === PENDING_CONFIRMATION_TYPE) {
    const target = pendingOperation.target as PendingWhatsAppConfirmation;
    reply = target.decision === "reclassify_scope"
      ? `Ainda preciso decidir o escopo de ${target.summary}. Escolha Só compatíveis, Todos recentes ou Cancelar.`
      : `Ainda preciso da sua confirmação para ${target.summary}. Responda SIM ou CANCELAR.`;
    interactiveReply = buildWhatsappClosedDecisionReply({ bodyText: reply, pendingOperationId: pendingOperation.id, actions });
  } else if (pendingOperation.type === PENDING_PERIOD_REPORT_TYPE) {
    reply = "Ainda preciso saber o período do resumo. Escolha uma opção ou envie CANCELAR.";
    interactiveReply = buildWhatsappPeriodReportClarificationListReply(pendingOperation.id, reply);
  } else if (pendingOperation.type === PENDING_INTENT_CLARIFICATION_TYPE) {
    const target = pendingOperation.target as PendingIntentClarification;
    reply = `Essa resposta não corresponde às opções. Sua mensagem original "${target.originalText}" continua guardada.`;
    interactiveReply = buildWhatsappIntentClarificationReply(pendingOperation.id, reply);
  } else if (pendingOperation.type === PENDING_FOOD_CLARIFICATION_TYPE) {
    const target = pendingOperation.target as PendingFoodClarificationTarget;
    reply = target.instructionText;
    if (interaction.classification === "closed") {
      interactiveReply = buildWhatsappClosedDecisionReply({ bodyText: reply, pendingOperationId: pendingOperation.id, actions });
    }
  } else if (pendingOperation.type === PENDING_PROFESSIONAL_ACCESS_TYPE) {
    const target = pendingOperation.target as { accessId?: string };
    if (!target.accessId) return null;
    const persistence = await import("../professionals/persistenceService");
    const service = await import("../professionals/service");
    const authorization = await persistence.getCanonicalProfessionalAuthorization(target.accessId);
    if (!authorization || authorization.patientUserId !== pendingOperation.userId || authorization.status !== "pending") return null;
    const profile = await persistence.getCanonicalProfessionalProfile(authorization.professionalUserId);
    if (!profile) return null;
    reply = service.buildProfessionalAccessAuthorizationMessage({
      professionalDisplayName: profile.displayName,
      reason: authorization.reason,
      accessId: authorization.id,
    });
    interactiveReply = buildWhatsappClosedDecisionReply({ bodyText: reply, pendingOperationId: pendingOperation.id, actions });
  }

  return {
    reply,
    interactiveReply,
    telemetry: buildWhatsappInteractionTelemetry({
      interactionId: interaction.id,
      origin: interaction.origin,
      classification: interaction.classification,
      actions,
      lifecycle: "represented",
      invalidResponseReason: "incompatible_text",
    }),
  };
}

export async function completeWhatsappRegisteredCallback(input: {
  userId: number;
  pendingOperation: WhatsAppPendingOperationRecord;
  action: string;
  receivedAt?: Date;
  userTimezone?: string | null;
}) {
  const { pendingOperation, action } = input;
  switch (pendingOperation.type) {
    case PENDING_DELETE_TYPE: {
      const { completeWhatsappDeleteInteractiveCallback } = await import("./deleteIntent");
      return completeWhatsappDeleteInteractiveCallback(input.userId, pendingOperation, action, input.userTimezone ?? undefined);
    }
    case PENDING_MEAL_ITEM_SELECTION_TYPE:
      return completeMealItemSelectionInteractiveCallback(input.userId, pendingOperation, action);
    case PENDING_CONFIRMATION_TYPE:
      return completeWhatsappGenericConfirmationCallback(input.userId, pendingOperation, action);
    case PENDING_PERIOD_REPORT_TYPE:
      return completeWhatsappPeriodReportCallback(input.userId, action, input.receivedAt);
    case PENDING_FOOD_CLARIFICATION_TYPE: {
      const { completeClaimedWhatsappFoodClarificationCallback } = await import("./foodClarification");
      return completeClaimedWhatsappFoodClarificationCallback({
        userId: input.userId,
        pendingOperation,
        action,
        receivedAt: input.receivedAt,
        userTimezone: input.userTimezone,
      });
    }
    case PENDING_INTENT_CLARIFICATION_TYPE:
      return completeWhatsappIntentClarificationCallback(input.userId, pendingOperation, action, input.receivedAt);
    case PENDING_PROFESSIONAL_ACCESS_TYPE: {
      const { completeWhatsAppProfessionalAccessCallback } = await import("../professionals/service");
      return completeWhatsAppProfessionalAccessCallback(input.userId, pendingOperation, action);
    }
    default:
      return null;
  }
}
