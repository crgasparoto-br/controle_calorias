import { getDb, logPersistenceWarning } from "../../db";
import { createDrizzleWhatsAppPendingOperationRepository, type WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import { listMeals } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { scaleMealItem, scaleMealItemQuantity, replaceMealItemFood } from "./intent/mealItemHelpers";
import { buildWhatsAppCallbackId } from "./interactiveCallback";
import {
  describeMealBatchMutationFailure,
  updateMealsWithCompensation,
  type MealBatchMutationChange,
} from "./mealBatchMutation";
import { listReply, type WhatsAppLogicalReply } from "./replyContract";
import {
  buildWhatsAppCallbackResourceNotFoundReplyMessage,
  buildWhatsAppMealActionReplyMessage,
  buildWhatsAppRecoverableErrorReplyMessage,
} from "./replyMessages";
import { collapseWhitespace, stripDiacritics } from "./webhookUtils";

export const PENDING_MEAL_ITEM_SELECTION_TYPE = "meal_item_selection";
const PENDING_MEAL_ITEM_SELECTION_TTL_MS = 10 * 60 * 1000;
const PENDING_MEAL_ITEM_SELECTION_ORIGIN = "mealItemSelectionCallback";
const CANCEL_ACTION = "cancel";
const SELECT_ACTION_PREFIX = "select:";
const MAX_LIST_ROW_TITLE_LENGTH = 24;

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({ getDb, onWarning: logPersistenceWarning });

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
  | { kind: "replace_food"; targetFood: string };

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
};

export type MealItemSelectionResult = {
  handled: true;
  action: "clarification_needed" | "meal_item_grams_adjusted" | "meal_item_replaced";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown>;
  interactiveReply?: WhatsAppLogicalReply;
};

function normalizeSelectionText(value: string) {
  return collapseWhitespace(stripDiacritics(value).toLowerCase().replace(/[^a-z0-9\s]/g, " "));
}

function parseSelectionIndex(normalized: string) {
  const ordinalWords: Record<string, number> = { primeiro: 0, primeira: 0, segundo: 1, segunda: 1, terceiro: 2, terceira: 2, quarto: 3, quarta: 3, quinto: 4, quinta: 4 };
  for (const [word, index] of Object.entries(ordinalWords)) {
    if (new RegExp(`\\b${word}\\b`).test(normalized)) return index;
  }
  const numeric = normalized.match(/(?:^|\b)(\d{1,2})(?:\b|$)/);
  return numeric ? Number(numeric[1]) - 1 : null;
}

function isCancellationText(normalized: string) {
  return ["nao", "cancelar", "cancela", "parar", "desfazer", "nenhuma", "nenhuma dessas", "nenhuma dessas opcoes"].includes(normalized);
}

function truncateListRowTitle(title: string) {
  return title.length > MAX_LIST_ROW_TITLE_LENGTH ? `${title.slice(0, MAX_LIST_ROW_TITLE_LENGTH - 1)}…` : title;
}

function selectionVerb(action: MealItemSelectionAction) {
  return action.kind === "replace_food" ? "trocar" : "ajustar";
}

function buildSelectionQuestion(pending: PendingMealItemSelection) {
  const options = pending.candidates.map((candidate, index) => `${index + 1}. ${candidate.itemName} em ${candidate.mealLabel}`).join("\n");
  return `Encontrei mais de um item parecido com "${pending.targetFood ?? "esse alimento"}" ${pending.contextLabel}. Qual devo ${selectionVerb(pending.action)}?\n${options}\n\nResponda com o número ou ordinal, ou toque em uma opção.`;
}

function buildSelectionListReply(bodyText: string, pendingOperationId: number, candidates: MealItemSelectionCandidate[]): WhatsAppLogicalReply {
  return listReply(bodyText, "Ver opções", [
    { rows: candidates.map((candidate, index) => ({ id: buildWhatsAppCallbackId(pendingOperationId, `${SELECT_ACTION_PREFIX}${index}`), title: truncateListRowTitle(`${index + 1}. ${candidate.itemName}`), description: candidate.mealLabel })) },
    { rows: [{ id: buildWhatsAppCallbackId(pendingOperationId, CANCEL_ACTION), title: "Cancelar" }] },
  ]);
}

function clarificationResult(reply: string, eventType: string, detail: string, data: Record<string, unknown> = {}): MealItemSelectionResult {
  return { handled: true, action: "clarification_needed", reply, eventType, detail, data };
}

function buildCancellationResult() {
  return clarificationResult("Tudo certo. Não alterei nada.", "whatsapp.intent.meal_item_selection_cancelled", "Seleção cancelada antes de qualquer mutação.");
}

function buildCallbackResourceNotFoundResult() {
  return clarificationResult(buildWhatsAppCallbackResourceNotFoundReplyMessage(), "whatsapp.intent.meal_item_selection_resource_not_found", "O alvo da seleção não corresponde mais ao estado esperado.");
}

