import { AsyncLocalStorage } from "node:async_hooks";

type AiUsageScope = {
  userId: number;
  conversationId: string | null;
};

const aiUsageScope = new AsyncLocalStorage<AiUsageScope>();

export function runWithAiUsageScope<T>(
  input: { userId: number; conversationId?: string | null },
  operation: () => T,
): T {
  return aiUsageScope.run(
    {
      userId: input.userId,
      conversationId: input.conversationId?.trim() || null,
    },
    operation,
  );
}

export function getCurrentAiUsageScope(): AiUsageScope | null {
  return aiUsageScope.getStore() ?? null;
}
