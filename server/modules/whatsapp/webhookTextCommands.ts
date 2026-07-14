import { getDb, listUserMeals, logPersistenceWarning, relabelUserMeals } from "../../db";
import { createDrizzleWhatsAppPendingOperationRepository, type WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import { formatWhatsAppMacro, formatWhatsAppReplyTime } from "./replyFormatting";
import { buildWhatsAppCallbackId } from "./interactiveCallback";
import { buttonsReply, type WhatsAppLogicalReply } from "./replyContract";
import {
  buildWhatsAppActionCancelledReplyMessage,
  buildWhatsAppActionConfirmationRequestReplyMessage,
  buildWhatsAppActionConfirmedReplyMessage,
  buildWhatsAppCallbackResourceNotFoundReplyMessage,
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppWaterLoggedReplyMessage,
  buildWhatsAppWeightLoggedReplyMessage,
} from "./replyMessages";
import {
  getWhatsAppMessageTextBody,
  normalizeWhatsAppIntentText,
  type WhatsAppWebhookMessage,
} from "./webhookUtils";

const CONFIRM_ACTION = "confirm";
const CANCEL_ACTION = "cancel";

export type WhatsAppAction = {
  kind: "reclassify_recent_meals";
  fromMealLabel: string;
  toMealLabel: string;
};

export type PendingWhatsAppConfirmation = {
  action: WhatsAppAction;
  mealIds: number[];
  summary: string;
};

const PENDING_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const PENDING_CONFIRMATION_ORIGIN = "webhookTextCommands";
export const PENDING_CONFIRMATION_TYPE = "confirmation";

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});
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

async function resolveMatchingRecentMeals(action: WhatsAppAction, userId: number) {
  const recentMeals = (await listUserMeals(userId))
    .filter(meal => meal.source === "whatsapp")
    .slice(0, 3);
  const matchingMeals = recentMeals.filter(
    meal => canonicalMealLabel(meal.mealLabel) === action.fromMealLabel,
  );
  return { recentMeals, matchingMeals };
}

async function applyClaimedGenericConfirmation(
  userId: number,
  pending: PendingWhatsAppConfirmation,
): Promise<{ handled: true; reply: string; eventType: string; detail: string }> {
  // Revalida o alvo contra o estado atual do banco em vez de confiar cegamente no target persistido (issue #766).
  const { matchingMeals } = await resolveMatchingRecentMeals(pending.action, userId);
  if (!matchingMeals.length) {
    return {
      handled: true,
      reply: buildWhatsAppClarificationReplyMessage("Os registros que essa confirmação alteraria não estão mais disponíveis. Envie o comando novamente se ainda quiser reclassificar refeições."),
      eventType: "whatsapp.action_confirmation_target_stale",
      detail: `Confirmação consumida, mas alvo (${pending.summary}) não foi mais encontrado no estado atual.`,
    };
  }

  const updatedMeals = await relabelUserMeals({
    userId,
    mealIds: matchingMeals.map(meal => meal.id),
    mealLabel: pending.action.toMealLabel,
    origin: "whatsapp",
  });

  return {
    handled: true,
    reply: buildWhatsAppActionConfirmedReplyMessage(`${updatedMeals.length} registro(s) recente(s) foram alterados de ${pending.action.fromMealLabel} para ${pending.action.toMealLabel}.`),
    eventType: "whatsapp.action_applied",
    detail: `Comando confirmado e executado com sucesso: ${pending.summary} em ${updatedMeals.length} registro(s).`,
  };
}

export async function handlePendingWhatsAppConfirmation(message: WhatsAppWebhookMessage, userId: number) {
  const pendingRow = await pendingOperationRepository.getActivePendingOperation(userId);
  if (!pendingRow || pendingRow.type !== PENDING_CONFIRMATION_TYPE) {
    return null;
  }
  const pending = pendingRow.target as PendingWhatsAppConfirmation;

  if (isCancellationMessage(message)) {
    await pendingOperationRepository.cancelPendingOperation(pendingRow.id);
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

  const claim = await pendingOperationRepository.claimPendingOperation({ id: pendingRow.id, expectedVersion: pendingRow.version });
  if (!claim.claimed) {
    // Outra requisição/instância já consumiu esta pendência (issue #766: consumo atômico, no máximo uma execução).
    return null;
  }

  return applyClaimedGenericConfirmation(userId, pending);
}

/**
 * Resolve um callback de botão já reivindicado pelo gate central (issue #782):
 * `messageRouter.ts` já validou dono/estado/expiração e consumiu a versão via
 * `claimWhatsAppInteractiveCallback`, então esta função só decide o efeito.
 */
export async function completeWhatsappGenericConfirmationCallback(
  userId: number,
  pendingOperation: Pick<WhatsAppPendingOperationRecord, "target">,
  action: string,
): Promise<{ handled: true; reply: string; eventType: string; detail: string; interactiveReply?: WhatsAppLogicalReply }> {
  const pending = pendingOperation.target as PendingWhatsAppConfirmation;

  if (action === CANCEL_ACTION) {
    return {
      handled: true,
      reply: buildWhatsAppActionCancelledReplyMessage("Tudo certo. Não alterei nenhum registro histórico."),
      eventType: "whatsapp.action_cancelled",
      detail: `Confirmação cancelada para ${pending.summary} via botão.`,
    };
  }

  if (action === CONFIRM_ACTION) {
    return applyClaimedGenericConfirmation(userId, pending);
  }

  return {
    handled: true,
    reply: buildWhatsAppCallbackResourceNotFoundReplyMessage(),
    eventType: "whatsapp.action_callback_resource_not_found",
    detail: `Callback com ação desconhecida (${action}) para confirmação genérica.`,
  };
}

export async function handleWhatsAppAction(action: WhatsAppAction, userId: number) {
  const { recentMeals, matchingMeals } = await resolveMatchingRecentMeals(action, userId);

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
  const created = await pendingOperationRepository.createPendingOperation({
    userId,
    type: PENDING_CONFIRMATION_TYPE,
    origin: PENDING_CONFIRMATION_ORIGIN,
    ttlMs: PENDING_CONFIRMATION_TTL_MS,
    target: {
      action,
      mealIds: matchingMeals.map(meal => meal.id),
      summary,
    } satisfies PendingWhatsAppConfirmation,
  });

  const reply = buildWhatsAppActionConfirmationRequestReplyMessage({
    summary: `Encontrei ${matchingMeals.length} registro(s) recente(s) marcados como ${action.fromMealLabel}.`,
    confirmInstruction: `Responda SIM para confirmar a mudança para ${action.toMealLabel}.`,
    cancelInstruction: "Responda CANCELAR para desistir.",
  });

  return {
    handled: true,
    reply,
    ...(created
      ? {
          interactiveReply: buttonsReply(reply, [
            { id: buildWhatsAppCallbackId(created.id, CONFIRM_ACTION), title: "Confirmar" },
            { id: buildWhatsAppCallbackId(created.id, CANCEL_ACTION), title: "Cancelar" },
          ]),
        }
      : {}),
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
