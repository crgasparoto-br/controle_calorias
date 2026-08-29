import { describe, expect, it } from "vitest";
import { billingRolloutGateDecisionSchema, billingRolloutRollbackSchema, billingRolloutSnapshotSchema } from "./billingRolloutAdminSchemas";

describe("billing rollout admin schemas", () => {
  it("rejects empty cohort sources and out-of-range percentages", () => {
    expect(billingRolloutSnapshotSchema.safeParse({ phase: "pilot_a", snapshotKey: "x", ruleVersion: "v1", criterion: "eligible users", candidateUserIds: [], percentage: 101, reason: "test" }).success).toBe(false);
  });
  it("requires explicit reinforced confirmation for rollback", () => {
    expect(billingRolloutRollbackSchema.safeParse({ phase: "pilot_a", reason: "incident", reinforcedConfirmation: false }).success).toBe(false);
  });
  it("accepts an explicit manual gate decision with named owners", () => {
    const result = billingRolloutGateDecisionSchema.safeParse({
      phase: "pilot_a", decision: "hold", reason: "monitorar mais um ciclo", reinforcedConfirmation: false, resumeAfterIncident: false,
      owners: { product: "Produto", technical: "Tecnico", billing: "Billing", support: "Suporte", authorizer: "Admin" },
      metrics: { processedWithin5mBps: 10000, reconciledWithin30mBps: 10000, financialDivergenceBps: 0, internalNotificationsPersistedBps: 10000 },
      evidence: ["run exato do candidato"],
    });
    expect(result.success).toBe(true);
  });
});
