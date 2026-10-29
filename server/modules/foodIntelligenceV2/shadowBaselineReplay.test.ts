import { describe, expect, it } from "vitest";
import { buildV1HistoricalSnapshotFixture, buildFoodResolutionDecisionFixture } from "./fixtures";
import { buildFoodShadowEvent, type FoodShadowEvent } from "./shadowComparison";
import { replaySanitizedFoodShadowEvents } from "./shadowBaselineReplay";

const baseTrace = "b4e590ab-35bd-44cd-932a-e895e51ec7a2";
function event(override: Partial<{
  traceId: string; entrypoint: FoodShadowEvent["entrypoint"];
  modality: FoodShadowEvent["modality"]; scenarioClass: FoodShadowEvent["scenarioClass"];
  v1Ms: number; totalMs: number;
}> = {}) {
  return buildFoodShadowEvent({
    traceId: override.traceId ?? baseTrace,
    modality: override.modality ?? "text",
    entrypoint: override.entrypoint ?? "web",
    scenarioClass: override.scenarioClass ?? "generic",
    v1: buildV1HistoricalSnapshotFixture(), v1Failure: null,
    v2: [buildFoodResolutionDecisionFixture()], observations: [],
    failure: "none", timings: {
      v1Ms: override.v1Ms ?? 10, languageMs: 2, resolverMs: 3,
      totalMs: override.totalMs ?? 20,
    },
  });
}
const envelope = (...events: FoodShadowEvent[]) => ({
  schemaVersion: 1, kind: "food-v2-sanitized-shadow-events", events,
});