function buildStaleSelectionResult() {
  return clarificationResult("A refeição mudou desde a seleção. Nada foi alterado; faça o pedido novamente para eu confirmar o item atual.", "whatsapp.intent.meal_item_selection_stale", "Plano de seleção obsoleto bloqueado antes da mutação.");
}

export async function createPendingMealItemSelection(userId: number, pending: PendingMealItemSelection): Promise<MealItemSelectionResult> {
  const created = await pendingOperationRepository.createPendingOperation({ userId, type: PENDING_MEAL_ITEM_SELECTION_TYPE, origin: PENDING_MEAL_ITEM_SELECTION_ORIGIN, ttlMs: PENDING_MEAL_ITEM_SELECTION_TTL_MS, target: pending });
  const reply = buildSelectionQuestion(pending);
  return {
    handled: true,
    action: "clarification_needed",
    reply,
    ...(created ? { interactiveReply: buildSelectionListReply(reply, created.id, pending.candidates) } : {}),
    eventType: "whatsapp.intent.meal_item_selection_requested",
    detail: "Seleção ambígua persistida antes da mutação; nenhum dado foi alterado.",
    data: { targetFood: pending.targetFood, candidateCount: pending.candidates.length, remainingSelectionCount: pending.remainingSelections?.length ?? 0 },
  };
}

function resolveCandidateIndex(meal: Awaited<ReturnType<typeof listMeals>>[number], candidate: MealItemSelectionCandidate) {
  const originalItem = meal.items?.[candidate.itemIndex];
  if (originalItem && normalizeSelectionText(originalItem.foodName ?? "") === normalizeSelectionText(candidate.itemName)) return candidate.itemIndex;
  const matches = (meal.items ?? []).map((item, index) => ({ item, index })).filter(({ item }) => normalizeSelectionText(item.foodName ?? "") === normalizeSelectionText(candidate.itemName));
  return matches.length === 1 ? matches[0].index : null;
}

function applyActionToItem(item: MealItemInput, action: MealItemSelectionAction) {
  const previousGrams = Number(item.estimatedGrams || 0);
  if (action.kind === "grams_delta") {
    const nextGrams = Math.max(previousGrams + action.delta, 1);
    return { nextItem: scaleMealItem(item, nextGrams), actionLine: `${item.foodName}: de ${previousGrams} g para ${nextGrams} g` };
  }
  if (action.kind === "grams_absolute") {
    const nextGrams = Math.max(action.grams, 1);
    return { nextItem: scaleMealItem(item, nextGrams), actionLine: `${item.foodName}: de ${previousGrams} g para ${nextGrams} g` };
  }
  if (action.kind === "quantity_absolute") {
    const previousPortion = item.portionText ?? `${previousGrams} g`;
    const nextItem = scaleMealItemQuantity(item, action.quantity, action.unit);
    return { nextItem, actionLine: `${item.foodName}: de ${previousPortion} para ${nextItem.portionText}` };
  }
  return { nextItem: replaceMealItemFood(item, action.targetFood), actionLine: `${item.foodName} → ${action.targetFood}` };
}

