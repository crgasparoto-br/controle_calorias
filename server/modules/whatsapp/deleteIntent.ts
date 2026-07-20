import { getDb, logPersistenceWarning } from "../../db";
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { listMeals, removeMeal, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import { formatWhatsAppConsolidationDateKey } from "./mealConsolidation";
import type { WhatsappInterpretedIntent } from "./intentSchema";
import { claimWhatsAppTextPendingOperation } from "./interactiveCallback";
import { composeWhatsAppMealActionReply } from "./mealActionReplyComposer";
import { getRecentConversationTurns } from "./conversationHistory";
import {
  detectWhatsappDeleteIntent,
  isGenericMealLabel,
  normalizeDeleteIntentText,
  normalizeMealLabelForDelete,
  shouldDeleteLastFood,
  type WhatsappDeleteIntentDetection,
} from "./deleteIntentDetection";
import {
  appendDeleteRoutingAudit,
  buildCallbackResourceNotFoundResult,
  buildCancellationResult,
  buildClarificationResult,
  buildPendingResult,
  buildRoutingData,
  buildSelectionResult,
  CANCEL_ACTION,
  CONFIRM_ACTION,
  PENDING_DELETE_ORIGIN,
  PENDING_DELETE_TTL_MS,
  PENDING_DELETE_TYPE,
  SELECT_ACTION_PREFIX,
  type DeleteExecutionInput,
  type PendingDeleteIntent,
  type PendingDeleteOperation,
  type PendingDeleteSelection,
  type WhatsappDeleteIntentResult,
} from "./deleteIntentContract";

export {
  detectWhatsappDeleteIntent,
  type WhatsappDeleteContextReference,
  type WhatsappDeleteIntentDetection,
  type WhatsappDeleteIntentKind,
} from "./deleteIntentDetection";
export {
  PENDING_DELETE_TYPE,
  type PendingDeleteIntent,
  type PendingDeleteOperation,
  type PendingDeleteSelection,
  type WhatsappDeleteIntentResult,
} from "./deleteIntentContract";

type ListedMeal = Awaited<ReturnType<typeof listMeals>>[number];

type FoodMatch = {
  meal: ListedMeal;
  item: ListedMeal["items"][number];
  itemIndex: number;
};

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

function isConfirmationText(normalized: string) {
  return [
    "sim",
    "confirmar",
    "confirma",
    "pode confirmar",
    "ok",
    "pode excluir",
    "pode remover",
    "autorizo",
    "autorizado",
  ].includes(normalized);
}

function isCancellationText(normalized: string) {
  return [
    "nao",
    "cancelar",
    "cancela",
    "parar",
    "desfazer",
    "nao excluir",
    "não excluir",
    "nao remover",
    "não remover",
  ].includes(normalized);
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

function findLatestMealForDelete(meals: ListedMeal[]) {
  return meals[0] ?? null;
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
    const sameLogicalMeal = sameDayMeals.filter(
      meal => normalizeMealLabelForDelete(meal.mealLabel) === referenceLabel,
    );
    if (sameLogicalMeal.length) return sameLogicalMeal;
  }

  return sameDayMeals;
}

function compareFoodMatches(left: FoodMatch, right: FoodMatch) {
  const timeDifference = new Date(right.meal.occurredAt).getTime() - new Date(left.meal.occurredAt).getTime();
  if (timeDifference) return timeDifference;
  if (left.meal.id !== right.meal.id) return left.meal.id - right.meal.id;
  return left.itemIndex - right.itemIndex;
}

function findFoodMatchesInLogicalContext(
  meals: ListedMeal[],
  referenceMeal: ListedMeal,
  target: string,
): FoodMatch[] {
  const contextMeals = buildFoodSearchContext(meals, referenceMeal);
  return contextMeals
    .flatMap(meal => findFoodMatches(meal.items ?? [], target).map(match => ({
      meal,
      item: match.item,
      itemIndex: match.index,
    })))
    .sort(compareFoodMatches);
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
        return Boolean(
          (foodName && reply.includes(foodName))
          || (canonicalName && reply.includes(canonicalName)),
        );
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

async function createPendingFoodDelete(
  userId: number,
  meal: ListedMeal,
  itemIndex: number,
  timeZone: string,
) {
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

async function createPendingDeleteSelection(
  userId: number,
  targetFoodName: string,
  matches: FoodMatch[],
) {
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
  return buildSelectionResult({
    targetFoodName,
    candidates,
    pendingOperationId: created?.id,
    reply: buildAmbiguousFoodMatchesReply(targetFoodName, matches),
  });
}

function buildMissingReferenceResult(detection: WhatsappDeleteIntentDetection) {
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

async function requestDeleteConfirmation(
  userId: number,
  detection: WhatsappDeleteIntentDetection,
  timeZone: string,
  receivedAt?: Date,
): Promise<WhatsappDeleteIntentResult> {
  const meals = await listMeals(userId);
  const referenceMeal = resolveReferenceMeal(userId, meals, detection, receivedAt);
  if (!referenceMeal) return buildMissingReferenceResult(detection);

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
    if (matches.length === 1) {
      return createPendingFoodDelete(userId, matches[0].meal, matches[0].itemIndex, timeZone);
    }
    if (matches.length > 1) {
      return createPendingDeleteSelection(userId, detection.targetFoodName, matches);
    }
    return buildClarificationResult({
      ...detection,
      reply: `Não encontrei "${detection.targetFoodName}" nas refeições do contexto informado. Qual item devo remover?`,
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Comando destrutivo de alimento por nome sem candidato compatível no contexto lógico resolvido.",
    });
  }

  if (items.length > 1) {
    const matches: FoodMatch[] = items.map((item, itemIndex) => ({
      meal: referenceMeal,
      item,
      itemIndex,
    }));
    return createPendingDeleteSelection(userId, "alimento", matches);
  }

  return createPendingFoodDelete(userId, referenceMeal, items.length - 1, timeZone);
}

function buildBlockedConfirmationResult(input: {
  reply: string;
  eventType: string;
  detail: string;
  pending: PendingDeleteIntent;
}) {
  return {
    handled: true,
    action: "clarification_needed",
    reply: input.reply,
    eventType: input.eventType,
    detail: input.detail,
    data: buildRoutingData({
      mealId: input.pending.mealId,
      deleteIntentKind: input.pending.kind,
      pendingState: "blocked",
    }),
  } satisfies WhatsappDeleteIntentResult;
}

async function confirmPendingDelete(
  userId: number,
  pending: PendingDeleteIntent,
  timeZone: string,
): Promise<WhatsappDeleteIntentResult> {
  const currentMeal = (await listMeals(userId)).find(meal => meal.id === pending.mealId);
  if (!currentMeal) {
    return buildBlockedConfirmationResult({
      reply: pending.kind === "delete_meal"
        ? "Essa refeição não está mais disponível. Nada foi excluído."
        : "Não encontrei mais esse alimento na refeição. Nada foi excluído.",
      eventType: pending.kind === "delete_meal"
        ? "whatsapp.intent.delete_meal_stale_confirmation"
        : "whatsapp.intent.delete_food_clarification_needed",
      detail: "Confirmação de exclusão ficou obsoleta antes da execução.",
      pending,
    });
  }

  if (pending.kind === "delete_meal") {
    await removeMeal(userId, pending.mealId);
    return {
      handled: true,
      action: "meal_deleted",
      reply: `Excluí a refeição ${currentMeal.mealLabel}.`,
      eventType: "whatsapp.intent.meal_deleted",
      detail: `Refeição ${pending.mealId} excluída após confirmação por mensagem no WhatsApp.`,
      data: buildRoutingData({
        mealId: pending.mealId,
        deleteIntentKind: pending.kind,
        pendingState: "completed",
      }),
    };
  }

  if (!currentMeal.items?.length || pending.itemIndex === undefined || !pending.itemName) {
    return buildBlockedConfirmationResult({
      reply: "Não encontrei mais esse alimento na refeição. Nada foi excluído.",
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Confirmação de exclusão de alimento sem item compatível no momento da execução.",
      pending,
    });
  }

  let resolvedItemIndex = pending.itemIndex;
  const originalItem = currentMeal.items[resolvedItemIndex];
  if (!originalItem
    || normalizeDeleteIntentText(originalItem.foodName) !== normalizeDeleteIntentText(pending.itemName)) {
    const currentMatches = currentMeal.items
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => normalizeDeleteIntentText(candidate.foodName)
        === normalizeDeleteIntentText(pending.itemName ?? ""));
    if (currentMatches.length !== 1) {
      return buildBlockedConfirmationResult({
        reply: "A refeição mudou desde a seleção. Nada foi excluído; faça o pedido novamente para eu confirmar o item atual.",
        eventType: "whatsapp.intent.delete_food_stale_selection",
        detail: "Seleção de alimento ficou obsoleta antes da confirmação e foi bloqueada.",
        pending,
      });
    }
    resolvedItemIndex = currentMatches[0].index;
  }

  const item = currentMeal.items[resolvedItemIndex];
  const nextItems = currentMeal.items.filter((_item, index) => index !== resolvedItemIndex);
  if (!nextItems.length) {
    await removeMeal(userId, currentMeal.id);
    return {
      handled: true,
      action: "meal_deleted",
      reply: `Removi ${item.foodName}. Como era o único item, excluí também a refeição ${currentMeal.mealLabel}.`,
      eventType: "whatsapp.intent.meal_deleted_after_last_item_removed",
      detail: `Último alimento da refeição ${currentMeal.id} removido após confirmação; refeição excluída.`,
      data: buildRoutingData({
        mealId: currentMeal.id,
        deleteIntentKind: pending.kind,
        removedFoodName: item.foodName,
        pendingState: "completed",
      }),
    };
  }

  const updatedMeal = await updateMeal(userId, {
    mealId: currentMeal.id,
    mealLabel: currentMeal.mealLabel,
    occurredAt: new Date(currentMeal.occurredAt).toISOString(),
    notes: currentMeal.notes,
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
        actionLines: [`Removi ${item.foodName} da refeição ${currentMeal.mealLabel}.`],
      },
    }),
    eventType: "whatsapp.intent.meal_item_deleted",
    detail: `Alimento ${item.foodName} removido da refeição ${currentMeal.id} após confirmação por mensagem no WhatsApp.`,
    data: buildRoutingData({
      mealId: updatedMeal.id,
      deleteIntentKind: pending.kind,
      removedFoodName: item.foodName,
      pendingState: "completed",
    }),
  };
}

