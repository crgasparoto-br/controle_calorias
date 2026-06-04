import { Request, Response } from "express";
import { executeWhatsappTextIntent } from "./modules/whatsapp/intentActions";
import { getUserIdByWhatsappPhone, logInferenceEvent } from "./db";
import { getWhatsAppChannelConfig, requireWhatsAppSendConfig } from "./whatsappConfig";
import { handleWhatsAppWebhookWithAnnotatedImages } from "./whatsappAnnotatedImageWebhook";

type WhatsAppMessage = {
  id?: string;
  from?: string;
  channelPhoneNumberId?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  audio?: { id?: string };
};

type ExtractedWhatsAppMessage = WhatsAppMessage & {
  entryIndex: number;
  changeIndex: number;
  messageIndex: number;
};

const recentlyHandledTextIntentMessageIds = new Map<string, number>();
const pendingTextIntentContexts = new Map<number, { kind: "period_report"; expiresAt: number }>();
const TEXT_INTENT_DEDUPLICATION_TTL_MS = 24 * 60 * 60 * 1000;
const TEXT_INTENT_CONTEXT_TTL_MS = 10 * 60 * 1000;

function extractMessages(payload: any): ExtractedWhatsAppMessage[] {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries.flatMap((entry: any, entryIndex: number) =>
    Array.isArray(entry?.changes)
      ? entry.changes.flatMap((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          return messages.map((message: WhatsAppMessage, messageIndex: number) => ({
            ...message,
            entryIndex,
            changeIndex,
            messageIndex,
            channelPhoneNumberId: change?.value?.metadata?.phone_number_id,
          }));
        })
      : [],
  );
}

function isMessageForConfiguredChannel(message: WhatsAppMessage) {
  const configuredPhoneNumberId = getWhatsAppChannelConfig().phoneNumberId;
  return !message.channelPhoneNumberId || !configuredPhoneNumberId || message.channelPhoneNumberId === configuredPhoneNumberId;
}

function resolveOccurredAt(message: WhatsAppMessage) {
  const parsed = Number(message.timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return new Date();
  }

  return new Date(String(message.timestamp).length <= 10 ? parsed * 1000 : parsed);
}

function getTextBody(message: WhatsAppMessage) {
  return message.text?.body?.trim() || "";
}

function canInterpretTextIntent(message: WhatsAppMessage) {
  return Boolean(getTextBody(message) && !message.image?.id && !message.audio?.id);
}

function getExtractedMessageKey(message: ExtractedWhatsAppMessage) {
  return `${message.entryIndex}:${message.changeIndex}:${message.messageIndex}`;
}

function pruneRecentlyHandledTextIntentMessageIds(now = Date.now()) {
  for (const [messageId, expiresAt] of recentlyHandledTextIntentMessageIds) {
    if (expiresAt <= now) {
      recentlyHandledTextIntentMessageIds.delete(messageId);
    }
  }
}

function wasTextIntentMessageAlreadyHandled(messageId?: string) {
  if (!messageId) {
    return false;
  }

  const now = Date.now();
  pruneRecentlyHandledTextIntentMessageIds(now);
  return recentlyHandledTextIntentMessageIds.has(messageId);
}

function markTextIntentMessageHandled(messageId?: string) {
  if (messageId) {
    recentlyHandledTextIntentMessageIds.set(messageId, Date.now() + TEXT_INTENT_DEDUPLICATION_TTL_MS);
  }
}

function getPendingTextIntentContext(userId: number) {
  const pending = pendingTextIntentContexts.get(userId);
  if (!pending) return null;

  if (pending.expiresAt <= Date.now()) {
    pendingTextIntentContexts.delete(userId);
    return null;
  }

  return pending;
}

function rememberPendingTextIntentContext(userId: number, result: NonNullable<Awaited<ReturnType<typeof executeWhatsappTextIntent>>>) {
  if (result.action === "clarification_needed" && result.detail === "Pedido de relatório sem período explícito.") {
    pendingTextIntentContexts.set(userId, {
      kind: "period_report",
      expiresAt: Date.now() + TEXT_INTENT_CONTEXT_TTL_MS,
    });
    return;
  }

  pendingTextIntentContexts.delete(userId);
}

