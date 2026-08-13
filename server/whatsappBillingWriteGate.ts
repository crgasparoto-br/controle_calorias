import { getUserIdByWhatsappPhone } from "./db";
import { billingService } from "./modules/billing/service";
import { canUseBillingWriteAccess } from "./modules/billing/types";
import { buildWhatsAppReadOnlyAccessReplyMessage } from "./modules/billing/whatsappAccessReply";
import {
  beginInboundMessage,
  claimMessageForProcessing,
  markMessageProcessed,
} from "./modules/whatsapp/messageLifecycle";
import { sendWhatsAppLogicalDomainReply } from "./modules/whatsapp/logicalReplyDelivery";
import {
  extractIndexedWhatsAppWebhookMessages,
  resolveWhatsAppMessageOccurredAt,
  type IndexedWhatsAppWebhookMessage,
  type WhatsAppWebhookMessage,
} from "./modules/whatsapp/webhookUtils";

function resolveContentType(message: WhatsAppWebhookMessage) {
  if (message.image?.id && message.audio?.id) return "multimodal" as const;
  if (message.image?.id) return "image" as const;
  if (message.audio?.id) return "audio" as const;
  return "text" as const;
}

function clonePayloadWithoutKeys(payload: unknown, handledKeys: Set<string>) {
  const cloned = structuredClone(payload as any);
  const entries = Array.isArray(cloned?.entry) ? cloned.entry : [];
  cloned.entry = entries
    .map((entry: any, entryIndex: number) => {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      const filteredChanges = changes
        .map((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages)
            ? change.value.messages
            : [];
          const filteredMessages = messages.filter(
            (_message: WhatsAppWebhookMessage, messageIndex: number) =>
              !handledKeys.has(`${entryIndex}:${changeIndex}:${messageIndex}`)
          );
          return {
            ...change,
            value: { ...change.value, messages: filteredMessages },
          };
        })
        .filter((change: any) => change.value.messages.length > 0);
      return { ...entry, changes: filteredChanges };
    })
    .filter((entry: any) => entry.changes.length > 0);
  return cloned;
}

async function handleReadOnlyMessage(item: IndexedWhatsAppWebhookMessage) {
  const message = item.message;
  if (!message.from) return false;
  const userId = await getUserIdByWhatsappPhone(message.from);
  if (!userId) return false;

  const access = await billingService.getUserEntitlements(userId);
  if (canUseBillingWriteAccess(access)) return false;
  if (access.reason !== "read_only_access") return false;

  const lifecycleHandle = await beginInboundMessage({
    userId,
    whatsappConnectionId: null,
    phoneNumber: message.from,
    externalMessageId: message.id ?? null,
    contentType: resolveContentType(message),
    text: null,
    captionText: null,
    occurredAt: resolveWhatsAppMessageOccurredAt(message),
    allowRawContentStorage: false,
  });
  if (!(await claimMessageForProcessing(lifecycleHandle))) return true;

  await sendWhatsAppLogicalDomainReply({
    to: message.from,
    userId,
    replyText: buildWhatsAppReadOnlyAccessReplyMessage(),
    lifecycleHandle,
  });
  await markMessageProcessed(lifecycleHandle);
  return true;
}

export async function gateSuspendedWhatsAppWrites(payload: unknown) {
  const messages = extractIndexedWhatsAppWebhookMessages(payload);
  const handledKeys = new Set<string>();

  for (const item of messages) {
    if (await handleReadOnlyMessage(item)) handledKeys.add(item.key);
  }

  return {
    handledCount: handledKeys.size,
    remainingPayload:
      handledKeys.size > 0 ? clonePayloadWithoutKeys(payload, handledKeys) : payload,
  };
}
