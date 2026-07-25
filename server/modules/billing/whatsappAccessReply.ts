const ACCESS_PENDING_TITLE = "Acesso aguardando ativação";

export function buildWhatsAppAccessPendingReplyMessage() {
  return [
    `*${ACCESS_PENDING_TITLE}*`,
    "────────────────────",
    "Seu cadastro está concluído, mas o acesso aos registros nutricionais ainda não está liberado.",
    "Entre no sistema web e abra Plano e acesso para consultar a situação atual.",
    "Nenhuma refeição, água, exercício ou alteração foi registrada por esta mensagem.",
  ].join("\n");
}
