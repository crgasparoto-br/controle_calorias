import { getDb, logPersistenceWarning } from "../../db";
import { createDrizzleWhatsAppPendingOperationRepository, type WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import { listMeals, removeMeal, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { formatWhatsAppConsolidationDateKey } from "./mealConsolidation";
import type { WhatsappInterpretedIntent } from "./intentSchema";

export type WhatsappDeleteIntentKind = "delete_food_from_meal" | "delete_meal" | "unknown_delete";

export type WhatsappDeleteIntentDetection = {
  kind: WhatsappDeleteIntentKind;
  text: string;
  normalizedText: string;
  reply: string;
  detail: string;
  eventType: string;
  targetFoodName?: string;
};

export type WhatsappDeleteIntentResult = {
  handled: true;
  action: "clarification_needed" | "meal_deleted" | "meal_item_deleted" | "delete_cancelled";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown>;
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

const PENDING_DELETE_TTL_MS = 10 * 60 * 1000;
const PENDING_DELETE_TYPE = "delete";
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
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  return /\b(?:excluir|exclua|exclui|remover|remova|remove|apagar|apague|apaga|deletar|delete|deleta|tirar|tire|tira)\b/.test(normalized);
}

function hasQuantityAdjustmentSignal(normalized: string) {
  return /\b(?:tirar|tire|tira|remover|remova|remove|reduzir|reduza|diminui|diminuir)\b/.test(normalized)
    && /\b\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|ml|l|un|unidades?|fatias?|colheres?|porcoes?|porcao)\b/.test(normalized);
}

function hasMealTarget(normalized: string) {
  return /\b(?:refeicao|refeicoes|prato|registro|registros|foto|fotografada|fotografado|ultima|ultimo|almoco|jantar|lanche|cafe|ceia)\b/.test(normalized);
}

function hasFoodTarget(normalized: string) {
  return /\b(?:alimento|alimentos|item|itens|comida|ingrediente)\b/.test(normalized);
}

function extractTargetFoodName(normalized: string) {
  const value = normalized
    .replace(/\b(?:excluir|exclua|exclui|remover|remova|remove|apagar|apague|apaga|deletar|delete|deleta|tirar|tire|tira)\b/g, " ")
    .replace(/\b(?:o|a|os|as|um|uma|do|da|dos|das|de|no|na|nos|nas)\b/g, " ")
    .replace(/\b(?:alimento|alimentos|item|itens|comida|ingrediente)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value.length >= 3 ? value : null;
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

function formatMealReference(pending: Pick<PendingDeleteIntent, "mealLabel" | "mealOccurredAt">) {
  const date = new Date(pending.mealOccurredAt);
  const time = Number.isNaN(date.getTime())
    ? ""
    : ` às ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}`;
  return `${pending.mealLabel}${time}`;
}

function buildPendingMealDeleteReply(pending: PendingDeleteIntent) {
  return [
    `Encontrei a refeição mais recente: ${formatMealReference(pending)}.`,
    "Responda SIM para confirmar a exclusão dessa refeição ou CANCELAR para desistir.",
    "Não excluí nada ainda e não registrei nenhum alimento novo.",
  ].join("\n\n");
}

function buildPendingFoodDeleteReply(pending: PendingDeleteIntent) {
  return [
    `Encontrei o item ${pending.itemName} em ${formatMealReference(pending)}.`,
    "Responda SIM para confirmar a remoção desse alimento ou CANCELAR para desistir.",
    "Não removi nada ainda e não registrei nenhum alimento novo.",
  ].join("\n\n");
}

function buildPendingResult(pending: PendingDeleteIntent): WhatsappDeleteIntentResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: pending.kind === "delete_meal" ? buildPendingMealDeleteReply(pending) : buildPendingFoodDeleteReply(pending),
    eventType: pending.kind === "delete_meal"
      ? "whatsapp.intent.delete_meal_confirmation_requested"
      : "whatsapp.intent.delete_food_confirmation_requested",
    detail: pending.kind === "delete_meal"
      ? "Confirmação por mensagem solicitada antes de excluir refeição pelo WhatsApp."
      : "Confirmação por mensagem solicitada antes de remover alimento pelo WhatsApp.",
    data: {
      deleteIntentKind: pending.kind,
      mealId: pending.mealId,
      itemIndex: pending.itemIndex ?? null,
      destructiveActionBlocked: true,
    },
  };
}

function buildClarificationResult(detection: WhatsappDeleteIntentDetection): WhatsappDeleteIntentResult {
  return {
    handled: true,
    action: "clarification_needed",
    reply: detection.reply,
    eventType: detection.eventType,
    detail: detection.detail,
    data: {
      deleteIntentKind: detection.kind,
      destructiveActionBlocked: true,
    },
  };
}

function buildCancellationResult(): WhatsappDeleteIntentResult {
  return {
    handled: true,
    action: "delete_cancelled",
    reply: "Tudo certo. Não excluí nenhum registro.",
    eventType: "whatsapp.intent.delete_cancelled",
    detail: "Exclusão pendente cancelada por mensagem no WhatsApp.",
    data: { destructiveActionCancelled: true },
  };
}

function findLatestMealForDelete(meals: Awaited<ReturnType<typeof listMeals>>) {
  return meals[0] ?? null;
}

function shouldDeleteLastFood(normalized: string) {
  return /\b(?:ultimo|ultima)\s+(?:alimento|item|comida|ingrediente)\b/.test(normalized)
    || /\b(?:esse|este|ultimo|ultima)\s+(?:alimento|item)\b/.test(normalized);
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

async function createPendingFoodDelete(userId: number, meal: ListedMeal, itemIndex: number) {
  const item = meal.items[itemIndex];
  const pending: PendingDeleteIntent = {
    kind: "delete_food_from_meal",
    mealId: meal.id,
    mealLabel: meal.mealLabel,
    mealOccurredAt: new Date(meal.occurredAt).toISOString(),
    itemIndex,
    itemName: item.foodName,
  };
  await pendingOperationRepository.createPendingOperation({
    userId,
    type: PENDING_DELETE_TYPE,
    origin: PENDING_DELETE_ORIGIN,
    ttlMs: PENDING_DELETE_TTL_MS,
    target: pending,
  });
  return buildPendingResult(pending);
}

function buildAmbiguousFoodMatchesReply(targetFoodName: string, matches: FoodMatch[]) {
  const options = matches
    .map((match, index) => `${index + 1}. ${match.item.foodName} em ${match.meal.mealLabel}`)
    .join("\n");
  return `Encontrei mais de um alimento parecido com "${targetFoodName}" no contexto do dia. Qual deseja remover?\n${options}\n\nResponda com o número ou ordinal, por exemplo: o segundo.`;
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
  await pendingOperationRepository.createPendingOperation({
    userId,
    type: PENDING_DELETE_TYPE,
    origin: PENDING_DELETE_ORIGIN,
    ttlMs: PENDING_DELETE_TTL_MS,
    target: pending,
  });
  return {
    handled: true,
    action: "clarification_needed",
    reply: buildAmbiguousFoodMatchesReply(targetFoodName, matches),
    eventType: "whatsapp.intent.delete_food_selection_requested",
    detail: "Seleção destrutiva persistida antes da confirmação; nenhum item foi removido.",
    data: { destructiveActionBlocked: true, candidateCount: candidates.length },
  } satisfies WhatsappDeleteIntentResult;
}

async function requestDeleteConfirmation(userId: number, detection: WhatsappDeleteIntentDetection): Promise<WhatsappDeleteIntentResult> {
  const meals = await listMeals(userId);
  const latestMeal = findLatestMealForDelete(meals);
  if (!latestMeal) {
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
      mealId: latestMeal.id,
      mealLabel: latestMeal.mealLabel,
      mealOccurredAt: new Date(latestMeal.occurredAt).toISOString(),
    };
    await pendingOperationRepository.createPendingOperation({
      userId,
      type: PENDING_DELETE_TYPE,
      origin: PENDING_DELETE_ORIGIN,
      ttlMs: PENDING_DELETE_TTL_MS,
      target: pending,
    });
    return buildPendingResult(pending);
  }

  const items = latestMeal.items ?? [];
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
    return createPendingFoodDelete(userId, latestMeal, items.length - 1);
  }

  if (detection.targetFoodName) {
    const matches = findFoodMatchesInLogicalContext(meals, latestMeal, detection.targetFoodName);
    if (matches.length === 1) return createPendingFoodDelete(userId, matches[0].meal, matches[0].itemIndex);
    if (matches.length > 1) return createPendingDeleteSelection(userId, detection.targetFoodName, matches);
    return buildClarificationResult({
      ...detection,
      reply: `Não encontrei "${detection.targetFoodName}" nas refeições do dia. Qual item devo remover?`,
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Comando destrutivo de alimento por nome sem candidato compatível no contexto lógico do dia.",
    });
  }

  if (items.length > 1) {
    const matches: FoodMatch[] = items.map((item, itemIndex) => ({ meal: latestMeal, item, itemIndex }));
    return createPendingDeleteSelection(userId, "alimento", matches);
  }

  return createPendingFoodDelete(userId, latestMeal, items.length - 1);
}

