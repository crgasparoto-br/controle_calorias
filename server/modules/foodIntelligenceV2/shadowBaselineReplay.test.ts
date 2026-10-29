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

  it("does not accept an empty/oversized or malformed replay as a measured population", () => {
    expect(() => replaySanitizedFoodShadowEvents(envelope())).toThrow("invalid-sanitized-shadow-events");
    expect(() => replaySanitizedFoodShadowEvents({ schemaVersion: 1, kind: "food-v2-sanitized-shadow-events",
      events: Array.from({ length: 10001 }, () => event()),
    })).toThrow("invalid-sanitized-shadow-events");
    expect(() => replaySanitizedFoodShadowEvents({ events: [event()] }))
      .toThrow("invalid-sanitized-shadow-events");
  });
});