async function resolveActiveDeletePending(
  userId: number,
  normalized: string,
  pending: PendingDeleteOperation,
  timeZone: string,
): Promise<WhatsappDeleteIntentResult | null> {
  if (isCancellationText(normalized)) {
    const claim = await claimWhatsAppTextPendingOperation(userId, PENDING_DELETE_TYPE, CANCEL_ACTION);
    return claim.status === "claimed" ? buildCancellationResult() : null;
  }

  if (pending.kind === "selection") {
    const selectedIndex = parseSelectionIndex(normalized);
    if (selectedIndex === null) {
      return {
        handled: true,
        action: "clarification_needed",
        reply: `Escolha uma das opções de 1 a ${pending.candidates.length} (por exemplo: o segundo) ou responda CANCELAR.`,
        eventType: "whatsapp.intent.delete_food_selection_needed",
        detail: "Pendência de seleção continua ativa; nenhuma exclusão foi executada.",
        data: buildRoutingData({
          destructiveActionBlocked: true,
          candidateCount: pending.candidates.length,
          pendingType: "selection",
          pendingState: "open",
        }),
      };
    }

    const selected = pending.candidates[selectedIndex];
    if (!selected) {
      return {
        handled: true,
        action: "clarification_needed",
        reply: `A opção ${selectedIndex + 1} não existe. Escolha um número entre 1 e ${pending.candidates.length}, ou responda CANCELAR.`,
        eventType: "whatsapp.intent.delete_food_selection_invalid",
        detail: "Índice informado não existe na seleção destrutiva persistida.",
        data: buildRoutingData({
          destructiveActionBlocked: true,
          candidateCount: pending.candidates.length,
          pendingType: "selection",
          pendingState: "open",
        }),
      };
    }

    const claim = await claimWhatsAppTextPendingOperation(
      userId,
      PENDING_DELETE_TYPE,
      `${SELECT_ACTION_PREFIX}${selectedIndex}`,
    );
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

  if (!isConfirmationText(normalized)) return null;
  const claim = await claimWhatsAppTextPendingOperation(userId, PENDING_DELETE_TYPE, CONFIRM_ACTION);
  if (claim.status !== "claimed") return null;
  return confirmPendingDelete(userId, claim.pendingOperation.target as PendingDeleteIntent, timeZone);
}

async function executeWhatsappDeleteIntentInternal(
  userId: number,
  input: DeleteExecutionInput,
): Promise<WhatsappDeleteIntentResult | null> {
  const text = input.text?.trim();
  if (!text) return null;
  const timeZone = input.timeZone ?? DEFAULT_APP_TIME_ZONE;
  const normalized = normalizeDeleteIntentText(text);

  const pendingRow: WhatsAppPendingOperationRecord | null =
    await pendingOperationRepository.getActivePendingOperation(userId, input.receivedAt);
  if (pendingRow?.type === PENDING_DELETE_TYPE) {
    const pendingResult = await resolveActiveDeletePending(
      userId,
      normalized,
      pendingRow.target as PendingDeleteOperation,
      timeZone,
    );
    if (pendingResult) return pendingResult;
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

export function toWhatsappDeleteInterpretedIntent(
  detection: WhatsappDeleteIntentDetection,
): WhatsappInterpretedIntent {
  const intent = detection.kind === "delete_meal" ? "delete_meal" : "delete_food_from_meal";
  return {
    intent,
    confidence: detection.kind === "unknown_delete" ? 0.7 : 0.9,
    items: [],
    requiresConfirmation: true,
    clarificationQuestion: detection.reply,
    possibleIntents: detection.kind === "unknown_delete"
      ? ["delete_food_from_meal", "delete_meal"]
      : [],
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
