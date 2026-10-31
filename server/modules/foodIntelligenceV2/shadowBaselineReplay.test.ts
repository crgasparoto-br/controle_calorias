import { describe, expect, it } from "vitest";
import { buildV1HistoricalSnapshotFixture, buildFoodResolutionDecisionFixture, buildFoodObservationFixture } from "./fixtures";
import { buildFoodShadowBaseline, buildFoodShadowEvent, type FoodShadowEvent } from "./shadowComparison";
import { MAX_SHADOW_EVENT_COST_USD, MAX_SHADOW_EVENT_COUNT, MAX_SHADOW_MACRO_EVENT_DELTA, MAX_SHADOW_REPLAY_COUNT, MAX_SHADOW_TIMING_MS, shadowMacroDifference, sumShadowCounts } from "./shadowPairing";
import { replaySanitizedFoodShadowEvents } from "./shadowBaselineReplay";

const baseTrace = "b4e590ab-35bd-44cd-932a-e895e51ec7a2";
function event(override: Partial<{
  traceId: string; entrypoint: FoodShadowEvent["entrypoint"];
  modality: FoodShadowEvent["modality"]; scenarioClass: FoodShadowEvent["scenarioClass"];
  v1Ms: number; languageMs: number; resolverMs: number; totalMs: number;
}> = {}) {
  return buildFoodShadowEvent({
    traceId: override.traceId ?? baseTrace,
    modality: override.modality ?? "text",
    entrypoint: override.entrypoint ?? "web",
    scenarioClass: override.scenarioClass ?? "generic",
    v1: buildV1HistoricalSnapshotFixture(), v1Failure: null,
    v2: [buildFoodResolutionDecisionFixture()], observations: [buildFoodObservationFixture()],
    failure: "none", timings: {
      v1Ms: override.v1Ms ?? 10, languageMs: override.languageMs ?? 2,
      resolverMs: override.resolverMs ?? 3, totalMs: override.totalMs ?? 20,
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

  it("A-028 flags missing or unavailable V1 nutrition provenance without inventing a confirmed error", () => {
    const original = buildV1HistoricalSnapshotFixture();
    const cases = [
      { calories: 0, origin: null, expected: 1 }, // A-028: numeric placeholder, no source
      { calories: 120, origin: "unavailable", expected: 1 }, // Explicit absence, not a source
      { calories: 0, origin: "unavailable", expected: 1 }, // Both failures at once
      { calories: 120, origin: null, expected: 1 }, // Original positive-control gap
      { calories: 0, origin: "catalog", expected: 0 }, // Legitimate zero with declared source
      { calories: 120, origin: "nutrition_label", expected: 0 },
      { calories: 120, origin: "heuristic", expected: 0 }, // Declared estimation is not silent
    ] as const;
    const makeTrace = (id: number) => `b4e590ab-35bd-44cd-932a-${String(id).padStart(12, "0")}`;
    const records = cases.map(({ calories, origin, expected }, index) => {
      const shadowEvent = buildFoodShadowEvent({
        traceId: makeTrace(index + 1), modality: "text", entrypoint: "web",
        scenarioClass: "generic",
        v1: { ...original, items: [{
          ...original.items[0], calories, protein: 0, carbs: 0, fat: 0,
          resolution: origin === null ? null : { nutritionOrigin: origin },
        }] },
        v1Failure: null,
        v2: [buildFoodResolutionDecisionFixture()],
        observations: [buildFoodObservationFixture()], failure: "none",
        timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
      });
      expect(shadowEvent.flagged.possibleSilentFallback).toBe(expected);
      expect(shadowEvent.verifiedCorrect).toBeNull();
      return shadowEvent;
    });
    // A failed/partial observation must not erase a saved V1 provenance gap.
    const partial = buildFoodShadowEvent({
      traceId: makeTrace(cases.length + 1), modality: "text", entrypoint: "web",
      scenarioClass: "generic",
      v1: { ...original, items: [{
        ...original.items[0], calories: 0, protein: 0, carbs: 0, fat: 0,
        resolution: null,
      }] },
      v1Failure: null, v2: null, observations: [], failure: "evidence_unavailable",
      timings: { v1Ms: 1, languageMs: 0, resolverMs: 0, totalMs: 1 },
    });
    expect(partial.flagged.possibleSilentFallback).toBe(1);
    const all = [...records, partial];
    const direct = buildFoodShadowBaseline(all);
    const replay = replaySanitizedFoodShadowEvents(envelope(...all));
    expect(direct.segments).toHaveLength(1);
    expect(direct.segments[0]).toMatchObject({
      runs: 8, compared: 7, failed: 1, potentialSilentFallbacks: 5,
    });
    expect(replay.baseline).toEqual(direct);
    expect(replay.baseline.verifiedAccuracy).toBeNull();
    expect(replay.baseline.rolloutEligible).toBe(false);
  });

  it("A-026 enforces the same strict sanitization for direct aggregation and replay", () => {
    const positive = event();
    expect(buildFoodShadowBaseline([positive]).segments[0]).toMatchObject({
      runs: 1, pairedItems: 1, modality: "text", scenarioClass: "generic",
    });
    const zero = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "web", scenarioClass: "unknown",
      v1: { ...buildV1HistoricalSnapshotFixture(), items: [] }, v1Failure: null,
      v2: [], observations: [], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
    });
    expect(buildFoodShadowBaseline([zero]).segments[0].pairedItems).toBe(0);
    const inputs: unknown[] = [
      { ...zero, differences: { ...zero.differences, comparablePairs: 3 } },
      { ...positive, scenarioClass: "private.user@example.test" },
      { ...positive, modality: "private.media@example.test" },
      { ...positive, entrypoint: "user:1234" },
      { ...positive, context: { ...positive.context, prompt: "private data" } },
      { ...positive, flagged: { ...positive.flagged, explicitFailure: 1 } },
      { ...positive, differences: { ...positive.differences, unpairedItems: 6 } },
      { ...positive, v2Stages: { s1: 0, s2: 0, s3: 0 } },
      { ...positive, run: "failed", failure: "none" },
      { ...positive, failure: "evidence_unavailable", run: "failed" },
      { ...positive, capabilityUsage: [{ capability: "MEAL_TEXT", calls: 1,
        retries: 0, totalLatencyMs: 1, estimatedCostUsd: null, costMeasuredCalls: 0 },
        { capability: "MEAL_TEXT", calls: 1,
          retries: 0, totalLatencyMs: 1, estimatedCostUsd: null, costMeasuredCalls: 0 }] },
      { ...positive, traceId: "private.user@example.test" },
      { ...positive, rawText: "private data" },
    ];
    for (const forged of inputs) {
      expect(() => buildFoodShadowBaseline([forged as FoodShadowEvent])).toThrow();
      expect(() => replaySanitizedFoodShadowEvents(envelope(forged as FoodShadowEvent)))
        .toThrow("invalid-sanitized-shadow-events");
    }
    const privateLabel = inputs[1];
    try { buildFoodShadowBaseline([privateLabel as FoodShadowEvent]); }
    catch (error) { expect(String(error)).not.toContain("private.user@example.test"); }
    expect(() => buildFoodShadowBaseline([positive, positive])).toThrow("duplicate-shadow-trace-id");
    // Schema invariants must apply regardless of partial/failed denominators.
    const partial = { ...positive, run: "partial" as const };
    expect(buildFoodShadowBaseline([partial]).segments[0]).toMatchObject({ partial: 1, pairedItems: 0 });
    expect(() => buildFoodShadowBaseline([{ ...partial, differences: {
      ...partial.differences, comparablePairs: 2,
    } }])).toThrow();
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
      observations: [buildFoodObservationFixture()], failure: "none",
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
      buildFoodShadowEvent({ ...request, v1: { ...originalV1, items: [] }, v2: twoV2,
        observations: [buildFoodObservationFixture(), buildFoodObservationFixture()] }),
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
      observations: [buildFoodObservationFixture()],
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

  it("A-011 rejects discrepancies exceeding comparable pairs or unmatched replacements", () => {
    const onePair = event();
    expect(onePair).toMatchObject({ v1ItemCount: 1, v2ItemCount: 1,
      differences: { comparablePairs: 1, v1UnpairedItems: 0, v2UnpairedItems: 0 } });
    // A positive match remains admissible for both complete and partial observations.
    for (const run of ["compared", "partial"] as const) {
      const observed = { ...onePair, run };
      expect(() => replaySanitizedFoodShadowEvents(envelope(observed))).not.toThrow();
      // Any of these bogus values would survive a validator that only reconciles
      // comparablePairs + unpaired against the item counts (the earlier A-008 gate).
      for (const field of ["identity", "variant", "variantIdUnverifiable",
        "quantity", "nutrition", "source"] as const) {
        expect(() => replaySanitizedFoodShadowEvents(envelope({
          ...observed, differences: { ...observed.differences, [field]: 2 },
        }))).toThrow("invalid-sanitized-shadow-events");
      }
    }

    const v1 = buildV1HistoricalSnapshotFixture();
    const unmatched = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "mixed",
      v1, v1Failure: null,
      v2: [buildFoodResolutionDecisionFixture({ identity: { canonicalName: "Arroz" } })],
      observations: [buildFoodObservationFixture()], failure: "none",
      timings: { v1Ms: 2, languageMs: 1, resolverMs: 1, totalMs: 4 },
    });
    expect(unmatched).toMatchObject({ differences: { comparablePairs: 0,
      v1UnpairedItems: 1, v2UnpairedItems: 1, identity: 1 } });
    // An unmatched replacement may produce one identity and/or variant signal,
    // but never two signals of the same kind from a single unmatched pair.
    expect(() => replaySanitizedFoodShadowEvents(envelope({
      ...unmatched, differences: { ...unmatched.differences, variant: 1 },
    }))).not.toThrow();
    for (const field of ["identity", "variant"] as const) {
      expect(() => replaySanitizedFoodShadowEvents(envelope({
        ...unmatched, differences: { ...unmatched.differences, [field]: 2 },
      }))).toThrow("invalid-sanitized-shadow-events");
    }
    expect(() => replaySanitizedFoodShadowEvents(envelope({
      ...unmatched, differences: { ...unmatched.differences,
        macros: { ...unmatched.differences.macros, calories: 0 } },
    }))).toThrow("invalid-sanitized-shadow-events");
  });

  it("A-011 bounds each suspected fallback/conflict by its observed side", () => {
    const valid = event();
    expect(valid.v1ItemCount).toBe(1);
    expect(valid.v2ItemCount).toBe(1);
    expect(() => replaySanitizedFoodShadowEvents(envelope(valid))).not.toThrow();
    // Positive boundary: one item can contribute one flag in each independent
    // category, even if the run is partial (not promoted to verified accuracy).
    const atBoundary = { ...valid, run: "partial" as const, flagged: {
      possibleSilentFallback: 1, v2MissingNutritionProvenance: 1,
      explicitFailure: 0, sourceConflicts: 1,
    } };
    const bounded = replaySanitizedFoodShadowEvents(envelope(atBoundary));
    expect(bounded.baseline.segments[0]).toMatchObject({
      runs: 1, partial: 1, pairedItems: 0,
      potentialSilentFallbacks: 1, missingNutritionProvenance: 1, explicitFailures: 0,
    });
    expect(bounded.baseline.verifiedAccuracy).toBeNull();
    // An actual non-food rejection is the positive boundary for explicitFailure;
    // an otherwise-resolved V2 item cannot be mislabeled as a rejection.
    const rejected = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "unknown",
      v1: buildV1HistoricalSnapshotFixture(), v1Failure: null,
      v2: [buildFoodResolutionDecisionFixture({ status: "unknown", nextAction: "reject",
        nutrition: { consumed: null, evidenceIds: [] } })],
      observations: [buildFoodObservationFixture()], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
    });
    expect(rejected).toMatchObject({ v2Outcome: "unknown", flagged: { explicitFailure: 1 } });
    expect(() => replaySanitizedFoodShadowEvents(envelope(rejected))).not.toThrow();
    for (const field of ["possibleSilentFallback", "v2MissingNutritionProvenance",
      "explicitFailure", "sourceConflicts"] as const) {
      const source = field === "explicitFailure" ? rejected : atBoundary;
      expect(() => replaySanitizedFoodShadowEvents(envelope({
        ...source, flagged: { ...source.flagged, [field]: 2 },
      }))).toThrow("invalid-sanitized-shadow-events");
    }

    const missingV1 = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "ambiguous",
      v1: null, v1Failure: "clarification", v2: [buildFoodResolutionDecisionFixture()],
      observations: [buildFoodObservationFixture()], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
    });
    expect(() => replaySanitizedFoodShadowEvents(envelope(missingV1))).not.toThrow();
    expect(() => replaySanitizedFoodShadowEvents(envelope({
      ...missingV1, flagged: { ...missingV1.flagged, possibleSilentFallback: 1 },
    }))).toThrow("invalid-sanitized-shadow-events");
    expect(() => replaySanitizedFoodShadowEvents(envelope({
      ...missingV1, differences: { ...missingV1.differences, clarification: true },
    }))).not.toThrow();

    const missingV2 = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "generic",
      v1: buildV1HistoricalSnapshotFixture(), v1Failure: null, v2: null,
      observations: [], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 0, totalMs: 2 },
    });
    expect(() => replaySanitizedFoodShadowEvents(envelope(missingV2))).not.toThrow();
    for (const field of ["v2MissingNutritionProvenance", "explicitFailure", "sourceConflicts"] as const) {
      expect(() => replaySanitizedFoodShadowEvents(envelope({
        ...missingV2, flagged: { ...missingV2.flagged, [field]: 1 },
      }))).toThrow("invalid-sanitized-shadow-events");
    }
    expect(() => replaySanitizedFoodShadowEvents(envelope({
      ...missingV2, differences: { ...missingV2.differences, clarification: true },
    }))).toThrow("invalid-sanitized-shadow-events");
  });

  it("A-012 rejects contradictory failure states and unreachable V1/V2 outcomes", () => {
    const observed = event();
    // Producer cannot report a completed V2 resolution when no linguistic
    // evidence or resolver result exists, even if all item counts add up.
    for (const failure of ["evidence_unavailable", "language_unavailable", "resolver_unavailable"] as const) {
      expect(() => replaySanitizedFoodShadowEvents(envelope({
        ...observed, run: "failed", failure,
      }))).toThrow("invalid-sanitized-shadow-events");
    }
    // The V1 adapter emits resolved/clarification/failed/not_compared only.
    for (const v1Outcome of ["partially_resolved", "ambiguous", "unknown"] as const) {
      expect(() => replaySanitizedFoodShadowEvents(envelope({ ...observed, v1Outcome })))
        .toThrow("invalid-sanitized-shadow-events");
    }
    const request = {
      traceId: baseTrace, modality: "text" as const, entrypoint: "replay" as const,
      scenarioClass: "ambiguous" as const, observations: [],
      v1: buildV1HistoricalSnapshotFixture(), v1Failure: null,
      timings: { v1Ms: 2, languageMs: 0, resolverMs: 0, totalMs: 2 },
    };
    const failed = buildFoodShadowEvent({ ...request, v2: null, failure: "language_unavailable" });
    expect(failed.run).toBe("failed");
    expect(() => replaySanitizedFoodShadowEvents(envelope(failed))).not.toThrow();
    expect(() => replaySanitizedFoodShadowEvents(envelope({
      ...failed, v2Outcome: "failed",
    }))).toThrow("invalid-sanitized-shadow-events");

    // Missing V2 snapshots and genuinely empty V2 decision lists differ.
    const partial = buildFoodShadowEvent({ ...request, failure: "none", v2: null });
    expect(partial.run).toBe("partial");
    expect(() => replaySanitizedFoodShadowEvents(envelope(partial))).not.toThrow();
    const emptyV2 = buildFoodShadowEvent({ ...request, failure: "none", v2: [] });
    expect(emptyV2).toMatchObject({ v2ItemsObserved: true, v2ItemCount: 0, v2Outcome: "unknown" });
    expect(() => replaySanitizedFoodShadowEvents(envelope(emptyV2))).not.toThrow();
    expect(() => replaySanitizedFoodShadowEvents(envelope({
      ...emptyV2, v2Outcome: "resolved",
    }))).toThrow("invalid-sanitized-shadow-events");
  });

  it("A-012 rejects forged positive macro deltas without a nutrition discrepancy", () => {
    const observed = event();
    // Existing A-011 bounds accept <= 1 nutritional discrepancy for one
    // comparable pair; the new invariant must additionally bind its macro sum.
    const coherent = { ...observed, differences: {
      ...observed.differences, nutrition: 1,
      macros: { ...observed.differences.macros, calories: 5 },
    } };
    expect(() => replaySanitizedFoodShadowEvents(envelope(coherent))).not.toThrow();
    const forged = { ...coherent, differences: { ...coherent.differences, nutrition: 0 } };
    expect(() => replaySanitizedFoodShadowEvents(envelope(forged)))
      .toThrow("invalid-sanitized-shadow-events");
    // Missing/unmeasurable macros remain null; zero is still a valid delta.
    const noDrift = { ...coherent, differences: { ...coherent.differences,
      nutrition: 0, macros: { calories: 0, protein: null, carbs: null, fat: null },
    } };
    expect(() => replaySanitizedFoodShadowEvents(envelope(noDrift))).not.toThrow();
  });

  it("A-014 reconciles explicit rejections with reachable V2 outcome distributions", () => {
    const resolved = event();
    const rejected = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "unknown",
      v1: buildV1HistoricalSnapshotFixture(), v1Failure: null,
      v2: [buildFoodResolutionDecisionFixture({ status: "unknown", nextAction: "reject",
        nutrition: { consumed: null, evidenceIds: [] } })],
      observations: [buildFoodObservationFixture()], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
    });
    const empty = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "unknown",
      v1: buildV1HistoricalSnapshotFixture(), v1Failure: null,
      v2: [], observations: [], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
    });
    expect(rejected).toMatchObject({ v2Outcome: "unknown", v2ItemCount: 1,
      flagged: { explicitFailure: 1 } });
    expect(empty).toMatchObject({ v2Outcome: "unknown", v2ItemCount: 0,
      flagged: { explicitFailure: 0 } });
    for (const valid of [resolved, rejected, empty]) {
      expect(() => replaySanitizedFoodShadowEvents(envelope(valid))).not.toThrow();
    }
    // Reject both fabricated failures in a completed V2 and suppressed
    // failures in a nonempty unknown V2, including a sibling outcome.
    for (const forged of [
      { ...resolved, flagged: { ...resolved.flagged, explicitFailure: 1 } },
      { ...resolved, v2Outcome: "partially_resolved" as const,
        flagged: { ...resolved.flagged, explicitFailure: 1 } },
      { ...resolved, v2Outcome: "ambiguous" as const,
        flagged: { ...resolved.flagged, explicitFailure: 1 } },
      { ...rejected, flagged: { ...rejected.flagged, explicitFailure: 0 } },
    ]) {
      expect(() => replaySanitizedFoodShadowEvents(envelope(forged)))
        .toThrow("invalid-sanitized-shadow-events");
    }
  });

  it("A-014 requires the exact clarification difference or null for missing sides", () => {
    const resolved = event();
    const v1Exception = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "ambiguous",
      v1: null, v1Failure: "clarification", v2: [buildFoodResolutionDecisionFixture()],
      observations: [buildFoodObservationFixture()], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
    });
    const bothClarify = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "ambiguous",
      v1: null, v1Failure: "clarification",
      v2: [buildFoodResolutionDecisionFixture({ status: "unknown", nextAction: "clarify",
        nutrition: { consumed: null, evidenceIds: [] } })],
      observations: [buildFoodObservationFixture()], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
    });
    const v1Missing = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "ambiguous",
      v1: null, v1Failure: null, v2: [buildFoodResolutionDecisionFixture()],
      observations: [buildFoodObservationFixture()], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
    });
    const v1Failure = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "unknown",
      v1: null, v1Failure: "failed", v2: [buildFoodResolutionDecisionFixture()],
      observations: [buildFoodObservationFixture()], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
    });
    const v2Missing = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "ambiguous",
      v1: buildV1HistoricalSnapshotFixture(), v1Failure: null,
      v2: null, observations: [], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 0, totalMs: 3 },
    });
    expect(resolved.differences.clarification).toBe(false);
    expect(v1Exception.differences.clarification).toBe(true);
    expect(bothClarify.differences.clarification).toBe(false);
    expect(v1Missing.differences.clarification).toBeNull();
    expect(v1Failure.differences.clarification).toBeNull();
    expect(v2Missing.differences.clarification).toBeNull();
    for (const valid of [resolved, v1Exception, bothClarify, v1Missing, v1Failure, v2Missing]) {
      expect(() => replaySanitizedFoodShadowEvents(envelope(valid))).not.toThrow();
    }
    for (const [valid, forgedClarification] of [
      [resolved, true], [resolved, null], [v1Exception, false],
      [bothClarify, true], [v1Missing, false], [v1Failure, false], [v2Missing, false],
    ] as const) {
      expect(() => replaySanitizedFoodShadowEvents(envelope({ ...valid,
        differences: { ...valid.differences, clarification: forgedClarification },
      }))).toThrow("invalid-sanitized-shadow-events");
    }
  });

  it("A-014 forbids fabricated S1/S2/S3 when the linguistic stage returned no observations", () => {
    const request = {
      traceId: baseTrace, modality: "text" as const, entrypoint: "replay" as const,
      scenarioClass: "generic" as const, v1: buildV1HistoricalSnapshotFixture(),
      v1Failure: null, v2: null,
      timings: { v1Ms: 1, languageMs: 0, resolverMs: 0, totalMs: 3 },
    };
    for (const failure of ["evidence_unavailable", "language_unavailable"] as const) {
      const failed = buildFoodShadowEvent({ ...request, observations: [], failure });
      expect(failed.v2Stages).toEqual({ s1: 0, s2: 0, s3: 0 });
      expect(() => replaySanitizedFoodShadowEvents(envelope(failed))).not.toThrow();
      for (const stage of ["s1", "s2", "s3"] as const) {
        expect(() => replaySanitizedFoodShadowEvents(envelope({ ...failed,
          v2Stages: { ...failed.v2Stages, [stage]: 9 },
        }))).toThrow("invalid-sanitized-shadow-events");
      }
    }
    // Resolver failure happens *after* language comprehension. Its observed
    // normalization path remains legitimate even without a V2 decision list.
    const afterLanguage = buildFoodShadowEvent({ ...request,
      failure: "resolver_unavailable", observations: [buildFoodObservationFixture()],
    });
    expect(afterLanguage.v2Stages.s1).toBe(1);
    expect(() => replaySanitizedFoodShadowEvents(envelope(afterLanguage))).not.toThrow();
  });

  it("A-013 keeps stage counts, conflicts and stage latencies observable per segment", () => {
    const first = { ...event({ v1Ms: 10, totalMs: 25 }),
      v2Stages: { s1: 1, s2: 0, s3: 0 },
      flagged: { ...event().flagged, sourceConflicts: 1 },
      timings: { v1Ms: 10, languageMs: 5, resolverMs: 7, totalMs: 25 },
      capabilityUsage: [] as FoodShadowEvent["capabilityUsage"],
    };
    const second = { ...event({
      traceId: "0ad100b8-35bd-44cd-932a-e895e51ec7a2", v1Ms: 20, totalMs: 60,
    }),
      v2Stages: { s1: 0, s2: 1, s3: 0 },
      flagged: { ...event().flagged, sourceConflicts: 1 },
      timings: { v1Ms: 20, languageMs: 15, resolverMs: 21, totalMs: 60 },
    };
    const missing = buildFoodShadowEvent({
      traceId: "c7ec7b9c-35bd-44cd-932a-e895e51ec7a2",
      modality: "text", entrypoint: "web", scenarioClass: "generic",
      v1: buildV1HistoricalSnapshotFixture(), v1Failure: null, v2: null,
      observations: [], failure: "evidence_unavailable",
      timings: { v1Ms: 4, languageMs: 0, resolverMs: 0, totalMs: 4 },
    });
    const report = replaySanitizedFoodShadowEvents(envelope(first, second, missing));
    const segment = report.baseline.segments[0];
    expect(report.baseline.segments).toHaveLength(1);
    expect(segment).toMatchObject({
      runs: 3, compared: 2, failed: 1, v2Stages: { s1: 1, s2: 1, s3: 0 },
      sourceConflicts: 2,
      languageLatencySamples: 2, languageLatencyP50Ms: 5, languageLatencyP95Ms: 15,
      resolverLatencySamples: 2, resolverLatencyP50Ms: 7, resolverLatencyP95Ms: 21,
      capabilityUsageObservedRuns: 1, capabilityUsageUnavailableRuns: 2,
      external: [],
    });
    // Same input except the stage/conflict signal must no longer yield identical aggregates.
    const changed = { ...first, v2Stages: { s1: 0, s2: 1, s3: 0 },
      flagged: { ...first.flagged, sourceConflicts: 0 } };
    expect(JSON.stringify(replaySanitizedFoodShadowEvents(envelope(first)).baseline))
      .not.toBe(JSON.stringify(replaySanitizedFoodShadowEvents(envelope(changed)).baseline));
    const noInstrumentation = replaySanitizedFoodShadowEvents(envelope(missing)).baseline.segments[0];
    expect(noInstrumentation).toMatchObject({
      languageLatencySamples: 0, languageLatencyP50Ms: null, languageLatencyP95Ms: null,
      resolverLatencySamples: 0, resolverLatencyP50Ms: null, resolverLatencyP95Ms: null,
      capabilityUsageObservedRuns: 0, capabilityUsageUnavailableRuns: 1, external: null,
    });
    expect(report.baseline).toMatchObject({ verifiedAccuracy: null, rolloutEligible: false });
  });

  it("A-018 requires exactly one observed S1/S2/S3 stage per completed V2 decision", () => {
    const observed = event();
    expect(observed.v2Stages).toEqual({ s1: 1, s2: 0, s3: 0 });
    expect(() => replaySanitizedFoodShadowEvents(envelope(observed))).not.toThrow();
    const partial = { ...observed, run: "partial" as const };
    expect(() => replaySanitizedFoodShadowEvents(envelope(partial))).not.toThrow();

    const empty = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "unknown",
      v1: buildV1HistoricalSnapshotFixture(), v1Failure: null,
      v2: [], observations: [], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
    });
    expect(() => replaySanitizedFoodShadowEvents(envelope(empty))).not.toThrow();

    // Resolver failures keep the linguistic observations even though V2
    // decisions are unavailable; no false equality is imposed in that case.
    const resolverFailure = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "generic",
      v1: buildV1HistoricalSnapshotFixture(), v1Failure: null, v2: null,
      observations: [buildFoodObservationFixture()], failure: "resolver_unavailable",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
    });
    expect(() => replaySanitizedFoodShadowEvents(envelope(resolverFailure))).not.toThrow();

    const stages = [
      { s1: 0, s2: 2, s3: 3 }, // Prior A-013 fixture: five stages for one V2 item.
      { s1: 0, s2: 0, s3: 0 }, // Suppressed stage.
      { s1: 1, s2: 1, s3: 0 }, // One extra stage.
    ];
    for (const sample of [observed, partial]) {
      for (const v2Stages of stages) {
        expect(() => replaySanitizedFoodShadowEvents(envelope({ ...sample, v2Stages })))
          .toThrow("invalid-sanitized-shadow-events");
      }
    }
    expect(() => replaySanitizedFoodShadowEvents(envelope({
      ...empty, v2Stages: { s1: 1, s2: 0, s3: 0 },
    }))).toThrow("invalid-sanitized-shadow-events");
    // A different completed normalization path remains valid when the
    // total still equals the number of resolved observations.
    expect(() => replaySanitizedFoodShadowEvents(envelope({
      ...observed, v2Stages: { s1: 0, s2: 0, s3: 1 },
    }))).not.toThrow();
  });

  it("A-015 rejects impossible sequential timings instead of publishing false percentiles", () => {
    const valid = event({ v1Ms: 10, languageMs: 5, resolverMs: 7, totalMs: 22 });
    const accepted = replaySanitizedFoodShadowEvents(envelope(valid));
    expect(accepted.baseline.segments[0]).toMatchObject({
      v1LatencyP95Ms: 10, languageLatencyP95Ms: 5,
      resolverLatencyP95Ms: 7, shadowCompletionP95Ms: 22,
    });
    const impossible = [
      { v1Ms: 1000, languageMs: 200, resolverMs: 400, totalMs: 1 },
      { v1Ms: 10, languageMs: 500, resolverMs: 10, totalMs: 100 },
      { v1Ms: 10, languageMs: 10, resolverMs: 500, totalMs: 100 },
      { v1Ms: 200, languageMs: 100, resolverMs: 250, totalMs: 500 },
      { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 2.997 },
    ];
    for (const timings of impossible) {
      expect(() => replaySanitizedFoodShadowEvents(envelope({ ...valid, timings })))
        .toThrow("invalid-sanitized-shadow-events");
    }
    // At 0.001ms precision, independent rounding may add 0.002ms skew.
    const rounded = { ...valid, timings: {
      v1Ms: 1.001, languageMs: 0.003, resolverMs: 0.003, totalMs: 1.005,
    } };
    expect(() => replaySanitizedFoodShadowEvents(envelope(rounded))).not.toThrow();
    // Unknown/failing V2 stages may be 0; no time is invented.
    const partial = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "generic",
      v1: buildV1HistoricalSnapshotFixture(), v1Failure: null, v2: null,
      observations: [], failure: "evidence_unavailable",
      timings: { v1Ms: 4, languageMs: 0, resolverMs: 0, totalMs: 4 },
    });
    expect(() => replaySanitizedFoodShadowEvents(envelope(partial))).not.toThrow();
  });

  it("A-015 rejects extreme finite durations in producer, replay and capability telemetry", () => {
    const valid = event();
    const huge = { v1Ms: 1e306, languageMs: 0, resolverMs: 0, totalMs: 1e306 };
    expect(() => replaySanitizedFoodShadowEvents(envelope({ ...valid, timings: huge })))
      .toThrow("invalid-sanitized-shadow-events");
    expect(() => event({ ...huge })).toThrow("invalid-shadow-timings");
    expect(() => event({ v1Ms: Number.POSITIVE_INFINITY })).toThrow("invalid-shadow-timings");
    expect(() => event({ v1Ms: 1000, totalMs: 1 })).toThrow("invalid-shadow-timings");
    expect(() => replaySanitizedFoodShadowEvents(envelope({ ...valid,
      capabilityUsage: [{ capability: "MEAL_TEXT", calls: 1, retries: 0,
        totalLatencyMs: 1e306, costMeasuredCalls: 0, estimatedCostUsd: null }],
    }))).toThrow("invalid-sanitized-shadow-events");
  });

  it("A-019 rejects oversized cost measurements and preserves valid micro-cost aggregates", () => {
    const withCost = (traceId: string, estimatedCostUsd: number) => ({
      ...event({ traceId }),
      capabilityUsage: [{
        capability: "MEAL_TEXT" as const, calls: 1, retries: 0, totalLatencyMs: 1,
        costMeasuredCalls: 1, estimatedCostUsd,
      }],
    });
    const secondTrace = "0ad100b8-35bd-44cd-932a-e895e51ec7a2";
    const boundary = replaySanitizedFoodShadowEvents(envelope(
      withCost(baseTrace, MAX_SHADOW_EVENT_COST_USD),
      withCost(secondTrace, MAX_SHADOW_EVENT_COST_USD),
    )).baseline.segments[0];
    expect(boundary.external).toMatchObject([{
      capability: "MEAL_TEXT", calls: 2, costMeasuredCalls: 2,
      estimatedCostUsd: MAX_SHADOW_EVENT_COST_USD * 2,
    }]);
    const verySmall = replaySanitizedFoodShadowEvents(envelope(
      withCost(baseTrace, 1e-12), withCost(secondTrace, 1e-12),
    )).baseline.segments[0];
    expect(verySmall.external?.[0].estimatedCostUsd).toBe(2e-12);
    for (const invalidCost of [-1, MAX_SHADOW_EVENT_COST_USD + 1, 1e308, Infinity]) {
      expect(() => replaySanitizedFoodShadowEvents(envelope(withCost(baseTrace, invalidCost))))
        .toThrow("invalid-sanitized-shadow-events");
    }
    expect(() => buildFoodShadowBaseline([withCost(baseTrace, 1e308)]))
      .toThrow("invalid-shadow-capability-cost");
  });

  it("A-021 prevents overflowed numeric nutrition from looking like a zero delta", () => {
    const compare = (calories: number, on: "v1" | "v2") => {
      const v1 = buildV1HistoricalSnapshotFixture();
      const v2 = buildFoodResolutionDecisionFixture();
      if (on === "v1") v1.items[0].calories = calories;
      else v2.nutrition.consumed!.calories = calories;
      return buildFoodShadowEvent({
        traceId: baseTrace, modality: "text", entrypoint: "replay",
        scenarioClass: "generic", v1, v1Failure: null, v2: [v2],
        observations: [buildFoodObservationFixture()], failure: "none",
        timings: { v1Ms: 2, languageMs: 3, resolverMs: 4, totalMs: 10 },
      });
    };
    expect(compare(100, "v1").differences).toMatchObject({
      comparablePairs: 1, nutrition: 1, macros: { calories: 19 },
    });
    const limit = compare(MAX_SHADOW_MACRO_EVENT_DELTA, "v1");
    expect(limit.differences.macros.calories).toBe(MAX_SHADOW_MACRO_EVENT_DELTA - 81);
    expect(() => replaySanitizedFoodShadowEvents(envelope(limit))).not.toThrow();
    for (const invalid of [1e306, Number.MAX_VALUE, Infinity, -1, MAX_SHADOW_MACRO_EVENT_DELTA + 1]) {
      for (const side of ["v1", "v2"] as const) {
        expect(() => compare(invalid, side)).toThrow("invalid-shadow-macro-delta");
      }
    }
    expect(shadowMacroDifference(0, 1e-12)).toBeGreaterThan(0);
    expect(shadowMacroDifference(0, 0)).toBe(0);
    const forged = { ...event(), differences: { ...event().differences,
      nutrition: 1, macros: { ...event().differences.macros, calories: 1e306 } } };
    expect(() => replaySanitizedFoodShadowEvents(envelope(forged)))
      .toThrow("invalid-sanitized-shadow-events");
    expect(() => buildFoodShadowBaseline([forged]))
      .toThrow("invalid-shadow-macro-delta");
    const invalidAggregate = { ...event(), differences: { ...event().differences,
      nutrition: 1, macros: { ...event().differences.macros, calories: Infinity } } };
    expect(() => buildFoodShadowBaseline([invalidAggregate]))
      .toThrow("invalid-shadow-macro-delta");
  });

  it("A-022 rejects forged item and stage counters outside the 10,000-event safe-integer envelope", () => {
    const withCounts = (traceId: string, size: number): FoodShadowEvent => {
      const original = event({ traceId });
      return {
        ...original, v1ItemCount: size, v2ItemCount: size,
        v2Stages: { s1: size, s2: 0, s3: 0 },
        differences: { ...original.differences, comparablePairs: size,
          v1UnpairedItems: 0, v2UnpairedItems: 0, unpairedItems: 0 },
      };
    };
    const a = withCounts(baseTrace, MAX_SHADOW_EVENT_COUNT);
    const b = withCounts("0ad100b8-35bd-44cd-932a-e895e51ec7a2", MAX_SHADOW_EVENT_COUNT);
    const c = withCounts("c7ec7b9c-35bd-44cd-932a-e895e51ec7a2", MAX_SHADOW_EVENT_COUNT);
    const valid = replaySanitizedFoodShadowEvents(envelope(a, b, c)).baseline.segments[0];
    expect(valid.pairedItems).toBe(MAX_SHADOW_EVENT_COUNT * 3);
    expect(valid.v2Stages.s1).toBe(MAX_SHADOW_EVENT_COUNT * 3);
    expect(Number.isSafeInteger(valid.pairedItems)).toBe(true);
    expect(sumShadowCounts(MAX_SHADOW_REPLAY_COUNT - MAX_SHADOW_EVENT_COUNT,
      MAX_SHADOW_EVENT_COUNT)).toBe(MAX_SHADOW_REPLAY_COUNT);
    expect(() => sumShadowCounts(MAX_SHADOW_REPLAY_COUNT, 1)).toThrow("invalid-shadow-count");
    for (const invalid of [MAX_SHADOW_EVENT_COUNT + 1, Number.MAX_SAFE_INTEGER, -1, 1.5, Infinity]) {
      const forged = withCounts(baseTrace, invalid);
      expect(() => replaySanitizedFoodShadowEvents(envelope(forged)))
        .toThrow("invalid-sanitized-shadow-events");
      expect(() => buildFoodShadowBaseline([forged])).toThrow("invalid-shadow-count");
    }
    const oversizedStage = { ...a, v2Stages: { s1: MAX_SHADOW_EVENT_COUNT + 1, s2: 0, s3: 0 } };
    expect(() => replaySanitizedFoodShadowEvents(envelope(oversizedStage)))
      .toThrow("invalid-sanitized-shadow-events");
    expect(() => buildFoodShadowBaseline([oversizedStage])).toThrow("invalid-shadow-count");
  });

  it("A-022 bounds capability calls, retries and measured-call counts in direct and replay aggregation", () => {
    const withCalls = (traceId: string, count: number): FoodShadowEvent => ({
      ...event({ traceId }),
      capabilityUsage: [{
        capability: "MEAL_TEXT", calls: count, retries: count,
        totalLatencyMs: 1, estimatedCostUsd: 0, costMeasuredCalls: count,
      }],
    });
    const a = withCalls(baseTrace, MAX_SHADOW_EVENT_COUNT);
    const b = withCalls("0ad100b8-35bd-44cd-932a-e895e51ec7a2", MAX_SHADOW_EVENT_COUNT);
    const usage = replaySanitizedFoodShadowEvents(envelope(a, b)).baseline.segments[0].external?.[0];
    expect(usage).toMatchObject({ calls: MAX_SHADOW_EVENT_COUNT * 2,
      retries: MAX_SHADOW_EVENT_COUNT * 2, costMeasuredCalls: MAX_SHADOW_EVENT_COUNT * 2 });
    expect(Number.isSafeInteger(usage!.calls)).toBe(true);
    for (const invalid of [MAX_SHADOW_EVENT_COUNT + 1, Number.MAX_SAFE_INTEGER, -1, 1.5, Infinity]) {
      const forged = withCalls(baseTrace, invalid);
      expect(() => replaySanitizedFoodShadowEvents(envelope(forged)))
        .toThrow("invalid-sanitized-shadow-events");
      expect(() => buildFoodShadowBaseline([forged])).toThrow("invalid-shadow-count");
    }
    for (const key of ["calls", "retries", "costMeasuredCalls"] as const) {
      const forged = withCalls(baseTrace, 1);
      forged.capabilityUsage![0][key] = MAX_SHADOW_EVENT_COUNT + 1;
      expect(() => replaySanitizedFoodShadowEvents(envelope(forged)))
        .toThrow("invalid-sanitized-shadow-events");
      expect(() => buildFoodShadowBaseline([forged])).toThrow("invalid-shadow-count");
    }
  });

  it("A-023 validates all count, confidence and macro fields before excluding partial samples", () => {
    const original = event();
    const partial = { ...original, run: "partial" as const };
    const valid = buildFoodShadowBaseline([partial]).segments[0];
    expect(valid).toMatchObject({ partial: 1, compared: 0, pairedItems: 0,
      nutritionDifferences: 0, macroAbsDelta: { calories: null } });
    expect(() => replaySanitizedFoodShadowEvents(envelope(partial))).not.toThrow();
    for (const field of ["comparablePairs", "identity", "variant", "variantIdUnverifiable",
      "quantity", "nutrition", "source", "unpairedItems", "v1UnpairedItems", "v2UnpairedItems"] as const) {
      for (const invalid of [MAX_SHADOW_EVENT_COUNT + 1, -1, 1.25, Infinity]) {
        const forged = { ...partial, differences: { ...partial.differences, [field]: invalid } };
        expect(() => buildFoodShadowBaseline([forged])).toThrow("invalid-shadow-count");
        expect(() => replaySanitizedFoodShadowEvents(envelope(forged)))
          .toThrow("invalid-sanitized-shadow-events");
      }
    }
    for (const field of ["possibleSilentFallback", "v2MissingNutritionProvenance",
      "explicitFailure", "sourceConflicts"] as const) {
      const forged = { ...partial, flagged: { ...partial.flagged, [field]: Infinity } };
      expect(() => buildFoodShadowBaseline([forged])).toThrow("invalid-shadow-count");
      expect(() => replaySanitizedFoodShadowEvents(envelope(forged)))
        .toThrow("invalid-sanitized-shadow-events");
    }
    for (const field of ["calories", "protein", "carbs", "fat"] as const) {
      for (const invalid of [-1, Infinity, MAX_SHADOW_MACRO_EVENT_DELTA + 1]) {
        const forged = { ...partial, differences: { ...partial.differences,
          macros: { ...partial.differences.macros, [field]: invalid } } };
        expect(() => buildFoodShadowBaseline([forged])).toThrow("invalid-shadow-macro-delta");
        expect(() => replaySanitizedFoodShadowEvents(envelope(forged)))
          .toThrow("invalid-sanitized-shadow-events");
      }
    }
    for (const invalid of [-1, NaN, Infinity]) {
      const forged = { ...partial, differences: { ...partial.differences, confidence: invalid } };
      expect(() => buildFoodShadowBaseline([forged])).toThrow("invalid-shadow-confidence");
      expect(() => replaySanitizedFoodShadowEvents(envelope(forged)))
        .toThrow("invalid-sanitized-shadow-events");
    }
    // Do not increase compared denominators when partial data are well formed.
    expect(buildFoodShadowBaseline([partial, { ...original,
      traceId: "0ad100b8-35bd-44cd-932a-e895e51ec7a2",
    }]).segments[0]).toMatchObject({
      runs: 2, partial: 1, compared: 1, pairedItems: original.differences.comparablePairs,
    });
  });

  it("A-024 rejects impossible timings and cost claims in both aggregation APIs", () => {
    const original = event();
    const usage = { capability: "MEAL_TEXT" as const, calls: 1, retries: 0,
      totalLatencyMs: 5, costMeasuredCalls: 1, estimatedCostUsd: 0.5 };
    const good = { ...original, capabilityUsage: [usage] };
    expect(buildFoodShadowBaseline([good]).segments[0].external?.[0]).toMatchObject(usage);
    expect(() => replaySanitizedFoodShadowEvents(envelope(good))).not.toThrow();
    for (const field of ["v1Ms", "languageMs", "resolverMs", "totalMs"] as const) {
      for (const invalid of [NaN, Infinity, -1, MAX_SHADOW_TIMING_MS + 1]) {
        const forged = { ...original, timings: { ...original.timings, [field]: invalid } };
        expect(() => buildFoodShadowBaseline([forged])).toThrow("invalid-shadow-timing");
        expect(() => replaySanitizedFoodShadowEvents(envelope(forged)))
          .toThrow("invalid-sanitized-shadow-events");
      }
    }
    const impossible = { ...original, timings: { ...original.timings, totalMs: 1 } };
    expect(() => buildFoodShadowBaseline([impossible])).toThrow("invalid-shadow-timing");
    expect(() => replaySanitizedFoodShadowEvents(envelope(impossible)))
      .toThrow("invalid-sanitized-shadow-events");
    for (const altered of [
      { ...usage, costMeasuredCalls: 1, estimatedCostUsd: null },
      { ...usage, costMeasuredCalls: 0, estimatedCostUsd: 0.5 },
      { ...usage, totalLatencyMs: NaN },
      { ...usage, totalLatencyMs: MAX_SHADOW_TIMING_MS + 1 },
      { ...usage, estimatedCostUsd: MAX_SHADOW_EVENT_COST_USD + 1 },
    ]) {
      const forged = { ...original, capabilityUsage: [altered] };
      expect(() => buildFoodShadowBaseline([forged])).toThrow();
      expect(() => replaySanitizedFoodShadowEvents(envelope(forged)))
        .toThrow("invalid-sanitized-shadow-events");
    }
    const duplicate = { ...original, capabilityUsage: [usage, usage] };
    expect(() => buildFoodShadowBaseline([duplicate])).toThrow("invalid-shadow-capability");
    expect(() => replaySanitizedFoodShadowEvents(envelope(duplicate)))
      .toThrow("invalid-sanitized-shadow-events");
    const partialUnmeasured = { ...original, run: "partial" as const, capabilityUsage: [
      { ...usage, estimatedCostUsd: null, costMeasuredCalls: 0 },
    ] };
    expect(buildFoodShadowBaseline([partialUnmeasured]).segments[0].external?.[0]).toMatchObject({
      calls: 1, costMeasuredCalls: 0, estimatedCostUsd: null,
    });
    expect(() => replaySanitizedFoodShadowEvents(envelope(partialUnmeasured))).not.toThrow();
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
