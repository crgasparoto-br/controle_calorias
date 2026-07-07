import { listUserMeals, relabelUserMeals } from "../../db";
import { formatWhatsAppMacro, formatWhatsAppReplyTime } from "./replyFormatting";
import {
  buildWhatsAppActionCancelledReplyMessage,
  buildWhatsAppActionConfirmationRequestReplyMessage,
  buildWhatsAppActionConfirmedReplyMessage,
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppWaterLoggedReplyMessage,
  buildWhatsAppWeightLoggedReplyMessage,
} from "./replyMessages";
import {
  getWhatsAppMessageTextBody,
  normalizeWhatsAppIntentText,
  type WhatsAppWebhookMessage,
} from "./webhookUtils";

export type WhatsAppAction = {
  kind: "reclassify_recent_meals";
  fromMealLabel: string;
  toMealLabel: string;
};

export type PendingWhatsAppConfirmation = {
  action: WhatsAppAction;
  mealIds: number[];
  createdAt: number;
  expiresAt: number;
  summary: string;
};

const pendingWhatsAppConfirmations = new Map<number, PendingWhatsAppConfirmation>();
const PENDING_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const MAX_WATER_LOG_AMOUNT_ML = 10000;
const MIN_WEIGHT_LOG_KG = 25;
const MAX_WEIGHT_LOG_KG = 350;
const WATER_LOG_ALLOWED_WORDS = [
  "agua",
  "aguas",
  "ml",
  "m l",
  "mililitro",
  "mililitros",
  "l",
  "litro",
  "litros",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "mais",
  "bebi",
  "beber",
  "tomei",
  "tomar",
  "consumi",
  "registrar",
  "registra",
  "registre",
  "registro",
  "registrei",
  "para",
  "por",
  "favor",
  "hoje",
  "agora",
];

function canonicalMealLabel(label: string) {
  const normalized = normalizeWhatsAppIntentText(label);
  if (normalized.includes("cafe") || normalized.includes("manha")) return "Café da manhã";
  if (normalized.includes("almoco")) return "Almoço";
  if (normalized.includes("janta")) return "Jantar";
  if (normalized.includes("lanche")) return "Lanche";
  if (normalized.includes("bebida")) return "Bebida";
  return label.trim();
}

function isConfirmationMessage(message: WhatsAppWebhookMessage) {
  const normalized = normalizeWhatsAppIntentText(getWhatsAppMessageTextBody(message));
  return ["sim", "confirmar", "confirma", "pode confirmar", "ok", "pode seguir"].includes(normalized);
}

function isCancellationMessage(message: WhatsAppWebhookMessage) {
  const normalized = normalizeWhatsAppIntentText(getWhatsAppMessageTextBody(message));
  return ["nao", "não", "cancelar", "cancela", "parar", "desfazer"].includes(normalized);
}

export function detectWhatsAppAction(message: WhatsAppWebhookMessage): WhatsAppAction | null {
  const text = getWhatsAppMessageTextBody(message);
  if (!text || message.image?.id || message.audio?.id) {
    return null;
  }

  const normalized = normalizeWhatsAppIntentText(text);
  const match = normalized.match(/(?:mudar|trocar|alterar)\s+a?\s*refeicao\s+(.+?)\s+para\s+(.+)/i);
  if (!match) {
    return null;
  }

  const fromMealLabel = canonicalMealLabel(match[1] || "");
  const toMealLabel = canonicalMealLabel(match[2] || "");
  if (!fromMealLabel || !toMealLabel || fromMealLabel === toMealLabel) {
    return null;
  }

  return {
    kind: "reclassify_recent_meals",
    fromMealLabel,
    toMealLabel,
  };
}

