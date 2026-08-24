import { describe, expect, it } from "vitest";
import {
  assertDistinctCandidateIdentities,
  evaluateGate,
  summarizeObservations,
} from "./issue-989-question-latency-benchmark.mjs";

describe("question latency benchmark gate", () => {
  it("deriva erros e timeouts das observações em vez de assumir zero", () => {
    const summary = summarizeObservations([
      { outcome: "success", totalMs: 100 },
      { outcome: "error", totalMs: 120 },
      { outcome: "timeout", totalMs: 2_000 },
    ]);

    expect(summary).toEqual(expect.objectContaining({
      totalRuns: 3,
      successfulRuns: 1,
      errors: 1,
      timeouts: 1,
      p50TotalMs: 100,
    }));
  });

  it("reprova quando o candidato aumenta erros ou timeouts", () => {
    const baseline = {
      successfulRuns: 40,
      errors: 0,
      timeouts: 0,
      p50TotalMs: 200,
      p90TotalMs: 200,
      p95TotalMs: 200,
    };
    const improved = {
      successfulRuns: 40,
      errors: 0,
      timeouts: 0,
      p50TotalMs: 120,
      p90TotalMs: 140,
      p95TotalMs: 195,
    };

    expect(evaluateGate(baseline, improved).passed).toBe(true);
    expect(evaluateGate(baseline, { ...improved, successfulRuns: 39, errors: 1 }).passed).toBe(false);
    expect(evaluateGate(baseline, { ...improved, successfulRuns: 39, timeouts: 1 }).passed).toBe(false);
  });

  it("rejeita baseline e candidato com a mesma identidade", () => {
    expect(() => assertDistinctCandidateIdentities("same", "same")).toThrow(/distinct explicit commit SHAs/);
    expect(() => assertDistinctCandidateIdentities("base", "candidate")).not.toThrow();
  });
});
