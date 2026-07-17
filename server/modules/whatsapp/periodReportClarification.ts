/**
 * Clarificação interativa de período para resumos (issues #782/#784).
 *
 * Quando o usuário pede um resumo sem período explícito, a pergunta usa lista
 * interativa vinculada à pendência persistida em `whatsappPendingOperations`.
 * O fallback textual ("resumo" → "ontem") continua resolvendo a mesma
 * pendência pelo mesmo serviço de intents (`executeWhatsappTextIntent`).
 */
import { buildWhatsAppCallbackId } from "./interactiveCallback";
import { listReply, type WhatsAppLogicalReply } from "./replyContract";
import { buildWhatsAppCallbackResourceNotFoundReplyMessage } from "./replyMessages";
import { executeWhatsappTextIntent } from "./intentActions";

export const PENDING_PERIOD_REPORT_TYPE = "period_report_clarification";

const PERIOD_ACTION_PREFIX = "period:";

export const WHATSAPP_PERIOD_REPORT_OPTIONS = [
  { action: `${PERIOD_ACTION_PREFIX}hoje`, title: "Hoje", intentText: "Resumo hoje" },
  { action: `${PERIOD_ACTION_PREFIX}ontem`, title: "Ontem", intentText: "Resumo ontem" },
  { action: `${PERIOD_ACTION_PREFIX}semana`, title: "Esta semana", intentText: "Resumo da semana" },
  { action: `${PERIOD_ACTION_PREFIX}mes`, title: "Este mês", intentText: "Resumo do mês" },
] as const;

export function isExpectedWhatsappPeriodReportAction(action: string) {
  return WHATSAPP_PERIOD_REPORT_OPTIONS.some(option => option.action === action);
}

export function buildWhatsappPeriodReportClarificationListReply(
  pendingOperationId: number,
  bodyText: string,
): WhatsAppLogicalReply {
  return listReply(bodyText, "Escolher período", [{
    rows: WHATSAPP_PERIOD_REPORT_OPTIONS.map(option => ({
      id: buildWhatsAppCallbackId(pendingOperationId, option.action),
      title: option.title,
    })),
  }]);
}

export async function completeWhatsappPeriodReportCallback(
  userId: number,
  action: string,
  receivedAt?: Date,
): Promise<{ handled: true; action?: string; reply: string; eventType: string; detail: string; data?: Record<string, unknown> }> {
  const option = WHATSAPP_PERIOD_REPORT_OPTIONS.find(candidate => candidate.action === action);
  if (!option) {
    return {
      handled: true,
      reply: buildWhatsAppCallbackResourceNotFoundReplyMessage(),
      eventType: "whatsapp.action_callback_resource_not_found",
      detail: `Callback com ação desconhecida (${action}) para clarificação de período.`,
    };
  }

  const result = await executeWhatsappTextIntent(userId, { text: option.intentText, receivedAt });
  if (!result || result.action !== "period_report") {
    return {
      handled: true,
      reply: buildWhatsAppCallbackResourceNotFoundReplyMessage(),
      eventType: "whatsapp.interactive_callback.period_report_failed",
      detail: `Seleção de período (${option.title}) não pôde ser resolvida pelo serviço de resumos.`,
    };
  }

  return {
    handled: true,
    action: result.action,
    reply: result.reply,
    eventType: result.eventType,
    detail: result.detail,
    data: result.data,
  };
}
