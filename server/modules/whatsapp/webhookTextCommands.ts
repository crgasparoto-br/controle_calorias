import { getDb, listUserMeals, logPersistenceWarning, relabelUserMeals } from "../../db";
import { createDrizzleWhatsAppPendingOperationRepository, type WhatsAppPendingOperationRecord } from "../../repositories/whatsappPendingOperationRepository";
import { claimWhatsAppTextPendingOperation } from "./interactiveCallback";
import { buildWhatsappClosedDecisionReply, type WhatsappInteractionAction } from "./interactionPresentation";
import type { WhatsAppLogicalReply } from "./replyContract";
import { formatWhatsAppReplyTime } from "./replyFormatting";
import {
  buildWhatsAppActionCancelledReplyMessage,
  buildWhatsAppActionConfirmationRequestReplyMessage,
  buildWhatsAppActionConfirmedReplyMessage,
  buildWhatsAppCallbackResourceNotFoundReplyMessage,
  buildWhatsAppClarificationReplyMessage,
} from "./replyMessages";
import {
  getWhatsAppMessageTextBody,
  normalizeWhatsAppIntentText,
  type WhatsAppWebhookMessage,
} from "./webhookUtils";

export const CONFIRM_ACTION = "confirm";
export const CONFIRM_ALL_ACTION = "confirm_all";
export const CONFIRMATION_CANCEL_ACTION = "cancel";

export type WhatsAppAction = {
  kind: "reclassify_recent_meals";
  fromMealLabel: string;
  toMealLabel: string;
};

