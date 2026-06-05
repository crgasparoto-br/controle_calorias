import { getWhatsAppChannelConfig, requireWhatsAppSendConfig } from "../../whatsappConfig";

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

export function formatDateKeyInSaoPaulo(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function normalizeWhatsAppIntentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export async function sendWhatsAppTextMessage(to: string, body: string) {
  let config;
  try {
    config = await requireWhatsAppSendConfig();
  } catch (error) {
    return {
      ok: false,
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
      return {
        ok: false,
        detail: `Meta retornou ${response.status} ${response.statusText} no envio da resposta automática.`,
      };
    }

    return { ok: true, detail: "Resposta automática enviada com sucesso." };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar resposta automática do WhatsApp.",
    };
  }
}
