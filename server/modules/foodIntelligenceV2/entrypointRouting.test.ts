import { describe, expect, it, vi } from "vitest";
import { buildFoodOperationEnvelopeFixture } from "./fixtures";
import {
  routeFoodD1Operation, hashFoodD1OperationScope,
  isFoodD1EntrypointCutoverRequested, isValidD1OperationId, type FoodD1PinnedRoute,
  type FoodD1RouteStore, type FoodD1GateApproval,
} from "./entrypointRouting";
import type { FoodOperationEnvelope } from "./schemas";

const envelope = (): FoodOperationEnvelope =>
  buildFoodOperationEnvelopeFixture() as FoodOperationEnvelope;
const approval: FoodD1GateApproval = {
  status: "approved",
  gateAReference: "artifact:independent-gate-a",
  rolloutReference: "artifact:approved-canary",
  auditedBaseSha: "a".repeat(40),
};

function store() {
  const pins = new Map<string, FoodD1PinnedRoute>();
  const backend: FoodD1RouteStore = {
    async readPinnedRoute(operationKey) { return pins.get(operationKey) ?? null; },
    async bindPinnedRoute(candidate) {
      const winner = pins.get(candidate.operationKey);
      if (winner) return winner;
      const stored = { ...candidate, versions: { ...candidate.versions } };
      pins.set(candidate.operationKey, stored);
      return stored;
    },
  };
  return { backend, pins };
}

function scenario(s: FoodD1RouteStore) {
  const runV1 = vi.fn(async () => "v1");
  const runV2 = vi.fn(async () => "v2");
  const verifyGates = vi.fn(async () => approval);
  return { envelope: envelope(), authenticatedUserId: 7, entrypoint: "text" as const,
    source: "web" as const, store: s, runV1, runV2, verifyGates, expectedAuditedBaseSha: "a".repeat(40) };
}

describe("#1308 D1 operation-key validation", () => {
  it("pins the original conversation and label bytes but not the next turn", () => {
    const original = buildFoodOperationEnvelopeFixture({
      ownerUserId: 7, idempotencyKey: "d1-label-7:12345678",
      traceId: "original-decision-trace",
      conversationRef: "d1-label-image:" + "a".repeat(64),
    }) as FoodOperationEnvelope;
    const scope = hashFoodD1OperationScope(original, "web");
    expect(hashFoodD1OperationScope({
      ...original, turnRef: "later-turn",
    }, "web")).toBe(scope);
    expect(hashFoodD1OperationScope({
      ...original, conversationRef: "d1-label-image:" + "b".repeat(64),
    }, "web")).not.toBe(scope);
  });
  it("binds owner-scoped context references to the original operation", async () => {
    const ctx = envelope();
    const scoped = { ...ctx, contextSources: {
      ...ctx.contextSources,
      preferences: { status: "available" as const, reason: null,
        sourceRef: "food-preference:7:12345" },
    } };
    expect(hashFoodD1OperationScope(scoped, "whatsapp"))
      .not.toBe(hashFoodD1OperationScope(ctx, "whatsapp"));
    const routes = store(), request = scenario(routes.backend);
    await routeFoodD1Operation({ ...request, enabled: false,
      envelope: scoped, source: "whatsapp" });
    await expect(routeFoodD1Operation({
      ...request, enabled: false, source: "whatsapp",
      envelope: { ...scoped, contextSources: {
        ...scoped.contextSources, preferences: { status: "absent",
          reason: "no_user_preferences", sourceRef: null },
      } },
    })).rejects.toThrow("food-d1-operation-scope-changed");
    expect(request.runV1).toHaveBeenCalledTimes(1);
  });
  it("accepts only the exact opaque key shape, never food-text or ambiguous whitespace", () => {
    for (const value of ["manual-submission-1", "A1234567", "0.12345_:-", "z".repeat(80)]) {
      expect(isValidD1OperationId(value), value).toBe(true);
    }
    for (const value of [undefined, null, 12345678, "", "a123456", "z".repeat(81),
      "-a1234567", ".a1234567", " abcdefgh", "abcdefgh ", "abcdefgh/1",
      "abc;defgh", "abcádefgh", "abcdefgh\n", "🍎12345678"]) {
      expect(isValidD1OperationId(value), String(value)).toBe(false);
    }
  });
});

