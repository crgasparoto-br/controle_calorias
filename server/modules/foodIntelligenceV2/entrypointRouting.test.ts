import { describe, expect, it, vi } from "vitest";
import { buildFoodOperationEnvelopeFixture } from "./fixtures";
import {
  routeFoodD1Operation, hashFoodD1OperationScope, type FoodD1PinnedRoute,
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
    async find(operationKey) { return pins.get(operationKey) ?? null; },
    async findOrCreate(candidate) {
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
      async find(key) { return restored.get(key) ?? null; },
      async findOrCreate(candidate) {
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
      async find() { return null; },
      async findOrCreate(candidate) {
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
      async find() {
        reads++;
        return reads === 1 ? null : state.pins.get("op-1") ?? null;
      },
      async findOrCreate() { throw new Error("no new route may be created"); },
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

});
