import { describe, expect, it, vi } from "vitest";
import { ensureCurrentIrreversibleEffectAllowed } from "../../_core/effectFenceContext";
import {
  claimMessageForProcessing,
  claimMessageForProcessingState,
  createMessageLifecycleService,
  markMessageProcessed,
  withMessageLifecycleService,
} from "./messageLifecycle";

function createConversationRepository() {
  return {
    createOrGetActiveConversation: vi.fn(),
    appendMessage: vi.fn(),
    findByIdempotencyKey: vi.fn(async () => null),
    linkResponse: vi.fn(),
    linkDomainRecord: vi.fn(),
    markProcessed: vi.fn(),
    findRecentMessages: vi.fn(),
    findRecentMessagesByUser: vi.fn(),
    findMessagesBefore: vi.fn(),
    findDomainLinksForMessage: vi.fn(async () => []),
    insertConversationSummary: vi.fn(),
    findLatestConversationSummary: vi.fn(),
    purgeExpiredRawText: vi.fn(),
    purgeExpiredSanitizedText: vi.fn(),
    purgeExpiredAuditRows: vi.fn(),
  };
}

function createSharedOwnerRepository() {
  const state = { ownerToken: null as string | null, heartbeatAt: null as Date | null };
  return {
    state,
    repository: {
      claimStaleUnprocessedMessage: vi.fn(async () => false),
      async claimUnprocessedMessage(_messageId: number, ownerToken: string, staleBefore: Date, claimedAt = new Date()) {
        if (!state.ownerToken || (state.heartbeatAt && state.heartbeatAt < staleBefore)) {
          const decision = state.ownerToken ? "recovered" as const : "claimed" as const;
          state.ownerToken = ownerToken;
          state.heartbeatAt = claimedAt;
          return { state: decision, ownerToken, heartbeatAt: claimedAt };
        }
        return { state: "inflight" as const, heartbeatAt: state.heartbeatAt };
      },
      async heartbeatOwnedUnprocessedMessage(_messageId: number, ownerToken: string, heartbeatAt = new Date()) {
        if (state.ownerToken !== ownerToken) return false;
        state.heartbeatAt = heartbeatAt;
        return true;
      },
      async completeOwnedMessageClaim(_messageId: number, ownerToken: string) {
        return state.ownerToken === ownerToken;
      },
    },
  };
}

describe("RESTART-FENCE-001 lifecycle effect fencing", () => {
  it("rejects an irreversible effect when runtime A resumes after runtime B takes over", async () => {
    const shared = createSharedOwnerRepository();
    const runtimeA = createMessageLifecycleService({
      conversationRepository: createConversationRepository() as never,
      processingClaimRepository: shared.repository,
      processingHeartbeatTimeoutMs: 20,
      processingHeartbeatIntervalMs: 10_000,
      ownerTokenFactory: () => "runtime-a",
    });
    const runtimeB = createMessageLifecycleService({
      conversationRepository: createConversationRepository() as never,
      processingClaimRepository: shared.repository,
      processingHeartbeatTimeoutMs: 20,
      processingHeartbeatIntervalMs: 10_000,
      ownerTokenFactory: () => "runtime-b",
    });
    const handle = { conversationId: 1, messageId: 91, wasNewInsert: true };
    let releaseA!: () => void;
    let signalA!: () => void;
    const aClaimed = new Promise<void>(resolve => { signalA = resolve; });
    const resumeA = new Promise<void>(resolve => { releaseA = resolve; });

    const staleAttempt = withMessageLifecycleService(runtimeA, async () => {
      expect(await claimMessageForProcessing(handle)).toBe(true);
      signalA();
      await resumeA;
      await ensureCurrentIrreversibleEffectAllowed();
    });

    await aClaimed;
    await new Promise(resolve => setTimeout(resolve, 30));
    await withMessageLifecycleService(runtimeB, async () => {
      await expect(claimMessageForProcessingState({ ...handle, wasNewInsert: false })).resolves.toBe("recovered");
    });
    expect(shared.state.ownerToken).toBe("runtime-b");

    releaseA();
    await expect(staleAttempt).rejects.toThrow("processing ownership is no longer available");
  });

  it("revalidates ownership at terminal processedAt flush", async () => {
    const shared = createSharedOwnerRepository();
    const repository = createConversationRepository();
    const runtimeA = createMessageLifecycleService({
      conversationRepository: repository as never,
      processingClaimRepository: shared.repository,
      processingHeartbeatTimeoutMs: 20,
      processingHeartbeatIntervalMs: 10_000,
      ownerTokenFactory: () => "runtime-a",
    });
    const handle = { conversationId: 1, messageId: 92, wasNewInsert: true };

    await expect(withMessageLifecycleService(runtimeA, async () => {
      expect(await claimMessageForProcessing(handle)).toBe(true);
      await markMessageProcessed(handle, new Date("2026-09-12T20:00:00.000Z"));
      shared.state.ownerToken = "runtime-b";
    })).rejects.toThrow("processing ownership is no longer available");

    expect(repository.markProcessed).not.toHaveBeenCalled();
  });
});
