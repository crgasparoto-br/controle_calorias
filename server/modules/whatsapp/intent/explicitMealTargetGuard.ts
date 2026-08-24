import { buildWhatsAppClarificationReplyMessage } from "../replyMessages";

function formatReplyDate(date: Date, timeZone: string) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  });
}

export function buildWhatsappExplicitMealTargetMissingClarification(input: {
  mealLabel: string;
  targetDate: Date;
  timeZone: string;
  eventType?: string;
  detail?: string;
}) {
  return {
    reply: buildWhatsAppClarificationReplyMessage(
      `Não encontrei a refeição ${input.mealLabel} em ${formatReplyDate(input.targetDate, input.timeZone)}. Nada foi alterado. Me diga em qual refeição devo adicionar os alimentos.`,
    ),
    eventType: input.eventType ?? "whatsapp.intent.clarification_needed",
    detail: input.detail
      ?? "Adição com data explícita bloqueada porque a refeição indicada não existe no dia interpretado.",
    data: {
      mealLabel: input.mealLabel,
      requestedDate: input.targetDate.toISOString(),
      explicitDate: true,
      mutationBlocked: true,
    },
  };
}