async function applySelectionPlan(userId: number, selected: MealItemSelectionCandidate, pending: PendingMealItemSelection): Promise<MealItemSelectionResult> {
  const meals = await listMeals(userId);
  const plan: MealItemSelectionCompanionAction[] = [...(pending.companionActions ?? []), { candidate: selected, action: pending.action }];
  const workingMeals = new Map<number, Awaited<ReturnType<typeof listMeals>>[number]>();
  const actionLinesByMeal = new Map<number, string[]>();

  for (const step of plan) {
    const originalMeal = meals.find(meal => meal.id === step.candidate.mealId);
    if (!originalMeal?.items?.length) return buildStaleSelectionResult();
    const resolvedIndex = resolveCandidateIndex(originalMeal, step.candidate);
    if (resolvedIndex === null) return buildStaleSelectionResult();
    const sourceMeal = workingMeals.get(step.candidate.mealId) ?? originalMeal;
    const item = sourceMeal.items[resolvedIndex] as MealItemInput;
    const { nextItem, actionLine } = applyActionToItem(item, step.action);
    const nextMeal = { ...sourceMeal, items: sourceMeal.items.map((existingItem, index) => index === resolvedIndex ? nextItem : existingItem) };
    workingMeals.set(nextMeal.id, nextMeal);
    actionLinesByMeal.set(nextMeal.id, [...(actionLinesByMeal.get(nextMeal.id) ?? []), actionLine]);
  }

  const changes: MealBatchMutationChange[] = [];
  for (const meal of workingMeals.values()) {
    const before = meals.find(candidate => candidate.id === meal.id);
    if (!before?.items?.length) return buildStaleSelectionResult();
    changes.push({
      before: {
        id: before.id,
        mealLabel: before.mealLabel,
        occurredAt: before.occurredAt,
        notes: before.notes,
        items: before.items as MealItemInput[],
      },
      after: {
        id: meal.id,
        mealLabel: meal.mealLabel,
        occurredAt: meal.occurredAt,
        notes: meal.notes,
        items: meal.items as MealItemInput[],
      },
    });
  }

  let updatedMeals: Awaited<ReturnType<typeof updateMealsWithCompensation>>;
  try {
    updatedMeals = await updateMealsWithCompensation(userId, changes);
  } catch (error) {
    const failure = describeMealBatchMutationFailure(error);
    return clarificationResult(
      buildWhatsAppRecoverableErrorReplyMessage(failure.userMessage),
      "whatsapp.intent.meal_item_selection_batch_failed",
      failure.detail,
      { rollbackSucceeded: failure.rollbackSucceeded, affectedMealIds: changes.map(change => change.after.id) },
    );
  }

  const hasReplacement = plan.some(step => step.action.kind === "replace_food");
  return {
    handled: true,
    action: hasReplacement ? "meal_item_replaced" : "meal_item_grams_adjusted",
    reply: updatedMeals.map(meal => buildWhatsAppMealActionReplyMessage(meal, { title: pending.resultTitle, actionLines: actionLinesByMeal.get(meal.id) ?? [] })).join("\n\n"),
    eventType: hasReplacement ? "whatsapp.intent.meal_item_replaced" : "whatsapp.intent.meal_item_grams_adjusted",
    detail: `${plan.length} ação(ões) aplicada(s) somente após todas as seleções, com revalidação do estado atual.`,
    data: { mealId: updatedMeals[0]?.id, affectedMealIds: updatedMeals.map(meal => meal.id), actionCount: plan.length },
  };
}

async function continueSelectionOrApply(userId: number, selected: MealItemSelectionCandidate, pending: PendingMealItemSelection) {
  const resolvedActions: MealItemSelectionCompanionAction[] = [...(pending.companionActions ?? []), { candidate: selected, action: pending.action }];
  const [next, ...remaining] = pending.remainingSelections ?? [];
  if (next) {
    return createPendingMealItemSelection(userId, {
      ...next,
      resultTitle: pending.resultTitle,
      companionActions: resolvedActions,
      remainingSelections: remaining,
    });
  }
  return applySelectionPlan(userId, selected, pending);
}

export async function resolveTextMealItemSelection(userId: number, text?: string | null): Promise<MealItemSelectionResult | null> {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const pendingRow: WhatsAppPendingOperationRecord | null = await pendingOperationRepository.getActivePendingOperation(userId);
  if (!pendingRow || pendingRow.type !== PENDING_MEAL_ITEM_SELECTION_TYPE) return null;
  const pending = pendingRow.target as PendingMealItemSelection;
  const normalized = normalizeSelectionText(trimmed);
  if (isCancellationText(normalized)) {
    await pendingOperationRepository.cancelPendingOperation(pendingRow.id);
    return buildCancellationResult();
  }
  const index = parseSelectionIndex(normalized);
  if (index === null) return clarificationResult(`Escolha uma das opções de 1 a ${pending.candidates.length} ou responda CANCELAR.`, "whatsapp.intent.meal_item_selection_needed", "Pendência continua ativa; nenhuma mutação foi executada.", { candidateCount: pending.candidates.length });
  const selected = pending.candidates[index];
  if (!selected) return clarificationResult(`A opção ${index + 1} não existe. Escolha um número entre 1 e ${pending.candidates.length}, ou responda CANCELAR.`, "whatsapp.intent.meal_item_selection_invalid", "Índice inexistente na seleção persistida.", { candidateCount: pending.candidates.length });
  const claim = await pendingOperationRepository.claimPendingOperation({ id: pendingRow.id, expectedVersion: pendingRow.version });
  if (!claim.claimed) return null;
  return continueSelectionOrApply(userId, selected, pending);
}

export async function completeMealItemSelectionInteractiveCallback(userId: number, pendingOperation: Pick<WhatsAppPendingOperationRecord, "target">, action: string): Promise<MealItemSelectionResult> {
  const pending = pendingOperation.target as PendingMealItemSelection;
  if (action === CANCEL_ACTION) return buildCancellationResult();
  if (action.startsWith(SELECT_ACTION_PREFIX)) {
    const selected = pending.candidates[Number(action.slice(SELECT_ACTION_PREFIX.length))];
    if (!selected) return buildCallbackResourceNotFoundResult();
    return continueSelectionOrApply(userId, selected, pending);
  }
  return buildCallbackResourceNotFoundResult();
}

export const contextUsage: import("./intentContext").IntentContextUsage = {
  usesRecentWindow: false,
  usesSummary: false,
  usesPendingOperation: true,
  usesLongTermMemory: false,
  requiresFreshDbQuery: true,
};
