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
  action: "clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  data: Record<string, unknown>;
};

const DELETE_FOOD_REPLY = [
  "Entendi que você quer remover um alimento, mas não excluí nada automaticamente.",
  "Para sua segurança, me diga qual alimento e em qual refeição/data ele está, ou use o botão Editar refeição no registro mais recente.",
  "Não registrei nenhum alimento novo.",
].join("\n\n");

const DELETE_MEAL_REPLY = [
  "Entendi que você quer remover uma refeição, mas não excluí nada automaticamente.",
  "Para sua segurança, use o botão Editar refeição do registro correto e confirme a exclusão por lá, ou me diga qual refeição/data deseja revisar.",
  "Não registrei nenhum alimento novo.",
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

export function buildWhatsappDeleteIntentResult(detection: WhatsappDeleteIntentDetection): WhatsappDeleteIntentResult {
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

export async function executeWhatsappDeleteIntent(_userId: number, input: { text?: string | null }): Promise<WhatsappDeleteIntentResult | null> {
  const detection = detectWhatsappDeleteIntent(input.text);
  return detection ? buildWhatsappDeleteIntentResult(detection) : null;
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
