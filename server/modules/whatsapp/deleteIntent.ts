import { listMeals, removeMeal, updateMeal } from "../meals/service";
import type { MealItemInput } from "../meals/schemas";
import type { WhatsappInterpretedIntent } from "./intentSchema";

export type WhatsappDeleteIntentKind = "delete_food_from_meal" | "delete_meal" | "unknown_delete";

export type WhatsappDeleteIntentDetection = {
  kind: WhatsappDeleteIntentKind;
  text: string;
  normalizedText: string;
  reply: string;
  detail: string;
  eventType: string;
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
  createdAt: number;
  expiresAt: number;
};

const PENDING_DELETE_TTL_MS = 10 * 60 * 1000;
const pendingDeleteIntents = new Map<number, PendingDeleteIntent>();

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

function isConfirmationText(normalized: string) {
  return ["sim", "confirmar", "confirma", "pode confirmar", "ok", "pode excluir", "pode remover", "autorizo", "autorizado"].includes(normalized);
}

function isCancellationText(normalized: string) {
  return ["nao", "cancelar", "cancela", "parar", "desfazer", "nao excluir", "não excluir", "nao remover", "não remover"].includes(normalized);
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
      createdAt: Date.now(),
      expiresAt: Date.now() + PENDING_DELETE_TTL_MS,
    };
    pendingDeleteIntents.set(userId, pending);
    return buildPendingResult(pending);
  }

  const items = latestMeal.items ?? [];
  if (!items.length) {
    return buildClarificationResult({
      ...detection,
      reply: "Encontrei a refeição recente, mas ela não tem alimentos detalhados para remover. Me diga qual registro você quer revisar.",
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Comando destrutivo de alimento sem itens na refeição recente.",
    });
  }

  if (items.length > 1 && !shouldDeleteLastFood(detection.normalizedText)) {
    const options = items.map((item, index) => `${index + 1}. ${item.foodName}`).join("\n");
    return buildClarificationResult({
      ...detection,
      reply: `Encontrei mais de um alimento na refeição mais recente. Qual deseja remover?\n${options}\n\nVocê também pode responder: remover último alimento.`,
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Comando destrutivo de alimento com múltiplos itens possíveis.",
    });
  }

  const itemIndex = items.length - 1;
  const item = items[itemIndex];
  const pending: PendingDeleteIntent = {
    kind: "delete_food_from_meal",
    mealId: latestMeal.id,
    mealLabel: latestMeal.mealLabel,
    mealOccurredAt: new Date(latestMeal.occurredAt).toISOString(),
    itemIndex,
    itemName: item.foodName,
    createdAt: Date.now(),
    expiresAt: Date.now() + PENDING_DELETE_TTL_MS,
  };
  pendingDeleteIntents.set(userId, pending);
  return buildPendingResult(pending);
}

async function confirmPendingDelete(userId: number, pending: PendingDeleteIntent): Promise<WhatsappDeleteIntentResult> {
  pendingDeleteIntents.delete(userId);

  if (pending.kind === "delete_meal") {
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
  if (!latestMeal?.items?.length || pending.itemIndex === undefined) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei mais esse alimento na refeição. Nada foi excluído.",
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Confirmação de exclusão de alimento sem item compatível no momento da execução.",
      data: { mealId: pending.mealId, deleteIntentKind: pending.kind },
    };
  }

  const item = latestMeal.items[pending.itemIndex];
  const nextItems = latestMeal.items.filter((_item, index) => index !== pending.itemIndex);
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
  if (!trimmed) {
    return null;
  }

  const normalizedText = normalizeDeleteIntentText(trimmed);
  if (!hasDestructiveVerb(normalizedText)) {
    return null;
  }

  if (hasQuantityAdjustmentSignal(normalizedText)) {
    return null;
  }

  if (hasFoodTarget(normalizedText)) {
    return {
      kind: "delete_food_from_meal",
      text: trimmed,
      normalizedText,
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
  if (!text) {
    return null;
  }

  const normalized = normalizeDeleteIntentText(text);
  const pending = pendingDeleteIntents.get(userId);
  if (pending) {
    if (pending.expiresAt <= Date.now()) {
      pendingDeleteIntents.delete(userId);
      return {
        handled: true,
        action: "clarification_needed",
        reply: "A confirmação de exclusão expirou. Envie o comando novamente se ainda quiser remover o registro.",
        eventType: "whatsapp.intent.delete_confirmation_expired",
        detail: "Confirmação de exclusão por WhatsApp expirada.",
        data: { deleteIntentKind: pending.kind, destructiveActionExpired: true },
      };
    }
    if (isCancellationText(normalized)) {
      pendingDeleteIntents.delete(userId);
      return buildCancellationResult();
    }
    if (isConfirmationText(normalized)) {
      return confirmPendingDelete(userId, pending);
    }
  }

  const detection = detectWhatsappDeleteIntent(text);
  if (!detection) {
    return null;
  }
  if (detection.kind === "unknown_delete") {
    return buildClarificationResult(detection);
  }
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

export function __resetWhatsappDeleteIntentsForTests() {
  pendingDeleteIntents.clear();
}
