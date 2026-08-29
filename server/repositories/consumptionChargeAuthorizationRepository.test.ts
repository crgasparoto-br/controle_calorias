import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorization: null as null | Record<string, unknown>,
  transitions: [] as Record<string, unknown>[],
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce(
    (text, part, index) => text + part + (index < values.length ? String(values[index] ?? "") : ""),
    "",
  ),
}));
vi.mock("./billingRepositorySupport", () => ({ resultRows: (value: unknown) => value }));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    transaction: async <T>(callback: (tx: { execute: (query: string) => Promise<unknown> }) => Promise<T>) => callback({
      execute: async query => {
        if (query.includes("INSERT INTO billingConsumptionChargeAuthorizations")) {
          state.authorization = {
            id: "auth-1", state: "draft", effectiveFrom: new Date("2026-09-01T00:00:00Z"),
            communicationAt: new Date("2026-08-19T00:00:00Z"), noRetroactive: true,
          };
          return [{ affectedRows: 1 }];
        }
        if (query.includes("INSERT INTO billingProviderEvents")) { state.transitions.push({ query }); return [{ affectedRows: 1 }]; }
        if (query.includes("SELECT id,state,effectiveFrom")) return state.authorization ? [{ ...state.authorization }] : [];
        if (query.includes("UPDATE billingConsumptionChargeAuthorizations")) {
          if (!state.authorization) return [{ affectedRows: 0 }];
          const match = query.match(/SET state=([^,\s]+)/);
          const next = query.includes("SET state='revoked'") ? "revoked" : match?.[1];
          state.authorization.state = next;
          return [{ affectedRows: 1 }];
        }
        return [];
      },
    }),
  })),
}));

const repo = await import("./consumptionChargeAuthorizationRepository");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T12:00:00Z"));
  state.authorization = null;
  state.transitions = [];
});

describe("consumption charge authorization state machine", () => {
  it("creates a draft and records the initial append-only transition", async () => {
    await repo.createConsumptionChargeAuthorizationDraft({
      id: "auth-1", policyVersion: "v2", reason: "future pricing", pricing: { unit: 10 }, affectedPlans: ["pro"],
      effectiveFrom: new Date("2026-09-01T00:00:00Z"), communicationAt: new Date("2026-08-19T00:00:00Z"), rollback: { strategy: "off" }, actorUserId: 7,
    });
    expect(state.authorization?.state).toBe("draft");
    expect(state.transitions).toHaveLength(1);
  });

  it("rejects a draft to active shortcut", async () => {
    state.authorization = { id: "auth-1", state: "draft", effectiveFrom: new Date("2026-09-01"), communicationAt: new Date("2026-08-19"), noRetroactive: true };
    await expect(repo.transitionConsumptionChargeAuthorization({ id: "auth-1", toState: "active", actorUserId: 7, reason: "skip", reinforcedConfirmation: true }))
      .rejects.toThrow("consumption_charge_transition_invalid");
  });

  it("supports approve, reinforced activate, suspend, reactivate and terminal revoke", async () => {
    state.authorization = { id: "auth-1", state: "draft", effectiveFrom: new Date("2026-09-01"), communicationAt: new Date("2026-08-19"), noRetroactive: true };
    await repo.transitionConsumptionChargeAuthorization({ id: "auth-1", toState: "approved", actorUserId: 7, reason: "reviewed" });
    await expect(repo.transitionConsumptionChargeAuthorization({ id: "auth-1", toState: "active", actorUserId: 8, reason: "activate" }))
      .rejects.toThrow("consumption_charge_reinforced_confirmation_required");
    await repo.transitionConsumptionChargeAuthorization({ id: "auth-1", toState: "active", actorUserId: 8, reason: "activate", reinforcedConfirmation: true });
    await repo.transitionConsumptionChargeAuthorization({ id: "auth-1", toState: "suspended", actorUserId: 9, reason: "pause" });
    await repo.transitionConsumptionChargeAuthorization({ id: "auth-1", toState: "active", actorUserId: 9, reason: "resume", reinforcedConfirmation: true });
    await repo.transitionConsumptionChargeAuthorization({ id: "auth-1", toState: "revoked", actorUserId: 10, reason: "rollback" });
    expect(state.authorization?.state).toBe("revoked");
    await expect(repo.transitionConsumptionChargeAuthorization({ id: "auth-1", toState: "active", actorUserId: 10, reason: "forbidden", reinforcedConfirmation: true }))
      .rejects.toThrow("consumption_charge_transition_invalid");
    expect(state.transitions).toHaveLength(5);
  });

  it("blocks activation when communication is not complete or activation would be retroactive", async () => {
    state.authorization = { id: "auth-1", state: "approved", effectiveFrom: new Date("2026-09-01"), communicationAt: new Date("2026-08-21"), noRetroactive: true };
    await expect(repo.transitionConsumptionChargeAuthorization({ id: "auth-1", toState: "active", actorUserId: 8, reason: "activate", reinforcedConfirmation: true }))
      .rejects.toThrow("consumption_charge_prior_communication_incomplete");
    state.authorization.communicationAt = new Date("2026-08-19");
    state.authorization.effectiveFrom = new Date("2026-08-20T11:00:00Z");
    await expect(repo.transitionConsumptionChargeAuthorization({ id: "auth-1", toState: "active", actorUserId: 8, reason: "activate", reinforcedConfirmation: true }))
      .rejects.toThrow("consumption_charge_retroactive_activation_forbidden");
  });
});
