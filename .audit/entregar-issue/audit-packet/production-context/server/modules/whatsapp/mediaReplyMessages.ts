import { buildWhatsAppAuxiliaryReplyMessage } from "./replyMessages";

export function buildWhatsAppImageNotRecognizedReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Não consegui identificar o alimento na imagem",
    lines: ["Envie outra foto com o alimento mais visível ou descreva o que comeu e a quantidade."],
  });
}

export function buildWhatsAppImageProcessingFailureReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Não foi possível processar a imagem",
    lines: ["Tente enviar a foto novamente. Se o problema continuar, descreva a refeição por mensagem."],
  });
}


export function buildWhatsAppAudioNotUnderstoodReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Não consegui entender o áudio",
    lines: ["Envie o áudio novamente, falando mais próximo do microfone, ou descreva a informação por texto."],
  });
}

export function buildWhatsAppAudioProcessingFailureReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "⚠️ Não foi possível processar o áudio",
    lines: ["Tente enviar novamente. Se o problema continuar, envie a informação por texto."],
  });
}