export function __resetWhatsAppTextIntentContextForTests() {
  pendingTextIntentContexts.clear();
  recentlyHandledTextIntentMessageIds.clear();
}

async function sendWhatsAppTextMessage(to: string, body: string) {
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

    return {
      ok: true,
      detail: "Resposta automática enviada com sucesso.",
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Falha desconhecida ao enviar resposta automática do WhatsApp.",
    };
  }
}

async function tryHandleTextIntent(message: ExtractedWhatsAppMessage) {
  const sourcePhone = message.from || "unknown";
  if (!isMessageForConfiguredChannel(message) || !canInterpretTextIntent(message)) {
    return false;
  }

  if (wasTextIntentMessageAlreadyHandled(message.id)) {
    return true;
  }

  const userId = await getUserIdByWhatsappPhone(sourcePhone);
  if (!userId) {
    return false;
  }

  const text = getTextBody(message);
  const pendingContext = getPendingTextIntentContext(userId);
  const textForIntent = pendingContext?.kind === "period_report" ? `Resumo ${text}` : text;

  const result = await executeWhatsappTextIntent(userId, {
    text: textForIntent,
    receivedAt: resolveOccurredAt(message),
  });
  if (!result) {
    return false;
  }

  markTextIntentMessageHandled(message.id);
  rememberPendingTextIntentContext(userId, result);

  logInferenceEvent({
    userId,
    origin: "whatsapp",
    status: result.action === "clarification_needed" ? "warning" : "success",
    eventType: result.eventType,
    detail: result.detail,
  });

  const replyResult = await sendWhatsAppTextMessage(sourcePhone, result.reply);
  if (!replyResult.ok) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.reply_failed",
      detail: `Falha ao enviar resposta automática para ${sourcePhone}: ${replyResult.detail}`,
    });
  }

  return true;
}

function clonePayloadWithoutHandledMessages(payload: any, handledMessageKeys: Set<string>) {
  const cloned = structuredClone(payload);
  const entries = Array.isArray(cloned?.entry) ? cloned.entry : [];
  cloned.entry = entries
    .map((entry: any, entryIndex: number) => {
      if (!Array.isArray(entry?.changes)) {
        return entry;
      }

      const changes = entry.changes
        .map((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          const pendingMessages = messages.filter(
            (_message: WhatsAppMessage, messageIndex: number) => !handledMessageKeys.has(`${entryIndex}:${changeIndex}:${messageIndex}`),
          );
          return {
            ...change,
            value: {
              ...change.value,
              messages: pendingMessages,
            },
          };
        })
        .filter((change: any) => Array.isArray(change?.value?.messages) && change.value.messages.length > 0);

      return {
        ...entry,
        changes,
      };
    })
    .filter((entry: any) => Array.isArray(entry?.changes) && entry.changes.length > 0);

  return cloned;
}

export async function handleWhatsAppWebhookWithTextIntent(req: Request, res: Response) {
  const messages = extractMessages(req.body);
  if (!messages.length) {
    return handleWhatsAppWebhookWithAnnotatedImages(req, res);
  }

  const handledMessageKeys = new Set<string>();
  for (const message of messages) {
    const handled = await tryHandleTextIntent(message);
    if (handled) {
      handledMessageKeys.add(getExtractedMessageKey(message));
    }
  }

  if (!handledMessageKeys.size) {
    return handleWhatsAppWebhookWithAnnotatedImages(req, res);
  }

  const remainingPayload = clonePayloadWithoutHandledMessages(req.body, handledMessageKeys);
  if (!Array.isArray(remainingPayload?.entry) || remainingPayload.entry.length === 0) {
    return res.status(200).json({ ok: true, processed: messages.length });
  }

  req.body = remainingPayload;
  return handleWhatsAppWebhookWithAnnotatedImages(req, res);
}
