import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { claimWhatsAppTextPendingOperation } from "./interactiveCallback";
import {
  buildWhatsappClosedDecisionReply,
  buildWhatsappInteractionTelemetry,
  type WhatsappInteractionAction,
} from "./interactionPresentation";
import type { WhatsappInterpretedIntent } from "./intentSchema";
import type { WhatsAppLogicalReply } from "./replyContract";
import {
  buildWhatsAppRecoverableErrorReplyMessage,
} from "./replyMessages";
import { normalizeStandaloneWhatsappCommand } from "./standaloneCommandWords";
import { supersedeActiveWhatsappPendingOperations } from "./pendingOperationPrecedence";

export const PENDING_INTENT_CLARIFICATION_TYPE = "intent_clarification";
export const PENDING_INTENT_CLARIFICATION_ORIGIN = "intentClarificationInteraction";
const PENDING_INTENT_CLARIFICATION_TTL_MS = 10 * 60 * 1000;

export const INTENT_CLARIFICATION_ACTIONS = [
  { id: "register_food", label: "Registrar alimento", effect: "ask_food_and_quantity" },
  { id: "correct_meal", label: "Corrigir refeição", effect: "ask_correction_details" },
  { id: "consult_records", label: "Consultar registros", effect: "run_daily_summary" },
  { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
] as const satisfies readonly WhatsappInteractionAction[];

export const GENERIC_COFFEE_PREPARATION_ACTIONS = [
  { id: "coffee_without_sugar", label: "Sem açúcar", effect: "complete_generic_coffee_once" },
  { id: "coffee_with_sugar", label: "Com açúcar", effect: "complete_generic_coffee_once" },
  { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
] as const satisfies readonly WhatsappInteractionAction[];

export const GENERIC_COFFEE_PREPARATION_QUESTION =
  "Seu café foi sem açúcar ou com açúcar?";

export type IntentClarificationAction =
  | (typeof INTENT_CLARIFICATION_ACTIONS)[number]["id"]
  | (typeof GENERIC_COFFEE_PREPARATION_ACTIONS)[number]["id"];

export type PendingGenericIntentClarification = {
  contractVersion: 1;
  interactionId: "intent_clarification.generic";
  kind: "intent_clarification";
  originalText: string;
  actions: WhatsappInteractionAction[];
};

export type PendingGenericCoffeePreparationClarification = {
  contractVersion: 1;
  interactionId: "intent_clarification.generic";
  kind: "generic_coffee_preparation";
  originalText: string;
  originalReceivedAt: string;
  inboundMessageId: string | null;
  userTimezone: string;
  intentSnapshot: WhatsappInterpretedIntent;
  genericItemIndexes: number[];
  actions: WhatsappInteractionAction[];
};

export type PendingIntentClarification =
  | PendingGenericIntentClarification
  | PendingGenericCoffeePreparationClarification;

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export function isPendingGenericCoffeePreparationClarification(
  value: unknown,
): value is PendingGenericCoffeePreparationClarification {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<PendingGenericCoffeePreparationClarification>;
  return target.contractVersion === 1
    && target.interactionId === "intent_clarification.generic"
    && target.kind === "generic_coffee_preparation"
    && typeof target.originalText === "string"
    && typeof target.originalReceivedAt === "string"
    && typeof target.userTimezone === "string"
    && target.intentSnapshot !== null
    && typeof target.intentSnapshot === "object"
    && Array.isArray(target.genericItemIndexes)
    && target.genericItemIndexes.every(index => Number.isSafeInteger(index) && index >= 0)
    && Array.isArray(target.actions);
}

export function isPendingIntentClarification(value: unknown): value is PendingIntentClarification {
  if (!value || typeof value !== "object") return false;
  if (isPendingGenericCoffeePreparationClarification(value)) return true;
  const target = value as Partial<PendingGenericIntentClarification>;
  return target.contractVersion === 1
    && target.interactionId === "intent_clarification.generic"
    && target.kind === "intent_clarification"
    && typeof target.originalText === "string"
    && Array.isArray(target.actions);
}

export function isExpectedWhatsappIntentClarificationAction(
  action: string,
  target?: unknown,
) {
  if (isPendingGenericCoffeePreparationClarification(target)) {
    return GENERIC_COFFEE_PREPARATION_ACTIONS.some(candidate => candidate.id === action);
  }
  return INTENT_CLARIFICATION_ACTIONS.some(candidate => candidate.id === action);
}

function normalizeCoffeePreparationText(value: string) {
  return normalizeStandaloneWhatsappCommand(value)
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeGenericCoffeePreparationPrompt(value: string) {
  const normalized = normalizeCoffeePreparationText(value);
  if (normalized.includes("sem acucar ou com acucar")) return true;
  const itemText = normalized.replace(/\bcafe da manha\b/g, " ").replace(/\s+/g, " ").trim();
  if (!/\bcafe\b/.test(itemText)) return false;
  if (/\b(?:sem acucar|com acucar|adocado|acucarado|puro|preto|natural)\b/.test(itemText)) return false;
  if (/\b(?:leite|mel|creme|chantilly|chocolate|achocolatado|leite condensado)\b/.test(itemText)) return false;
  return /\b(?:\d+(?:[,.]\d+)?\s*)?(?:xicaras?|copos?|ml|l|porcoes?|unidades?)?\s*(?:de\s+)?cafe\b/.test(itemText);
}

export function buildWhatsappIntentClarificationReply(
  pendingOperationId: number,
  bodyText: string,
  actions?: readonly WhatsappInteractionAction[],
): WhatsAppLogicalReply {
  const resolvedActions = actions
    ? [...actions]
    : looksLikeGenericCoffeePreparationPrompt(bodyText)
      ? [...GENERIC_COFFEE_PREPARATION_ACTIONS]
      : [...INTENT_CLARIFICATION_ACTIONS];
  return buildWhatsappClosedDecisionReply({
    bodyText,
    pendingOperationId,
    actions: resolvedActions,
    listButtonText: "Escolher opção",
  });
}

export async function createWhatsappIntentClarificationInteraction(input: {
  userId: number;
  originalText: string;
  bodyText?: string;
  receivedAt?: Date;
}) {
  const target: PendingGenericIntentClarification = {
    contractVersion: 1,
    interactionId: "intent_clarification.generic",
    kind: "intent_clarification",
    originalText: input.originalText.trim(),
    actions: [...INTENT_CLARIFICATION_ACTIONS],
  };
  const created = await pendingOperationRepository.createPendingOperation({
    userId: input.userId,
    type: PENDING_INTENT_CLARIFICATION_TYPE,
    origin: PENDING_INTENT_CLARIFICATION_ORIGIN,
    ttlMs: PENDING_INTENT_CLARIFICATION_TTL_MS,
    now: input.receivedAt,
    target,
  });
  if (!created) return null;

  const reply = input.bodyText
    ?? "Você quer registrar um alimento, corrigir uma refeição ou consultar seus registros?";
  return {
    handled: true as const,
    action: "food_clarification_standalone_command_blocked",
    reply,
    eventType: "whatsapp.intent_clarification.requested",
    detail: "Comando isolado bloqueado antes da inferência; clarificação genérica persistida como decisão fechada.",
    data: {
      pendingOperationId: created.id,
      pendingType: created.type,
      originalTextPreserved: true,
      ...buildWhatsappInteractionTelemetry({
        interactionId: target.interactionId,
        origin: PENDING_INTENT_CLARIFICATION_ORIGIN,
        classification: "closed",
        actions: target.actions,
        lifecycle: "created",
      }),
    },
    interactiveReply: buildWhatsappIntentClarificationReply(created.id, reply),
  };
}

export async function createWhatsappGenericCoffeePreparationClarification(input: {
  userId: number;
  originalText: string;
  receivedAt: Date;
  messageId?: string | null;
  userTimezone: string;
  intent: WhatsappInterpretedIntent;
  genericItemIndexes: number[];
}) {
  const replaced = await supersedeActiveWhatsappPendingOperations(
    input.userId,
    input.receivedAt,
  );
  if (!replaced) {
    return {
      handled: true as const,
      action: "clarification_needed" as const,
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui substituir a ação pendente com segurança. Nada foi alterado; cancele a ação anterior e envie a mensagem novamente.",
      ),
      eventType: "whatsapp.generic_coffee_preparation.pending_replacement_blocked",
      detail: "Café genérico bloqueado porque uma pendência anterior não pôde ser substituída.",
      data: {
        fallbackBlocked: true,
        fallbackBlockReason: "pending_replacement_failed",
      },
    };
  }

  const target: PendingGenericCoffeePreparationClarification = {
    contractVersion: 1,
    interactionId: "intent_clarification.generic",
    kind: "generic_coffee_preparation",
    originalText: input.originalText,
    originalReceivedAt: input.receivedAt.toISOString(),
    inboundMessageId: input.messageId?.trim() || null,
    userTimezone: input.userTimezone,
    intentSnapshot: structuredClone(input.intent),
    genericItemIndexes: [...new Set(input.genericItemIndexes)].sort((a, b) => a - b),
    actions: [...GENERIC_COFFEE_PREPARATION_ACTIONS],
  };

  const created = await pendingOperationRepository.createPendingOperation({
    userId: input.userId,
    type: PENDING_INTENT_CLARIFICATION_TYPE,
    origin: PENDING_INTENT_CLARIFICATION_ORIGIN,
    ttlMs: PENDING_INTENT_CLARIFICATION_TTL_MS,
    now: input.receivedAt,
    target,
  });
  if (!created) {
    return {
      handled: true as const,
      action: "clarification_needed" as const,
      reply: buildWhatsAppRecoverableErrorReplyMessage(
        "Não consegui guardar a pergunta sobre o café com segurança. Nada foi registrado; envie a mensagem novamente.",
      ),
      eventType: "whatsapp.generic_coffee_preparation.persistence_unavailable",
      detail: "Pergunta de preparo do café não foi enviada porque a pendência não pôde ser persistida.",
      data: {
        fallbackBlocked: true,
        fallbackBlockReason: "pending_persistence_failed",
        originalTextPreserved: true,
      },
    };
  }

  return {
    handled: true as const,
    action: "clarification_needed" as const,
    reply: GENERIC_COFFEE_PREPARATION_QUESTION,
    eventType: "whatsapp.generic_coffee_preparation.requested",
    detail: "Café genérico aguardando confirmação persistente do preparo antes de qualquer composição nutricional.",
    data: {
      pendingOperationId: created.id,
      pendingType: created.type,
      originalTextPreserved: true,
      genericCoffeeItemCount: target.genericItemIndexes.length,
      ...buildWhatsappInteractionTelemetry({
        interactionId: target.interactionId,
        origin: PENDING_INTENT_CLARIFICATION_ORIGIN,
        classification: "closed",
        actions: target.actions,
        lifecycle: "created",
      }),
    },
    interactiveReply: buildWhatsappIntentClarificationReply(
      created.id,
      GENERIC_COFFEE_PREPARATION_QUESTION,
      target.actions,
    ),
  };
}

export function parseGenericCoffeePreparationTextAction(
  text?: string | null,
): IntentClarificationAction | null {
  const normalized = normalizeCoffeePreparationText(text ?? "");
  if (!normalized) return null;
  if (["cancelar", "cancela", "cancele", "nao", "nenhuma", "nenhum", "0"].includes(normalized)) return "cancel";
  if (/^(?:opcao\s*)?1$/.test(normalized)) return "coffee_without_sugar";
  if (/^(?:opcao\s*)?2$/.test(normalized)) return "coffee_with_sugar";
  if (/^(?:sem acucar|sem adicao de acucar|puro|preto|natural)$/.test(normalized)) return "coffee_without_sugar";
  if (/^(?:com acucar|adocado|acucarado)$/.test(normalized)) return "coffee_with_sugar";
  return null;
}

export function parseIntentClarificationTextAction(
  text?: string | null,
  target?: unknown,
): IntentClarificationAction | null {
  if (isPendingGenericCoffeePreparationClarification(target)) {
    return parseGenericCoffeePreparationTextAction(text);
  }
  const normalized = normalizeStandaloneWhatsappCommand(text ?? "");
  if (!normalized) return null;
  if (["cancelar", "cancela", "cancele", "nao", "nenhuma", "0"].includes(normalized)) return "cancel";
  const numeric = normalized.match(/^(?:opcao\s*)?([1-3])$/);
  if (numeric) return INTENT_CLARIFICATION_ACTIONS[Number(numeric[1]) - 1].id;
  if (/^registrar?(?:\s+alimento)?$/.test(normalized) || ["registre", "registra"].includes(normalized)) return "register_food";
  if (/^corrigir(?:\s+refeicao)?$/.test(normalized) || ["corrige", "corrija"].includes(normalized)) return "correct_meal";
  if (/^consultar?(?:\s+registros)?$/.test(normalized) || ["consulte", "consulta"].includes(normalized)) return "consult_records";
  return null;
}

function canResumeAsFoodRegistration(action: string) {
  return action === "meal_item_added" || action.startsWith("food_clarification_");
}

async function completeGenericCoffeePreparation(
  userId: number,
  target: PendingGenericCoffeePreparationClarification,
  action: IntentClarificationAction,
) {
  if (action === "cancel") {
    return {
      handled: true as const,
      action: "food_clarification_cancelled",
      reply: "Tudo certo. Não registrei o café pendente.",
      eventType: "whatsapp.generic_coffee_preparation.cancelled",
      detail: "Clarificação de preparo do café cancelada sem mutação.",
      data: { originalTextPreserved: true },
    };
  }

  if (action !== "coffee_without_sugar" && action !== "coffee_with_sugar") {
    return {
      handled: true as const,
      action: "food_clarification_unavailable",
      reply: "Essa opção não está mais disponível. Envie a mensagem alimentar completa novamente.",
      eventType: "whatsapp.generic_coffee_preparation.unavailable",
      detail: "Ação incompatível com a clarificação de preparo do café.",
    };
  }

  const { resumeWhatsappGenericCoffeePreparationClarification } = await import("./llmIntentActions");
  return resumeWhatsappGenericCoffeePreparationClarification({
    userId,
    target,
    preparation: action === "coffee_without_sugar" ? "without_sugar" : "with_sugar",
  });
}

export async function completeWhatsappIntentClarificationCallback(
  userId: number,
  pendingOperation: Pick<WhatsAppPendingOperationRecord, "target">,
  action: string,
  receivedAt?: Date,
) {
  const target = pendingOperation.target;
  if (!isPendingIntentClarification(target) || !isExpectedWhatsappIntentClarificationAction(action, target)) {
    return {
      handled: true as const,
      reply: "Essa opção não está mais disponível. Envie uma nova mensagem completa.",
      eventType: "whatsapp.intent_clarification.unavailable",
      detail: "Ação ou contrato de clarificação genérica inválido.",
    };
  }

  if (isPendingGenericCoffeePreparationClarification(target)) {
    return completeGenericCoffeePreparation(
      userId,
      target,
      action as IntentClarificationAction,
    );
  }

  if (action === "cancel") {
    return {
      handled: true as const,
      action: "intent_clarification_cancelled",
      reply: "Tudo certo. Não registrei nem alterei nada.",
      eventType: "whatsapp.intent_clarification.cancelled",
      detail: "Clarificação genérica cancelada sem mutação.",
    };
  }
  if (action === "register_food") {
    const { executeWhatsappTextIntent } = await import("./intentActions");
    const resumed = await executeWhatsappTextIntent(userId, {
      text: target.originalText,
      receivedAt,
      entrypoint: "intentClarification.resume",
    });
    if (resumed && canResumeAsFoodRegistration(resumed.action)) {
      return {
        ...resumed,
        detail: `${resumed.detail} Mensagem original retomada após a escolha Registrar alimento.`,
        data: {
          ...(resumed.data ?? {}),
          originalTextPreserved: true,
          originalTextResumed: true,
        },
      };
    }

    return {
      handled: true as const,
      action: "intent_clarification_register_food",
      reply: "Certo! Me diga o alimento e a quantidade, por exemplo: 100 g de arroz ou 1 pão francês.",
      eventType: "whatsapp.intent_clarification.register_food",
      detail: "A mensagem original não tinha dados suficientes; a clarificação foi convertida em pergunta aberta específica de alimento e quantidade.",
      data: {
        originalTextPreserved: Boolean(target.originalText),
        originalTextResumed: false,
      },
    };
  }
  if (action === "correct_meal") {
    return {
      handled: true as const,
      action: "intent_clarification_correct_meal",
      reply: "Certo! Diga exatamente o que deseja corrigir, por exemplo: troque o arroz por batata ou remova o queijo da última refeição.",
      eventType: "whatsapp.intent_clarification.correct_meal",
      detail: "Clarificação resolvida para pergunta aberta de correção.",
    };
  }

  const { executeWhatsappTextIntent } = await import("./intentActions");
  const summary = await executeWhatsappTextIntent(userId, {
    text: "Resumo hoje",
    receivedAt,
  });
  return {
    handled: true as const,
    action: "intent_clarification_consult_records",
    reply: summary?.reply ?? "Não consegui montar o resumo agora. Envie \"resumo hoje\" para tentar novamente.",
    eventType: summary?.eventType ?? "whatsapp.intent_clarification.consult_records_failed",
    detail: summary?.detail ?? "Consulta de registros indisponível ao resolver a clarificação genérica.",
    data: summary?.data,
  };
}

export async function resolveWhatsappIntentClarificationText(input: {
  userId: number;
  pendingOperation: WhatsAppPendingOperationRecord;
  text?: string | null;
  receivedAt?: Date;
}) {
  const action = parseIntentClarificationTextAction(
    input.text,
    input.pendingOperation.target,
  );
  if (!action) return null;
  const claim = await claimWhatsAppTextPendingOperation(
    input.userId,
    PENDING_INTENT_CLARIFICATION_TYPE,
    action,
    input.receivedAt,
  );
  if (claim.status !== "claimed") return null;
  return completeWhatsappIntentClarificationCallback(
    input.userId,
    claim.pendingOperation,
    action,
    input.receivedAt,
  );
}
