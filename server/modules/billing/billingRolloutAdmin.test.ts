import { describe, expect, it } from "vitest";
import { rolloutAdvanceBlockers, selectDeterministicRolloutCohort } from "./billingRolloutAdmin";

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
      metrics: { processedWithin5mBps: 10000, reconciledWithin30mBps: 10000, financialDivergenceBps: 0, internalNotificationsPersistedBps: 10000 },
      openIncidents: [{ severity: "medium", type: "duplicate_charge" }],
    });
    expect(blockers.some(item => item.includes("reprova a etapa"))).toBe(true);
  });

  it("requires reinforced confirmation for enforced progression and incident resume", () => {
    const metrics = { processedWithin5mBps: 10000, reconciledWithin30mBps: 10000, financialDivergenceBps: 0, internalNotificationsPersistedBps: 10000 };
    expect(rolloutAdvanceBlockers({ phase: "enforced_10", resumeAfterIncident: false, reinforcedConfirmation: false, metrics, openIncidents: [] })).toContain("Esta decisão exige confirmação reforçada.");
    expect(rolloutAdvanceBlockers({ phase: "pilot_b", resumeAfterIncident: true, reinforcedConfirmation: false, metrics, openIncidents: [] })).toContain("Esta decisão exige confirmação reforçada.");
  });
});
