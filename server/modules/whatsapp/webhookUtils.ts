import { getWhatsAppChannelConfig, requireWhatsAppMediaConfig, requireWhatsAppSendConfig } from "../../whatsappConfig";

export type WhatsAppWebhookMessage = {
  id?: string;
  from?: string;
  channelPhoneNumberId?: string;
  channelDisplayPhoneNumber?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  interactive?: {
    type?: "button_reply" | "list_reply";
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
};

export type WhatsAppProviderSendResult = {
  ok: boolean;
  detail: string;
  failureCategory?: "config" | "network" | "provider";
  status?: number;
  statusText?: string;
  errorBody?: string;
};

export type ExtractedWhatsAppWebhookMessage = WhatsAppWebhookMessage & {
  entryIndex: number;
  changeIndex: number;
  messageIndex: number;
};

export type IndexedWhatsAppWebhookMessage = {
  key: string;
  message: ExtractedWhatsAppWebhookMessage;
};

export function extractWhatsAppWebhookMessages(payload: unknown): ExtractedWhatsAppWebhookMessage[] {
  const entries = Array.isArray((payload as any)?.entry) ? (payload as any).entry : [];
  return entries.flatMap((entry: any, entryIndex: number) =>
    Array.isArray(entry?.changes)
      ? entry.changes.flatMap((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          return messages.map((message: WhatsAppWebhookMessage, messageIndex: number) => ({
            ...message,
            entryIndex,
            changeIndex,
            messageIndex,
            channelPhoneNumberId: change?.value?.metadata?.phone_number_id,
            channelDisplayPhoneNumber: change?.value?.metadata?.display_phone_number,
          }));
        })
      : [],
  );
}

export function extractIndexedWhatsAppWebhookMessages(payload: unknown): IndexedWhatsAppWebhookMessage[] {
  return extractWhatsAppWebhookMessages(payload).map(message => ({
    key: getExtractedWhatsAppMessageKey(message),
    message,
  }));
}

export function getExtractedWhatsAppMessageKey(message: Pick<ExtractedWhatsAppWebhookMessage, "entryIndex" | "changeIndex" | "messageIndex">) {
  return `${message.entryIndex}:${message.changeIndex}:${message.messageIndex}`;
}

export function isWhatsAppMessageForConfiguredChannel(message: Pick<WhatsAppWebhookMessage, "channelPhoneNumberId">) {
  const configuredPhoneNumberId = getWhatsAppChannelConfig().phoneNumberId;
  return !message.channelPhoneNumberId || !configuredPhoneNumberId || message.channelPhoneNumberId === configuredPhoneNumberId;
}

export function resolveWhatsAppMessageOccurredAt(message: Pick<WhatsAppWebhookMessage, "timestamp">) {
  const parsed = Number(message.timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return new Date();
  }

  return new Date(String(message.timestamp).length <= 10 ? parsed * 1000 : parsed);
}

export function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeWhatsAppIntentText(value: string) {
  return stripDiacritics(value).toLowerCase().trim();
}

export function getWhatsAppMessageTextBody(message: Pick<WhatsAppWebhookMessage, "text" | "image">) {
  return message.text?.body?.trim() || message.image?.caption?.trim() || "";
}

/**
 * ID opaco de uma resposta de botão ou lista interativa (issue #782). Não é texto
 * livre do usuário: nunca deve ser reinterpretado como comando textual nem passado
 * ao fallback nutricional. A resolução vive em `interactiveCallback.ts`.
 */
export function getWhatsAppInteractiveReplyId(message: Pick<WhatsAppWebhookMessage, "interactive">): string | null {
  return message.interactive?.button_reply?.id?.trim() || message.interactive?.list_reply?.id?.trim() || null;
}

export function isWhatsAppInteractiveReplyMessage(message: Pick<WhatsAppWebhookMessage, "interactive">) {
  return Boolean(getWhatsAppInteractiveReplyId(message));
}

export async function sendWhatsAppImageMessage(to: string, imageUrl: string, caption: string) {
  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para envio de imagem.",
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
        image: {
          link: imageUrl,
          caption,
        },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: `Meta retornou ${response.status} ${response.statusText} no envio da imagem anotada.`,
      };
    }

    return { ok: true, detail: "Imagem anotada enviada com sucesso." };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar imagem anotada do WhatsApp.",
    };
  }
}