export async function handlePendingWhatsAppConfirmation(message: WhatsAppWebhookMessage, userId: number) {
  const pending = pendingWhatsAppConfirmations.get(userId);
  if (!pending) {
    return null;
  }

  if (pending.expiresAt < Date.now()) {
    pendingWhatsAppConfirmations.delete(userId);
    return {
      handled: true,
      reply: buildWhatsAppClarificationReplyMessage("A solicitação anterior expirou. Se ainda quiser alterar a classificação das refeições, envie o comando novamente."),
      eventType: "whatsapp.action_confirmation_expired",
      detail: `Confirmação expirada para ${pending.summary}.`,
    };
  }

  if (isCancellationMessage(message)) {
    pendingWhatsAppConfirmations.delete(userId);
    return {
      handled: true,
      reply: buildWhatsAppActionCancelledReplyMessage("Tudo certo. Não alterei nenhum registro histórico."),
      eventType: "whatsapp.action_cancelled",
      detail: `Confirmação cancelada para ${pending.summary}.`,
    };
  }

  if (!isConfirmationMessage(message)) {
    return null;
  }

  const updatedMeals = await relabelUserMeals({
    userId,
    mealIds: pending.mealIds,
    mealLabel: pending.action.toMealLabel,
    origin: "whatsapp",
  });
  pendingWhatsAppConfirmations.delete(userId);

  return {
    handled: true,
    reply: buildWhatsAppActionConfirmedReplyMessage(`${updatedMeals.length} registro(s) recente(s) foram alterados de ${pending.action.fromMealLabel} para ${pending.action.toMealLabel}.`),
    eventType: "whatsapp.action_applied",
    detail: `Comando confirmado e executado com sucesso: ${pending.summary} em ${updatedMeals.length} registro(s).`,
  };
}

export async function handleWhatsAppAction(action: WhatsAppAction, userId: number) {
  const recentMeals = (await listUserMeals(userId))
    .filter(meal => meal.source === "whatsapp")
    .slice(0, 3);
  const matchingMeals = recentMeals.filter(
    meal => canonicalMealLabel(meal.mealLabel) === action.fromMealLabel,
  );

  if (!recentMeals.length || !matchingMeals.length) {
    return {
      handled: true,
      reply: buildWhatsAppClarificationReplyMessage(`Não encontrei refeições recentes no WhatsApp marcadas como ${action.fromMealLabel}. Me diga quais alimentos você quer mover para ${action.toMealLabel}.`),
      eventType: "whatsapp.action_clarification_needed",
      detail: `Comando de reclassificação sem refeições recentes compatíveis: ${action.fromMealLabel} → ${action.toMealLabel}.`,
    };
  }

  if (matchingMeals.length !== recentMeals.length) {
    const recentSummary = recentMeals
      .map(meal => `${meal.mealLabel} às ${formatWhatsAppReplyTime(new Date(meal.occurredAt))}`)
      .join(", ");

    return {
      handled: true,
      reply: buildWhatsAppClarificationReplyMessage(`Encontrei registros recentes com classificações diferentes (${recentSummary}). Você quer que eu mova apenas os itens marcados como ${action.fromMealLabel} ou todos os últimos ${recentMeals.length} registros para ${action.toMealLabel}?`),
      eventType: "whatsapp.action_clarification_needed",
      detail: `Comando ambíguo de reclassificação para ${action.toMealLabel}. Registros recentes: ${recentSummary}.`,
    };
  }

  const summary = `${action.fromMealLabel} → ${action.toMealLabel}`;
  pendingWhatsAppConfirmations.set(userId, {
    action,
    mealIds: matchingMeals.map(meal => meal.id),
    createdAt: Date.now(),
    expiresAt: Date.now() + PENDING_CONFIRMATION_TTL_MS,
    summary,
  });

  return {
    handled: true,
    reply: buildWhatsAppActionConfirmationRequestReplyMessage({
      summary: `Encontrei ${matchingMeals.length} registro(s) recente(s) marcados como ${action.fromMealLabel}.`,
      confirmInstruction: `Responda SIM para confirmar a mudança para ${action.toMealLabel}.`,
      cancelInstruction: "Responda CANCELAR para desistir.",
    }),
    eventType: "whatsapp.action_confirmation_requested",
    detail: `Confirmação solicitada para ${summary} em ${matchingMeals.length} registro(s).`,
  };
}

