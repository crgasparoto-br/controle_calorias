/**
 * Clarificação genérica de intenção como decisão fechada (issue #858, épica #857).
 *
 * Quando o classificador não entende a mensagem, a pergunta "registrar,
 * corrigir ou consultar?" é uma decisão fechada: três ações objetivas mais
 * Cancelar (4 ações → lista, pela regra central). A pendência preserva a
 * mensagem original e escolher **Registrar alimento** nunca persiste a palavra
 * de comando como alimento (issue #855) — com dado ausente, cria a pergunta
 * aberta específica correspondente.
 */
import { getDb, logPersistenceWarning } from "../../db";
import {
  createDrizzleWhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationRecord,
} from "../../repositories/whatsappPendingOperationRepository";
import { buildWhatsappClosedDecisionReply, type WhatsappClosedDecisionAction } from "./interactionInventory";
import { WHATSAPP_GENERIC_CLARIFICATION_MESSAGE } from "./replyMessages";
import { collapseWhitespace, stripDiacritics } from "./webhookUtils";
import type { WhatsAppLogicalReply } from "./replyContract";

export const PENDING_INTENT_CLARIFICATION_TYPE = "intent_clarification";
const PENDING_INTENT_CLARIFICATION_ORIGIN = "intentClarificationInteraction";
const PENDING_INTENT_CLARIFICATION_TTL_MS = 10 * 60 * 1000;

export const INTENT_CLARIFICATION_ACTIONS = ["register_food", "correct_meal", "consult_records", "cancel"] as const;
export type IntentClarificationAction = (typeof INTENT_CLARIFICATION_ACTIONS)[number];

export type PendingIntentClarification = {
  kind: "intent_clarification";
  /** Mensagem original preservada; nunca persistida como alimento. */
  originalText: string;
};

const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export function isExpectedWhatsappIntentClarificationAction(action: string) {
  return (INTENT_CLARIFICATION_ACTIONS as readonly string[]).includes(action);
}

/** Ações canônicas em ordem determinística (contagem inclui Cancelar → 4 → lista). */
export function buildIntentClarificationActions(): WhatsappClosedDecisionAction[] {
  return [
    { action: "register_food", label: "Registrar alimento" },
    { action: "correct_meal", label: "Corrigir refeição" },
    { action: "consult_records", label: "Consultar registros" },
    { action: "cancel", label: "Cancelar" },
  ];
}

export function buildWhatsappIntentClarificationReply(
  pendingOperationId: number,
  bodyText: string,
): WhatsAppLogicalReply {
  return buildWhatsappClosedDecisionReply({
    bodyText,
    pendingOperationId,
    actions: buildIntentClarificationActions(),
    listButtonText: "Escolher opção",
  });
}

/**
 * Cria a pendência de clarificação genérica preservando a mensagem original e
 * devolve a lista interativa correspondente. Retorna `null` sem persistência
 * disponível — o texto original da resposta continua válido como fallback.
 */
export async function createWhatsappIntentClarificationInteraction(
  userId: number,
  originalText: string,
  bodyText: string,
): Promise<WhatsAppLogicalReply | null> {
  const created = await pendingOperationRepository.createPendingOperation({
    userId,
    type: PENDING_INTENT_CLARIFICATION_TYPE,
    origin: PENDING_INTENT_CLARIFICATION_ORIGIN,
    ttlMs: PENDING_INTENT_CLARIFICATION_TTL_MS,
    target: { kind: "intent_clarification", originalText } satisfies PendingIntentClarification,
  });
  if (!created) return null;
  return buildWhatsappIntentClarificationReply(created.id, bodyText);
}

/** Detecta o resultado de clarificação genérica produzido pelo router/LLM sem duplicar a mensagem. */
export function isGenericIntentClarificationResult(result: { reply?: string | null } | null | undefined) {
  return Boolean(result?.reply && result.reply.includes(WHATSAPP_GENERIC_CLARIFICATION_MESSAGE));
}

function normalizeResponse(text: string) {
  return collapseWhitespace(stripDiacritics(text.trim().toLowerCase()));
}

/**
 * Resolução textual equivalente ao callback: número da opção ou cancelamento.
 * Retorna `null` quando o texto não é uma resposta à clarificação (mensagem
 * completa nova segue o fluxo normal sem consumir a pendência).
 */
