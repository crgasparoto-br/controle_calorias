export type MessageDeduplicationCache = {
  wasAlreadyHandled: (messageId?: string) => boolean;
  markHandled: (messageId?: string) => void;
  clear: () => void;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function createMessageDeduplicationCache(ttlMs = DEFAULT_TTL_MS): MessageDeduplicationCache {
  const expiresAtByMessageId = new Map<string, number>();

  function prune(now = Date.now()) {
    for (const [messageId, expiresAt] of expiresAtByMessageId) {
      if (expiresAt <= now) {
        expiresAtByMessageId.delete(messageId);
      }
    }
  }

  return {
    wasAlreadyHandled(messageId) {
      if (!messageId) {
        return false;
      }

      const now = Date.now();
      prune(now);
      return expiresAtByMessageId.has(messageId);
    },
    markHandled(messageId) {
      if (messageId) {
        expiresAtByMessageId.set(messageId, Date.now() + ttlMs);
      }
    },
    clear() {
      expiresAtByMessageId.clear();
    },
  };
}
