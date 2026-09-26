import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import type { WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import {
  classifyCoffeePreparationClarificationText,
  completeWhatsappCoffeePreparationClarificationCallback,
  isPendingCoffeePreparationClarification,
  PENDING_COFFEE_PREPARATION_CLARIFICATION_ORIGIN,
  PENDING_COFFEE_PREPARATION_CLARIFICATION_TYPE,
  rebuildCoffeePreparationClarification,
  resolveCoffeePreparationClarificationText,
} from "./coffeePreparationClarification";
import {
  WHATSAPP_INTERACTION_REGISTRY as LEGACY_REGISTRY,
  type WhatsappInteractionCallbackInput,
  type WhatsappRegisteredInteraction,
} from "./interactionRegistryLegacy";
import { buildWhatsappInteractionTelemetry, selectWhatsappInteractionComponent } from "./interactionPresentation";
import type { WhatsappInteractionTextInput } from "./interactionTextHandlers";
import type { WhatsAppLogicalReply } from "./replyContract";
import {
  completeQuestionMealCalculationCallback,
  classifyQuestionMealCalculationText,
  isPendingQuestionMealCalculation,
  PENDING_QUESTION_MEAL_CALCULATION_ORIGIN,
  PENDING_QUESTION_MEAL_CALCULATION_TYPE,
  rebuildQuestionMealCalculation,
  resolveQuestionMealCalculationText,
  QUESTION_MEAL_CALCULATION_ACTIONS,
  QUESTION_MEAL_CALCULATION_INTERACTION_ID,
} from "./questionMealCalculationInteraction";

export type {
  WhatsappInteractionCallbackInput,
  WhatsappInteractionClassification,
  WhatsappInteractionReconstruction,
  WhatsappRegisteredInteraction,
} from "./interactionRegistryLegacy";

export const WHATSAPP_INTERACTION_REGISTRY_VERSION = 13;

const coffeePreparationInteraction: WhatsappRegisteredInteraction = {
  id: "coffee_preparation.sugar_choice",
  pendingType: PENDING_COFFEE_PREPARATION_CLARIFICATION_TYPE,
  origin: PENDING_COFFEE_PREPARATION_CLARIFICATION_ORIGIN,
  entrypoints: ["whatsappWebhook", "whatsappIntentWebhook", "simulator", "audioTranscription"],
  classification: "closed",
  reconstruction: "pending_target",
  invalidResponse: "represent_same_actions",
  staleBehavior: "reply_unavailable_request_new_command",
  allowedEffects: ["without_sugar", "with_sugar", "cancel", "complete_coffee_preparation_once"],
  forbiddenEffects: ["nutrition_fallback", "mutate_before_preparation"],
  matches: isPendingCoffeePreparationClarification,
  actions: target => isPendingCoffeePreparationClarification(target)
    ? target.actions.map(action => ({ ...action }))
    : [],
  classifyText: classifyCoffeePreparationClarificationText,
  resolveText: resolveCoffeePreparationClarificationText,
  rebuild: input => rebuildCoffeePreparationClarification(input.pendingOperation),
  completeCallback: input => completeWhatsappCoffeePreparationClarificationCallback({
    userId: input.userId,
    pendingOperation: input.pendingOperation,
    action: input.action,
    receivedAt: input.receivedAt,
    userTimezone: input.userTimezone,
  }),
};

const questionMealCalculationInteraction: WhatsappRegisteredInteraction = {
  id: QUESTION_MEAL_CALCULATION_INTERACTION_ID,
  pendingType: PENDING_QUESTION_MEAL_CALCULATION_TYPE,
  origin: PENDING_QUESTION_MEAL_CALCULATION_ORIGIN,
  entrypoints: ["whatsappWebhook", "whatsappIntentWebhook", "simulator", "audioTranscription"],
  classification: "closed",
  reconstruction: "pending_target",
  invalidResponse: "represent_same_actions",
  staleBehavior: "reply_unavailable_request_new_command",
  allowedEffects: ["calculate", "cancel", "calculate_suggestion_once"],
  forbiddenEffects: ["meal_creation", "llm_reinterpretation", "history_reparse"],
  matches: isPendingQuestionMealCalculation,
  actions: target => isPendingQuestionMealCalculation(target)
    ? target.actions.map(action => ({ ...action }))
    : [...QUESTION_MEAL_CALCULATION_ACTIONS],
  classifyText: classifyQuestionMealCalculationText,
  resolveText: resolveQuestionMealCalculationText,
  rebuild: input => rebuildQuestionMealCalculation(input.pendingOperation),
  completeCallback: input => completeQuestionMealCalculationCallback({
    userId: input.userId,
    pendingOperation: input.pendingOperation,
    action: input.action,
  }),
};

export const WHATSAPP_INTERACTION_REGISTRY: readonly WhatsappRegisteredInteraction[] = [
  ...LEGACY_REGISTRY,
  coffeePreparationInteraction,
  questionMealCalculationInteraction,
];

export function findWhatsappRegisteredInteraction(type: string, target: unknown) {
  return WHATSAPP_INTERACTION_REGISTRY.find(entry => entry.pendingType === type && entry.matches(target)) ?? null;
}

export function listWhatsappRegisteredPendingTypes() {
  return [...new Set(WHATSAPP_INTERACTION_REGISTRY.map(entry => entry.pendingType))];
}

export function isExpectedWhatsappRegisteredAction(type: string, action: string, pendingOperation: WhatsAppPendingOperationRecord) {
  const interaction = findWhatsappRegisteredInteraction(type, pendingOperation.target);
  return interaction ? interaction.actions(pendingOperation.target).some(candidate => candidate.id === action) : false;
}

export function describeWhatsappRegisteredInteraction(pendingOperation: WhatsAppPendingOperationRecord) {
  const interaction = findWhatsappRegisteredInteraction(pendingOperation.type, pendingOperation.target);
  if (!interaction) return null;
  const actions = interaction.actions(pendingOperation.target);
  return { interaction, actions, component: selectWhatsappInteractionComponent(interaction.classification, actions.length) };
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

export async function resolveWhatsappRegisteredText(interaction: WhatsappRegisteredInteraction, input: WhatsappInteractionTextInput) {
  return interaction.resolveText(input);
}

export async function completeWhatsappRegisteredCallback(input: WhatsappInteractionCallbackInput) {
  const interaction = findWhatsappRegisteredInteraction(input.pendingOperation.type, input.pendingOperation.target);
  return interaction ? interaction.completeCallback(input) : null;
}
