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

export function buildWhatsAppReadOnlyAccessReplyMessage() {
  return [
    "*Assinatura temporariamente suspensa*",
    "────────────────────",
    "Você ainda pode consultar e exportar seus dados pelo sistema web e acessar Plano e acesso.",
    "Novos registros e recursos pagos pelo WhatsApp ficam indisponíveis até a regularização.",
    "Nenhuma refeição, água, exercício ou alteração foi registrada por esta mensagem.",
  ].join("\n");
}
