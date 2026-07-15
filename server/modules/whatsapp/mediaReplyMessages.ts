import { buildWhatsAppAuxiliaryReplyMessage } from "./replyMessages";

export function buildWhatsAppImageNotRecognizedReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Não consegui identificar a refeição",
    lines: ["Envie uma foto mais nítida ou descreva os alimentos e as quantidades por mensagem."],
  });
}

export function buildWhatsAppImageProcessingFailureReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Não foi possível processar a imagem",
    lines: ["Tente enviar a foto novamente. Se o problema continuar, descreva a refeição por mensagem."],
  });
}
