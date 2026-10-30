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
      observations: [], failure: "none",
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
      explicitFailure: 1, sourceConflicts: 1,
    } };
    const bounded = replaySanitizedFoodShadowEvents(envelope(atBoundary));
    expect(bounded.baseline.segments[0]).toMatchObject({
      runs: 1, partial: 1, pairedItems: 0,
      potentialSilentFallbacks: 1, missingNutritionProvenance: 1, explicitFailures: 1,
    });
    expect(bounded.baseline.verifiedAccuracy).toBeNull();
    for (const field of ["possibleSilentFallback", "v2MissingNutritionProvenance",
      "explicitFailure", "sourceConflicts"] as const) {
      expect(() => replaySanitizedFoodShadowEvents(envelope({
        ...atBoundary, flagged: { ...atBoundary.flagged, [field]: 2 },
      }))).toThrow("invalid-sanitized-shadow-events");
    }

    const missingV1 = buildFoodShadowEvent({
      traceId: baseTrace, modality: "text", entrypoint: "replay", scenarioClass: "ambiguous",
      v1: null, v1Failure: "clarification", v2: [buildFoodResolutionDecisionFixture()],
      observations: [], failure: "none",
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

  it("A-013 keeps stage counts, conflicts and stage latencies observable per segment", () => {
    const first = { ...event({ v1Ms: 10, totalMs: 25 }),
      v2Stages: { s1: 1, s2: 0, s3: 0 },
      flagged: { ...event().flagged, sourceConflicts: 1 },
      timings: { v1Ms: 10, languageMs: 5, resolverMs: 7, totalMs: 25 },
      capabilityUsage: [] as FoodShadowEvent["capabilityUsage"],
    };
    const second = { ...event({
      traceId: "0ad100b8-35bd-44cd-932a-e895e51ec7a2", v1Ms: 20, totalMs: 45,
    }),
      v2Stages: { s1: 0, s2: 2, s3: 3 },
      flagged: { ...event().flagged, sourceConflicts: 1 },
      timings: { v1Ms: 20, languageMs: 15, resolverMs: 21, totalMs: 45 },
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
      runs: 3, compared: 2, failed: 1, v2Stages: { s1: 1, s2: 2, s3: 3 },
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

  it("does not accept an empty/oversized or malformed replay as a measured population", () => {
    expect(() => replaySanitizedFoodShadowEvents(envelope())).toThrow("invalid-sanitized-shadow-events");
    expect(() => replaySanitizedFoodShadowEvents({ schemaVersion: 1, kind: "food-v2-sanitized-shadow-events",
      events: Array.from({ length: 10001 }, () => event()),
    })).toThrow("invalid-sanitized-shadow-events");
    expect(() => replaySanitizedFoodShadowEvents({ events: [event()] }))
      .toThrow("invalid-sanitized-shadow-events");
  });
});
