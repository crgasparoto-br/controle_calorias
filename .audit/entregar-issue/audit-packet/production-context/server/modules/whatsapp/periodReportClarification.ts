/**
 * Clarificação interativa de período para resumos.
 * Quatro períodos mais Cancelar formam cinco ações e, portanto, usam lista.
 */
import { buildWhatsappClosedDecisionReply } from "./interactionPresentation";
import type { WhatsAppLogicalReply } from "./replyContract";
import { buildWhatsAppCallbackResourceNotFoundReplyMessage } from "./replyMessages";
import { executeWhatsappTextIntent } from "./intentActions";

export const PENDING_PERIOD_REPORT_TYPE = "period_report_clarification";
const PERIOD_ACTION_PREFIX = "period:";
export const PERIOD_REPORT_CANCEL_ACTION = "cancel";

export const WHATSAPP_PERIOD_REPORT_OPTIONS = [
  { action: `${PERIOD_ACTION_PREFIX}hoje`, title: "Hoje", intentText: "Resumo hoje" },
  { action: `${PERIOD_ACTION_PREFIX}ontem`, title: "Ontem", intentText: "Resumo ontem" },
  { action: `${PERIOD_ACTION_PREFIX}semana`, title: "Esta semana", intentText: "Resumo da semana" },
  { action: `${PERIOD_ACTION_PREFIX}mes`, title: "Este mês", intentText: "Resumo do mês" },
] as const;

export function buildWhatsappPeriodReportActions() {
  return [
    ...WHATSAPP_PERIOD_REPORT_OPTIONS.map(option => ({
      id: option.action,
      label: option.title,
      effect: "run_report",
    })),
    { id: PERIOD_REPORT_CANCEL_ACTION, label: "Cancelar", effect: "cancel_report" },
  ];
}

export function isExpectedWhatsappPeriodReportAction(action: string) {
  return action === PERIOD_REPORT_CANCEL_ACTION
    || WHATSAPP_PERIOD_REPORT_OPTIONS.some(option => option.action === action);
}

export function buildWhatsappPeriodReportClarificationListReply(
  pendingOperationId: number,
  bodyText: string,
): WhatsAppLogicalReply {
  return buildWhatsappClosedDecisionReply({
    bodyText,
    pendingOperationId,
    actions: buildWhatsappPeriodReportActions(),
    listButtonText: "Escolher período",
  });
}

export async function completeWhatsappPeriodReportCallback(
  userId: number,
  action: string,
  receivedAt?: Date,
): Promise<{ handled: true; action?: string; reply: string; eventType: string; detail: string; data?: Record<string, unknown> }> {
  if (action === PERIOD_REPORT_CANCEL_ACTION) {
    return {
      handled: true,
      action: "period_report_cancelled",
      reply: "Tudo certo. Não montei o resumo. Quando quiser, é só pedir de novo.",
      eventType: "whatsapp.interactive_callback.period_report_cancelled",
      detail: "Clarificação de período cancelada sem gerar resumo.",
    };
  }

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
