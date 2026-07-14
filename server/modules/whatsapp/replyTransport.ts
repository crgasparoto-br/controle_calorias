/**
 * Transporte central da resposta lógica do WhatsApp (issue #781, epic #779).
 *
 * Único ponto que converte o contrato (`replyContract.ts`) em chamadas da
 * Cloud API, envia a sequência na ordem definida e integra com o
 * `messageLifecycle` para gravar a resposta funcional exatamente uma vez.
 */
import { requireWhatsAppSendConfig } from "../../whatsappConfig";
import {
  sendWhatsAppImageBufferMessage,
  sendWhatsAppImageMessage,
  sendWhatsAppInteractiveButtonsMessage,
  sendWhatsAppInteractiveListMessage,
  sendWhatsAppInteractiveUrlButtonMessage,
  sendWhatsAppTextMessage,
} from "./webhookUtils";
import {
  resolveWhatsAppLogicalReplyRecordText,
  validateWhatsAppOutboundMessage,
  type WhatsAppLogicalReply,
  type WhatsAppOutboundMessage,
} from "./replyContract";
import { recordOutboundReply, type MessageLifecycleHandle } from "./messageLifecycle";

export type WhatsAppOutboundSendResult = {
  message: WhatsAppOutboundMessage;
  ok: boolean;
  /** Detalhe técnico para logs seguros; nunca é enviado ao usuário como texto da resposta. */
  detail: string;
};

export type WhatsAppLogicalReplySendResult = {
  ok: boolean;
  /** `true` quando a mensagem primária foi entregue, independentemente de mídia auxiliar. */
  primaryOk: boolean;
  sends: WhatsAppOutboundSendResult[];
  recorded: boolean;
};

async function sendWhatsAppImageIdMessage(to: string, mediaId: string, caption: string) {
  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para envio de mídia.",
    };
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: { id: mediaId, caption },
      }),
    });
    if (!response.ok) {
      return { ok: false, detail: `Meta retornou ${response.status} ${response.statusText} no envio da mídia por ID.` };
    }
    return { ok: true, detail: "Mídia enviada por ID com sucesso." };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar mídia do WhatsApp por ID.",
    };
  }
}

async function sendOutboundMessage(to: string, message: WhatsAppOutboundMessage): Promise<{ ok: boolean; detail: string }> {
  const validationErrors = validateWhatsAppOutboundMessage(message);
  if (validationErrors.length) {
    return {
      ok: false,
      detail: `Mensagem rejeitada por validação do contrato: ${validationErrors.map(error => error.detail).join(" ")}`,
    };
  }

  switch (message.type) {
    case "text":
      return sendWhatsAppTextMessage(to, message.body);
    case "cta_url":
      return sendWhatsAppInteractiveUrlButtonMessage(to, message.bodyText, message.buttonText, message.url);
    case "buttons":
      return sendWhatsAppInteractiveButtonsMessage(to, message.bodyText, message.buttons);
    case "list":
      return sendWhatsAppInteractiveListMessage(to, message.bodyText, message.buttonText, message.sections);
    case "image_url":
      return sendWhatsAppImageMessage(to, message.url, message.caption);
    case "image_id":
      return sendWhatsAppImageIdMessage(to, message.mediaId, message.caption);
    case "image_buffer":
      return sendWhatsAppImageBufferMessage(
        to,
        { buffer: message.buffer, mimeType: message.mimeType, fileName: message.fileName },
        message.caption,
      );
  }
}

export type WhatsAppLogicalReplyLifecycleInput = {
  handle: MessageLifecycleHandle;
  userId: number;
};

/**
 * Envia a sequência de mensagens físicas de uma resposta lógica, na ordem
 * definida, e grava a resposta funcional no lifecycle exatamente uma vez.
 *
 * Regras de gravação:
 * - somente respostas `functional` são gravadas; `acknowledgement` nunca é;
 * - a gravação depende apenas do sucesso da mensagem primária;
 * - falha de mídia auxiliar não impede a gravação nem repete o domínio;
 * - falha na primária interrompe a sequência para não enviar mídia órfã.
 */
export async function sendWhatsAppLogicalReply(
  to: string,
  reply: WhatsAppLogicalReply,
  lifecycle?: WhatsAppLogicalReplyLifecycleInput,
): Promise<WhatsAppLogicalReplySendResult> {
  const sends: WhatsAppOutboundSendResult[] = [];
  for (const [index, message] of reply.messages.entries()) {
    const result = await sendOutboundMessage(to, message);
    sends.push({ message, ...result });
    if (index === 0 && !result.ok) break;
  }

  const primaryOk = sends.length > 0 && sends[0].ok;
  let recorded = false;
  if (reply.kind === "functional" && primaryOk && lifecycle) {
    const recordText = resolveWhatsAppLogicalReplyRecordText(reply);
    if (recordText) {
      await recordOutboundReply(lifecycle.handle, { userId: lifecycle.userId, text: recordText });
      recorded = true;
    }
  }

  return {
    ok: sends.length === reply.messages.length && sends.every(send => send.ok),
    primaryOk,
    sends,
    recorded,
  };
}
