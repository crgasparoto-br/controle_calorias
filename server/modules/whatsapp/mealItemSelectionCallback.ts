import { getDb, logPersistenceWarning } from "../../db";
import { createDrizzleWhatsAppPendingOperationRepository, type WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import { listMeals, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { scaleMealItem, scaleMealItemQuantity, replaceMealItemFood } from "./intent/mealItemHelpers";
import { buildWhatsAppCallbackId } from "./interactiveCallback";
import { listReply, type WhatsAppLogicalReply } from "./replyContract";
import { buildWhatsAppCallbackResourceNotFoundReplyMessage, buildWhatsAppMealActionReplyMessage } from "./replyMessages";
import { collapseWhitespace, stripDiacritics } from "./webhookUtils";

export const PENDING_MEAL_ITEM_SELECTION_TYPE = "meal_item_selection";
const PENDING_MEAL_ITEM_SELECTION_TTL_MS = 10 * 60 * 1000;
const PENDING_MEAL_ITEM_SELECTION_ORIGIN = "mealItemSelectionCallback";
const CANCEL_ACTION = "cancel";
const SELECT_ACTION_PREFIX = "select:";
const MAX_LIST_ROW_TITLE_LENGTH = 24;

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
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
  | { kind: "replace_food"; targetFood: string };

export type MealItemSelectionCompanionAction = {
  candidate: MealItemSelectionCandidate;
  action: MealItemSelectionAction;
};

export type PendingMealItemSelection = {
  targetFood: string | null;
  action: MealItemSelectionAction;
  contextLabel: string;
  resultTitle: string;
  candidates: MealItemSelectionCandidate[];
  companionActions?: MealItemSelectionCompanionAction[];
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
    {
      rows: candidates.map((candidate, index) => ({
        id: buildWhatsAppCallbackId(pendingOperationId, `${SELECT_ACTION_PREFIX}${index}`),
        title: truncateListRowTitle(`${index + 1}. ${candidate.itemName}`),
        description: candidate.mealLabel,
      })),
    },
    { rows: [{ id: buildWhatsAppCallbackId(pendingOperationId, CANCEL_ACTION), title: "Cancelar" }] },
  ]);
}

function buildCancellationResult(): MealItemSelectionResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: "Tudo certo. Não alterei nada.",
    eventType: "whatsapp.intent.meal_item_selection_cancelled",
    detail: "Seleção de item ambíguo cancelada antes de qualquer mutação.",
    data: {},
  };
}

function buildCallbackResourceNotFoundResult(): MealItemSelectionResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: buildWhatsAppCallbackResourceNotFoundReplyMessage(),
    eventType: "whatsapp.intent.meal_item_selection_resource_not_found",
    detail: "Callback de seleção de item resolvido, mas o alvo não corresponde mais ao estado esperado.",
    data: {},
  };
}

function buildStaleSelectionResult(): MealItemSelectionResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: "A refeição mudou desde a seleção. Nada foi alterado; faça o pedido novamente para eu confirmar o item atual.",
    eventType: "whatsapp.intent.meal_item_selection_stale",
    detail: "Seleção de item ficou obsoleta antes da confirmação e foi bloqueada.",
    data: {},
  };
}

export async function createPendingMealItemSelection(userId: number, pending: PendingMealItemSelection): Promise<MealItemSelectionResult> {
  const created = await pendingOperationRepository.createPendingOperation({
    userId,
    type: PENDING_MEAL_ITEM_SELECTION_TYPE,
    origin: PENDING_MEAL_ITEM_SELECTION_ORIGIN,
    ttlMs: PENDING_MEAL_ITEM_SELECTION_TTL_MS,
    target: pending,
  });
  const reply = buildSelectionQuestion(pending);
  return {
    handled: true,
    action: "clarification_needed",
    reply,
    ...(created ? { interactiveReply: buildSelectionListReply(reply, created.id, pending.candidates) } : {}),
    eventType: "whatsapp.intent.meal_item_selection_requested",
    detail: "Seleção de item ambíguo persistida antes da mutação; nenhum dado foi alterado.",
    data: { targetFood: pending.targetFood, candidateCount: pending.candidates.length },
  };
}

