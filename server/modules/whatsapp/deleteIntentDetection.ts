import { collapseWhitespace, stripDiacritics } from "./webhookUtils";

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

export const DELETE_FOOD_REPLY = [
  "Entendi que você quer remover um alimento, mas preciso confirmar qual item.",
  "Me envie o nome do alimento e a refeição/data, ou peça para remover o último alimento registrado. Não registrei nenhum alimento novo.",
].join("\n\n");

export const DELETE_MEAL_REPLY = [
  "Entendi que você quer remover uma refeição, mas preciso confirmar qual registro.",
  "Me diga qual refeição/data deseja revisar. Não excluí nada e não registrei nenhum alimento novo.",
].join("\n\n");

const UNKNOWN_DELETE_REPLY = [
  "Entendi que você quer remover algo, mas preciso confirmar se é um alimento específico ou uma refeição inteira.",
  "Me envie o nome do alimento e a refeição/data, ou diga qual refeição quer revisar. Não excluí nada e não registrei nenhum alimento novo.",
].join("\n\n");

export function normalizeDeleteIntentText(value: string) {
  return collapseWhitespace(stripDiacritics(value).toLowerCase().replace(/[^a-z0-9\s]/g, " "));
}

export function normalizeMealLabelForDelete(label: string) {
  const normalized = normalizeDeleteIntentText(label);
  if (normalized.includes("cafe") || normalized.includes("manha")) return "cafe da manha";
  if (normalized.includes("almoco")) return "almoco";
  if (normalized.includes("janta")) return "jantar";
  if (normalized.includes("lanche")) return "lanche";
  if (normalized.includes("ceia")) return "ceia";
  return normalized;
}

export function isGenericMealLabel(label: string) {
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
  return /\b(?:refeicao|refeicoes|prato|registro|registros|foto|fotografada|fotografado|ultima|ultimo|almoco|jantar|janta|lanche|cafe|ceia)\b/.test(normalized);
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

export function shouldDeleteLastFood(normalized: string) {
  return /\b(?:ultimo|ultima)\s+(?:alimento|item|comida|ingrediente)\b/.test(normalized)
    || /\b(?:esse|este|essa|esta|ultimo|ultima)\s+(?:alimento|item)\b/.test(normalized);
}

function resolveContextReference(normalized: string, targetMealLabel?: string): WhatsappDeleteContextReference {
  if (isConversationReference(normalized)) return "conversation";
  if (targetMealLabel) return "named_meal";
  if (isLatestReference(normalized)) return "latest";
  return "recent";
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
      contextReference: resolveContextReference(normalizedText, targetMealLabel),
      reply: DELETE_FOOD_REPLY,
      eventType: "whatsapp.intent.delete_food_clarification_needed",
      detail: "Comando destrutivo de alimento bloqueado antes do fallback nutricional.",
    };
  }

  const targetFoodName = extractTargetFoodName(normalizedText);
  if (hasMealTarget(normalizedText) && (!targetFoodName || isMealOnlyTarget(targetFoodName))) {
    return {
      kind: "delete_meal",
      text: trimmed,
      normalizedText,
      targetMealLabel,
      contextReference: resolveContextReference(normalizedText, targetMealLabel),
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