export async function sendWhatsAppImageBufferMessage(
  to: string,
  image: { buffer: Buffer; mimeType?: string; fileName?: string },
  caption: string,
) {
  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para envio de imagem.",
    };
  }

  const mimeType = image.mimeType || "image/png";
  const fileName = image.fileName || `whatsapp-annotated-meal.${extensionFromMimeType(mimeType)}`;

  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([new Uint8Array(image.buffer)], { type: mimeType }), fileName);

    const uploadResponse = await fetch(`https://graph.facebook.com/v22.0/${config.phoneNumberId}/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
      body: form,
    });

    if (!uploadResponse.ok) {
      return {
        ok: false,
        detail: `Meta retornou ${uploadResponse.status} ${uploadResponse.statusText} no upload da imagem anotada.`,
      };
    }

    const uploadPayload = await uploadResponse.json() as { id?: string };
    if (!uploadPayload.id) {
      return {
        ok: false,
        detail: "Meta não retornou ID da mídia no upload da imagem anotada.",
      };
    }

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
        image: {
          id: uploadPayload.id,
          caption,
        },
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: `Meta retornou ${response.status} ${response.statusText} no envio da imagem anotada por upload.`,
      };
    }

    return { ok: true, detail: "Imagem anotada enviada por upload com sucesso." };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar imagem anotada do WhatsApp por upload.",
    };
  }
}

export async function markWhatsAppMessageAsRead(messageId?: string) {
  if (!messageId) {
    return { ok: true, detail: "Mensagem sem ID para marcar como lida." };
  }

  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para marcar mensagem como lida.",
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
        status: "read",
        message_id: messageId,
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: `Meta retornou ${response.status} ${response.statusText} ao marcar mensagem como lida.`,
      };
    }

    return { ok: true, detail: "Mensagem marcada como lida." };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao marcar mensagem do WhatsApp como lida.",
    };
  }
}

export async function getWhatsAppMediaDownloadUrl(mediaId: string) {
  const { accessToken } = await requireWhatsAppMediaConfig();

  const response = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Falha ao obter URL da mídia do WhatsApp: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as { url?: string; mime_type?: string };
  if (!payload.url) {
    throw new Error("A API do WhatsApp não retornou a URL da mídia.");
  }

  return { url: payload.url, mimeType: payload.mime_type };
}

export async function downloadWhatsAppMedia(mediaId: string, fallbackMimeType?: string) {
  const { accessToken } = await requireWhatsAppMediaConfig();

  const meta = await getWhatsAppMediaDownloadUrl(mediaId);
  const response = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Falha ao baixar mídia do WhatsApp: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    mimeType: response.headers.get("content-type") || meta.mimeType || fallbackMimeType || "application/octet-stream",
  };
}

export function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("wav")) return "wav";
  return "bin";
}

export function buildMediaDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export async function sendWhatsAppInteractiveUrlButtonMessage(
  to: string,
  bodyText: string,
  buttonDisplayText: string,
  buttonUrl: string,
): Promise<WhatsAppProviderSendResult> {
  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      failureCategory: "config",
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para envio de mensagem interativa.",
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
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: bodyText },
          action: {
            name: "cta_url",
            parameters: {
              display_text: buttonDisplayText,
              url: buttonUrl,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return {
        ok: false,
        failureCategory: "provider",
        status: response.status,
        statusText: response.statusText,
        errorBody,
        detail: `Meta retornou ${response.status} ${response.statusText}: ${errorBody} no envio da mensagem interativa.`,
      };
    }

    return { ok: true, detail: "Mensagem interativa enviada com sucesso." };
  } catch (error) {
    return {
      ok: false,
      failureCategory: "network",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar mensagem interativa do WhatsApp.",
    };
  }
}

export type WhatsAppInteractiveButtonSpec = { id: string; title: string };
export type WhatsAppInteractiveListRowSpec = { id: string; title: string; description?: string };
export type WhatsAppInteractiveListSectionSpec = { title?: string; rows: WhatsAppInteractiveListRowSpec[] };

export async function sendWhatsAppInteractiveButtonsMessage(
  to: string,
  bodyText: string,
  buttons: WhatsAppInteractiveButtonSpec[],
): Promise<WhatsAppProviderSendResult> {
  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      failureCategory: "config",
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para envio de botões.",
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
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: {
            buttons: buttons.map(button => ({
              type: "reply",
              reply: { id: button.id, title: button.title },
            })),
          },
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return {
        ok: false,
        failureCategory: "provider",
        status: response.status,
        statusText: response.statusText,
        errorBody,
        detail: `Meta retornou ${response.status} ${response.statusText}: ${errorBody} no envio dos botões.`,
      };
    }

    return { ok: true, detail: "Botões enviados com sucesso." };
  } catch (error) {
    return {
      ok: false,
      failureCategory: "network",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar botões do WhatsApp.",
    };
  }
}

export async function sendWhatsAppInteractiveListMessage(
  to: string,
  bodyText: string,
  buttonText: string,
  sections: WhatsAppInteractiveListSectionSpec[],
): Promise<WhatsAppProviderSendResult> {
  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      failureCategory: "config",
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para envio de lista.",
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
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: bodyText },
          action: {
            button: buttonText,
            sections: sections.map(section => ({
              ...(section.title ? { title: section.title } : {}),
              rows: section.rows.map(row => ({
                id: row.id,
                title: row.title,
                ...(row.description ? { description: row.description } : {}),
              })),
            })),
          },
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return {
        ok: false,
        failureCategory: "provider",
        status: response.status,
        statusText: response.statusText,
        errorBody,
        detail: `Meta retornou ${response.status} ${response.statusText}: ${errorBody} no envio da lista.`,
      };
    }

    return { ok: true, detail: "Lista enviada com sucesso." };
  } catch (error) {
    return {
      ok: false,
      failureCategory: "network",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar lista do WhatsApp.",
    };
  }
}

export async function sendWhatsAppTextMessage(to: string, body: string): Promise<WhatsAppProviderSendResult> {
  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
      failureCategory: "config",
      detail: error instanceof Error ? error.message : "Credenciais do WhatsApp não configuradas para envio de resposta.",
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
        type: "text",
        text: {
          preview_url: false,
          body,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return {
        ok: false,
        failureCategory: "provider",
        status: response.status,
        statusText: response.statusText,
        errorBody,
        detail: `Meta retornou ${response.status} ${response.statusText}: ${errorBody} no envio da resposta automática.`,
      };
    }

    return { ok: true, detail: "Resposta automática enviada com sucesso." };
  } catch (error) {
    return {
      ok: false,
      failureCategory: "network",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar resposta automática do WhatsApp.",
    };
  }
}