export type PendingWhatsAppConfirmation = {
  action: WhatsAppAction;
  mealIds: number[];
  allMealIds?: number[];
  summary: string;
  decision?: "reclassify_scope";
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
  "agua", "aguas", "ml", "m l", "mililitro", "mililitros", "l", "litro", "litros",
  "de", "da", "do", "das", "dos", "e", "mais", "bebi", "beber", "tomei", "tomar",
  "consumi", "registrar", "registra", "registre", "registro", "registrei", "para", "por",
  "favor", "hoje", "agora",
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

export function parseReclassifyScopeMessage(message: WhatsAppWebhookMessage): typeof CONFIRM_ACTION | typeof CONFIRM_ALL_ACTION | null {
  const normalized = normalizeWhatsAppIntentText(getWhatsAppMessageTextBody(message));
  if (/^(apenas|somente|so)(\s|$)/.test(normalized) || normalized === "1") return CONFIRM_ACTION;
  if (/^(todos|todas)(\s|$)/.test(normalized) || normalized === "2") return CONFIRM_ALL_ACTION;
  return null;
}

export function buildGenericConfirmationActions(target?: Pick<PendingWhatsAppConfirmation, "decision">): WhatsappInteractionAction[] {
  if (target?.decision === "reclassify_scope") {
    return [
      { id: CONFIRM_ACTION, label: "Só compatíveis", effect: "reclassify_matching" },
      { id: CONFIRM_ALL_ACTION, label: "Todos recentes", effect: "reclassify_all" },
      { id: CONFIRMATION_CANCEL_ACTION, label: "Cancelar", effect: "cancel_action" },
    ];
  }
  return [
    { id: CONFIRM_ACTION, label: "Confirmar", effect: "apply_action" },
    { id: CONFIRMATION_CANCEL_ACTION, label: "Cancelar", effect: "cancel_action" },
  ];
}

export function detectWhatsAppAction(message: WhatsAppWebhookMessage): WhatsAppAction | null {
  const text = getWhatsAppMessageTextBody(message);
  if (!text || message.image?.id || message.audio?.id) return null;
  const normalized = normalizeWhatsAppIntentText(text);
  const match = normalized.match(/(?:mudar|trocar|alterar)\s+a?\s*refeicao\s+(.+?)\s+para\s+(.+)/i);
  if (!match) return null;
  const fromMealLabel = canonicalMealLabel(match[1] || "");
  const toMealLabel = canonicalMealLabel(match[2] || "");
  if (!fromMealLabel || !toMealLabel || fromMealLabel === toMealLabel) return null;
  return { kind: "reclassify_recent_meals", fromMealLabel, toMealLabel };
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
  scope: "matching" | "all" = "matching",
): Promise<{ handled: true; reply: string; eventType: string; detail: string }> {
  const { recentMeals, matchingMeals } = await resolveMatchingRecentMeals(pending.action, userId);
  const selectedMeals = scope === "all" ? recentMeals : matchingMeals;
  if (!selectedMeals.length) {
    return {
      handled: true,
      reply: buildWhatsAppClarificationReplyMessage("Os registros que essa confirmação alteraria não estão mais disponíveis. Envie o comando novamente se ainda quiser reclassificar refeições."),
      eventType: "whatsapp.action_confirmation_target_stale",
      detail: `Confirmação consumida, mas alvo (${pending.summary}) não foi mais encontrado no estado atual.`,
    };
  }

  const updatedMeals = await relabelUserMeals({
    userId,
    mealIds: selectedMeals.map(meal => meal.id),
    mealLabel: pending.action.toMealLabel,
    origin: "whatsapp",
  });
  return {
    handled: true,
    reply: buildWhatsAppActionConfirmedReplyMessage(`${updatedMeals.length} registro(s) recente(s) foram alterados de ${pending.action.fromMealLabel} para ${pending.action.toMealLabel}.`),
    eventType: "whatsapp.action_applied",
    detail: `Comando confirmado e executado com escopo ${scope}: ${pending.summary} em ${updatedMeals.length} registro(s).`,
  };
}

export async function handlePendingWhatsAppConfirmation(message: WhatsAppWebhookMessage, userId: number) {
  const pendingRow = await pendingOperationRepository.getActivePendingOperation(userId);
  if (!pendingRow || pendingRow.type !== PENDING_CONFIRMATION_TYPE) return null;

  if (isCancellationMessage(message)) {
    const claim = await claimWhatsAppTextPendingOperation(userId, PENDING_CONFIRMATION_TYPE, CONFIRMATION_CANCEL_ACTION);
    if (claim.status !== "claimed") return null;
    const pending = claim.pendingOperation.target as PendingWhatsAppConfirmation;
    return {
      handled: true,
      reply: buildWhatsAppActionCancelledReplyMessage("Tudo certo. Não alterei nenhum registro histórico."),
      eventType: "whatsapp.action_cancelled",
      detail: `Confirmação cancelada para ${pending.summary}.`,
    };
  }

  const pending = pendingRow.target as PendingWhatsAppConfirmation;
  if (pending.decision === "reclassify_scope") {
    const scopeAction = parseReclassifyScopeMessage(message);
    if (!scopeAction) return null;
    const claim = await claimWhatsAppTextPendingOperation(userId, PENDING_CONFIRMATION_TYPE, scopeAction);
    if (claim.status !== "claimed") return null;
    return applyClaimedGenericConfirmation(
      userId,
      claim.pendingOperation.target as PendingWhatsAppConfirmation,
      scopeAction === CONFIRM_ALL_ACTION ? "all" : "matching",
    );
  }

  if (!isConfirmationMessage(message)) return null;
  const claim = await claimWhatsAppTextPendingOperation(userId, PENDING_CONFIRMATION_TYPE, CONFIRM_ACTION);
  if (claim.status !== "claimed") return null;
  return applyClaimedGenericConfirmation(userId, claim.pendingOperation.target as PendingWhatsAppConfirmation);
}

export async function completeWhatsappGenericConfirmationCallback(
  userId: number,
  pendingOperation: Pick<WhatsAppPendingOperationRecord, "target">,
  action: string,
): Promise<{ handled: true; reply: string; eventType: string; detail: string; interactiveReply?: WhatsAppLogicalReply }> {
  const pending = pendingOperation.target as PendingWhatsAppConfirmation;
  if (action === CONFIRMATION_CANCEL_ACTION) {
    return {
      handled: true,
      reply: buildWhatsAppActionCancelledReplyMessage("Tudo certo. Não alterei nenhum registro histórico."),
      eventType: "whatsapp.action_cancelled",
      detail: `Confirmação cancelada para ${pending.summary} via botão.`,
    };
  }
  if (action === CONFIRM_ACTION) return applyClaimedGenericConfirmation(userId, pending, "matching");
  if (action === CONFIRM_ALL_ACTION && pending.decision === "reclassify_scope") {
    return applyClaimedGenericConfirmation(userId, pending, "all");
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

  const summary = `${action.fromMealLabel} → ${action.toMealLabel}`;
  if (matchingMeals.length !== recentMeals.length) {
    const recentSummary = recentMeals
      .map(meal => `${meal.mealLabel} às ${formatWhatsAppReplyTime(new Date(meal.occurredAt))}`)
      .join(", ");
    const target: PendingWhatsAppConfirmation = {
      action,
      mealIds: matchingMeals.map(meal => meal.id),
      allMealIds: recentMeals.map(meal => meal.id),
      summary,
      decision: "reclassify_scope",
    };
    const created = await pendingOperationRepository.createPendingOperation({
      userId,
      type: PENDING_CONFIRMATION_TYPE,
      origin: PENDING_CONFIRMATION_ORIGIN,
      ttlMs: PENDING_CONFIRMATION_TTL_MS,
      target,
    });
    const reply = buildWhatsAppClarificationReplyMessage(
      `Encontrei registros recentes com classificações diferentes (${recentSummary}). Você quer que eu mova apenas os itens marcados como ${action.fromMealLabel} ou todos os registros recentes para ${action.toMealLabel}?\n\nResponda APENAS, TODOS ou CANCELAR.`,
    );
    return {
      handled: true,
      reply,
      ...(created ? {
        interactiveReply: buildWhatsappClosedDecisionReply({
          bodyText: reply,
          pendingOperationId: created.id,
          actions: buildGenericConfirmationActions(target),
        }),
      } : {}),
      eventType: "whatsapp.action_clarification_needed",
      detail: `Decisão fechada de escopo criada para ${action.toMealLabel}. Registros recentes: ${recentSummary}.`,
      data: {
        pendingOperationId: created?.id ?? null,
        pendingType: PENDING_CONFIRMATION_TYPE,
        interactionId: "generic_confirmation.reclassify_scope",
        interactionActionCount: 3,
        interactionComponent: "buttons",
      },
    };
  }

  const target: PendingWhatsAppConfirmation = {
    action,
    mealIds: matchingMeals.map(meal => meal.id),
    summary,
  };
  const created = await pendingOperationRepository.createPendingOperation({
    userId,
    type: PENDING_CONFIRMATION_TYPE,
    origin: PENDING_CONFIRMATION_ORIGIN,
    ttlMs: PENDING_CONFIRMATION_TTL_MS,
    target,
  });
  const reply = buildWhatsAppActionConfirmationRequestReplyMessage({
    summary: `Encontrei ${matchingMeals.length} registro(s) recente(s) marcados como ${action.fromMealLabel}.`,
    confirmInstruction: `Responda SIM para confirmar a mudança para ${action.toMealLabel}.`,
    cancelInstruction: "Responda CANCELAR para desistir.",
  });
  return {
    handled: true,
    reply,
    ...(created ? {
      interactiveReply: buildWhatsappClosedDecisionReply({
        bodyText: reply,
        pendingOperationId: created.id,
        actions: buildGenericConfirmationActions(target),
      }),
    } : {}),
    eventType: "whatsapp.action_confirmation_requested",
    detail: `Confirmação solicitada para ${summary} em ${matchingMeals.length} registro(s).`,
  };
}

function parseWaterAmountMl(text: string) {
  const normalized = normalizeWhatsAppIntentText(text);
  const mlMatch = normalized.match(/(\d+(?:[,.]\d+)?)\s*(?:m\s*l|ml|mililitros?)\b/);
  if (mlMatch) return Math.round(Number(mlMatch[1].replace(",", ".")));
  const literMatch = normalized.match(/(\d+(?:[,.]\d+)?)\s*(?:l|litros?)\b/);
  if (literMatch) return Math.round(Number(literMatch[1].replace(",", ".")) * 1000);
  return null;
}

function isWaterOnlyText(text: string) {
  const normalized = normalizeWhatsAppIntentText(text);
  if (!/\baguas?\b/.test(normalized)) return false;
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
  if (!text || message.image?.id || message.audio?.id || !isWaterOnlyText(text)) return null;
  const amountMl = parseWaterAmountMl(text);
  if (!amountMl || amountMl <= 0 || amountMl > MAX_WATER_LOG_AMOUNT_ML) return null;
  return { amountMl };
}

function parseWeightKg(text: string) {
  const normalized = normalizeWhatsAppIntentText(text);
  const kgMatch = normalized.match(/(?:\bpeso\b|\bpesei\b|\bpesando\b|\bpeso atual\b)?\s*(\d{2,3}(?:[,.]\d{1,2})?)\s*(?:kg|kgs|quilo|quilos)\b/);
  if (kgMatch) return Number(kgMatch[1].replace(",", "."));
  const numberBeforeWeightMatch = normalized.match(/\b(\d{2,3}(?:[,.]\d{1,2})?)\s*(?:de\s*)?(?:peso|pesei|pesando|peso atual)\b/);
  if (numberBeforeWeightMatch) return Number(numberBeforeWeightMatch[1].replace(",", "."));
  const weightFirstMatch = normalized.match(/\b(?:peso|pesei|pesando|peso atual)\b[^\d]*(\d{2,3}(?:[,.]\d{1,2})?)\b/);
  if (weightFirstMatch) return Number(weightFirstMatch[1].replace(",", "."));
  return null;
}

export function detectWeightLogFromMessage(message: WhatsAppWebhookMessage) {
  const text = getWhatsAppMessageTextBody(message);
  if (!text || message.image?.id || message.audio?.id) return null;
  const normalized = normalizeWhatsAppIntentText(text);
  if (!/\b(peso|pesei|pesando|kg|kgs|quilo|quilos)\b/.test(normalized)) return null;
  const weightKg = parseWeightKg(text);
  if (!weightKg || weightKg < MIN_WEIGHT_LOG_KG || weightKg > MAX_WEIGHT_LOG_KG) return null;
  return { weightKg };
}
