import type { DomainLinkInput } from "../../repositories/whatsappConversationRepository";

export type WhatsAppDeferredLogicalReply = {
  prefixBlocks: string[];
  domainLinks: DomainLinkInput[];
};

const deferredByRequest = new WeakMap<object, Map<string, WhatsAppDeferredLogicalReply>>();

function getMessageKey(externalMessageId?: string | null) {
  return externalMessageId?.trim() || null;
}

export function setWhatsAppDeferredLogicalReply(
  request: object,
  externalMessageId: string | null | undefined,
  deferred: WhatsAppDeferredLogicalReply,
) {
  const key = getMessageKey(externalMessageId);
  if (!key) return;
  const map = deferredByRequest.get(request) ?? new Map<string, WhatsAppDeferredLogicalReply>();
  map.set(key, deferred);
  deferredByRequest.set(request, map);
}

export function getWhatsAppDeferredLogicalReply(
  request: object,
  externalMessageId: string | null | undefined,
): WhatsAppDeferredLogicalReply | null {
  const key = getMessageKey(externalMessageId);
  if (!key) return null;
  return deferredByRequest.get(request)?.get(key) ?? null;
}

export function composeWhatsAppDeferredReplyText(
  deferred: WhatsAppDeferredLogicalReply | null | undefined,
  finalText: string,
) {
  const blocks = [...(deferred?.prefixBlocks ?? []), finalText]
    .map(block => block.trim())
    .filter(Boolean);
  return blocks.join("\n\n");
}
