import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { buildProfessionalAccessActions } from "../professionals/accessInteractionContract";
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
  isPendingFoodClarificationTarget,
  PENDING_FOOD_CLARIFICATION_TYPE,
  type PendingFoodClarificationTarget,
} from "./foodClarification";
import {
  buildWhatsappIntentClarificationReply,
  completeWhatsappIntentClarificationCallback,
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
  classifyDeleteText,
  classifyFoodClarificationText,
  classifyGenericConfirmationText,
  classifyIntentClarificationText,
  classifyMealItemSelectionText,
  classifyPeriodReportText,
  classifyProfessionalAccessText,
  resolveDeleteText,
  resolveFoodClarificationText,
  resolveGenericConfirmationText,
  resolveIntentClarificationText,
  resolveMealItemSelectionText,
  resolvePeriodReportText,
  resolveProfessionalAccessText,
  type WhatsappInteractionTextClassification,
  type WhatsappInteractionTextInput,
  type WhatsappInteractionTextResult,
} from "./interactionTextHandlers";
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
export const WHATSAPP_INTERACTION_REGISTRY_VERSION = 4;

export type WhatsappInteractionClassification = "open" | "closed";
export type WhatsappInteractionReconstruction = "pending_target" | "domain_reload";

type WhatsappInteractionActionContext = {
  timeZone?: string | null;
};

type WhatsappInteractionReplayInput = {
  pendingOperation: WhatsAppPendingOperationRecord;
  actions: WhatsappInteractionAction[];
  timeZone: string;
};

type WhatsappInteractionReplayResult = {
  reply: string;
  interactiveReply?: WhatsAppLogicalReply;
} | null;

export type WhatsappInteractionCallbackInput = {
  userId: number;
  pendingOperation: WhatsAppPendingOperationRecord;
  action: string;
  receivedAt?: Date;
  userTimezone?: string | null;
};

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
  actions: (target: unknown, context?: WhatsappInteractionActionContext) => WhatsappInteractionAction[];
  classifyText: (target: unknown, text?: string | null) => WhatsappInteractionTextClassification;
  resolveText: (input: WhatsappInteractionTextInput) => WhatsappInteractionTextResult | null | Promise<WhatsappInteractionTextResult | null>;
  rebuild: (input: WhatsappInteractionReplayInput) => WhatsappInteractionReplayResult | Promise<WhatsappInteractionReplayResult>;
  completeCallback: (input: WhatsappInteractionCallbackInput) => unknown | Promise<unknown>;
};

const NUTRITION_FORBIDDEN = ["nutrition_fallback", "meal_creation", "llm_reinterpretation"] as const;
const ALL_ENTRYPOINTS = ["whatsappWebhook", "whatsappIntentWebhook", "simulator", "audioTranscription"] as const;

function foodActions(target: unknown): WhatsappInteractionAction[] {
  return isPendingFoodClarificationTarget(target)
    ? target.actions.map(action => ({ ...action }))
    : [];
}

function rebuildDeleteConfirmation(input: WhatsappInteractionReplayInput): WhatsappInteractionReplayResult {
  const target = input.pendingOperation.target as PendingDeleteOperation;
  if (isPendingDeleteSelection(target)) return null;
  const rebuilt = buildPendingResult(target, input.pendingOperation.id, input.timeZone);
  return { reply: rebuilt.reply, interactiveReply: rebuilt.interactiveReply };
}

function rebuildDeleteSelection(input: WhatsappInteractionReplayInput): WhatsappInteractionReplayResult {
  const target = input.pendingOperation.target as PendingDeleteOperation;
  if (!isPendingDeleteSelection(target)) return null;
  const reply = `Ainda preciso da sua escolha sobre "${target.targetLabel ?? target.targetFoodName ?? "o registro"}". Selecione uma opção ou envie CANCELAR.`;
  return {
    reply,
    interactiveReply: buildWhatsappClosedDecisionReply({
      bodyText: reply,
      pendingOperationId: input.pendingOperation.id,
      actions: input.actions,
    }),
  };
}

