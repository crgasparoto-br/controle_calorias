import { describe, expect, it } from "vitest";
import { goldenFoodCorpus } from "./data";
import type { CorpusReport } from "./harness";
import {
  CALIBRATION_PARAMETERS, evaluateLockedHoldout, projectSplitEvidence,
  selectCalibrationCandidate, verifyCalibrationPlan,
  type CalibrationPlan, type CalibrationSegment, type SplitEvidence,
} from "./calibration.test.support";

const registeredAt = "2026-10-26T10:00:00.000Z";
const lockedAt = "2026-10-26T10:04:00.000Z";
const revisions = {
  code: "f2ce431146614751c7b6e850e66ff5556e350e89",
  knowledge: "knowledge-v1",
  lexicon: "lexicon-v1",
  model: "offline-model-v1",
  policy: "test-policy-baseline",
  resolver: "resolver-v2",
};
const parameterPlan = (): CalibrationPlan => ({
  id: "pre-registered-c3-1",
  parameter: "rounding:macros",
  scope: "macro=protein;unit=g",
  owner: "test-only-owner",
  reference: "test:independent-fixture-no-human-approval",
  corpusVersion: goldenFoodCorpus.corpusVersion,
  resolverId: "food-intelligence-v2-domain-resolver",
  preRegisteredAt: registeredAt,
  revisions,
  baseline: { id: "baseline", value: 0, policyRevision: "test-policy-baseline" },
  candidates: [
    { id: "candidate-a", value: 0.01, policyRevision: "test-policy-a" },
    { id: "candidate-b", value: 0.02, policyRevision: "test-policy-b" },
  ],
  selectionRule: "no_regression_then_max_correct_then_cost",
  maxExternalCalls: 0,
});

function segments(matched = 12): CalibrationSegment[] {
  const failed = 15 - matched;
  return [
    { dimension: "modality", label: "text", cases: 20, resolvableLabeled: 15, matchedResolvable: matched, failedCases: failed },
    { dimension: "brand", label: "none", cases: 20, resolvableLabeled: 15, matchedResolvable: matched, failedCases: failed },
    { dimension: "measure", label: "g", cases: 20, resolvableLabeled: 15, matchedResolvable: matched, failedCases: failed },
    { dimension: "decisionClass", label: "resolvable", cases: 15, resolvableLabeled: 15, matchedResolvable: matched, failedCases: failed },
    { dimension: "decisionClass", label: "clarification", cases: 5, resolvableLabeled: 0, matchedResolvable: 0, failedCases: 0 },
    { dimension: "nonRecurrenceClass", label: "A", cases: 20, resolvableLabeled: 15, matchedResolvable: matched, failedCases: failed },
  ];
}

/** Synthetic measurements solely to test the selector, never calibration evidence. */
function evidence(
  candidateId: string, matched = 12,
  split: SplitEvidence["split"] = "calibration",
): SplitEvidence {
  const policies: Record<string, string> = {
    baseline: "test-policy-baseline", "candidate-a": "test-policy-a",
    "candidate-b": "test-policy-b",
  };
  return {
    planId: "pre-registered-c3-1", candidateId,
    runId: split + ":" + candidateId,
    recordedAt: split === "holdout" ? "2026-10-26T10:05:00.000Z" : "2026-10-26T10:02:00.000Z",
    split, corpusVersion: goldenFoodCorpus.corpusVersion,
    resolverId: "food-intelligence-v2-domain-resolver",
    revisions: { ...revisions, policy: policies[candidateId] },
    cases: 20, resolvableLabeled: 15, matchedResolvable: matched,
    matchedCases: 5 + matched, failedCases: 15 - matched,
    nonResolvableFailures: 0, abstentions: 0,
    totalCostUsd: 0.05, costSamples: 20,
    totalLatencyMs: 300, latencySamples: 20,
    failuresByClass: { "decision:resolvable": 15 - matched },
    failedCaseIds: Array.from({ length: 15 - matched }, (_, i) => "synthetic-failure-" + i),
    segments: segments(matched), structuralViolations: [],
  };
}

