/**
 * Transporte central da resposta lógica do WhatsApp (issue #781, epic #779).
 *
 * Único ponto que converte o contrato (`replyContract.ts`) em chamadas às
 * funções de envio da Cloud API concentradas em `webhookUtils.ts`, envia a
 * sequência na ordem definida e integra com o `messageLifecycle` para gravar
 * a resposta funcional exatamente uma vez por ação lógica.
 */
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
import type { MessageLifecycleHandle } from "./messageLifecycle";

export type WhatsAppOutboundSendResult = {
  message: WhatsAppOutboundMessage;
  ok: boolean;
  detail: string;
};

export type WhatsAppLogicalReplySendResult = {
  ok: boolean;
  primaryOk: boolean;
  sends: WhatsAppOutboundSendResult[];
  recorded: boolean;
};

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

export async function sendWhatsAppLogicalReply(
  to: string,
  reply: WhatsAppLogicalReply,
  lifecycle?: WhatsAppLogicalReplyLifecycleInput,
): Promise<WhatsAppLogicalReplySendResult> {
  const sends: WhatsAppOutboundSendResult[] = [];
  for (const message of reply.messages) {
    const result = await sendOutboundMessage(to, message);
    sends.push({ message, ...result });
    if (!result.ok) {
      break;
    }
  }

  const primaryOk = sends.length > 0 && sends[0].ok;
  let recorded = false;
  if (reply.kind === "functional" && primaryOk && lifecycle) {
    const recordText = resolveWhatsAppLogicalReplyRecordText(reply);
    if (recordText) {
      const { recordOutboundReply } = await import("./messageLifecycle");
      await recordOutboundReply(lifecycle.handle, { userId: lifecycle.userId, text: recordText });
      recorded = true;
    }
  }

  return {
    ok: sends.every(send => send.ok),
    primaryOk,
    sends,
    recorded,
  };
}
