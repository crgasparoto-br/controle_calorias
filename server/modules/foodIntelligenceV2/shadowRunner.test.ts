import { describe, expect, it, vi } from "vitest";
import type { AiInferenceEvent } from "../../_core/ai/observability";
import type { CanonicalMealProcessingResult } from "../../nutritionEngineTypes";
import { buildV1HistoricalSnapshotFixture, buildFoodObservationFixture, buildFoodResolutionDecisionFixture } from "./fixtures";
import type { FoodKnowledgeStore } from "./knowledgeRead";
import type { LinguisticLexiconStore } from "./linguisticComprehension";
import { buildFoodShadowBaseline, buildFoodShadowEvent, summarizeFoodShadowCapabilityUsage, type FoodShadowEvent } from "./shadowComparison";
import { readOnlyFoodKnowledge, runMealWithFoodV2Shadow } from "./shadowRunner";

const traceId = "b4e590ab-35bd-44cd-932a-e895e51ec7a2";
const baseV1 = () => buildV1HistoricalSnapshotFixture() as CanonicalMealProcessingResult;

function fixture() {
  const readLocal = vi.fn(async () => ({ kind: "miss", reason: "not_found" } as const));
  const readPendingEvidence = vi.fn(async () => null);
  const stagePendingEvidence = vi.fn(async () => true);
  const knowledge: FoodKnowledgeStore = { readLocal, readPendingEvidence, stagePendingEvidence };
  const load = vi.fn(async () => []);
  const lexicon: LinguisticLexiconStore = { load };
  const emit = vi.fn(async (_event: FoodShadowEvent) => {});
  const runV1 = vi.fn(async () => baseV1());
  const verifyGateA = vi.fn(async () => ({
    status: "approved" as const,
    baseSha: "4ff6202ec7e0b9a895791c3f930cefdc43b97e3e",
    evidenceReference: "actions:gate-a-approved-artifact",
  }));
  const deps = {
    runV1, knowledge, lexicon, emit, verifyGateA,
    enabled: true, userId: null, knowledgeRevision: "kn-test",
    lexiconRevision: "lex-test", policyVersion: "policy-test",
    resolverVersion: "resolver-test", entrypoint: "web" as const,
    scenarioClass: "generic" as const, traceId,
  };
  return { deps, readLocal, readPendingEvidence, stagePendingEvidence, load, emit, runV1, verifyGateA };
}

