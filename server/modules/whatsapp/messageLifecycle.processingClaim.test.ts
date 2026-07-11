import { describe, expect, it, vi } from "vitest";
import { createMessageLifecycleService } from "./messageLifecycle";

function createConversationRepository() {
  return {
    createOrGetActiveConversation: vi.fn(),
    appendMessage: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    linkResponse: vi.fn(),
    linkDomainRecord: vi.fn(),
    findRecentMessages: vi.fn(),
    findRecentMessagesByUser: vi.fn(),
    findMessagesBefore: vi.fn(),
    findDomainLinksForMessage: vi.fn(async () => []),
    markProcessed: vi.fn(),
    insertConversationSummary: vi.fn(),
    findLatestConversationSummary: vi.fn(),
    purgeExpiredRawText: vi.fn(),
    purgeExpiredSanitizedText: vi.fn(),
    purgeExpiredAuditRows: vi.fn(),
  };
}

describe("messageLifecycle persistent processing claim", () => {
  it("aceita inserção nova sem consultar lease", async () => {
    const claim = vi.fn();
    const service = createMessageLifecycleService({
      conversationRepository: createConversationRepository() as never,
      processingClaimRepository: { claimStaleUnprocessedMessage: claim },
    });

    await expect(service.claimMessageForProcessing({ conversationId: 1, messageId: 2, wasNewInsert: true })).resolves.toBe(true);
    expect(claim).not.toHaveBeenCalled();
  });

  it("delega reentrega ao compare-and-set persistente com prazo do lease", async () => {
    const claim = vi.fn(async () => true);
    const service = createMessageLifecycleService({
      conversationRepository: createConversationRepository() as never,
      processingClaimRepository: { claimStaleUnprocessedMessage: claim },
      processingLeaseMs: 60_000,
    });
    const now = new Date("2026-07-11T01:00:00.000Z");

    await expect(service.claimMessageForProcessing({ conversationId: 1, messageId: 2, wasNewInsert: false }, now)).resolves.toBe(true);
    expect(claim).toHaveBeenCalledWith(
      2,
      new Date("2026-07-11T00:59:00.000Z"),
      now,
    );
  });

  it("bloqueia reentrega quando a persistência não concede propriedade", async () => {
    const service = createMessageLifecycleService({
      conversationRepository: createConversationRepository() as never,
      processingClaimRepository: { claimStaleUnprocessedMessage: vi.fn(async () => false) },
    });

    await expect(service.claimMessageForProcessing({ conversationId: 1, messageId: 2, wasNewInsert: false })).resolves.toBe(false);
  });
});