function rebuildMealItemSelection(input: WhatsappInteractionReplayInput): WhatsappInteractionReplayResult {
  const target = input.pendingOperation.target as PendingMealItemSelection;
  const reply = `Ainda preciso saber qual item devo usar para ${target.contextLabel}. Selecione uma opção ou envie CANCELAR.`;
  return {
    reply,
    interactiveReply: buildWhatsappClosedDecisionReply({
      bodyText: reply,
      pendingOperationId: input.pendingOperation.id,
      actions: input.actions,
    }),
  };
}

function rebuildGenericConfirmation(input: WhatsappInteractionReplayInput): WhatsappInteractionReplayResult {
  const target = input.pendingOperation.target as PendingWhatsAppConfirmation;
  const reply = target.decision === "reclassify_scope"
    ? `Ainda preciso decidir o escopo de ${target.summary}. Escolha Só compatíveis, Todos recentes ou Cancelar.`
    : `Ainda preciso da sua confirmação para ${target.summary}. Responda SIM ou CANCELAR.`;
  return {
    reply,
    interactiveReply: buildWhatsappClosedDecisionReply({
      bodyText: reply,
      pendingOperationId: input.pendingOperation.id,
      actions: input.actions,
    }),
  };
}

function rebuildPeriodReport(input: WhatsappInteractionReplayInput): WhatsappInteractionReplayResult {
  const reply = "Ainda preciso saber o período do resumo. Escolha uma opção ou envie CANCELAR.";
  return {
    reply,
    interactiveReply: buildWhatsappPeriodReportClarificationListReply(input.pendingOperation.id, reply),
  };
}

async function rebuildProfessionalAccess(input: WhatsappInteractionReplayInput): Promise<WhatsappInteractionReplayResult> {
  const target = input.pendingOperation.target as { accessId?: string };
  if (!target.accessId) return null;
  const persistence = await import("../professionals/persistenceService");
  const service = await import("../professionals/service");
  const authorization = await persistence.getCanonicalProfessionalAuthorization(target.accessId);
  if (!authorization || authorization.patientUserId !== input.pendingOperation.userId || authorization.status !== "pending") return null;
  const profile = await persistence.getCanonicalProfessionalProfile(authorization.professionalUserId);
  if (!profile) return null;
  const reply = service.buildProfessionalAccessAuthorizationMessage({
    professionalDisplayName: profile.displayName,
    reason: authorization.reason,
    accessId: authorization.id,
  });
  return {
    reply,
    interactiveReply: buildWhatsappClosedDecisionReply({
      bodyText: reply,
      pendingOperationId: input.pendingOperation.id,
      actions: input.actions,
    }),
  };
}

function rebuildIntentClarification(input: WhatsappInteractionReplayInput): WhatsappInteractionReplayResult {
  const target = input.pendingOperation.target as PendingIntentClarification;
  const reply = `Essa resposta não corresponde às opções. Sua mensagem original "${target.originalText}" continua guardada.`;
  return {
    reply,
    interactiveReply: buildWhatsappIntentClarificationReply(input.pendingOperation.id, reply),
  };
}

function rebuildFoodClarification(input: WhatsappInteractionReplayInput): WhatsappInteractionReplayResult {
  const target = input.pendingOperation.target as PendingFoodClarificationTarget;
  if (!isPendingFoodClarificationTarget(target)) return null;
  const reply = target.instructionText;
  return target.classification === "closed"
    ? {
        reply,
        interactiveReply: buildWhatsappClosedDecisionReply({
          bodyText: reply,
          pendingOperationId: input.pendingOperation.id,
          actions: input.actions,
        }),
      }
    : { reply };
}

async function completeDeleteCallback(input: WhatsappInteractionCallbackInput) {
  const { completeWhatsappDeleteInteractiveCallback } = await import("./deleteIntent");
  return completeWhatsappDeleteInteractiveCallback(
    input.userId,
    input.pendingOperation,
    input.action,
    input.userTimezone ?? undefined,
  );
}

function completeMealItemCallback(input: WhatsappInteractionCallbackInput) {
  return completeMealItemSelectionInteractiveCallback(input.userId, input.pendingOperation, input.action);
}

function completeGenericConfirmation(input: WhatsappInteractionCallbackInput) {
  return completeWhatsappGenericConfirmationCallback(input.userId, input.pendingOperation, input.action);
}

function completePeriodReport(input: WhatsappInteractionCallbackInput) {
  return completeWhatsappPeriodReportCallback(input.userId, input.action, input.receivedAt);
}