async function confirmPendingDelete(userId: number, pending: PendingDeleteIntent): Promise<WhatsappDeleteIntentResult> {
  if (pending.kind === "delete_meal") {
    const currentMeal = (await listMeals(userId)).find(meal => meal.id === pending.mealId);
    if (!currentMeal) {
      return {
        handled: true,
        action: "clarification_needed",
        reply: "Essa refeição não está mais disponível. Nada foi excluído.",
        eventType: "whatsapp.intent.delete_meal_stale_confirmation",
        detail: "Confirmação de refeição ficou obsoleta antes da execução.",
        data: { mealId: pending.mealId, deleteIntentKind: pending.kind },
      };
    }
    await removeMeal(userId, pending.mealId);
    return {
      handled: true,
      action: "meal_deleted",
      reply: `Excluí a refeição ${formatMealReference(pending)}.`,
      eventType: "whatsapp.intent.meal_deleted",
      detail: `Refeição ${pending.mealId} excluída após confirmação por mensagem no WhatsApp.`,
      data: { mealId: pending.mealId, deleteIntentKind: pending.kind },
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
      data: { mealId: pending.mealId, deleteIntentKind: pending.kind },
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
        data: { mealId: pending.mealId, deleteIntentKind: pending.kind },
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
      reply: `Removi ${item.foodName}. Como era o único item, excluí também a refeição ${formatMealReference(pending)}.`,
      eventType: "whatsapp.intent.meal_deleted_after_last_item_removed",
      detail: `Último alimento da refeição ${latestMeal.id} removido após confirmação; refeição excluída.`,
      data: { mealId: latestMeal.id, deleteIntentKind: pending.kind, removedFoodName: item.foodName },
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
    reply: `Removi ${item.foodName} da refeição ${formatMealReference(pending)}.`,
    eventType: "whatsapp.intent.meal_item_deleted",
    detail: `Alimento ${item.foodName} removido da refeição ${latestMeal.id} após confirmação por mensagem no WhatsApp.`,
    data: { mealId: updatedMeal.id, deleteIntentKind: pending.kind, removedFoodName: item.foodName },
  };
}

export function detectWhatsappDeleteIntent(text?: string | null): WhatsappDeleteIntentDetection | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;

  const normalizedText = normalizeDeleteIntentText(trimmed);
  if (!hasDestructiveVerb(normalizedText)) return null;
  if (hasQuantityAdjustmentSignal(normalizedText)) return null;

  if (hasFoodTarget(normalizedText)) {
    return {
      kind: "delete_food_from_meal",
      text: trimmed,
      normalizedText,
      targetFoodName: shouldDeleteLastFood(normalizedText) ? undefined : extractTargetFoodName(normalizedText) ?? undefined,
      reply: DELETE_FOOD_REPLY,
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Comando destrutivo de alimento bloqueado antes do fallback nutricional.",
    };
  }

  if (hasMealTarget(normalizedText)) {
    return {
      kind: "delete_meal",
      text: trimmed,
      normalizedText,
      reply: DELETE_MEAL_REPLY,
      eventType: "whatsapp.intent.delete_meal_clarification_needed",
      detail: "Comando destrutivo de refeição bloqueado antes do fallback nutricional.",
    };
  }

  const targetFoodName = extractTargetFoodName(normalizedText);
  if (targetFoodName) {
    return {
      kind: "delete_food_from_meal",
      text: trimmed,
      normalizedText,
      targetFoodName,
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

export async function executeWhatsappDeleteIntent(userId: number, input: { text?: string | null }): Promise<WhatsappDeleteIntentResult | null> {
  const text = input.text?.trim();
  if (!text) return null;

  const normalized = normalizeDeleteIntentText(text);
  const pendingRow: WhatsAppPendingOperationRecord | null = await pendingOperationRepository.getActivePendingOperation(userId);
  if (pendingRow && pendingRow.type === PENDING_DELETE_TYPE) {
    const pending = pendingRow.target as PendingDeleteOperation;
    if (isCancellationText(normalized)) {
      await pendingOperationRepository.cancelPendingOperation(pendingRow.id);
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
            data: { destructiveActionBlocked: true, candidateCount: pending.candidates.length },
          };
        }
        const claim = await pendingOperationRepository.claimPendingOperation({ id: pendingRow.id, expectedVersion: pendingRow.version });
        if (!claim.claimed) return null;
        await pendingOperationRepository.createPendingOperation({
          userId,
          type: PENDING_DELETE_TYPE,
          origin: PENDING_DELETE_ORIGIN,
          ttlMs: PENDING_DELETE_TTL_MS,
          target: selected,
        });
        return buildPendingResult(selected);
      }

      return {
        handled: true,
        action: "clarification_needed",
        reply: `Escolha uma das opções de 1 a ${pending.candidates.length} (por exemplo: o segundo) ou responda CANCELAR.`,
        eventType: "whatsapp.intent.delete_food_selection_needed",
        detail: "Pendência de seleção continua ativa; nenhuma exclusão foi executada.",
        data: { destructiveActionBlocked: true, candidateCount: pending.candidates.length },
      };
    }

    if (isConfirmationText(normalized)) {
      const claim = await pendingOperationRepository.claimPendingOperation({ id: pendingRow.id, expectedVersion: pendingRow.version });
      if (!claim.claimed) return null;
      return confirmPendingDelete(userId, pending);
    }
  }

  const detection = detectWhatsappDeleteIntent(text);
  if (!detection) return null;
  if (detection.kind === "unknown_delete") return buildClarificationResult(detection);
  return requestDeleteConfirmation(userId, detection);
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