describe("#1306 C3: pre-registration and offline calibration", () => {
  it("declares separate purpose and unit for each unresolved ADR parameter, no approved values", () => {
    const items = new Set(Object.values(CALIBRATION_PARAMETERS).map(item => item.item));
    expect([...items].sort((a, b) => a - b)).toEqual([2, 7, 8, 17, 19, 22, 30]);
    expect(CALIBRATION_PARAMETERS["materiality:profile-macros"].unit).toBe("g_per_100g");
    expect(CALIBRATION_PARAMETERS["rounding:macros"].unit).toBe("g");
    expect(CALIBRATION_PARAMETERS["search:semantic-similarity"].unit).toBe("similarity");
    expect(CALIBRATION_PARAMETERS["confidence:source-field"].unit).toBe("probability");
    verifyCalibrationPlan(parameterPlan());
    expect(Object.values(CALIBRATION_PARAMETERS).every(item => !("approved" in item))).toBe(true);
  });

  it("rejects missing owner, generic scope, unpinned source and candidate duplicates", () => {
    const plan = parameterPlan();
    expect(() => verifyCalibrationPlan({ ...plan, owner: "" })).toThrow();
    expect(() => verifyCalibrationPlan({ ...plan, scope: "global" })).toThrow();
    expect(() => verifyCalibrationPlan({ ...plan, parameter: "confidence:source-field",
      scope: "source=verified-only" })).toThrow();
    expect(() => verifyCalibrationPlan({ ...plan, parameter: "materiality:profile-kcal",
      scope: "attribute=fat" })).toThrow();
    expect(() => verifyCalibrationPlan({ ...plan, revisions: { ...revisions, knowledge: "unset" } })).toThrow();
    expect(() => verifyCalibrationPlan({ ...plan, candidates: [plan.baseline] })).toThrow();
    expect(() => verifyCalibrationPlan({ ...plan, candidates: [] })).toThrow();
    expect(() => verifyCalibrationPlan({ ...plan, maxExternalCalls: 1 as 0 })).toThrow();
    expect(() => verifyCalibrationPlan({ ...plan, parameter: "not-existent" as CalibrationPlan["parameter"] })).toThrow();
  });

  it("validates units independently, not with one generic numeric threshold", () => {
    const plan = parameterPlan();
    const change = (parameter: CalibrationPlan["parameter"], value: string | number) => ({
      ...plan, parameter, candidates: [{ id: "candidate-a", value, policyRevision: "test-policy-a" }],
    });
    expect(() => verifyCalibrationPlan(change("search:candidate-limit", 1.5))).toThrow();
    expect(() => verifyCalibrationPlan(change("search:semantic-similarity", 1.5))).toThrow();
    expect(() => verifyCalibrationPlan(change("search:top-margin", -1))).toThrow();
    expect(() => verifyCalibrationPlan(change("confidence:source-field", 1.01))).toThrow();
    expect(() => verifyCalibrationPlan(change("materiality:profile-macros", -0.01))).toThrow();
    expect(() => verifyCalibrationPlan(change("search:text-algorithm", 0.5))).toThrow();
    expect(() => verifyCalibrationPlan({
      ...change("materiality:sparse-family", 2),
      scope: "family=test-family", baseline: { id: "baseline", value: 1, policyRevision: "test-policy-baseline" },
    })).not.toThrow();
  });

  it("locks the best non-regressing calibration candidate before opening the holdout", () => {
    const plan = parameterPlan();
    const result = selectCalibrationCandidate(plan, evidence("baseline", 12),
      [evidence("candidate-a", 14), evidence("candidate-b", 15)], lockedAt);
    expect(result.status).toBe("locked_for_holdout");
    if (result.status !== "locked_for_holdout") return;
    expect(result.selectedCandidateId).toBe("candidate-b");
    expect(result.calibrationDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(selectCalibrationCandidate(plan, evidence("baseline", 12),
      [evidence("candidate-a", 14), evidence("candidate-b", 15)], lockedAt)).toEqual(result);
  });

  it("blocks calibration regression even when aggregate rate is improved", () => {
    const worseSegment = evidence("candidate-a", 15);
    worseSegment.segments.find(item => item.dimension === "brand")!.matchedResolvable = 11;
    const result = selectCalibrationCandidate(parameterPlan(), evidence("baseline", 12),
      [worseSegment, evidence("candidate-b", 11)], lockedAt);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.comparisons[0].reasons).toContain("segment_regression:brand:none");
      expect(result.comparisons[1].reasons).toContain("match_regression");
    }
  });

  it("never selects from holdout and rejects timestamps after the locked selection", () => {
    const plan = parameterPlan();
    const baseline = evidence("baseline", 12);
    const candidates = [evidence("candidate-a", 15), evidence("candidate-b", 15)];
    expect(() => selectCalibrationCandidate(plan, baseline,
      [evidence("candidate-a", 15, "holdout"), candidates[1]], lockedAt)).toThrow();
    expect(() => selectCalibrationCandidate(plan, baseline, candidates,
      "2026-10-26T10:01:00.000Z")).toThrow();
    expect(() => selectCalibrationCandidate(plan, baseline, [candidates[0]], lockedAt)).toThrow();
    expect(() => selectCalibrationCandidate(plan, { ...baseline, resolvableLabeled: 0 },
      candidates, lockedAt)).toThrow();
  });

  it("holdout needs 95%, zero expected failures and separate approval even with full success", () => {
    const plan = parameterPlan();
    const selection = selectCalibrationCandidate(plan, evidence("baseline", 12),
      [evidence("candidate-a", 15), evidence("candidate-b", 14)], lockedAt);
    expect(selection.status).toBe("locked_for_holdout");
    if (selection.status !== "locked_for_holdout") return;
    const baseline = evidence("baseline", 12, "holdout");
    const successful = evidence("candidate-a", 15, "holdout");
    const approved = evaluateLockedHoldout(plan, selection, baseline, successful);
    expect(approved).toMatchObject({ status: "awaiting_independent_approval", approved: false, item: 30 });
    expect(approved.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(evaluateLockedHoldout(plan, selection, baseline,
      evidence("candidate-a", 14, "holdout"))).toMatchObject({
        status: "rejected", approved: false, reasons: expect.arrayContaining(["minimum_95_percent_not_met"]),
      });
    expect(() => evaluateLockedHoldout(plan, selection, baseline,
      evidence("candidate-b", 15, "holdout"))).toThrow();
    expect(() => evaluateLockedHoldout(plan, selection, baseline,
      { ...successful, recordedAt: registeredAt })).toThrow();
  });


  it("prevents new per-case regressions hidden by improved aggregates", () => {
    const candidate = evidence("candidate-a", 15);
    const compensation = evidence("candidate-b", 14);
    compensation.failedCaseIds = ["different-case"];
    const selected = selectCalibrationCandidate(parameterPlan(), evidence("baseline", 12),
      [candidate, compensation], lockedAt);
    expect(selected.status).toBe("locked_for_holdout");
    if (selected.status === "locked_for_holdout") {
      expect(selected.selectedCandidateId).toBe("candidate-a");
      expect(selected.calibrationComparison.find(c => c.candidateId === "candidate-b")?.reasons)
        .toContain("case_regression");
    }
  });

  it("requires observed reduction in S3 cost, not just accuracy", () => {
    const p: CalibrationPlan = {
      ...parameterPlan(), parameter: "linguistic:s3-escalation", scope: "modality=audio",
      baseline: { id: "baseline", value: 0, policyRevision: "test-policy-baseline" },
      candidates: [{ id: "candidate-a", value: 0.4, policyRevision: "test-policy-a" }],
    };
    const result = selectCalibrationCandidate(p, evidence("baseline"),
      [evidence("candidate-a", 15)], lockedAt);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.comparisons[0].reasons).toContain("s3_cost_reduction_not_demonstrated");
    }
  });
  it("does not accept a new policy revision, unknown source or fabricated zero-denominator sample", () => {
    const base = evidence("baseline");
    expect(() => selectCalibrationCandidate(parameterPlan(), base,
      [evidence("candidate-a"), { ...evidence("candidate-b"), revisions: { ...revisions, policy: "wrong" } }],
      lockedAt)).toThrow();
    expect(() => selectCalibrationCandidate(parameterPlan(),
      { ...base, structuralViolations: ["synthetic_resolver"] },
      [evidence("candidate-a"), evidence("candidate-b")], lockedAt)).toThrow();
    expect(() => selectCalibrationCandidate(parameterPlan(),
      { ...base, matchedCases: 100 },
      [evidence("candidate-a"), evidence("candidate-b")], lockedAt)).toThrow();
    expect(() => selectCalibrationCandidate(parameterPlan(),
      { ...base, failedCaseIds: [] },
      [evidence("candidate-a"), evidence("candidate-b")], lockedAt)).toThrow();
  });
});