export function parseIntentClarificationTextAction(text?: string | null): IntentClarificationAction | null {
  if (!text) return null;
  const normalized = normalizeResponse(text);
  if (!normalized) return null;
  if (["cancelar", "cancela", "cancele", "nao", "nenhuma", "0"].includes(normalized)) return "cancel";
  const numeric = normalized.match(/^(?:opcao\s*)?([1-3])$/);
  if (numeric) return INTENT_CLARIFICATION_ACTIONS[Number(numeric[1]) - 1];
  if (/^registrar?(\s+alimento)?$/.test(normalized) || normalized === "registre" || normalized === "registra") return "register_food";
  if (/^corrigir(\s+refeicao)?$/.test(normalized) || normalized === "corrige" || normalized === "corrija") return "correct_meal";
  if (/^consultar?(\s+registros)?$/.test(normalized) || normalized === "consulte" || normalized === "consulta") return "consult_records";
  return null;
}

export type IntentClarificationCompletion = {
  handled: true;
  action?: string;
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
};

/**
 * Resolve a ação canônica já reivindicada pelo gate central. Nunca encaminha
 * ao parser, LLM ou fallback nutricional; nunca persiste a palavra de comando
 * como alimento.
 */
export async function completeWhatsappIntentClarificationCallback(
  userId: number,
  pendingOperation: Pick<WhatsAppPendingOperationRecord, "target">,
  action: string,
  receivedAt?: Date,
): Promise<IntentClarificationCompletion> {
  const pending = pendingOperation.target as PendingIntentClarification;
  const originalText = typeof pending?.originalText === "string" ? pending.originalText.trim() : "";

  if (action === "cancel") {
    return {
      handled: true,
      action: "intent_clarification_cancelled",
      reply: "Tudo certo. Não registrei nada. Quando quiser, é só mandar outra mensagem.",
      eventType: "whatsapp.intent_clarification.cancelled",
      detail: "Clarificação genérica cancelada sem persistência.",
    };
  }

  if (action === "register_food") {
    const lines = [
      "Certo! Me diga o alimento e a quantidade, por exemplo: 100 g de arroz ou 1 pão francês.",
    ];
    if (originalText) {
      lines.push(`Sua mensagem anterior foi "${originalText}". Se ela era um alimento, é só confirmar a quantidade.`);
    }
    return {
      handled: true,
      action: "intent_clarification_register_food",
      reply: lines.join("\n\n"),
      eventType: "whatsapp.intent_clarification.register_food",
      detail: "Clarificação genérica resolvida para registro; pergunta aberta criada sem persistir comando como alimento.",
      data: { originalTextPreserved: Boolean(originalText) },
    };
  }

  if (action === "correct_meal") {
    return {
      handled: true,
      action: "intent_clarification_correct_meal",
      reply: "Certo! Me diga o que quer corrigir, por exemplo: troque o arroz por batata ou remova o queijo da última refeição.",
      eventType: "whatsapp.intent_clarification.correct_meal",
      detail: "Clarificação genérica resolvida para correção; pergunta aberta criada.",
    };
  }

  if (action === "consult_records") {
    const { executeWhatsappTextIntent } = await import("./intentActions");
    const result = await executeWhatsappTextIntent(userId, { text: "Resumo hoje", receivedAt });
    if (result?.reply) {
      return {
        handled: true,
        action: "intent_clarification_consult_records",
        reply: result.reply,
        eventType: "whatsapp.intent_clarification.consult_records",
        detail: "Clarificação genérica resolvida consultando registros pelo serviço existente de resumos.",
        data: result.data,
      };
    }
    return {
      handled: true,
      action: "intent_clarification_consult_records",
      reply: "Não consegui montar seu resumo agora. Envie \"resumo hoje\" para tentar de novo.",
      eventType: "whatsapp.intent_clarification.consult_records_failed",
      detail: "Consulta de registros indisponível ao resolver clarificação genérica.",
    };
  }

  return {
    handled: true,
    reply: "Essa opção não está mais disponível. Me diga em uma frase o que você quer fazer.",
    eventType: "whatsapp.intent_clarification.unknown_action",
    detail: `Callback com ação desconhecida (${action}) para clarificação genérica.`,
  };
}
