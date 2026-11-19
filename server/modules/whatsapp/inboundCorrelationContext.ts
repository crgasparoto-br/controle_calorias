import { AsyncLocalStorage } from "node:async_hooks";

/** Set only by the authenticated message lifecycle, never from text/LLM. */
export type TrustedWhatsAppContentType = "text" | "audio" | "image" | "multimodal" | "system";
type WhatsappInboundCorrelationScope = {
  externalMessageId: string | null;
  contentType: TrustedWhatsAppContentType | null;
};

const inboundCorrelationScope = new AsyncLocalStorage<WhatsappInboundCorrelationScope>();

export function runWithWhatsappInboundCorrelationScope<T>(operation: () => T): T {
  if (inboundCorrelationScope.getStore()) return operation();
  return inboundCorrelationScope.run({ externalMessageId: null, contentType: null }, operation);
}

export function setCurrentWhatsappInboundExternalMessageId(messageId?: string | null) {
  const scope = inboundCorrelationScope.getStore();
  if (scope) scope.externalMessageId = messageId?.trim() || null;
}

export function getCurrentWhatsappInboundExternalMessageId() {
  return inboundCorrelationScope.getStore()?.externalMessageId ?? null;
}

/** The inbound transport fixes provenance before any intent or nutrition routing. */
export function setCurrentWhatsappInboundContentType(type: TrustedWhatsAppContentType) {
  const scope = inboundCorrelationScope.getStore();
  if (scope) scope.contentType = type;
}

export function getCurrentWhatsappInboundContentType(): TrustedWhatsAppContentType | null {
  return inboundCorrelationScope.getStore()?.contentType ?? null;
}