async function completeFoodClarification(input: WhatsappInteractionCallbackInput) {
  const { completeClaimedWhatsappFoodClarificationCallback } = await import("./foodClarification");
  return completeClaimedWhatsappFoodClarificationCallback({
    userId: input.userId,
    pendingOperation: input.pendingOperation,
    action: input.action,
    receivedAt: input.receivedAt,
    userTimezone: input.userTimezone,
  });
}

function completeIntentClarification(input: WhatsappInteractionCallbackInput) {
  return completeWhatsappIntentClarificationCallback(
    input.userId,
    input.pendingOperation,
    input.action,
    input.receivedAt,
  );
}

async function completeProfessionalAccess(input: WhatsappInteractionCallbackInput) {
  const { completeWhatsAppProfessionalAccessCallback } = await import("../professionals/service");
  return completeWhatsAppProfessionalAccessCallback(input.userId, input.pendingOperation, input.action);
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
    classifyText: classifyDeleteText,
    resolveText: resolveDeleteText,
    rebuild: rebuildDeleteConfirmation,
    completeCallback: completeDeleteCallback,
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
    actions: (target, context) => isPendingDeleteSelection(target)
      ? buildDeleteSelectionActions(target.candidates, context?.timeZone ?? DEFAULT_APP_TIME_ZONE)
      : [],
    classifyText: classifyDeleteText,
    resolveText: resolveDeleteText,
    rebuild: rebuildDeleteSelection,
    completeCallback: completeDeleteCallback,
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
    classifyText: classifyMealItemSelectionText,
    resolveText: resolveMealItemSelectionText,
    rebuild: rebuildMealItemSelection,
    completeCallback: completeMealItemCallback,
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
    classifyText: classifyGenericConfirmationText,
    resolveText: resolveGenericConfirmationText,
    rebuild: rebuildGenericConfirmation,
    completeCallback: completeGenericConfirmation,
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
    classifyText: classifyGenericConfirmationText,
    resolveText: resolveGenericConfirmationText,
    rebuild: rebuildGenericConfirmation,
    completeCallback: completeGenericConfirmation,
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
    classifyText: classifyPeriodReportText,
    resolveText: resolvePeriodReportText,
    rebuild: rebuildPeriodReport,
    completeCallback: completePeriodReport,
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
    classifyText: classifyProfessionalAccessText,
    resolveText: resolveProfessionalAccessText,
    rebuild: rebuildProfessionalAccess,
    completeCallback: completeProfessionalAccess,
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
    classifyText: classifyIntentClarificationText,
    resolveText: resolveIntentClarificationText,
    rebuild: rebuildIntentClarification,
    completeCallback: completeIntentClarification,
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
    classifyText: classifyFoodClarificationText,
    resolveText: resolveFoodClarificationText,
    rebuild: rebuildFoodClarification,
    completeCallback: completeFoodClarification,
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
    classifyText: classifyFoodClarificationText,
    resolveText: resolveFoodClarificationText,
    rebuild: rebuildFoodClarification,
    completeCallback: completeFoodClarification,
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
    classifyText: classifyFoodClarificationText,
    resolveText: resolveFoodClarificationText,
    rebuild: rebuildFoodClarification,
    completeCallback: completeFoodClarification,
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
  const interaction = findWhatsappRegisteredInteraction(pendingOperation.type, pendingOperation.target);
  if (!interaction) return null;
  const timeZone = options?.timeZone ?? DEFAULT_APP_TIME_ZONE;
  const actions = interaction.actions(pendingOperation.target, { timeZone });
  const rebuilt = await interaction.rebuild({ pendingOperation, actions, timeZone });
  if (!rebuilt) return null;
  return {
    ...rebuilt,
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

export async function resolveWhatsappRegisteredText(
  interaction: WhatsappRegisteredInteraction,
  input: WhatsappInteractionTextInput,
) {
  return interaction.resolveText(input);
}

export async function completeWhatsappRegisteredCallback(input: WhatsappInteractionCallbackInput) {
  const interaction = findWhatsappRegisteredInteraction(input.pendingOperation.type, input.pendingOperation.target);
  if (!interaction) return null;
  return interaction.completeCallback(input);
}