function resolveCandidateIndex(meal: Awaited<ReturnType<typeof listMeals>>[number], candidate: MealItemSelectionCandidate) {
  let resolvedIndex = candidate.itemIndex;
  const originalItem = meal.items?.[resolvedIndex];
  if (originalItem && normalizeSelectionText(originalItem.foodName ?? "") === normalizeSelectionText(candidate.itemName)) {
    return resolvedIndex;
  }
  const matches = (meal.items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => normalizeSelectionText(item.foodName ?? "") === normalizeSelectionText(candidate.itemName));
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

async function applySelectionPlan(
  userId: number,
  selected: MealItemSelectionCandidate,
  pending: PendingMealItemSelection,
): Promise<MealItemSelectionResult> {
  const meals = await listMeals(userId);
  const plan: MealItemSelectionCompanionAction[] = [
    { candidate: selected, action: pending.action },
    ...(pending.companionActions ?? []),
  ];
  const workingMeals = new Map<number, Awaited<ReturnType<typeof listMeals>>[number]>();
  const actionLinesByMeal = new Map<number, string[]>();

  for (const step of plan) {
    const sourceMeal = workingMeals.get(step.candidate.mealId) ?? meals.find(meal => meal.id === step.candidate.mealId);
    if (!sourceMeal?.items?.length) return buildStaleSelectionResult();
    const resolvedIndex = resolveCandidateIndex(sourceMeal, step.candidate);
    if (resolvedIndex === null) return buildStaleSelectionResult();
    const item = sourceMeal.items[resolvedIndex] as MealItemInput;
    const { nextItem, actionLine } = applyActionToItem(item, step.action);
    const nextMeal = {
      ...sourceMeal,
      items: sourceMeal.items.map((existingItem, index) => index === resolvedIndex ? nextItem : existingItem),
    };
    workingMeals.set(nextMeal.id, nextMeal);
    actionLinesByMeal.set(nextMeal.id, [...(actionLinesByMeal.get(nextMeal.id) ?? []), actionLine]);
  }

  const updatedMeals = [];
  for (const meal of workingMeals.values()) {
    updatedMeals.push(await updateMeal(userId, {
      mealId: meal.id,
      mealLabel: meal.mealLabel,
      occurredAt: new Date(meal.occurredAt).toISOString(),
      notes: meal.notes,
      items: meal.items as MealItemInput[],
    }));
  }

  const hasReplacement = plan.some(step => step.action.kind === "replace_food");
  return {
    handled: true,
    action: hasReplacement ? "meal_item_replaced" : "meal_item_grams_adjusted",
    reply: updatedMeals.map(meal => buildWhatsAppMealActionReplyMessage(meal, {
      title: pending.resultTitle,
      actionLines: actionLinesByMeal.get(meal.id) ?? [],
    })).join("\n\n"),
    eventType: hasReplacement ? "whatsapp.intent.meal_item_replaced" : "whatsapp.intent.meal_item_grams_adjusted",
    detail: `${plan.length} ação(ões) aplicada(s) somente após a seleção ambígua, com revalidação do estado atual.`,
    data: { mealId: updatedMeals[0]?.id, affectedMealIds: updatedMeals.map(meal => meal.id), actionCount: plan.length },
  };
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
  if (index === null) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: `Escolha uma das opções de 1 a ${pending.candidates.length} (por exemplo: o segundo) ou responda CANCELAR.`,
      eventType: "whatsapp.intent.meal_item_selection_needed",
      detail: "Pendência de seleção continua ativa; nenhuma mutação foi executada.",
      data: { candidateCount: pending.candidates.length },
    };
  }

  const selected = pending.candidates[index];
  if (!selected) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: `A opção ${index + 1} não existe. Escolha um número entre 1 e ${pending.candidates.length}, ou responda CANCELAR.`,
      eventType: "whatsapp.intent.meal_item_selection_invalid",
      detail: "Índice informado não existe na seleção ambígua persistida.",
      data: { candidateCount: pending.candidates.length },
    };
  }

  const claim = await pendingOperationRepository.claimPendingOperation({ id: pendingRow.id, expectedVersion: pendingRow.version });
  if (!claim.claimed) return null;
  return applySelectionPlan(userId, selected, pending);
}

export async function completeMealItemSelectionInteractiveCallback(
  userId: number,
  pendingOperation: Pick<WhatsAppPendingOperationRecord, "target">,
  action: string,
): Promise<MealItemSelectionResult> {
  const pending = pendingOperation.target as PendingMealItemSelection;

  if (action === CANCEL_ACTION) {
    return buildCancellationResult();
  }

  if (action.startsWith(SELECT_ACTION_PREFIX)) {
    const index = Number(action.slice(SELECT_ACTION_PREFIX.length));
    const selected = pending.candidates[index];
    if (!selected) return buildCallbackResourceNotFoundResult();
    return applySelectionPlan(userId, selected, pending);
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
