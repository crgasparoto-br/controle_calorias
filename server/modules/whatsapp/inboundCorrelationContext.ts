import { AsyncLocalStorage } from "node:async_hooks";

type WhatsappInboundCorrelationScope = {
  externalMessageId: string | null;
};

const inboundCorrelationScope = new AsyncLocalStorage<WhatsappInboundCorrelationScope>();

export function runWithWhatsappInboundCorrelationScope<T>(operation: () => T): T {
  if (inboundCorrelationScope.getStore()) return operation();
  return inboundCorrelationScope.run({ externalMessageId: null }, operation);
}

export function setCurrentWhatsappInboundExternalMessageId(messageId?: string | null) {
  const scope = inboundCorrelationScope.getStore();
  if (scope) scope.externalMessageId = messageId?.trim() || null;
}

export function getCurrentWhatsappInboundExternalMessageId() {
  return inboundCorrelationScope.getStore()?.externalMessageId ?? null;
}