describe("#1306: only split-scoped independent Golden labels reach tuning", () => {
  /** Synthetic report projection checks, never claimed as resolver accuracy. */
  function reportWithHoldoutFailure(holdoutCaseId: string | null): CorpusReport {
    const failures = holdoutCaseId ? [{
      caseId: holdoutCaseId, label: null, codes: ["identity_mismatch"], detail: "synthetic-test",
    }] : [];
    const bySplit = (["acquisition", "calibration", "holdout"] as const).map(split => {
      const cases = goldenFoodCorpus.cases.filter(c => c.split === split);
      const resolvable = cases.filter(c => c.decisionClass === "resolvable");
      const failed = cases.filter(c => failures.some(f => f.caseId === c.caseId));
      return {
        dimension: "split", segment: split, cases: cases.length,
        resolvableLabeled: resolvable.length,
        matchedCases: cases.length - failed.length, failedCases: failed.length,
        abstentions: 0, matchRate: resolvable.length
          ? (resolvable.length - failed.filter(c => c.decisionClass === "resolvable").length) / resolvable.length : null,
        totalCostUsd: null, costSamples: 0, totalLatencyMs: null, latencySamples: 0,
      };
    });
    return {
      corpusVersion: goldenFoodCorpus.corpusVersion, caseCount: goldenFoodCorpus.cases.length,
      resolveCalls: goldenFoodCorpus.cases.length, bySplit, failures,
      resolver: { id: "food-intelligence-v2-domain-resolver", revision: revisions.resolver },
      revisions,
      integrity: {
        status: "valid", reference: { verified: true }, splitLeakage: [],
        holdoutKnowledgeWrites: [], knowledgeWritesOutside: [], knowledgeWritesAfterStep: [],
      },
    } as unknown as CorpusReport;
  }

  it("holds calibration metrics and brand/measure segments constant when holdout answers change", () => {
    const caseId = goldenFoodCorpus.cases.find(c =>
      c.split === "holdout" && c.decisionClass === "resolvable")?.caseId;
    expect(caseId).toBeDefined();
    const first = projectSplitEvidence(goldenFoodCorpus, reportWithHoldoutFailure(null),
      "p", "baseline", "a", "2026-10-26T10:02:00.000Z", "calibration");
    const changed = projectSplitEvidence(goldenFoodCorpus, reportWithHoldoutFailure(caseId!),
      "p", "baseline", "a", "2026-10-26T10:02:00.000Z", "calibration");
    expect(changed).toEqual(first);
    expect(first.segments.some(item => item.dimension === "modality")).toBe(true);
    expect(first.segments.some(item => item.dimension === "brand")).toBe(true);
    expect(first.segments.some(item => item.dimension === "measure")).toBe(true);
    const holdout = projectSplitEvidence(goldenFoodCorpus, reportWithHoldoutFailure(caseId!),
      "p", "baseline", "a", "2026-10-26T10:02:00.000Z", "holdout");
    expect(holdout.failedCases).toBe(1);
  });

  it("blocks a spoofed synthetic resolver, corpus mismatch and false report counters", () => {
    const fake = reportWithHoldoutFailure(null);
    const selfTest = { ...fake, resolver: { id: "self-test:reference-oracle", revision: revisions.resolver } };
    expect(projectSplitEvidence(goldenFoodCorpus, selfTest,
      "p", "baseline", "a", registeredAt, "calibration").structuralViolations)
      .toContain("synthetic_resolver");
    expect(() => projectSplitEvidence(goldenFoodCorpus, { ...fake, caseCount: 1 },
      "p", "baseline", "a", registeredAt, "calibration")).toThrow();
    expect(() => projectSplitEvidence(goldenFoodCorpus,
      { ...fake, bySplit: fake.bySplit.map(row => row.segment === "calibration" ?
        { ...row, matchedCases: 999 } : row) },
      "p", "baseline", "a", registeredAt, "calibration")).toThrow();
  });
});