describe("#1307 / A-004: bounded C4 baseline diagnostics, never operational approval", () => {
  it("segments same food class by entrypoint and computes per-request v1 p50/p95", () => {
    const report = replaySanitizedFoodShadowEvents(envelope(
      event({ v1Ms: 10, totalMs: 50 }),
      event({ traceId: "0ad100b8-35bd-44cd-932a-e895e51ec7a2", v1Ms: 100, totalMs: 110 }),
      event({ traceId: "c7ec7b9c-35bd-44cd-932a-e895e51ec7a2", entrypoint: "whatsapp", v1Ms: 300, totalMs: 900 }),
    ));
    expect(report).toMatchObject({
      status: "diagnostic-only", gateAApproved: false, sampleProvenanceVerified: false,
      baseline: { totalRuns: 3, verifiedAccuracy: null, rolloutEligible: false },
    });
    const web = report.baseline.segments.find(s => s.entrypoint === "web")!;
    const whatsapp = report.baseline.segments.find(s => s.entrypoint === "whatsapp")!;
    expect(report.baseline.segments).toHaveLength(2);
    expect(web).toMatchObject({ runs: 2, compared: 2, v1LatencyP50Ms: 10,
      v1LatencyP95Ms: 100, shadowCompletionP95Ms: 110,
      v1Outcomes: { resolved: 2, not_compared: 0 },
    });
    expect(whatsapp).toMatchObject({ runs: 1, v1LatencyP95Ms: 300,
      shadowCompletionP95Ms: 900, entrypoint: "whatsapp" });
    expect(JSON.stringify(report)).not.toContain(baseTrace);
    expect(JSON.stringify(report)).not.toContain("0ad100b8");
  });

  it("rejects user content at every nested boundary without leaking its value in errors", () => {
    const secrets = "private-user@personal.example";
    for (const edited of [
      { ...event(), sourceText: secrets },
      { ...event(), context: { ...event().context, prompt: secrets } },
      { ...event(), differences: { ...event().differences, sourceText: secrets } },
      { ...event(), capabilityUsage: [{ capability: "MEAL_TEXT", calls: 1, retries: 0,
        totalLatencyMs: 1, costMeasuredCalls: 0, estimatedCostUsd: null, correlation: secrets }] },
    ]) {
      try { replaySanitizedFoodShadowEvents(envelope(edited as FoodShadowEvent)); }
      catch (error) {
        expect(String(error)).toContain("invalid-sanitized-shadow-events");
        expect(String(error)).not.toContain(secrets);
        continue;
      }
      throw new Error("unsafe event accepted");
    }
  });

  it("rejects forged approval, repeated trace, partial/incorrect counter and invalid cost claims", () => {
    const first = event();
    const bad = { ...first, differences: { ...first.differences, unpairedItems: 999 } };
    expect(() => replaySanitizedFoodShadowEvents(envelope(bad))).toThrow("invalid-sanitized-shadow-events");
    expect(() => replaySanitizedFoodShadowEvents(envelope(first, first))).toThrow("duplicate-shadow-trace-id");
    expect(() => replaySanitizedFoodShadowEvents({ ...envelope(first), gateAApproved: true }))
      .toThrow("invalid-sanitized-shadow-events");
    expect(() => replaySanitizedFoodShadowEvents(envelope({ ...first, timings: {
      ...first.timings, v1Ms: -1,
    } }))).toThrow("invalid-sanitized-shadow-events");
    expect(() => replaySanitizedFoodShadowEvents(envelope({ ...first, capabilityUsage: [{
      capability: "MEAL_TEXT", calls: 2, retries: 3, totalLatencyMs: 1,
      costMeasuredCalls: 2, estimatedCostUsd: 0.5,
    }] }))).toThrow("invalid-sanitized-shadow-events");
  });

  it("A-008 rejects omitted item gaps in complete and two-sided partial comparisons", () => {
    const valid = event();
    // A self-consistent sum of zero gaps still hides two items on each side.
    const undercounted = { ...valid, v1ItemCount: 2, v2ItemCount: 2,
      differences: { ...valid.differences, comparablePairs: 0,
        v1UnpairedItems: 0, v2UnpairedItems: 0, unpairedItems: 0 } };
    for (const run of ["compared", "partial"] as const) {
      expect(() => replaySanitizedFoodShadowEvents(envelope({ ...undercounted, run })))
        .toThrow("invalid-sanitized-shadow-events");
    }
    // A sum that exceeds the total for either side must also be rejected.
    const overcounted = { ...valid, differences: { ...valid.differences,
      v1UnpairedItems: valid.v1ItemCount, unpairedItems: valid.v1ItemCount } };
    expect(() => replaySanitizedFoodShadowEvents(envelope(overcounted)))
      .toThrow("invalid-sanitized-shadow-events");

    // A V1 clarification exception has no item list. It must stay partial,
    // report the outcome divergence, and never invent unpaired V1/V2 items.
    const exception = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "ambiguous",
      v1: null, v1Failure: "clarification", v2: [buildFoodResolutionDecisionFixture()],
      observations: [], failure: "none",
      timings: { v1Ms: 2, languageMs: 3, resolverMs: 4, totalMs: 9 },
    });
    expect(exception.run).toBe("partial");
    const report = replaySanitizedFoodShadowEvents(envelope(exception));
    expect(report.baseline.segments[0]).toMatchObject({
      runs: 1, compared: 0, partial: 1, pairedItems: 0,
      clarificationDifferences: 1, unpairedItems: 0,
    });
    expect(() => replaySanitizedFoodShadowEvents(envelope({
      ...exception, run: "compared",
    }))).toThrow("invalid-sanitized-shadow-events");
  });

  it("A-008 reconciles both observed lists even when either partial result is empty", () => {
    const originalV1 = buildV1HistoricalSnapshotFixture();
    const twoV1 = { ...originalV1, items: [
      originalV1.items[0], { ...originalV1.items[0], foodName: "Arroz", canonicalName: "Arroz" },
    ] };
    const firstV2 = buildFoodResolutionDecisionFixture();
    const twoV2 = [firstV2, buildFoodResolutionDecisionFixture({
      identity: { canonicalName: "Arroz" },
    })];
    const request = {
      traceId: baseTrace, modality: "text" as const, entrypoint: "replay" as const,
      scenarioClass: "mixed" as const, observations: [], failure: "none" as const,
      v1Failure: null, partialEvidence: true,
      timings: { v1Ms: 2, languageMs: 1, resolverMs: 1, totalMs: 4 },
    };
    const observed = [
      buildFoodShadowEvent({ ...request, v1: twoV1, v2: [] }),
      buildFoodShadowEvent({ ...request, v1: { ...originalV1, items: [] }, v2: twoV2 }),
    ];
    for (const [index, valid] of observed.entries()) {
      expect(valid).toMatchObject({
        run: "partial", v1ItemsObserved: true, v2ItemsObserved: true,
        differences: { comparablePairs: 0, unpairedItems: 2 },
      });
      expect(valid.differences.v1UnpairedItems).toBe(index === 0 ? 2 : 0);
      expect(valid.differences.v2UnpairedItems).toBe(index === 0 ? 0 : 2);
      const report = replaySanitizedFoodShadowEvents(envelope(valid));
      expect(report.baseline.segments[0]).toMatchObject({
        partial: 1, pairedItems: 0, unpairedItems: 2,
      });
      // Sum-of-gaps remains internally consistent but hides two real items.
      const hidden = { ...valid, differences: { ...valid.differences,
        v1UnpairedItems: 0, v2UnpairedItems: 0, unpairedItems: 0 } };
      expect(() => replaySanitizedFoodShadowEvents(envelope(hidden)))
        .toThrow("invalid-sanitized-shadow-events");
      // A missing or forged observation marker may not override known totals.
      expect(() => replaySanitizedFoodShadowEvents(envelope({ ...valid,
        [index === 0 ? "v1ItemsObserved" : "v2ItemsObserved"]: false,
      }))).toThrow("invalid-sanitized-shadow-events");
    }
  });

  it("A-008 does not manufacture gaps for a genuinely missing V1 or V2 snapshot", () => {
    const request = {
      traceId: baseTrace, modality: "text" as const, entrypoint: "replay" as const,
      scenarioClass: "generic" as const, observations: [], failure: "none" as const,
      timings: { v1Ms: 2, languageMs: 1, resolverMs: 1, totalMs: 4 },
    };
    const v1Absent = buildFoodShadowEvent({ ...request,
      v1: null, v1Failure: "clarification", v2: [buildFoodResolutionDecisionFixture()],
    });
    const v2Absent = buildFoodShadowEvent({ ...request,
      v1: buildV1HistoricalSnapshotFixture(), v1Failure: null, v2: null,
    });
    for (const valid of [v1Absent, v2Absent]) {
      expect(valid.run).toBe("partial");
      expect(valid.differences).toMatchObject({
        comparablePairs: 0, v1UnpairedItems: 0, v2UnpairedItems: 0,
      });
      expect(replaySanitizedFoodShadowEvents(envelope(valid)).baseline.segments[0].unpairedItems)
        .toBe(0);
      expect(() => replaySanitizedFoodShadowEvents(envelope({ ...valid,
        run: "compared",
      }))).toThrow("invalid-sanitized-shadow-events");
    }
    expect(v1Absent).toMatchObject({
      v1ItemsObserved: false, v2ItemsObserved: true, v1Outcome: "clarification",
    });
    expect(v2Absent).toMatchObject({
      v1ItemsObserved: true, v2ItemsObserved: false, v2Outcome: "not_compared",
    });
    expect(() => replaySanitizedFoodShadowEvents(envelope({
      ...v1Absent, v1ItemsObserved: true,
    }))).toThrow("invalid-sanitized-shadow-events");
    expect(() => replaySanitizedFoodShadowEvents(envelope({
      ...v2Absent, v2ItemsObserved: true,
    }))).toThrow("invalid-sanitized-shadow-events");
    const { v1ItemsObserved: unused, ...oldFormat } = v2Absent;
    expect(unused).toBe(true);
    expect(() => replaySanitizedFoodShadowEvents(envelope(oldFormat as FoodShadowEvent)))
      .toThrow("invalid-sanitized-shadow-events");
  });

  it("does not accept an empty/oversized or malformed replay as a measured population", () => {
    expect(() => replaySanitizedFoodShadowEvents(envelope())).toThrow("invalid-sanitized-shadow-events");
    expect(() => replaySanitizedFoodShadowEvents({ schemaVersion: 1, kind: "food-v2-sanitized-shadow-events",
      events: Array.from({ length: 10001 }, () => event()),
    })).toThrow("invalid-sanitized-shadow-events");
    expect(() => replaySanitizedFoodShadowEvents({ events: [event()] }))
      .toThrow("invalid-sanitized-shadow-events");
  });
});
