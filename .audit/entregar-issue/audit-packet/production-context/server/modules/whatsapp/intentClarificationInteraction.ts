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
import type { WhatsAppLogicalReply } from "./replyContract";
import { normalizeStandaloneWhatsappCommand } from "./standaloneCommandWords";

export const PENDING_INTENT_CLARIFICATION_TYPE = "intent_clarification";
export const PENDING_INTENT_CLARIFICATION_ORIGIN = "intentClarificationInteraction";
const PENDING_INTENT_CLARIFICATION_TTL_MS = 10 * 60 * 1000;

export const INTENT_CLARIFICATION_ACTIONS = [
  { id: "register_food", label: "Registrar alimento", effect: "ask_food_and_quantity" },
  { id: "correct_meal", label: "Corrigir refeição", effect: "ask_correction_details" },
  { id: "consult_records", label: "Consultar registros", effect: "run_daily_summary" },
  { id: "cancel", label: "Cancelar", effect: "cancel_without_persistence" },
] as const satisfies readonly WhatsappInteractionAction[];

export type IntentClarificationAction = (typeof INTENT_CLARIFICATION_ACTIONS)[number]["id"];

export type PendingIntentClarification = {
  contractVersion: 1;
  interactionId: "intent_clarification.generic";
  kind: "intent_clarification";
  originalText: string;
  actions: WhatsappInteractionAction[];
};

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export function isPendingIntentClarification(value: unknown): value is PendingIntentClarification {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<PendingIntentClarification>;
  return target.contractVersion === 1
    && target.interactionId === "intent_clarification.generic"
    && target.kind === "intent_clarification"
    && typeof target.originalText === "string"
    && Array.isArray(target.actions);
}

export function isExpectedWhatsappIntentClarificationAction(action: string) {
  return INTENT_CLARIFICATION_ACTIONS.some(candidate => candidate.id === action);
}

export function buildWhatsappIntentClarificationReply(
  pendingOperationId: number,
  bodyText: string,
): WhatsAppLogicalReply {
  return buildWhatsappClosedDecisionReply({
    bodyText,
    pendingOperationId,
    actions: [...INTENT_CLARIFICATION_ACTIONS],
    listButtonText: "Escolher opção",
  });
}

export async function createWhatsappIntentClarificationInteraction(input: {
  userId: number;
  originalText: string;
  bodyText?: string;
  receivedAt?: Date;
}) {
  const target: PendingIntentClarification = {
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

export function parseIntentClarificationTextAction(text?: string | null): IntentClarificationAction | null {
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

export async function completeWhatsappIntentClarificationCallback(
  userId: number,
  pendingOperation: Pick<WhatsAppPendingOperationRecord, "target">,
  action: string,
  receivedAt?: Date,
) {
  const target = pendingOperation.target;
  if (!isPendingIntentClarification(target) || !isExpectedWhatsappIntentClarificationAction(action)) {
    return {
      handled: true as const,
      reply: "Essa opção não está mais disponível. Envie uma nova mensagem completa.",
      eventType: "whatsapp.intent_clarification.unavailable",
      detail: "Ação ou contrato de clarificação genérica inválido.",
    };
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
  const action = parseIntentClarificationTextAction(input.text);
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
