import { describe, expect, it } from "vitest";
import { createMessageDeduplicationCache } from "./messageDeduplicationCache";
import {
  beginInboundMessage,
  claimMessageForProcessing,
  createMessageLifecycleService,
  runWithMessageLifecycleRequestScope,
  withMessageLifecycleService,
} from "./messageLifecycle";

function createService() {
  return createMessageLifecycleService({
    conversationRepository: {
      createOrGetActiveConversation: async () => ({ id: 1 }),
      appendMessage: async () => ({
        message: { id: 2 },
        wasNewInsert: false,
      }),
      findDomainLinksForMessage: async () => [],
      markProcessed: async () => undefined,
    } as never,
    processingClaimRepository: {
      claimStaleUnprocessedMessage: async () => true,
    },
  });
}

describe("messageDeduplicationCache", () => {
  it("não bloqueia retry que recebeu propriedade persistente", async () => {
    const cache = createMessageDeduplicationCache();
    cache.markHandled("wamid-retry");
    expect(cache.wasAlreadyHandled("wamid-retry")).toBe(true);

    await runWithMessageLifecycleRequestScope(() =>
      withMessageLifecycleService(createService(), async () => {
        const handle = await beginInboundMessage({
          userId: 1,
          whatsappConnectionId: null,
          phoneNumber: "5511000000000",
          externalMessageId: "wamid-retry",
          contentType: "image",
          occurredAt: new Date(),
        });
        expect(await claimMessageForProcessing(handle)).toBe(true);
        expect(cache.wasAlreadyHandled("wamid-retry")).toBe(false);
      }),
    );
  });
});
