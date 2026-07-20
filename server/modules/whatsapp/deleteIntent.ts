import { getDb, logPersistenceWarning } from "../../db";
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { createDrizzleWhatsAppPendingOperationRepository, type WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import { listMeals, removeMeal, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { formatWhatsAppConsolidationDateKey } from "./mealConsolidation";
import type { WhatsappInterpretedIntent } from "./intentSchema";
import { collapseWhitespace, stripDiacritics } from "./webhookUtils";
import { buildWhatsAppCallbackId, claimWhatsAppTextPendingOperation } from "./interactiveCallback";
import { buttonsReply, listReply, type WhatsAppLogicalReply } from "./replyContract";
import { buildWhatsAppCallbackResourceNotFoundReplyMessage } from "./replyMessages";
import { composeWhatsAppMealActionReply } from "./mealActionReplyComposer";
import { getRecentConversationTurns } from "./conversationHistory";

const CONFIRM_ACTION = "confirm";
const CANCEL_ACTION = "cancel";
const SELECT_ACTION_PREFIX = "select:";
const MAX_LIST_ROW_TITLE_LENGTH = 24;

export type WhatsappDeleteIntentKind = "delete_food_from_meal" | "delete_meal" | "unknown_delete";
export type WhatsappDeleteContextReference = "conversation" | "latest" | "named_meal" | "recent";

export type WhatsappDeleteIntentDetection = {
  kind: WhatsappDeleteIntentKind;
  text: string;
  normalizedText: string;
  reply: string;
  detail: string;
  eventType: string;
  targetFoodName?: string;
  targetMealLabel?: string;
  contextReference?: WhatsappDeleteContextReference;
};

export type WhatsappDeleteIntentResult = {
  handled: true;
  action: "clarification_needed" | "meal_deleted" | "meal_item_deleted" | "delete_cancelled";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown>;
  /** Quando presente, o transporte central deve enviar botões/lista (issue #782) em vez do texto simples de `reply`. */
  interactiveReply?: WhatsAppLogicalReply;
};

type PendingDeleteIntent = {
  kind: "delete_meal" | "delete_food_from_meal";
  mealId: number;
  mealLabel: string;
  mealOccurredAt: string;
  itemIndex?: number;
  itemName?: string;
};

type PendingDeleteSelection = {
  kind: "selection";
  targetFoodName: string;
  candidates: PendingDeleteIntent[];
};

type PendingDeleteOperation = PendingDeleteIntent | PendingDeleteSelection;
type ListedMeal = Awaited<ReturnType<typeof listMeals>>[number];

type FoodMatch = {
  meal: ListedMeal;
  item: ListedMeal["items"][number];
  itemIndex: number;
};

type DeleteExecutionInput = {
  text?: string | null;
  timeZone?: string | null;
  receivedAt?: Date;
  entrypoint?: string;
};

const PENDING_DELETE_TTL_MS = 10 * 60 * 1000;
export const PENDING_DELETE_TYPE = "delete";
const PENDING_DELETE_ORIGIN = "deleteIntent";
const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

const DELETE_FOOD_REPLY = [
  "Entendi que você quer remover um alimento, mas preciso confirmar qual item.",
  "Me envie o nome do alimento e a refeição/data, ou peça para remover o último alimento registrado. Não registrei nenhum alimento novo.",
].join("\n\n");

const DELETE_MEAL_REPLY = [
  "Entendi que você quer remover uma refeição, mas preciso confirmar qual registro.",
  "Me diga qual refeição/data deseja revisar. Não excluí nada e não registrei nenhum alimento novo.",
].join("\n\n");

const UNKNOWN_DELETE_REPLY = [
  "Entendi que você quer remover algo, mas preciso confirmar se é um alimento específico ou uma refeição inteira.",
  "Me envie o nome do alimento e a refeição/data, ou diga qual refeição quer revisar. Não excluí nada e não registrei nenhum alimento novo.",
].join("\n\n");

function normalizeDeleteIntentText(value: string) {
  return collapseWhitespace(stripDiacritics(value).toLowerCase().replace(/[^a-z0-9\s]/g, " "));
}

function normalizeMealLabelForDelete(label: string) {
  const normalized = normalizeDeleteIntentText(label);
  if (normalized.includes("cafe") || normalized.includes("manha")) return "cafe da manha";
  if (normalized.includes("almoco")) return "almoco";
  if (normalized.includes("janta")) return "jantar";
  if (normalized.includes("lanche")) return "lanche";
  if (normalized.includes("ceia")) return "ceia";
  return normalized;
}

function isGenericMealLabel(label: string) {
  const normalized = normalizeMealLabelForDelete(label);
  return !normalized || ["refeicao", "refeicao registrada", "refeicao fotografada"].includes(normalized);
}

function hasDestructiveVerb(normalized: string) {
  return /\b(?:excluir|exclua|exclui|remover|remova|remove|apagar|apague|apaga|deletar|delete|deleta|tirar|tire|tira|retirar|retire|retira)\b/.test(normalized);
}

function hasExplicitFoodAbsenceSignal(normalized: string) {
  return /^(?:nao\s+(?:tem|tinha|havia|existe|existia)|sem)\s+/.test(normalized);
}

function extractMealContextLabel(normalized: string) {
  if (/\b(?:cafe\s+da\s+manha|cafe|manha)\b/.test(normalized)) return "cafe da manha";
  if (/\balmoco\b/.test(normalized)) return "almoco";
  if (/\bjantar\b|\bjanta\b/.test(normalized)) return "jantar";
  if (/\blanche\b/.test(normalized)) return "lanche";
  if (/\bceia\b/.test(normalized)) return "ceia";
  return null;
}

function removeMealContextFromTarget(value: string) {
  return value
    .replace(/\b(?:do|da|no|na|em|durante\s+o|durante\s+a)\s+(?:cafe\s+da\s+manha|cafe|manha|almoco|jantar|janta|lanche|ceia)\b.*$/g, " ")
    .replace(/\b(?:cafe\s+da\s+manha|cafe|manha|almoco|jantar|janta|lanche|ceia)\b$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAbsentFoodName(normalized: string) {
  const value = removeMealContextFromTarget(normalized
    .replace(/^(?:nao\s+(?:tem|tinha|havia|existe|existia)|sem)\s+/, "")
    .replace(/\b(?:na|no|nesta|neste|nessa|nesse)\s+(?:refeicao|foto|imagem|prato)\b.*$/g, " ")
    .replace(/\b(?:refeicao|foto|imagem|prato)\b.*$/g, " "));
  return value.length >= 2 ? value : null;
}

function hasQuantityAdjustmentSignal(normalized: string) {
  return /\b(?:tirar|tire|tira|remover|remova|remove|retirar|retire|retira|reduzir|reduza|diminui|diminuir)\b/.test(normalized)
    && /\b\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|ml|l|un|unidades?|fatias?|colheres?|porcoes?|porcao)\b/.test(normalized);
}

function hasMealTarget(normalized: string) {
  return /\b(?:refeicao|refeicoes|prato|registro|registros|foto|fotografada|fotografado|ultima|ultimo|almoco|jantar|lanche|cafe|ceia)\b/.test(normalized);
}

function hasFoodTarget(normalized: string) {
  return /\b(?:alimento|alimentos|item|itens|comida|ingrediente)\b/.test(normalized);
}

function isConversationReference(normalized: string) {
  return /\b(?:essa|esse|esta|este|aquela|aquele)\s+(?:refeicao|prato|registro|alimento|item)\b/.test(normalized);
}

function isLatestReference(normalized: string) {
  return /\b(?:ultimo|ultima)\s+(?:refeicao|prato|registro|alimento|item|comida|ingrediente)\b/.test(normalized);
}

function extractTargetFoodName(normalized: string) {
  const value = removeMealContextFromTarget(normalized
    .replace(/\b(?:excluir|exclua|exclui|remover|remova|remove|apagar|apague|apaga|deletar|delete|deleta|tirar|tire|tira|retirar|retire|retira)\b/g, " ")
    .replace(/\b(?:o|a|os|as|um|uma)\b/g, " ")
    .replace(/\b(?:alimento|alimentos|item|itens|comida|ingrediente)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim());
  return value.length >= 3 ? value : null;
}

function isMealOnlyTarget(value: string | null) {
  if (!value) return false;
  return /^(?:(?:essa|esse|esta|este|aquela|aquele|ultima|ultimo)\s+)?(?:refeicao|refeicoes|refeicao\s+fotografada|prato|registro|registros|foto|fotografada|fotografado|almoco|jantar|janta|lanche|ceia|cafe(?:\s+da\s+manha)?)$/.test(value);
}

function isConfirmationText(normalized: string) {
  return ["sim", "confirmar", "confirma", "pode confirmar", "ok", "pode excluir", "pode remover", "autorizo", "autorizado"].includes(normalized);
}

function isCancellationText(normalized: string) {
  return ["nao", "cancelar", "cancela", "parar", "desfazer", "nao excluir", "não excluir", "nao remover", "não remover"].includes(normalized);
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

function formatMealReference(
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

function buildConfirmCancelButtonsReply(bodyText: string, pendingOperationId: number): WhatsAppLogicalReply {
  return buttonsReply(bodyText, [
    { id: buildWhatsAppCallbackId(pendingOperationId, CONFIRM_ACTION), title: "Confirmar" },
    { id: buildWhatsAppCallbackId(pendingOperationId, CANCEL_ACTION), title: "Cancelar" },
  ]);
}

function buildRoutingData(extra: Record<string, unknown> = {}) {
  return {
    executor: PENDING_DELETE_ORIGIN,
    fallbackBlocked: true,
    fallbackBlockReason: "destructive_intent",
    ...extra,
  };
}

function buildConfirmationInteraction(pending: PendingDeleteIntent, pendingOperationId?: number) {
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
    actions: [
      { id: CONFIRM_ACTION, label: "Confirmar", effect: "apply_delete" },
      { id: CANCEL_ACTION, label: "Cancelar", effect: "cancel_delete" },
    ],
    allowedEffects: ["select", "confirm", "cancel", "delete_once"],
    forbiddenEffects: ["nutrition_fallback", "meal_creation", "delete_without_confirmation"],
  };
}

function buildPendingResult(
  pending: PendingDeleteIntent,
  pendingOperationId: number | undefined,
  timeZone: string,
): WhatsappDeleteIntentResult {
  const reply = pending.kind === "delete_meal"
    ? buildPendingMealDeleteReply(pending, timeZone)
    : buildPendingFoodDeleteReply(pending, timeZone);
  return {
    handled: true,
    action: "clarification_needed",
    reply,
    ...(pendingOperationId ? { interactiveReply: buildConfirmCancelButtonsReply(reply, pendingOperationId) } : {}),
    eventType: pending.kind === "delete_meal"
      ? "whatsapp.intent.delete_meal_confirmation_requested"
      : "whatsapp.intent.delete_food_confirmation_requested",
    detail: pending.kind === "delete_meal"
      ? "Confirmação por mensagem solicitada antes de excluir refeição pelo WhatsApp."
      : "Confirmação por mensagem solicitada antes de remover alimento pelo WhatsApp.",
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
    }),
  };
}

function buildCallbackResourceNotFoundResult(): WhatsappDeleteIntentResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: buildWhatsAppCallbackResourceNotFoundReplyMessage(),
    eventType: "whatsapp.intent.delete_callback_resource_not_found",
    detail: "Callback de exclusão resolvido, mas o alvo não corresponde mais ao estado esperado no momento da execução.",
    data: buildRoutingData({ destructiveActionBlocked: true, pendingState: "blocked" }),
  };
}

function buildClarificationResult(detection: WhatsappDeleteIntentDetection): WhatsappDeleteIntentResult {
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

function buildCancellationResult(): WhatsappDeleteIntentResult {
  return {
    handled: true,
    action: "delete_cancelled",
    reply: "Tudo certo. Não excluí nenhum registro.",
    eventType: "whatsapp.intent.delete_cancelled",
    detail: "Exclusão pendente cancelada por mensagem no WhatsApp.",
    data: buildRoutingData({ destructiveActionCancelled: true, pendingState: "cancelled" }),
  };
}

function findLatestMealForDelete(meals: Awaited<ReturnType<typeof listMeals>>) {
  return meals[0] ?? null;
}

function shouldDeleteLastFood(normalized: string) {
  return /\b(?:ultimo|ultima)\s+(?:alimento|item|comida|ingrediente)\b/.test(normalized)
    || /\b(?:esse|este|essa|esta|ultimo|ultima)\s+(?:alimento|item)\b/.test(normalized);
}

function getMealDateKey(meal: ListedMeal) {
  return formatWhatsAppConsolidationDateKey(meal.occurredAt);
}

function getFoodSearchName(item: ListedMeal["items"][number]) {
  const extraNames = [
    "originalFoodName",
    "originalName",
    "displayName",
    "sourceFoodName",
    "inferredFoodName",
  ].map(key => {
    const value = (item as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  });

  return normalizeDeleteIntentText([
    item.foodName ?? "",
    item.canonicalName ?? "",
    ...extraNames,
  ].join(" "));
}

function itemMatchesFoodTarget(item: ListedMeal["items"][number], target: string) {
  const query = normalizeDeleteIntentText(target);
  const queryWords = query.split(/\s+/).filter(Boolean);
  const name = getFoodSearchName(item);
  return Boolean(query) && (name.includes(query) || queryWords.every(word => name.includes(word)));
}

function findFoodMatches(items: ListedMeal["items"], target: string) {
  return items
    .map((item, index) => ({ item, index }))
    .filter(candidate => itemMatchesFoodTarget(candidate.item, target));
}

function buildFoodSearchContext(meals: ListedMeal[], referenceMeal: ListedMeal) {
  const referenceDateKey = getMealDateKey(referenceMeal);
  const referenceLabel = normalizeMealLabelForDelete(referenceMeal.mealLabel);
  const sameDayMeals = meals.filter(meal => getMealDateKey(meal) === referenceDateKey);

  if (!sameDayMeals.length) return [referenceMeal];

  if (!isGenericMealLabel(referenceMeal.mealLabel)) {
    const sameLogicalMeal = sameDayMeals.filter(meal => normalizeMealLabelForDelete(meal.mealLabel) === referenceLabel);
    if (sameLogicalMeal.length) return sameLogicalMeal;
  }

  return sameDayMeals;
}

function findFoodMatchesInLogicalContext(meals: ListedMeal[], referenceMeal: ListedMeal, target: string): FoodMatch[] {
  const contextMeals = buildFoodSearchContext(meals, referenceMeal);
  return contextMeals.flatMap(meal => findFoodMatches(meal.items ?? [], target).map(match => ({
    meal,
    item: match.item,
    itemIndex: match.index,
  })));
}

function findNamedMeal(meals: ListedMeal[], targetMealLabel: string) {
  const normalizedTarget = normalizeMealLabelForDelete(targetMealLabel);
  return meals.find(meal => normalizeMealLabelForDelete(meal.mealLabel) === normalizedTarget) ?? null;
}

function getConversationReferencedMeal(userId: number, meals: ListedMeal[], receivedAt?: Date) {
  if (meals.length === 1) return meals[0];
  const turns = getRecentConversationTurns(userId, receivedAt?.getTime()).slice().reverse();
  for (const turn of turns) {
    const reply = normalizeDeleteIntentText(turn.botReply ?? "");
    if (!reply) continue;
    const matches = meals.filter(meal => {
      const label = normalizeMealLabelForDelete(meal.mealLabel);
      if (label && reply.includes(label)) return true;
      return (meal.items ?? []).some(item => {
        const foodName = normalizeDeleteIntentText(item.foodName ?? "");
        const canonicalName = normalizeDeleteIntentText(item.canonicalName ?? "");
        return Boolean((foodName && reply.includes(foodName)) || (canonicalName && reply.includes(canonicalName)));
      });
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null;
  }
  return null;
}

function resolveReferenceMeal(
  userId: number,
  meals: ListedMeal[],
  detection: WhatsappDeleteIntentDetection,
  receivedAt?: Date,
) {
  if (detection.targetMealLabel) {
    return findNamedMeal(meals, detection.targetMealLabel);
  }
  if (detection.contextReference === "conversation") {
    return getConversationReferencedMeal(userId, meals, receivedAt);
  }
  return findLatestMealForDelete(meals);
}

async function createPendingFoodDelete(userId: number, meal: ListedMeal, itemIndex: number, timeZone: string) {
  const item = meal.items[itemIndex];
  const pending: PendingDeleteIntent = {
    kind: "delete_food_from_meal",
    mealId: meal.id,
    mealLabel: meal.mealLabel,
    mealOccurredAt: new Date(meal.occurredAt).toISOString(),
    itemIndex,
    itemName: item.foodName,
  };
  const created = await pendingOperationRepository.createPendingOperation({
    userId,
    type: PENDING_DELETE_TYPE,
    origin: PENDING_DELETE_ORIGIN,
    ttlMs: PENDING_DELETE_TTL_MS,
    target: pending,
  });
  return buildPendingResult(pending, created?.id, timeZone);
}

function buildAmbiguousFoodMatchesReply(targetFoodName: string, matches: FoodMatch[]) {
  const options = matches
    .map((match, index) => `${index + 1}. ${match.item.foodName} em ${match.meal.mealLabel}`)
    .join("\n");
  return `Encontrei mais de um alimento parecido com "${targetFoodName}" no contexto do dia. Qual deseja remover?\n${options}\n\nResponda com o número ou ordinal, por exemplo: o segundo.`;
}

function truncateListRowTitle(title: string) {
  return title.length > MAX_LIST_ROW_TITLE_LENGTH ? `${title.slice(0, MAX_LIST_ROW_TITLE_LENGTH - 1)}…` : title;
}

function buildSelectionListReply(bodyText: string, pendingOperationId: number, candidates: PendingDeleteIntent[]): WhatsAppLogicalReply {
  return listReply(bodyText, "Ver opções", [
    {
      rows: candidates.map((candidate, index) => ({
        id: buildWhatsAppCallbackId(pendingOperationId, `${SELECT_ACTION_PREFIX}${index}`),
        title: truncateListRowTitle(`${index + 1}. ${candidate.itemName ?? "Alimento"}`),
        description: candidate.mealLabel,
      })),
    },
    { rows: [{ id: buildWhatsAppCallbackId(pendingOperationId, CANCEL_ACTION), title: "Cancelar" }] },
  ]);
}

async function createPendingDeleteSelection(userId: number, targetFoodName: string, matches: FoodMatch[]) {
  const candidates: PendingDeleteIntent[] = matches.map(match => ({
    kind: "delete_food_from_meal",
    mealId: match.meal.id,
    mealLabel: match.meal.mealLabel,
    mealOccurredAt: new Date(match.meal.occurredAt).toISOString(),
    itemIndex: match.itemIndex,
    itemName: match.item.foodName,
  }));
  const pending: PendingDeleteSelection = { kind: "selection", targetFoodName, candidates };
  const created = await pendingOperationRepository.createPendingOperation({
    userId,
    type: PENDING_DELETE_TYPE,
    origin: PENDING_DELETE_ORIGIN,
    ttlMs: PENDING_DELETE_TTL_MS,
    target: pending,
  });
  const reply = buildAmbiguousFoodMatchesReply(targetFoodName, matches);
  return {
    handled: true,
    action: "clarification_needed",
    reply,
    ...(created ? { interactiveReply: buildSelectionListReply(reply, created.id, candidates) } : {}),
    eventType: "whatsapp.intent.delete_food_selection_requested",
    detail: "Seleção destrutiva persistida antes da confirmação; nenhum item foi removido.",
    data: buildRoutingData({
      destructiveActionBlocked: true,
      candidateCount: candidates.length,
      pendingOperationId: created?.id ?? null,
      pendingType: "selection",
      pendingState: "open",
      targetFoodName,
      interaction: {
        id: created?.id ?? null,
        state: "open",
        type: "selection",
        targetFoodName,
        candidates: candidates.map((candidate, index) => ({
          order: index + 1,
          mealId: candidate.mealId,
          mealLabel: candidate.mealLabel,
          mealOccurredAt: candidate.mealOccurredAt,
          itemIndex: candidate.itemIndex ?? null,
          itemName: candidate.itemName ?? null,
        })),
        actions: [
          ...candidates.map((_candidate, index) => ({ id: `${SELECT_ACTION_PREFIX}${index}`, label: `Opção ${index + 1}`, effect: "select_candidate" })),
          { id: CANCEL_ACTION, label: "Cancelar", effect: "cancel_delete" },
        ],
        allowedEffects: ["select", "cancel"],
        forbiddenEffects: ["nutrition_fallback", "meal_creation", "delete_before_confirmation"],
      },
    }),
  } satisfies WhatsappDeleteIntentResult;
}

async function requestDeleteConfirmation(
  userId: number,
  detection: WhatsappDeleteIntentDetection,
  timeZone: string,
  receivedAt?: Date,
): Promise<WhatsappDeleteIntentResult> {
  const meals = await listMeals(userId);
  const referenceMeal = resolveReferenceMeal(userId, meals, detection, receivedAt);
  if (!referenceMeal) {
    if (detection.targetMealLabel) {
      return buildClarificationResult({
        ...detection,
        reply: `Não encontrei uma refeição recente de ${detection.targetMealLabel}. Me diga a data ou escolha outro registro para remover.`,
        eventType: "whatsapp.intent.delete_clarification_needed",
        detail: "Comando destrutivo com contexto de refeição sem candidato compatível.",
      });
    }
    if (detection.contextReference === "conversation") {
      return buildClarificationResult({
        ...detection,
        reply: "Não consegui identificar com segurança a qual refeição você se refere. Informe café da manhã, almoço, jantar, lanche, ceia ou a data.",
        eventType: "whatsapp.intent.delete_clarification_needed",
        detail: "Referência conversacional de exclusão sem refeição única resolvível.",
      });
    }
    return buildClarificationResult({
      ...detection,
      reply: "Não encontrei uma refeição recente para excluir. Me diga qual registro você quer revisar.",
      eventType: "whatsapp.intent.delete_clarification_needed",
      detail: "Comando destrutivo sem refeição recente disponível para confirmação.",
    });
  }

  if (detection.kind === "delete_meal") {
    const pending: PendingDeleteIntent = {
      kind: "delete_meal",
      mealId: referenceMeal.id,
      mealLabel: referenceMeal.mealLabel,
      mealOccurredAt: new Date(referenceMeal.occurredAt).toISOString(),
    };
    const created = await pendingOperationRepository.createPendingOperation({
      userId,
      type: PENDING_DELETE_TYPE,
      origin: PENDING_DELETE_ORIGIN,
      ttlMs: PENDING_DELETE_TTL_MS,
      target: pending,
    });
    return buildPendingResult(pending, created?.id, timeZone);
  }

  const items = referenceMeal.items ?? [];
  if (!items.length && !detection.targetFoodName) {
    return buildClarificationResult({
      ...detection,
      reply: "Encontrei a refeição recente, mas ela não tem alimentos detalhados para remover. Me diga qual registro você quer revisar.",
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Comando destrutivo de alimento sem itens na refeição recente.",
    });
  }

  if (shouldDeleteLastFood(detection.normalizedText)) {
    if (!items.length) {
      return buildClarificationResult({
        ...detection,
        reply: "Encontrei a refeição recente, mas ela não tem alimentos detalhados para remover. Me diga qual registro você quer revisar.",
        eventType: "whatsapp.intent.delete_food_clarification_needed",
        detail: "Comando destrutivo de último alimento sem itens na refeição recente.",
      });
    }
    return createPendingFoodDelete(userId, referenceMeal, items.length - 1, timeZone);
  }

  if (detection.targetFoodName) {
    const matches = findFoodMatchesInLogicalContext(meals, referenceMeal, detection.targetFoodName);
    if (matches.length === 1) return createPendingFoodDelete(userId, matches[0].meal, matches[0].itemIndex, timeZone);
    if (matches.length > 1) return createPendingDeleteSelection(userId, detection.targetFoodName, matches);
    return buildClarificationResult({
      ...detection,
      reply: `Não encontrei "${detection.targetFoodName}" nas refeições do contexto informado. Qual item devo remover?`,
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Comando destrutivo de alimento por nome sem candidato compatível no contexto lógico resolvido.",
    });
  }

  if (items.length > 1) {
    const matches: FoodMatch[] = items.map((item, itemIndex) => ({ meal: referenceMeal, item, itemIndex }));
    return createPendingDeleteSelection(userId, "alimento", matches);
  }

  return createPendingFoodDelete(userId, referenceMeal, items.length - 1, timeZone);
}

async function confirmPendingDelete(
  userId: number,
  pending: PendingDeleteIntent,
  timeZone: string,
): Promise<WhatsappDeleteIntentResult> {
  if (pending.kind === "delete_meal") {
    const currentMeal = (await listMeals(userId)).find(meal => meal.id === pending.mealId);
    if (!currentMeal) {
      return {
        handled: true,
        action: "clarification_needed",
        reply: "Essa refeição não está mais disponível. Nada foi excluído.",
        eventType: "whatsapp.intent.delete_meal_stale_confirmation",
        detail: "Confirmação de refeição ficou obsoleta antes da execução.",
        data: buildRoutingData({ mealId: pending.mealId, deleteIntentKind: pending.kind, pendingState: "blocked" }),
      };
    }
    await removeMeal(userId, pending.mealId);
    return {
      handled: true,
      action: "meal_deleted",
      reply: `Excluí a refeição ${formatMealReference(pending, timeZone)}.`,
      eventType: "whatsapp.intent.meal_deleted",
      detail: `Refeição ${pending.mealId} excluída após confirmação por mensagem no WhatsApp.`,
      data: buildRoutingData({ mealId: pending.mealId, deleteIntentKind: pending.kind, pendingState: "completed" }),
    };
  }

  const latestMeal = (await listMeals(userId)).find(meal => meal.id === pending.mealId);
  if (!latestMeal?.items?.length || pending.itemIndex === undefined || !pending.itemName) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei mais esse alimento na refeição. Nada foi excluído.",
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Confirmação de exclusão de alimento sem item compatível no momento da execução.",
      data: buildRoutingData({ mealId: pending.mealId, deleteIntentKind: pending.kind, pendingState: "blocked" }),
    };
  }

  let resolvedItemIndex = pending.itemIndex;
  const originalItem = latestMeal.items[resolvedItemIndex];
  if (!originalItem || normalizeDeleteIntentText(originalItem.foodName) !== normalizeDeleteIntentText(pending.itemName)) {
    const currentMatches = latestMeal.items
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => normalizeDeleteIntentText(candidate.foodName) === normalizeDeleteIntentText(pending.itemName ?? ""));
    if (currentMatches.length !== 1) {
      return {
        handled: true,
        action: "clarification_needed",
        reply: "A refeição mudou desde a seleção. Nada foi excluído; faça o pedido novamente para eu confirmar o item atual.",
        eventType: "whatsapp.intent.delete_food_stale_selection",
        detail: "Seleção de alimento ficou obsoleta antes da confirmação e foi bloqueada.",
        data: buildRoutingData({ mealId: pending.mealId, deleteIntentKind: pending.kind, pendingState: "blocked" }),
      };
    }
    resolvedItemIndex = currentMatches[0].index;
  }

  const item = latestMeal.items[resolvedItemIndex];
  const nextItems = latestMeal.items.filter((_item, index) => index !== resolvedItemIndex);
  if (!nextItems.length) {
    await removeMeal(userId, latestMeal.id);
    return {
      handled: true,
      action: "meal_deleted",
      reply: `Removi ${item.foodName}. Como era o único item, excluí também a refeição ${formatMealReference(pending, timeZone)}.`,
      eventType: "whatsapp.intent.meal_deleted_after_last_item_removed",
      detail: `Último alimento da refeição ${latestMeal.id} removido após confirmação; refeição excluída.`,
      data: buildRoutingData({ mealId: latestMeal.id, deleteIntentKind: pending.kind, removedFoodName: item.foodName, pendingState: "completed" }),
    };
  }

  const updatedMeal = await updateMeal(userId, {
    mealId: latestMeal.id,
    mealLabel: latestMeal.mealLabel,
    occurredAt: new Date(latestMeal.occurredAt).toISOString(),
    notes: latestMeal.notes,
    items: nextItems as MealItemInput[],
  });

  return {
    handled: true,
    action: "meal_item_deleted",
    reply: await composeWhatsAppMealActionReply({
      userId,
      meal: updatedMeal,
      timeZone,
      options: {
        title: "Alimento removido",
        actionLines: [`Removi ${item.foodName} da refeição ${formatMealReference(pending, timeZone)}.`],
      },
    }),
    eventType: "whatsapp.intent.meal_item_deleted",
    detail: `Alimento ${item.foodName} removido da refeição ${latestMeal.id} após confirmação por mensagem no WhatsApp.`,
    data: buildRoutingData({ mealId: updatedMeal.id, deleteIntentKind: pending.kind, removedFoodName: item.foodName, pendingState: "completed" }),
  };
}

export function detectWhatsappDeleteIntent(text?: string | null): WhatsappDeleteIntentDetection | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;

  const normalizedText = normalizeDeleteIntentText(trimmed);
  const targetMealLabel = extractMealContextLabel(normalizedText) ?? undefined;
  const absentFoodName = hasExplicitFoodAbsenceSignal(normalizedText)
    ? extractAbsentFoodName(normalizedText)
    : null;

  if (absentFoodName) {
    return {
      kind: "delete_food_from_meal",
      text: trimmed,
      normalizedText,
      targetFoodName: absentFoodName,
      targetMealLabel,
      contextReference: targetMealLabel ? "named_meal" : "recent",
      reply: DELETE_FOOD_REPLY,
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Negação explícita da presença de alimento interpretada como pedido de exclusão antes do fallback nutricional.",
    };
  }

  if (!hasDestructiveVerb(normalizedText)) return null;
  if (hasQuantityAdjustmentSignal(normalizedText)) return null;

  if (hasFoodTarget(normalizedText)) {
    return {
      kind: "delete_food_from_meal",
      text: trimmed,
      normalizedText,
      targetFoodName: shouldDeleteLastFood(normalizedText) ? undefined : extractTargetFoodName(normalizedText) ?? undefined,
      targetMealLabel,
      contextReference: isConversationReference(normalizedText)
        ? "conversation"
        : targetMealLabel
          ? "named_meal"
          : isLatestReference(normalizedText)
            ? "latest"
            : "recent",
      reply: DELETE_FOOD_REPLY,
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Comando destrutivo de alimento bloqueado antes do fallback nutricional.",
    };
  }

  const targetFoodName = extractTargetFoodName(normalizedText);
  // targetFoodName null com alvo de refeição presente significa que o texto
  // continha apenas o rótulo da refeição (ex.: "apagar o almoço"), removido
  // por removeMealContextFromTarget — é exclusão de refeição, não de alimento.
  if (hasMealTarget(normalizedText) && (targetFoodName === null || isMealOnlyTarget(targetFoodName))) {
    return {
      kind: "delete_meal",
      text: trimmed,
      normalizedText,
      targetMealLabel,
      contextReference: isConversationReference(normalizedText)
        ? "conversation"
        : targetMealLabel
          ? "named_meal"
          : isLatestReference(normalizedText)
            ? "latest"
            : "recent",
      reply: DELETE_MEAL_REPLY,
      eventType: "whatsapp.intent.delete_meal_clarification_needed",
      detail: "Comando destrutivo de refeição bloqueado antes do fallback nutricional.",
    };
  }

  if (targetFoodName) {
    return {
      kind: "delete_food_from_meal",
      text: trimmed,
      normalizedText,
      targetFoodName,
      targetMealLabel,
      contextReference: targetMealLabel ? "named_meal" : "recent",
      reply: DELETE_FOOD_REPLY,
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Comando destrutivo com nome provável de alimento bloqueado antes do fallback nutricional.",
    };
  }

  return {
    kind: "unknown_delete",
    text: trimmed,
    normalizedText,
    reply: UNKNOWN_DELETE_REPLY,
    eventType: "whatsapp.intent.delete_clarification_needed",
    detail: "Comando destrutivo ambíguo bloqueado antes do fallback nutricional.",
  };
}

function appendDeleteRoutingAudit(result: WhatsappDeleteIntentResult, input: DeleteExecutionInput) {
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

async function executeWhatsappDeleteIntentInternal(
  userId: number,
  input: DeleteExecutionInput,
): Promise<WhatsappDeleteIntentResult | null> {
  const text = input.text?.trim();
  if (!text) return null;
  const timeZone = input.timeZone ?? DEFAULT_APP_TIME_ZONE;

  const normalized = normalizeDeleteIntentText(text);
  const pendingRow: WhatsAppPendingOperationRecord | null = await pendingOperationRepository.getActivePendingOperation(userId, input.receivedAt);
  if (pendingRow && pendingRow.type === PENDING_DELETE_TYPE) {
    const pending = pendingRow.target as PendingDeleteOperation;
    if (isCancellationText(normalized)) {
      const claim = await claimWhatsAppTextPendingOperation(userId, PENDING_DELETE_TYPE, CANCEL_ACTION);
      if (claim.status !== "claimed") return null;
      return buildCancellationResult();
    }

    if (pending.kind === "selection") {
      const selectedIndex = parseSelectionIndex(normalized);
      if (selectedIndex !== null) {
        const selected = pending.candidates[selectedIndex];
        if (!selected) {
          return {
            handled: true,
            action: "clarification_needed",
            reply: `A opção ${selectedIndex + 1} não existe. Escolha um número entre 1 e ${pending.candidates.length}, ou responda CANCELAR.`,
            eventType: "whatsapp.intent.delete_food_selection_invalid",
            detail: "Índice informado não existe na seleção destrutiva persistida.",
            data: buildRoutingData({ destructiveActionBlocked: true, candidateCount: pending.candidates.length, pendingType: "selection", pendingState: "open" }),
          };
        }
        const claim = await claimWhatsAppTextPendingOperation(userId, PENDING_DELETE_TYPE, `${SELECT_ACTION_PREFIX}${selectedIndex}`);
        if (claim.status !== "claimed") return null;
        const created = await pendingOperationRepository.createPendingOperation({
          userId,
          type: PENDING_DELETE_TYPE,
          origin: PENDING_DELETE_ORIGIN,
          ttlMs: PENDING_DELETE_TTL_MS,
          target: selected,
        });
        return buildPendingResult(selected, created?.id, timeZone);
      }

      return {
        handled: true,
        action: "clarification_needed",
        reply: `Escolha uma das opções de 1 a ${pending.candidates.length} (por exemplo: o segundo) ou responda CANCELAR.`,
        eventType: "whatsapp.intent.delete_food_selection_needed",
        detail: "Pendência de seleção continua ativa; nenhuma exclusão foi executada.",
        data: buildRoutingData({ destructiveActionBlocked: true, candidateCount: pending.candidates.length, pendingType: "selection", pendingState: "open" }),
      };
    }

    if (isConfirmationText(normalized)) {
      const claim = await claimWhatsAppTextPendingOperation(userId, PENDING_DELETE_TYPE, CONFIRM_ACTION);
      if (claim.status !== "claimed") return null;
      return confirmPendingDelete(userId, claim.pendingOperation.target as PendingDeleteIntent, timeZone);
    }
  }

  const detection = detectWhatsappDeleteIntent(text);
  if (!detection) return null;
  if (detection.kind === "unknown_delete") return buildClarificationResult(detection);
  return requestDeleteConfirmation(userId, detection, timeZone, input.receivedAt);
}

export async function executeWhatsappDeleteIntent(
  userId: number,
  input: DeleteExecutionInput,
): Promise<WhatsappDeleteIntentResult | null> {
  const result = await executeWhatsappDeleteIntentInternal(userId, input);
  return result ? appendDeleteRoutingAudit(result, input) : null;
}

/**
 * Resolve um callback de botão/lista já reivindicado (issue #782): o chamador
 * (`messageRouter.ts`) já validou dono/estado/expiração e consumiu a versão via
 * `claimWhatsAppInteractiveCallback`, então esta função apenas executa o efeito
 * de domínio correspondente à ação, sem consumir novamente a pendência.
 */
export async function completeWhatsappDeleteInteractiveCallback(
  userId: number,
  pendingOperation: Pick<WhatsAppPendingOperationRecord, "target">,
  action: string,
  timeZone = DEFAULT_APP_TIME_ZONE,
): Promise<WhatsappDeleteIntentResult> {
  const pending = pendingOperation.target as PendingDeleteOperation;
  let result: WhatsappDeleteIntentResult;

  if (action === CANCEL_ACTION) {
    result = buildCancellationResult();
  } else if (action === CONFIRM_ACTION) {
    result = pending.kind === "selection"
      ? buildCallbackResourceNotFoundResult()
      : await confirmPendingDelete(userId, pending, timeZone);
  } else if (action.startsWith(SELECT_ACTION_PREFIX) && pending.kind === "selection") {
    const index = Number(action.slice(SELECT_ACTION_PREFIX.length));
    const selected = pending.candidates[index];
    if (!selected) {
      result = buildCallbackResourceNotFoundResult();
    } else {
      const created = await pendingOperationRepository.createPendingOperation({
        userId,
        type: PENDING_DELETE_TYPE,
        origin: PENDING_DELETE_ORIGIN,
        ttlMs: PENDING_DELETE_TTL_MS,
        target: selected,
      });
      result = buildPendingResult(selected, created?.id, timeZone);
    }
  } else {
    result = buildCallbackResourceNotFoundResult();
  }

  return appendDeleteRoutingAudit(result, { entrypoint: "interactiveCallback" });
}

export function toWhatsappDeleteInterpretedIntent(detection: WhatsappDeleteIntentDetection): WhatsappInterpretedIntent {
  const intent = detection.kind === "delete_meal" ? "delete_meal" : "delete_food_from_meal";
  return {
    intent,
    confidence: detection.kind === "unknown_delete" ? 0.7 : 0.9,
    items: [],
    requiresConfirmation: true,
    clarificationQuestion: detection.reply,
    possibleIntents: detection.kind === "unknown_delete" ? ["delete_food_from_meal", "delete_meal"] : [],
    reason: detection.detail,
  };
}

export const contextUsage: import("./intentContext").IntentContextUsage = {
  usesRecentWindow: false,
  usesSummary: false,
  usesPendingOperation: true,
  usesLongTermMemory: false,
  requiresFreshDbQuery: true,
};