describe("#1307 read-only V1/V2 shadow execution", () => {
  it("never touches V2, gate, providers or sink while the flag is off", async () => {
    const f = fixture();
    f.deps.enabled = false;
    const input = { text: "100 g de arroz" };
    const expected = baseV1();
    f.runV1.mockResolvedValueOnce(expected);
    expect(await runMealWithFoodV2Shadow(input, f.deps)).toBe(expected);
    expect(f.runV1).toHaveBeenCalledExactlyOnceWith(input);
    expect(f.verifyGateA).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.readLocal).not.toHaveBeenCalled();
    expect(f.stagePendingEvidence).not.toHaveBeenCalled();
    expect(f.emit).not.toHaveBeenCalled();
  });

  it("denies unapproved/throwing Gate A and preserves V1 without touching V2", async () => {
    for (const approval of [null, { status: "approved", evidenceReference: "unverified", baseSha: "bad" }]) {
      const f = fixture();
      f.verifyGateA.mockResolvedValueOnce(approval as never);
      expect(await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, f.deps)).toHaveProperty("items");
      expect(f.load).not.toHaveBeenCalled();
      expect(f.readLocal).not.toHaveBeenCalled();
      expect(f.emit).not.toHaveBeenCalled();
    }
    const g = fixture();
    g.verifyGateA.mockRejectedValueOnce(new Error("raw gate secret value"));
    await expect(runMealWithFoodV2Shadow({ text: "arroz" }, g.deps)).resolves.toHaveProperty("items");
    expect(g.load).not.toHaveBeenCalled();
  });

  it("runs the actual linguistic layer and resolver with identical original text; never stages knowledge", async () => {
    const f = fixture();
    const input = { text: "100 g de arroz" };
    const original = baseV1();
    f.runV1.mockResolvedValueOnce(original);
    const result = await runMealWithFoodV2Shadow(input, f.deps);
    expect(result).toBe(original);
    expect(f.load).toHaveBeenCalledOnce();
    expect(f.readLocal).toHaveBeenCalled();
    expect(f.stagePendingEvidence).not.toHaveBeenCalled();
    expect(f.emit).toHaveBeenCalledOnce();
    const event = f.emit.mock.calls[0][0];
    expect(event.run).toBe("compared");
    expect(event.schemaVersion).toBe(1);
    expect(event.traceId).toBe(traceId);
    expect(event.v1ItemCount).toBe(1);
    expect(event.v2ItemCount).toBeGreaterThan(0);
    expect(event.capabilityUsage).toBeNull();
    expect(event.verifiedCorrect).toBeNull();
  });

  it("does not recover a failing V1 with V2 or change the thrown clarification object", async () => {
    const f = fixture();
    const failure = Object.assign(new Error("private message"), { code: "food_identity_clarification_required" });
    f.runV1.mockRejectedValueOnce(failure);
    let received: unknown;
    try { await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, f.deps); }
    catch (error) { received = error; }
    expect(received).toBe(failure);
    expect(f.emit).toHaveBeenCalledOnce();
    expect(f.emit.mock.calls[0][0].v1Outcome).toBe("clarification");
    expect(JSON.stringify(f.emit.mock.calls[0][0])).not.toContain("private message");
  });

  it("handles V2 language failure and telemetry-sink failure without changing the V1 result", async () => {
    const f = fixture();
    f.load.mockRejectedValueOnce(new Error("private nutrition label"));
    const output = await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, f.deps);
    expect(output.items).toHaveLength(1);
    expect(f.emit).toHaveBeenCalledOnce();
    expect(f.emit.mock.calls[0][0]).toMatchObject({ run: "failed", failure: "language_unavailable" });
    expect(JSON.stringify(f.emit.mock.calls[0][0])).not.toContain("private nutrition label");
    const g = fixture();
    g.emit.mockRejectedValueOnce(new Error("telemetry down"));
    expect(await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, g.deps)).toHaveProperty("items");
  });

  it("does not fabricate observations from image-only URLs, old V1 decisions or OCR instructions", async () => {
    const f = fixture();
    const result = await runMealWithFoodV2Shadow({ imageUrl: "https://private.example/item.jpg" }, f.deps);
    expect(result.items).toHaveLength(1);
    expect(f.load).not.toHaveBeenCalled();
    expect(f.readLocal).not.toHaveBeenCalled();
    expect(f.emit.mock.calls[0][0]).toMatchObject({
      modality: "image", failure: "evidence_unavailable", v2Outcome: "not_compared",
    });
    expect(JSON.stringify(f.emit.mock.calls[0][0])).not.toContain("private.example");
  });

  it("protects the write contract even if a later caller supplies an external source", async () => {
    const f = fixture();
    const readOnly = readOnlyFoodKnowledge(f.deps.knowledge);
    await expect(readOnly.stagePendingEvidence(
      { normalizedName: "arroz", userId: 5, policyVersion: "p", resolverVersion: "r" },
      { sourceId: 7, sourceReference: "https://example.org", nutrition: {
        basisQuantity: 100, basisUnit: "g", caloriesKcal: 10, proteinG: 1, carbG: 1, fatG: 0,
      } },
    )).rejects.toThrow("shadow-knowledge-write-denied");
    expect(f.stagePendingEvidence).not.toHaveBeenCalled();
  });

  it("does not leak raw values, personal IDs, links or provider event correlation into telemetry", () => {
    const privateName = "teste pessoa+alimento@privado.example";
    const v1 = baseV1();
    v1.sourceText = privateName;
    v1.items[0].canonicalName = privateName;
    v1.items[0].foodName = privateName;
    const v2 = buildFoodResolutionDecisionFixture({
      identity: { canonicalName: privateName },
    });
    const event = buildFoodShadowEvent({
      traceId, modality: "text", entrypoint: "web", scenarioClass: "unknown",
      v1, v1Failure: null, v2: [v2], observations: [buildFoodObservationFixture({
        rawInput: privateName, normalizedInput: privateName,
      })], failure: "none", timings: { v1Ms: 2, languageMs: 3, resolverMs: 4, totalMs: 10 },
      capabilityEvents: [{ capability: "MEAL_TEXT", callRole: "retry", latencyMs: 7,
        estimatedCostUsd: 0.002, correlation: { private: privateName } } as AiInferenceEvent],
    });
    const json = JSON.stringify(event);
    expect(json).not.toContain(privateName);
    expect(json).not.toContain("privado.example");
    expect(event.capabilityUsage).toMatchObject([{ capability: "MEAL_TEXT", calls: 1, retries: 1 }]);
    expect(event.verifiedCorrect).toBeNull();
  });

  it("replays classes and modalities without turning agreement into verified correctness", () => {
    const base = {
      traceId, modality: "text" as const, entrypoint: "replay" as const,
      scenarioClass: "generic" as const, v1: baseV1(), v1Failure: null,
      v2: [buildFoodResolutionDecisionFixture()], observations: [buildFoodObservationFixture()],
      timings: { v1Ms: 5, languageMs: 4, resolverMs: 8, totalMs: 20 }, failure: "none" as const,
    };
    const event = buildFoodShadowEvent(base);
    const report = buildFoodShadowBaseline([event, { ...event, modality: "image", failure: "evidence_unavailable", run: "failed" }]);
    expect(report.totalRuns).toBe(2);
    expect(report.verifiedAccuracy).toBeNull();
    expect(report.rolloutEligible).toBe(false);
    expect(report.segments).toHaveLength(2);
    expect(report.segments.find(row => row.modality === "image")?.compared).toBe(0);
    expect(report.segments.find(row => row.modality === "text")?.compared).toBe(1);
  });

  it("preserves uninstrumented cost as null rather than claiming zero external calls", () => {
    expect(summarizeFoodShadowCapabilityUsage(null)).toBeNull();
    expect(summarizeFoodShadowCapabilityUsage([
      { capability: "NUTRITION_SEARCH", callRole: "primary", latencyMs: 25, estimatedCostUsd: null } as AiInferenceEvent,
    ])).toEqual([{
      capability: "NUTRITION_SEARCH", calls: 1, retries: 0, totalLatencyMs: 25,
      estimatedCostUsd: null, costMeasuredCalls: 0,
    }]);
  });
});
