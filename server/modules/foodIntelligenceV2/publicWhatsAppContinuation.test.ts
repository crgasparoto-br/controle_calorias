import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFoodObservationFixture, buildFoodResolutionDecisionFixture,
  buildFoodOperationEnvelopeFixture } from "./fixtures";
import { createFoodD1WhatsAppContinuation,
  type FoodD1WhatsAppContinuationDependencies } from "./publicWhatsAppContinuation";
import type { FoodD1WhatsAppPending } from "./publicWhatsAppPendingContract";
import type { FoodD1WhatsAppPendingRecord } from "./publicWhatsAppPendingRepository";
import type { runFoodD1Migration } from "./entrypointRunner";

const sha = "c".repeat(40);
const envelope = buildFoodOperationEnvelopeFixture({
  idempotencyKey: "d1-whatsapp-original-001",
  traceId: "d1-trace-original-001",
  ownerUserId: 7,
  effectiveTimeZone: "America/Sao_Paulo",
  mealOperation: { action: "add", targetMeal: "almoço", date: "2026-11-04" },
  revisions: { code: sha, knowledge: "k1", lexicon: "l1", policy: "p1", resolver: "r1" },
}) as FoodD1WhatsAppPending["envelope"];
const original = buildFoodObservationFixture({
  rawInput: null, normalizedInput: null, lexiconRevision: "l1",
  quantityHints: {
    value: null, unit: null, servingText: null,
    visiblePackageQuantity: null, visiblePackageUnit: null,
  },
  evidence: [{
    evidenceId: "ev-ident", field: "identity.foodName",
    origin: "text", value: "mortadela", unit: null, confidence: 0.9,
    verified: true, anchor: buildFoodObservationFixture().surfaceSpan, sourceId: null,
  }],
});
const decision = buildFoodResolutionDecisionFixture({
  ownerUserId: 7, traceId: envelope.traceId,
  knowledgeRevision: "k1", policyVersion: "p1",
  status: "partially_resolved", nextAction: "clarify",
  reasonCodes: ["quantity_missing"], unresolvedFields: ["quantity"],
  quantity: { value: null, unit: null, grams: null, milliliters: null,
    source: null, portionId: null, measureKind: null, confidence: null, evidenceIds: [] },
  nutrition: { profileId: null, sourceId: null, verified: false, provisional: false,
    basis: null, consumed: null, snapshotHash: null, evidenceIds: [] },
});
const pending: FoodD1WhatsAppPending = {
  schemaVersion: 2, envelope, originEntrypoint: "text",
  occurredAt: "2026-11-04T15:00:00.000Z",
  observations: [original], decisions: [decision], unresolvedIds: ["obs-1"],
};
const current: FoodD1WhatsAppPendingRecord = {
  id: 104, version: 1,
  expiresAt: new Date("2099-11-04T15:30:00Z"),
  target: pending,
};
const context = {
  approval: { status: "approved" as const, auditedBaseSha: sha,
    gateAReference: "gate-a-fixture", rolloutReference: "rollout-fixture" },
  expectedAuditedBaseSha: sha,
  revisions: { ...envelope.revisions },
};
const input = () => ({
  userId: 7, externalMessageId: "wamid.followup-001",
  replyText: "100 g", receivedAt: new Date("2026-11-04T15:01:00Z"),
  timeZone: "America/Sao_Paulo",
});
function dependencies() {
  const readPending = vi.fn(async () => current);
  const updatePending = vi.fn(async (_before: FoodD1WhatsAppPendingRecord,
    next: FoodD1WhatsAppPending) =>
    ({ ...current, version: 2, target: next }));
  const consumePending = vi.fn(async () => undefined);
  const run = vi.fn(async (args: Parameters<typeof runFoodD1Migration>[0]) => {
    expect(args.request.entrypoint).toBe("continuation");
    expect(args.request.envelope).toEqual(envelope);
    expect(args.request.targets).toMatchObject([{
      observationId: "obs-1", mealItemId: null, previousDecision: decision,
    }]);
    expect(args.request.evidence).toMatchObject({
      kind: "structured", observations: [{
        observationId: "obs-1", rawInput: null, normalizedInput: null,
        quantityHints: { value: 100, unit: "g" },
      }],
    });
    args.beforeCommit?.({ items: [{
      observationId: "obs-1", disposition: "ready",
    }], readyCount: 1 } as never);
    await expect(args.legacy()).rejects
      .toThrow("food-d1-whatsapp-continuation-no-v1-replay");
    return { committed: true, replayed: false, mealId: 44,
      operationKey: envelope.idempotencyKey, recordedItemIds: [81], skipped: [] };
  });
  const deps = {
    readPending, updatePending, consumePending,
    readAuthorizedContext: vi.fn(async () => context),
    comprehend: vi.fn(async () => [buildFoodObservationFixture({
      observationId: "reply-1", modality: "text",
      identityHints: { foodName: null },
      quantityHints: { value: 100, unit: "g", servingText: "100 g" },
    })]),
    lexicon: { load: vi.fn(async () => []) },
    knowledge: { readLocal: vi.fn(async () => ({ kind: "miss" as const, reason: "not_found" as const })),
      readPendingEvidence: vi.fn(async () => null), stagePendingEvidence: vi.fn(async () => {}) },
    run,
    renderCommittedMeal: vi.fn(async () => "Mortadela 100 g registrada"),
  };
  return deps;
}
afterEach(() => vi.unstubAllEnvs());
describe("#1308 durable WhatsApp continuation from pinned original decisions", () => {
  it("resumes one original physical batch without new first-turn intent or duplicate write", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "text,continuation");
    const deps = dependencies();
    const continuation = createFoodD1WhatsAppContinuation(
      deps as unknown as FoodD1WhatsAppContinuationDependencies,
    );
    const result = await continuation(input());
    expect(result?.action).toBe("food_clarification_completed");
    expect(result?.data?.mealId).toBe(44);
    expect(deps.run).toHaveBeenCalledOnce();
    expect(deps.consumePending).toHaveBeenCalledWith(current, 7);
    expect(deps.updatePending).not.toHaveBeenCalled();
    expect(deps.renderCommittedMeal).toHaveBeenCalledOnce();
  });

  it("stores the next structured revision if another original sibling remains unresolved", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "text,continuation");
    const deps = dependencies();
    deps.run.mockImplementation(async args => {
      args.beforeCommit?.({ items: [{
        observationId: "obs-1", disposition: "deferred",
      }], readyCount: 0 } as never);
      throw new Error("unexpected-write");
    });
    const result = await createFoodD1WhatsAppContinuation(
      deps as unknown as FoodD1WhatsAppContinuationDependencies,
    )(input());
    expect(result?.action).toBe("food_clarification_reprompted");
    expect(deps.updatePending).toHaveBeenCalledOnce();
    expect(deps.consumePending).not.toHaveBeenCalled();
    const saved = deps.updatePending.mock.calls[0][1] as FoodD1WhatsAppPending;
    expect(saved.observations).toHaveLength(1);
    expect(saved.observations[0].rawInput).toBeNull();
    expect(saved.envelope.idempotencyKey).toBe(envelope.idempotencyKey);
  });

  it("cannot reinterpret the pending reply under V1 after rollback", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "false");
    const deps = dependencies();
    await expect(createFoodD1WhatsAppContinuation(
      deps as unknown as FoodD1WhatsAppContinuationDependencies,
    )(input())).rejects.toThrow("food-d1-operation-paused-by-rollback");
    expect(deps.comprehend).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("rejects foreign owner, timezone change and revoked Gate A before interpretation", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "text,continuation");
    const deps = dependencies();
    const service = createFoodD1WhatsAppContinuation(
      deps as unknown as FoodD1WhatsAppContinuationDependencies,
    );
    await expect(service({ ...input(), timeZone: "UTC" }))
      .rejects.toThrow("food-d1-whatsapp-continuation-scope-mismatch");
    await expect(service({ ...input(), userId: 8 }))
      .rejects.toThrow("food-d1-whatsapp-continuation-scope-mismatch");
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.comprehend).not.toHaveBeenCalled();
    const noApproval = createFoodD1WhatsAppContinuation({
      ...deps, readAuthorizedContext: async () => null,
    } as unknown as FoodD1WhatsAppContinuationDependencies);
    await expect(noApproval(input()))
      .rejects.toThrow("food-d1-whatsapp-continuation-gate-or-version-unavailable");
  });

  it("does not overwrite first-turn quantity with contradictory reply", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "text,continuation");
    const deps = dependencies();
    const conflicts = {
      ...current, target: {
        ...pending, observations: [{
          ...original, quantityHints: { ...original.quantityHints,
            value: 80, unit: "g", servingText: "80 g" },
        }],
      },
    };
    deps.readPending.mockResolvedValueOnce(conflicts);
    await expect(createFoodD1WhatsAppContinuation(
      deps as unknown as FoodD1WhatsAppContinuationDependencies,
    )(input())).rejects.toThrow("food-d1-whatsapp-continuation-material-conflict");
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.updatePending).not.toHaveBeenCalled();
  });

  it("does not absorb a new V1 reply when no V2 pending exists", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "false");
    const deps = dependencies();
    deps.readPending.mockResolvedValueOnce(null);
    expect(await createFoodD1WhatsAppContinuation(
      deps as unknown as FoodD1WhatsAppContinuationDependencies,
    )(input())).toBeNull();
    expect(deps.run).not.toHaveBeenCalled();
  });
});
