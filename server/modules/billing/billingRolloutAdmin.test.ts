import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => ({ execute: mocks.execute })),
}));

import {
  recordBillingRolloutGateDecision,
  recordBillingRolloutRollback,
  rolloutAdvanceBlockers,
  selectDeterministicRolloutCohort,
  setBillingRolloutPause,
} from "./billingRolloutAdmin";

const healthyMetrics = {
  processedWithin5mBps: 10000,
  reconciledWithin30mBps: 10000,
  financialDivergenceBps: 0,
  internalNotificationsPersistedBps: 10000,
};

const owners = {
  product: "Produto",
  technical: "Tecnico",
  billing: "Billing",
  support: "Suporte",
  authorizer: "Admin",
};

function compiledCall(index: number) {
  return new MySqlDialect().sqlToQuery(mocks.execute.mock.calls[index][0]);
}

function jsonParam(params: unknown[]) {
  const value = params.find(param => typeof param === "string" && param.startsWith("{"));
  if (typeof value !== "string") throw new Error("json payload not found");
  return JSON.parse(value) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue([[]]);
});

describe("billing rollout admin policy", () => {
  it("keeps cohort selection deterministic and stable across input ordering", () => {
    const a = selectDeterministicRolloutCohort({ candidateUserIds: [9, 1, 7, 3, 5], percentage: 40, ruleVersion: "v1", snapshotKey: "pilot-a" });
    const b = selectDeterministicRolloutCohort({ candidateUserIds: [5, 3, 9, 7, 1], percentage: 40, ruleVersion: "v1", snapshotKey: "pilot-a" });
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
  });

  it("blocks phase advancement on absolute incidents regardless of percentages", () => {
    const blockers = rolloutAdvanceBlockers({
      phase: "pilot_a",
      resumeAfterIncident: false,
      reinforcedConfirmation: false,
      metrics: healthyMetrics,
      openIncidents: [{ severity: "medium", type: "duplicate_charge" }],
    });
    expect(blockers.some(item => item.includes("reprova a etapa"))).toBe(true);
  });

  it("requires reinforced confirmation for enforced progression and incident resume", () => {
    expect(rolloutAdvanceBlockers({ phase: "enforced_10", resumeAfterIncident: false, reinforcedConfirmation: false, metrics: healthyMetrics, openIncidents: [] })).toContain("Esta decisão exige confirmação reforçada.");
    expect(rolloutAdvanceBlockers({ phase: "pilot_b", resumeAfterIncident: true, reinforcedConfirmation: false, metrics: healthyMetrics, openIncidents: [] })).toContain("Esta decisão exige confirmação reforçada.");
  });

  it("records manual progression only after evaluating the current rollout state", async () => {
    await recordBillingRolloutGateDecision({
      phase: "pilot_a",
      decision: "advance",
      reason: "Gate manual aprovado",
      reinforcedConfirmation: false,
      resumeAfterIncident: false,
      owners,
      metrics: healthyMetrics,
      evidence: ["evidencia operacional"],
      actorUserId: 31,
    });

    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(compiledCall(0).sql).toContain("FROM billingProviderEvents");
    const insert = compiledCall(1);
    expect(insert.sql).toContain("INSERT INTO billingProviderEvents");
    const payload = jsonParam(insert.params);
    expect(payload).toMatchObject({ phase: "pilot_a", decision: "advance", actorUserId: 31 });
  });

  it("records pause as an append-only control event", async () => {
    await setBillingRolloutPause({
      phase: "pilot_a",
      paused: true,
      scope: "all",
      reason: "Pausa operacional",
      reinforcedConfirmation: false,
      actorUserId: 31,
    });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const insert = compiledCall(0);
    expect(insert.sql).toContain("INSERT INTO billingProviderEvents");
    expect(insert.sql).not.toMatch(/\bUPDATE\b|\bDELETE\b/i);
    expect(jsonParam(insert.params)).toMatchObject({ phase: "pilot_a", paused: true, scope: "all", actorUserId: 31 });
  });

  it("rejects resume without reinforced confirmation before persistence", async () => {
    await expect(setBillingRolloutPause({
      phase: "pilot_a",
      paused: false,
      scope: "all",
      reason: "Retomada operacional",
      reinforcedConfirmation: false,
      actorUserId: 31,
    })).rejects.toThrow("billing_rollout_resume_confirmation_required");

    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("records rollback to open_access without mutating financial facts, subscriptions or capacity", async () => {
    await recordBillingRolloutRollback({
      phase: "enforced_25",
      snapshotKey: "coorte-25",
      reason: "Rollback operacional",
      pauseCommunications: true,
      pauseBlocks: true,
      reinforcedConfirmation: true,
      actorUserId: 31,
    });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const insert = compiledCall(0);
    expect(insert.sql).toContain("INSERT INTO billingProviderEvents");
    expect(insert.sql).not.toMatch(/billingEconomicFacts|billingSubscriptions|billingProfessionalCapacity|\bUPDATE\b|\bDELETE\b/i);
    expect(jsonParam(insert.params)).toMatchObject({
      phase: "enforced_25",
      targetAccessMode: "open_access",
      preserveFinancialFacts: true,
      preserveSubscriptions: true,
      preserveCapacity: true,
      actorUserId: 31,
    });
  });
});
