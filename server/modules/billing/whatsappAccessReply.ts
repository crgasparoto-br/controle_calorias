import { buildWhatsAppAuxiliaryReplyMessage } from "../whatsapp/replyMessages";

export function buildWhatsAppAccessPendingReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Acesso aguardando ativação",
    lines: [
      "Seu cadastro está concluído, mas o acesso aos registros nutricionais ainda não está liberado.",
      "Entre no sistema web e abra Plano e acesso para consultar a situação atual.",
      "Nenhuma refeição, água, exercício ou alteração foi registrada por esta mensagem.",
    ],
  });
}