function parseWaterAmountMl(text: string) {
  const normalized = normalizeWhatsAppIntentText(text);
  const mlMatch = normalized.match(/(\d+(?:[,.]\d+)?)\s*(?:m\s*l|ml|mililitros?)\b/);
  if (mlMatch) {
    return Math.round(Number(mlMatch[1].replace(",", ".")));
  }

  const literMatch = normalized.match(/(\d+(?:[,.]\d+)?)\s*(?:l|litros?)\b/);
  if (literMatch) {
    return Math.round(Number(literMatch[1].replace(",", ".")) * 1000);
  }

  return null;
}

function isWaterOnlyText(text: string) {
  const normalized = normalizeWhatsAppIntentText(text);
  if (!/\baguas?\b/.test(normalized)) {
    return false;
  }

  const remaining = normalized
    .replace(/\d+(?:[,.]\d+)?/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => !WATER_LOG_ALLOWED_WORDS.includes(word));

  return remaining.length === 0;
}

export function detectWaterLogFromMessage(message: WhatsAppWebhookMessage) {
  const text = getWhatsAppMessageTextBody(message);
  if (!text || message.image?.id || message.audio?.id) {
    return null;
  }

  if (!isWaterOnlyText(text)) {
    return null;
  }

  const amountMl = parseWaterAmountMl(text);
  if (!amountMl || amountMl <= 0 || amountMl > MAX_WATER_LOG_AMOUNT_ML) {
    return null;
  }

  return { amountMl };
}

function parseWeightKg(text: string) {
  const normalized = normalizeWhatsAppIntentText(text);
  const kgMatch = normalized.match(/(?:\bpeso\b|\bpesei\b|\bpesando\b|\bpeso atual\b)?\s*(\d{2,3}(?:[,.]\d{1,2})?)\s*(?:kg|kgs|quilo|quilos)\b/);
  if (kgMatch) {
    return Number(kgMatch[1].replace(",", "."));
  }

  const numberBeforeWeightMatch = normalized.match(/\b(\d{2,3}(?:[,.]\d{1,2})?)\s*(?:de\s*)?(?:peso|pesei|pesando|peso atual)\b/);
  if (numberBeforeWeightMatch) {
    return Number(numberBeforeWeightMatch[1].replace(",", "."));
  }

  const weightFirstMatch = normalized.match(/\b(?:peso|pesei|pesando|peso atual)\b[^\d]*(\d{2,3}(?:[,.]\d{1,2})?)\b/);
  if (weightFirstMatch) {
    return Number(weightFirstMatch[1].replace(",", "."));
  }

  return null;
}

export function detectWeightLogFromMessage(message: WhatsAppWebhookMessage) {
  const text = getWhatsAppMessageTextBody(message);
  if (!text || message.image?.id || message.audio?.id) {
    return null;
  }

  const normalized = normalizeWhatsAppIntentText(text);
  if (!/\b(peso|pesei|pesando|kg|kgs|quilo|quilos)\b/.test(normalized)) {
    return null;
  }

  const weightKg = parseWeightKg(text);
  if (!weightKg || weightKg < MIN_WEIGHT_LOG_KG || weightKg > MAX_WEIGHT_LOG_KG) {
    return null;
  }

  return { weightKg };
}

export function buildWaterLogReply(amountMl: number, occurredAt: Date) {
  return buildWhatsAppWaterLoggedReplyMessage({
    amountLabel: formatWhatsAppMacro(amountMl),
    occurredAtLabel: formatWhatsAppReplyTime(occurredAt),
  });
}

export function buildWeightLogReply(weightKg: number, occurredAt: Date) {
  return buildWhatsAppWeightLoggedReplyMessage({
    weightLabel: formatWhatsAppMacro(weightKg),
    occurredAtLabel: formatWhatsAppReplyTime(occurredAt),
  });
}
