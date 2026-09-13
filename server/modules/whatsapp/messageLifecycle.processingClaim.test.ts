import { describe, expect, it, vi } from "vitest";
import {
  claimMessageForProcessing,
  claimMessageForProcessingState,
  createMessageLifecycleService,
  ensureMessageProcessingOwnership,
  markMessageProcessed,
  withMessageLifecycleService,
} from "./messageLifecycle";
import {
  beginCurrentQuestionLatencyTrace,
  recordCurrentQuestionDeliveryOutcome,
  runWithQuestionLatencyContext,
} from "./questionLatencyContext";

function createConversationRepository() {
  return {
    createOrGetActiveConversation: vi.fn(),
    appendMessage: vi.fn(),
    findByIdempotencyKey: vi.fn(async () => null),
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
  it("aceita inserção nova sem consultar lease legado", async () => {
    const claim = vi.fn();
    const service = createMessageLifecycleService({
      conversationRepository: createConversationRepository() as never,
      processingClaimRepository: { claimStaleUnprocessedMessage: claim },
    });

    await expect(service.claimMessageForProcessing({ conversationId: 1, messageId: 2, wasNewInsert: true })).resolves.toBe(true);
    expect(claim).not.toHaveBeenCalled();
  });

  it("delega reentrega legada ao compare-and-set persistente com prazo do lease", async () => {
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

  it("prefere owner persistente e distingue retomada órfã de inflight", async () => {
    const claimUnprocessedMessage = vi
      .fn()
      .mockResolvedValueOnce({ state: "inflight", heartbeatAt: new Date("2026-07-11T00:59:59.000Z") })
      .mockResolvedValueOnce({ state: "recovered", ownerToken: "owner-b" });
    const service = createMessageLifecycleService({
      conversationRepository: createConversationRepository() as never,
      processingClaimRepository: {
        claimStaleUnprocessedMessage: vi.fn(async () => false),
        claimUnprocessedMessage,
      },
      processingHeartbeatTimeoutMs: 30_000,
      ownerTokenFactory: () => "owner-b",
    });
    const now = new Date("2026-07-11T01:00:00.000Z");
    const handle = { conversationId: 1, messageId: 2, wasNewInsert: false };

    await expect(service.claimMessageForProcessingState(handle, now)).resolves.toEqual({ status: "inflight", ownerToken: undefined });
    await expect(service.claimMessageForProcessingState(handle, now)).resolves.toEqual({ status: "recovered", ownerToken: "owner-b" });
    expect(claimUnprocessedMessage).toHaveBeenNthCalledWith(
      1,
      2,
      "owner-b",
      new Date("2026-07-11T00:59:30.000Z"),
      now,
    );
  });

  it("renova, conclui e libera somente o owner persistente do escopo", async () => {
    const heartbeat = vi.fn(async () => true);
    const complete = vi.fn(async () => true);
    const release = vi.fn(async () => true);
    const repository = createConversationRepository();
    const service = createMessageLifecycleService({
      conversationRepository: repository as never,
      processingClaimRepository: {
        claimStaleUnprocessedMessage: vi.fn(async () => false),
        claimUnprocessedMessage: vi.fn(async () => ({ state: "claimed", ownerToken: "owner-a" as const })),
        heartbeatOwnedUnprocessedMessage: heartbeat,
        releaseOwnedUnprocessedMessage: release,
        completeOwnedMessageClaim: complete,
      },
      processingHeartbeatTimeoutMs: 100,
      processingHeartbeatIntervalMs: 25,
      ownerTokenFactory: () => "owner-a",
    });
    const handle = { conversationId: 1, messageId: 2, wasNewInsert: true };

    await withMessageLifecycleService(service, async () => {
      expect(await claimMessageForProcessing(handle)).toBe(true);
      await ensureMessageProcessingOwnership(handle);
      await markMessageProcessed(handle, new Date("2026-07-11T01:00:00.000Z"));
    });

    expect(heartbeat).toHaveBeenCalledWith(2, "owner-a", expect.any(Date));
    expect(repository.markProcessed).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(2, "owner-a");
    expect(release).not.toHaveBeenCalled();
  });

  it("mantém claim persistido quando o runtime termina abruptamente e permite takeover após heartbeat stale", async () => {
    const persistent = {
      ownerToken: null as string | null,
      heartbeatAt: null as Date | null,
    };
    const createOwnerRepository = () => ({
      claimStaleUnprocessedMessage: vi.fn(async () => false),
      async claimUnprocessedMessage(_messageId: number, ownerToken: string, staleBefore: Date, claimedAt = new Date()) {
        if (!persistent.ownerToken) {
          persistent.ownerToken = ownerToken;
          persistent.heartbeatAt = claimedAt;
          return { state: "claimed" as const, ownerToken, heartbeatAt: claimedAt };
        }
        if (persistent.heartbeatAt && persistent.heartbeatAt < staleBefore) {
          persistent.ownerToken = ownerToken;
          persistent.heartbeatAt = claimedAt;
          return { state: "recovered" as const, ownerToken, heartbeatAt: claimedAt };
        }
        return { state: "inflight" as const, heartbeatAt: persistent.heartbeatAt };
      },
      async heartbeatOwnedUnprocessedMessage(_messageId: number, ownerToken: string, heartbeatAt = new Date()) {
        if (persistent.ownerToken !== ownerToken) return false;
        persistent.heartbeatAt = heartbeatAt;
        return true;
      },
      async releaseOwnedUnprocessedMessage(_messageId: number, ownerToken: string) {
        if (persistent.ownerToken !== ownerToken) return false;
        persistent.ownerToken = null;
        persistent.heartbeatAt = null;
        return true;
      },
      async completeOwnedMessageClaim(_messageId: number, ownerToken: string) {
        if (persistent.ownerToken !== ownerToken) return false;
        persistent.ownerToken = null;
        persistent.heartbeatAt = null;
        return true;
      },
    });
    const runtimeA = createMessageLifecycleService({
      conversationRepository: createConversationRepository() as never,
      processingClaimRepository: createOwnerRepository(),
      processingHeartbeatTimeoutMs: 30,
      processingHeartbeatIntervalMs: 10,
      ownerTokenFactory: () => "runtime-a",
    });
    const runtimeB = createMessageLifecycleService({
      conversationRepository: createConversationRepository() as never,
      processingClaimRepository: createOwnerRepository(),
      processingHeartbeatTimeoutMs: 30,
      processingHeartbeatIntervalMs: 10,
      ownerTokenFactory: () => "runtime-b",
    });
    const firstHandle = { conversationId: 1, messageId: 9, wasNewInsert: true };
    const replayHandle = { conversationId: 1, messageId: 9, wasNewInsert: false };

    await expect(withMessageLifecycleService(runtimeA, async () => {
      expect(await claimMessageForProcessing(firstHandle)).toBe(true);
      throw new Error("simulated abrupt runtime termination");
    })).rejects.toThrow("simulated abrupt runtime termination");

    await withMessageLifecycleService(runtimeB, async () => {
      await expect(claimMessageForProcessingState(replayHandle)).resolves.toBe("inflight");
    });

    await new Promise(resolve => setTimeout(resolve, 35));

    await withMessageLifecycleService(runtimeB, async () => {
      await expect(claimMessageForProcessingState(replayHandle)).resolves.toBe("recovered");
    });
    expect(persistent.ownerToken).toBe("runtime-b");
  });

  it("libera mensagem não processada para reclaim imediato após falha de entrega", async () => {
    const release = vi.fn(async () => true);
    const service = createMessageLifecycleService({
      conversationRepository: createConversationRepository() as never,
      processingClaimRepository: {
        claimStaleUnprocessedMessage: vi.fn(async () => true),
        releaseUnprocessedMessage: release,
      },
      processingLeaseMs: 60_000,
    });
    const now = new Date("2026-07-11T01:00:00.000Z");

    await expect(service.releaseMessageForRetry({ conversationId: 1, messageId: 2, wasNewInsert: false }, now)).resolves.toBe(true);
    expect(release).toHaveBeenCalledWith(2, new Date("2026-07-11T00:58:59.999Z"));
  });

  it("bloqueia reentrega quando a persistência não concede propriedade", async () => {
    const service = createMessageLifecycleService({
      conversationRepository: createConversationRepository() as never,
      processingClaimRepository: { claimStaleUnprocessedMessage: vi.fn(async () => false) },
    });

    await expect(service.claimMessageForProcessing({ conversationId: 1, messageId: 2, wasNewInsert: false })).resolves.toBe(false);
  });

  it("considera resposta funcional já gravada como conclusão idempotente", async () => {
    const repository = createConversationRepository();
    repository.findByIdempotencyKey.mockResolvedValueOnce({ id: 99 } as never);
    const service = createMessageLifecycleService({ conversationRepository: repository as never });

    await expect(service.wasMessageAlreadyProcessed({ conversationId: 7, messageId: 11, wasNewInsert: false })).resolves.toBe(true);
    expect(repository.findByIdempotencyKey).toHaveBeenCalledWith("whatsapp:outbound:7:response:11");
  });

  it("só grava processedAt quando o escopo termina com sucesso", async () => {
    const repository = createConversationRepository();
    const service = createMessageLifecycleService({ conversationRepository: repository as never });
    const handle = { conversationId: 1, messageId: 2, wasNewInsert: true };

    await withMessageLifecycleService(service, async () => {
      await markMessageProcessed(handle, new Date("2026-07-11T01:00:00.000Z"));
      expect(repository.markProcessed).not.toHaveBeenCalled();
    });

    expect(repository.markProcessed).toHaveBeenCalledOnce();
    expect(repository.markProcessed).toHaveBeenCalledWith(2, new Date("2026-07-11T01:00:00.000Z"));
  });

  it("não finaliza processedAt e libera claim quando a resposta final da pergunta falha", async () => {
    const repository = createConversationRepository();
    const release = vi.fn(async () => true);
    const service = createMessageLifecycleService({
      conversationRepository: repository as never,
      processingClaimRepository: {
        claimStaleUnprocessedMessage: vi.fn(async () => true),
        releaseUnprocessedMessage: release,
      },
      processingLeaseMs: 60_000,
    });
    const handle = { conversationId: 1, messageId: 2, wasNewInsert: true };

    await expect(runWithQuestionLatencyContext(() =>
      withMessageLifecycleService(service, async () => {
        beginCurrentQuestionLatencyTrace({ userId: 1, contentType: "text", text: "/teste" });
        recordCurrentQuestionDeliveryOutcome(false);
        await markMessageProcessed(handle, new Date("2026-07-11T01:00:00.000Z"));
      }),
    )).rejects.toThrow("inbound remains retryable");

    expect(repository.markProcessed).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(2, new Date("2026-07-11T00:58:59.999Z"));
  });

  it("descarta a finalização pendente quando o escopo falha", async () => {
    const repository = createConversationRepository();
    const service = createMessageLifecycleService({ conversationRepository: repository as never });
    const handle = { conversationId: 1, messageId: 2, wasNewInsert: true };

    await expect(withMessageLifecycleService(service, async () => {
      await markMessageProcessed(handle);
      throw new Error("downstream unavailable");
    })).rejects.toThrow("downstream unavailable");

    expect(repository.markProcessed).not.toHaveBeenCalled();
  });
});