describe("#1308 D1 - exact-operation resolver routing and rollback", () => {
  it("pins legacy V1 on disabled flag and never upgrades it on a subsequent retry", async () => {
    const state = store(), request = scenario(state.backend);
    expect(await routeFoodD1Operation({ ...request, enabled: false })).toBe("v1");
    expect(state.pins.get("op-1")?.resolver).toBe("v1");
    expect(await routeFoodD1Operation({ ...request, enabled: true })).toBe("v1");
    expect(request.runV1).toHaveBeenCalledTimes(2);
    expect(request.runV2).not.toHaveBeenCalled();
    expect(request.verifyGates).not.toHaveBeenCalled();
  });

  it("pins native V2 on explicit approval, including retry across a simulated restart", async () => {
    const state = store(), request = scenario(state.backend);
    expect(await routeFoodD1Operation({ ...request, enabled: true })).toBe("v2");
    expect(state.pins.get("op-1")?.resolver).toBe("v2");
    const exported = structuredClone([...state.pins.entries()]);
    const restored = new Map<string, FoodD1PinnedRoute>(exported);
    const afterRestart: FoodD1RouteStore = {
      async readPinnedRoute(key) { return restored.get(key) ?? null; },
      async bindPinnedRoute(candidate) {
        if (!restored.has(candidate.operationKey)) restored.set(candidate.operationKey, candidate);
        return restored.get(candidate.operationKey)!;
      },
    };
    expect(await routeFoodD1Operation({
      ...request, store: afterRestart, entrypoint: "continuation", enabled: true,
    })).toBe("v2");
    expect(request.runV2).toHaveBeenCalledTimes(2);
    expect(request.runV1).not.toHaveBeenCalled();
    expect(request.verifyGates).toHaveBeenCalledTimes(2);
  });

  it("rolls back a pinned V2 operation without rerouting or duplicating a V1 effect", async () => {
    const state = store(), request = scenario(state.backend);
    await routeFoodD1Operation({ ...request, enabled: true });
    await expect(routeFoodD1Operation({
      ...request, enabled: false,
    })).rejects.toThrow("operation-paused-by-rollback");
    expect(request.runV2).toHaveBeenCalledTimes(1);
    expect(request.runV1).not.toHaveBeenCalled();
  });

  it("fails closed when independent approval is absent or revoked", async () => {
    const state = store(), request = scenario(state.backend);
    await expect(routeFoodD1Operation({
      ...request, enabled: true, verifyGates: async () => null,
    })).rejects.toThrow("independent-gates-not-approved");
    expect(state.pins.size).toBe(0);
    await routeFoodD1Operation({ ...request, enabled: true });
    await expect(routeFoodD1Operation({
      ...request, enabled: true, verifyGates: async () => {
        throw new Error("external approval unavailable");
      },
    })).rejects.toThrow("independent-gates-not-approved");
    expect(request.runV2).toHaveBeenCalledTimes(1);
  });

  it("rejects version drift and operation keys that change owner", async () => {
    const state = store(), request = scenario(state.backend);
    await routeFoodD1Operation({ ...request, enabled: false });
    await expect(routeFoodD1Operation({
      ...request, enabled: false, envelope: {
        ...request.envelope, revisions: {
          ...request.envelope.revisions, policy: "new-policy",
        },
      },
    })).rejects.toThrow("pinned-versions-changed");
    await expect(routeFoodD1Operation({
      ...request, enabled: false, authenticatedUserId: 8,
    })).rejects.toThrow("owner-mismatch");
    await expect(routeFoodD1Operation({
      ...request, enabled: false, entrypoint: "edit",
    })).rejects.toThrow("entrypoint-changed-during-operation");
  });

  it("pins meal date, destination, timezone and channel across retries", async () => {
    const state = store(), request = scenario(state.backend);
    await routeFoodD1Operation({ ...request, enabled: false });
    expect(state.pins.get("op-1")?.operationScopeHash).toBe(
      hashFoodD1OperationScope(request.envelope, "web"));
    const poisoned = [
      { ...request, envelope: { ...request.envelope, mealOperation: {
        ...request.envelope.mealOperation!, date: "2026-10-06" } } },
      { ...request, envelope: { ...request.envelope, mealOperation: {
        ...request.envelope.mealOperation!, targetMeal: "jantar" } } },
      { ...request, source: "whatsapp" as const },
      { ...request, envelope: { ...request.envelope,
        effectiveTimeZone: "UTC" } },
      { ...request, envelope: { ...request.envelope,
        traceId: "forged-retry-trace" } },
    ];
    for (const invalid of poisoned) {
      await expect(routeFoodD1Operation({ ...invalid, enabled: false }))
        .rejects.toThrow("operation-scope-changed");
    }
    expect(request.runV1).toHaveBeenCalledTimes(1);
    expect(request.runV2).not.toHaveBeenCalled();
  });

  it("uses the atomically winning V1 owner when V1 and V2 compete to create the same key", async () => {
    const state = store();
    const request = scenario({
      async readPinnedRoute() { return null; },
      async bindPinnedRoute(candidate) {
        const winner: FoodD1PinnedRoute = { ...candidate, resolver: "v1" };
        state.pins.set(candidate.operationKey, winner);
        return winner;
      },
    });
    expect(await routeFoodD1Operation({ ...request, enabled: true })).toBe("v1");
    expect(request.runV2).not.toHaveBeenCalled();
  });

  it("rejects independent approval for a different code material SHA", async () => {
    const state = store(), request = scenario(state.backend);
    await expect(routeFoodD1Operation({
      ...request, enabled: true, expectedAuditedBaseSha: "b".repeat(40),
    })).rejects.toThrow("independent-gates-not-approved");
    expect(state.pins.size).toBe(0);
    expect(request.runV2).not.toHaveBeenCalled();
  });

  it("never accepts an environment-only opt-in without evidence from the gate provider", async () => {
    const state = store(), request = scenario(state.backend);
    await expect(routeFoodD1Operation({
      ...request, enabled: true, verifyGates: async () => ({
        ...approval, auditedBaseSha: "not-a-real-sha",
      }),
    })).rejects.toThrow("independent-gates-not-approved");
    expect(state.pins.size).toBe(0);
  });

  it("keeps an incumbent V1 owner when its binding wins while V2 approval is unavailable", async () => {
    const state = store(), incumbent = scenario(state.backend);
    await routeFoodD1Operation({ ...incumbent, enabled: false });
    let reads = 0;
    const request = scenario({
      async readPinnedRoute() {
        reads++;
        return reads === 1 ? null : state.pins.get("op-1") ?? null;
      },
      async bindPinnedRoute() { throw new Error("no new route may be created"); },
    });
    const outcome = await routeFoodD1Operation({ ...request, enabled: true,
      verifyGates: async () => null });
    expect(outcome).toBe("v1");
    expect(reads).toBe(2);
    expect(request.runV1).toHaveBeenCalledTimes(1);
    expect(request.runV2).not.toHaveBeenCalled();
  });

  it("refuses a new owner if the approval is revoked and no legacy pin exists", async () => {
    const state = store(), request = scenario(state.backend);
    await expect(routeFoodD1Operation({ ...request, enabled: true,
      verifyGates: async () => null })).rejects.toThrow("independent-gates-not-approved");
    expect(state.pins.size).toBe(0);
    expect(request.runV1).not.toHaveBeenCalled();
    expect(request.runV2).not.toHaveBeenCalled();
  });

  it("scopes a progressive rollout and preserves the original pin on removal", async () => {
    const previousGlobal = process.env.FOOD_V2_D1_ENABLED;
    const previousScope = process.env.FOOD_V2_D1_ENTRYPOINTS;
    try {
      process.env.FOOD_V2_D1_ENABLED = "true";
      process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
      expect(isFoodD1EntrypointCutoverRequested("text")).toBe(true);
      expect(isFoodD1EntrypointCutoverRequested("audio_transcript")).toBe(false);
      const textStore = store(), text = scenario(textStore.backend);
      expect(await routeFoodD1Operation(text)).toBe("v2");
      const audioStore = store(), audio = {
        ...scenario(audioStore.backend), entrypoint: "audio_transcript" as const,
      };
      expect(await routeFoodD1Operation(audio)).toBe("v1");
      expect(audio.verifyGates).not.toHaveBeenCalled();
      expect(audioStore.pins.get("op-1")?.resolver).toBe("v1");
      process.env.FOOD_V2_D1_ENTRYPOINTS = "audio_transcript";
      await expect(routeFoodD1Operation({
        ...text, entrypoint: "continuation",
      })).rejects.toThrow("operation-paused-by-rollback");
      expect(textStore.pins.get("op-1")?.resolver).toBe("v2");
      expect(text.runV1).not.toHaveBeenCalled();
      expect(text.runV2).toHaveBeenCalledTimes(1);
    } finally {
      if (previousGlobal === undefined) delete process.env.FOOD_V2_D1_ENABLED;
      else process.env.FOOD_V2_D1_ENABLED = previousGlobal;
      if (previousScope === undefined) delete process.env.FOOD_V2_D1_ENTRYPOINTS;
      else process.env.FOOD_V2_D1_ENTRYPOINTS = previousScope;
    }
  });

  it("rejects malformed selection and orphan V2 continuation before binding a route", async () => {
    const previousGlobal = process.env.FOOD_V2_D1_ENABLED;
    const previousScope = process.env.FOOD_V2_D1_ENTRYPOINTS;
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.FOOD_V2_D1_ENABLED = "true";
      for (const malformed of ["", "banana", "text,banana", "text,text", "text,"]) {
        process.env.FOOD_V2_D1_ENTRYPOINTS = malformed;
        expect(isFoodD1EntrypointCutoverRequested("text")).toBe(false);
      }
      delete process.env.FOOD_V2_D1_ENTRYPOINTS;
      process.env.NODE_ENV = "production";
      expect(isFoodD1EntrypointCutoverRequested("text")).toBe(false);
      process.env.NODE_ENV = previousNodeEnv;
      process.env.FOOD_V2_D1_ENTRYPOINTS = "continuation";
      const state = store(), request = scenario(state.backend);
      await expect(routeFoodD1Operation({
        ...request, entrypoint: "continuation",
      })).rejects.toThrow("food-d1-orphan-continuation");
      expect(state.pins.size).toBe(0);
      expect(request.runV1).not.toHaveBeenCalled();
      expect(request.runV2).not.toHaveBeenCalled();
    } finally {
      if (previousGlobal === undefined) delete process.env.FOOD_V2_D1_ENABLED;
      else process.env.FOOD_V2_D1_ENABLED = previousGlobal;
      if (previousScope === undefined) delete process.env.FOOD_V2_D1_ENTRYPOINTS;
      else process.env.FOOD_V2_D1_ENTRYPOINTS = previousScope;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

});
