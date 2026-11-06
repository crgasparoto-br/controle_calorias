import { getDb, logPersistenceWarning } from "../../db";
import { getMealMutationPreImage } from "../meals/mealMutationToken";
import { listMeals } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";
import {
  scaleMealItem,
  scaleMealItemQuantity,
  replaceMealItemFood,
} from "./intent/mealItemHelpers";
import {
  buildWhatsappClosedDecisionReply,
  type WhatsappInteractionAction,
} from "./interactionPresentation";
import {
  describeMealBatchMutationFailure,
  updateMealsWithCompensation,
  type MealBatchMutationChange,
} from "./mealBatchMutation";
import { composeWhatsAppMealActionReplies } from "./mealActionReplyComposer";
import type { WhatsAppLogicalReply } from "./replyContract";
import {
  buildWhatsAppCallbackResourceNotFoundReplyMessage,
  buildWhatsAppRecoverableErrorReplyMessage,
} from "./replyMessages";
import type { MixedIncrementSelectionContinuation } from "./mixedMealItemIncrementPlanTypes";
import { applyChoicePlan } from "./mealItemSelectionMutation";
import type {
  MealItemSelectionMutationBindings,
  SelectionMeal,
  SelectionMealItem,
} from "./mealItemSelectionMutation";
import { isCompleteWhatsappCommand } from "./foodClarificationContract";
import {
  isStandaloneWhatsappSelectionCancellation,
  normalizeStandaloneWhatsappCommand,
} from "./standaloneCommandWords";
import { createMealItemSelectionLifecycle } from "./mealItemSelectionLifecycle";

export const PENDING_MEAL_ITEM_SELECTION_TYPE = "meal_item_selection";
const PENDING_MEAL_ITEM_SELECTION_TTL_MS = 10 * 60 * 1000;
const PENDING_MEAL_ITEM_SELECTION_ORIGIN = "mealItemSelectionCallback";
const CANCEL_ACTION = "cancel";
const SELECT_ACTION_PREFIX = "select:";

const pendingOperationRepository =
  createDrizzleWhatsAppPendingOperationRepository({
    getDb,
    onWarning: logPersistenceWarning,
  });

export type MealItemSelectionCandidate = {
  mealId: number;
  mealLabel: string;
  itemIndex: number;
  itemName: string;
};

export type MealItemSelectionAction =
  | { kind: "grams_delta"; delta: number }
  | { kind: "grams_absolute"; grams: number }
  | { kind: "quantity_absolute"; quantity: number; unit: string }
  | { kind: "replace_food"; targetFood: string }
  | { kind: "mixed_increment_target"; operationIndex: number };

export type MealItemSelectionCompanionAction = {
  candidate: MealItemSelectionCandidate;
  action: MealItemSelectionAction;
};

export type MealItemPendingSelectionStep = {
  targetFood: string | null;
  action: MealItemSelectionAction;
  contextLabel: string;
  candidates: MealItemSelectionCandidate[];
};

export type PendingMealItemSelection = MealItemPendingSelectionStep & {
  resultTitle: string;
  companionActions?: MealItemSelectionCompanionAction[];
  remainingSelections?: MealItemPendingSelectionStep[];
  continuation?: MixedIncrementSelectionContinuation;
};

export type MealItemSelectionResult = {
  handled: true;
  action:
    | "clarification_needed"
    | "meal_item_grams_adjusted"
    | "meal_item_replaced";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown>;
  interactiveReply?: WhatsAppLogicalReply;
};

const selectionMutationBindings: MealItemSelectionMutationBindings = {
  listMeals: async (userId, options) =>
    (await listMeals(userId, options)) as unknown as SelectionMeal[],
  readMutationPreImage: value => getMealMutationPreImage(value),
  scaleMealItem: (item, grams) =>
    scaleMealItem(item as MealItemInput, grams) as unknown as SelectionMealItem,
  scaleMealItemQuantity: (item, quantity, unit) =>
    scaleMealItemQuantity(
      item as MealItemInput,
      quantity,
      unit
    ) as unknown as SelectionMealItem,
  replaceMealItemFood: (item, targetFood) =>
    replaceMealItemFood(
      item as MealItemInput,
      targetFood
    ) as unknown as SelectionMealItem,
  updateMealsWithCompensation: async (userId, changes) =>
    (await updateMealsWithCompensation(
      userId,
      changes as unknown as MealBatchMutationChange[]
    )) as unknown as SelectionMeal[],
  describeBatchFailure: describeMealBatchMutationFailure,
  buildRecoverableErrorReply: buildWhatsAppRecoverableErrorReplyMessage,
  composeActionReplies: input =>
    composeWhatsAppMealActionReplies(
      input as unknown as Parameters<
        typeof composeWhatsAppMealActionReplies
      >[0]
    ),
  normalizeCandidateName: normalizeStandaloneWhatsappCommand,
};

function parseSelectionIndex(normalized: string) {
  const ordinalWords: Record<string, number> = {
    primeiro: 0,
    primeira: 0,
    segundo: 1,
    segunda: 1,
    terceiro: 2,
    terceira: 2,
    quarto: 3,
    quarta: 3,
    quinto: 4,
    quinta: 4,
  };
  for (const [word, index] of Object.entries(ordinalWords)) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) return index;
  }
  const numeric = normalized.match(/(?:^|\b)(\d{1,2})(?:\b|$)/);
  return numeric ? Number(numeric[1]) - 1 : null;
}

function selectionVerb(action: MealItemSelectionAction) {
  return action.kind === "replace_food" ? "trocar" : "ajustar";
}

function formatAmbiguityPrompt(pending: PendingMealItemSelection) {
  const options = pending.candidates
    .map(
      (candidate, index) =>
        `${index + 1}. ${candidate.itemName} em ${candidate.mealLabel}`
    )
    .join("\n");
  return `Encontrei mais de um item parecido com "${pending.targetFood ?? "esse alimento"}" ${pending.contextLabel}. Qual devo ${selectionVerb(pending.action)}?\n${options}\n\nResponda com o número ou ordinal, ou toque em uma opção. Envie CANCELAR para desistir.`;
}

export function isMealItemSelectionReply(text?: string | null) {
  if (!text?.trim()) return false;
  const normalized = normalizeStandaloneWhatsappCommand(text);
  return (
    parseSelectionIndex(normalized) !== null ||
    isStandaloneWhatsappSelectionCancellation(normalized)
  );
}

export function buildMealItemSelectionActions(
  candidates: MealItemSelectionCandidate[]
): WhatsappInteractionAction[] {
  return [
    ...candidates.map((candidate, index) => ({
      id: `${SELECT_ACTION_PREFIX}${index}`,
      label: `${index + 1}. ${candidate.itemName}`,
      description: candidate.mealLabel,
      effect: "select_candidate",
    })),
    { id: CANCEL_ACTION, label: "Cancelar", effect: "cancel_selection" },
  ];
}

function formatClosedDecisionReply(
  bodyText: string,
  pendingOperationId: number,
  candidates: MealItemSelectionCandidate[]
): WhatsAppLogicalReply {
  return buildWhatsappClosedDecisionReply({
    bodyText,
    pendingOperationId,
    actions: buildMealItemSelectionActions(candidates),
  });
}

export const buildMealItemSelectionReply = formatClosedDecisionReply;

function clarificationResult(
  reply: string,
  eventType: string,
  detail: string,
  data: Record<string, unknown> = {}
): MealItemSelectionResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply,
    eventType,
    detail,
    data,
  };
}

function buildCancellationResult() {
  return clarificationResult(
    "Tudo certo. Não alterei nada.",
    "whatsapp.intent.meal_item_selection_cancelled",
    "Seleção cancelada antes de qualquer mutação."
  );
}

function buildCallbackResourceNotFoundResult() {
  return clarificationResult(
    buildWhatsAppCallbackResourceNotFoundReplyMessage(),
    "whatsapp.intent.meal_item_selection_resource_not_found",
    "O alvo da seleção não corresponde mais ao estado esperado."
  );
}

export async function createPendingMealItemChoice(
  userId: number,
  pending: PendingMealItemSelection,
  receivedAt?: Date
): Promise<MealItemSelectionResult> {
  const now =
    receivedAt && Number.isFinite(receivedAt.getTime())
      ? receivedAt
      : undefined;
  const created = await pendingOperationRepository.createPendingOperation({
    userId,
    type: PENDING_MEAL_ITEM_SELECTION_TYPE,
    origin: PENDING_MEAL_ITEM_SELECTION_ORIGIN,
    ttlMs: PENDING_MEAL_ITEM_SELECTION_TTL_MS,
    target: pending,
    ...(now ? { now } : {}),
  });
  const reply = formatAmbiguityPrompt(pending);
  return {
    handled: true,
    action: "clarification_needed",
    reply,
    ...(created
      ? {
          interactiveReply: buildMealItemSelectionReply(
            reply,
            created.id,
            pending.candidates
          ),
        }
      : {}),
    eventType: "whatsapp.intent.meal_item_selection_requested",
    detail:
      "Seleção ambígua persistida antes da mutação; nenhum dado foi alterado.",
    data: {
      targetFood: pending.targetFood,
      candidateCount: pending.candidates.length,
      remainingSelectionCount: pending.remainingSelections?.length ?? 0,
      pendingOperationId: created?.id ?? null,
      interactionId: "meal_item.candidate_selection",
      interactionActionCount: pending.candidates.length + 1,
      interactionComponent:
        pending.candidates.length + 1 <= 3 ? "buttons" : "list",
    },
  };
}

const mealItemSelectionLifecycle = createMealItemSelectionLifecycle({
  pendingOperationRepository,
  createPendingMealItemChoice,
  applyChoicePlan: (userId, selected, pending) =>
    applyChoicePlan(
      userId,
      selected,
      pending,
      selectionMutationBindings
  ),
  parseChoiceIndex: parseSelectionIndex,
  isChoiceCancellation: isStandaloneWhatsappSelectionCancellation,
  isCompleteCommand: isCompleteWhatsappCommand,
  normalizeChoiceText: normalizeStandaloneWhatsappCommand,
  buildMealItemSelectionReply,
  continueMixedIncrementPlan: async (userId, plan, options) => {
    const { continueMixedMealItemIncrementPlan } = await import(
      "./mixedMealItemIncrementPlan"
    );
    return continueMixedMealItemIncrementPlan(userId, plan, options);
  },
  clarificationResult,
  buildCancellationResult,
  buildCallbackResourceNotFoundResult,
});

export const handleTextMealItemChoice =
  mealItemSelectionLifecycle.handleTextMealItemChoice;
export const completeItemChoiceInteractiveCallback =
  mealItemSelectionLifecycle.completeItemChoiceInteractiveCallback;

export const contextUsage: import("./intentContext").IntentContextUsage = {
  usesRecentWindow: false,
  usesSummary: false,
  usesPendingOperation: true,
  usesLongTermMemory: false,
  requiresFreshDbQuery: true,
};
export const createPendingMealItemSelection = createPendingMealItemChoice;
export const resolveTextMealItemSelection = handleTextMealItemChoice;
export const completeMealItemSelectionInteractiveCallback =
  completeItemChoiceInteractiveCallback;
