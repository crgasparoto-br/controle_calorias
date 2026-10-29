import { describe, expect, it, vi } from "vitest";
import type { AiInferenceEvent } from "../../_core/ai/observability";
import type { CanonicalMealProcessingResult } from "../../nutritionEngineTypes";
import { buildV1HistoricalSnapshotFixture, buildFoodObservationFixture, buildFoodResolutionDecisionFixture } from "./fixtures";
import type { FoodKnowledgeRequest, FoodKnowledgeStore } from "./knowledgeRead";
import type { LinguisticLexiconStore } from "./linguisticComprehension";
import { buildFoodShadowBaseline, buildFoodShadowEvent, summarizeFoodShadowCapabilityUsage, type FoodShadowEvent } from "./shadowComparison";
import { readOnlyFoodKnowledge, runMealWithFoodV2Shadow } from "./shadowRunner";

const traceId = "b4e590ab-35bd-44cd-932a-e895e51ec7a2";
const baseV1 = () => buildV1HistoricalSnapshotFixture() as CanonicalMealProcessingResult;

function fixture() {
  const readLocal = vi.fn(async (_request: FoodKnowledgeRequest) => ({ kind: "miss", reason: "not_found" } as const));
  const readPendingEvidence = vi.fn(async () => null);
  const stagePendingEvidence = vi.fn(async () => true);
  const knowledge: FoodKnowledgeStore = { readLocal, readPendingEvidence, stagePendingEvidence };
  const load = vi.fn(async () => []);
  const lexicon: LinguisticLexiconStore = { load };
  const emit = vi.fn(async (_event: FoodShadowEvent) => {});
  const tasks: Promise<void>[] = [];
  const trackShadowTask = vi.fn((task: Promise<void>) => { tasks.push(task); });
  const runV1 = vi.fn(async () => baseV1());
  const verifyGateA = vi.fn(async () => ({
    status: "approved" as const,
    baseSha: "4ff6202ec7e0b9a895791c3f930cefdc43b97e3e",
    evidenceReference: "actions:gate-a-approved-artifact",
  }));
  const deps = {
    runV1, knowledge, lexicon, emit, verifyGateA, trackShadowTask,
    enabled: true, userId: null, knowledgeRevision: "kn-test",
    lexiconRevision: "lex-test", policyVersion: "policy-test",
    resolverVersion: "resolver-test", entrypoint: "web" as const,
    scenarioClass: "generic" as const, traceId,
  };
  return { deps, readLocal, readPendingEvidence, stagePendingEvidence, load, emit, runV1,
    verifyGateA, trackShadowTask, waitForShadow: async () => { await Promise.all(tasks); } };
}

describe("#1307 read-only V1/V2 shadow execution", () => {
  it("lets V1 own validation of malformed data without a premature shadow exception", async () => {
    const f = fixture();
    f.deps.enabled = false;
    const invalid = { text: { unexpected: "value" } } as unknown as Parameters<typeof f.runV1>[0];
    const expected = baseV1();
    f.runV1.mockResolvedValueOnce(expected);
    await expect(runMealWithFoodV2Shadow(invalid, f.deps)).resolves.toBe(expected);
    expect(f.runV1).toHaveBeenCalledTimes(1);
    expect(f.runV1).toHaveBeenCalledWith(invalid);
    expect(f.load).not.toHaveBeenCalled();
  });

  it("never touches V2, gate, providers or sink while the flag is off", async () => {
    const f = fixture();
    f.deps.enabled = false;
    const input = { text: "100 g de arroz" };
    const expected = baseV1();
    f.runV1.mockResolvedValueOnce(expected);
    expect(await runMealWithFoodV2Shadow(input, f.deps)).toBe(expected);
    expect(f.runV1).toHaveBeenCalledTimes(1);
    expect(f.runV1).toHaveBeenCalledWith(input);
    expect(f.verifyGateA).not.toHaveBeenCalled();
    expect(f.trackShadowTask).not.toHaveBeenCalled();
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
      await f.waitForShadow();
      expect(f.load).not.toHaveBeenCalled();
      expect(f.readLocal).not.toHaveBeenCalled();
      expect(f.emit).not.toHaveBeenCalled();
    }
    const g = fixture();
    g.verifyGateA.mockRejectedValueOnce(new Error("raw gate secret value"));
    await expect(runMealWithFoodV2Shadow({ text: "arroz" }, g.deps)).resolves.toHaveProperty("items");
    await g.waitForShadow();
    expect(g.load).not.toHaveBeenCalled();
  });

  it("runs the actual linguistic layer and resolver with identical original text; never stages knowledge", async () => {
    const f = fixture();
    const input = { text: "100 g de arroz" };
    const original = baseV1();
    f.runV1.mockImplementationOnce(async request => {
      request.text = "100 g de banana";
      return original;
    });
    const result = await runMealWithFoodV2Shadow(input, f.deps);
    await f.waitForShadow();
    expect(result).toBe(original);
    expect(f.load).toHaveBeenCalledOnce();
    expect(f.readLocal).toHaveBeenCalled();
    expect(f.readLocal.mock.calls[0][0].normalizedName).toBe("arroz");
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
    await f.waitForShadow();
    expect(f.emit).toHaveBeenCalledOnce();
    expect(f.emit.mock.calls[0][0].v1Outcome).toBe("clarification");
    expect(JSON.stringify(f.emit.mock.calls[0][0])).not.toContain("private message");
  });

  it("handles V2 language failure and telemetry-sink failure without changing the V1 result", async () => {
    const f = fixture();
    f.load.mockRejectedValueOnce(new Error("private nutrition label"));
    const output = await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, f.deps);
    await f.waitForShadow();
    expect(output.items).toHaveLength(1);
    expect(f.emit).toHaveBeenCalledOnce();
    expect(f.emit.mock.calls[0][0]).toMatchObject({ run: "failed", failure: "language_unavailable" });
    expect(JSON.stringify(f.emit.mock.calls[0][0])).not.toContain("private nutrition label");
    const g = fixture();
    g.emit.mockRejectedValueOnce(new Error("telemetry down"));
    expect(await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, g.deps)).toHaveProperty("items");
    await g.waitForShadow();
  });

  it("does not fabricate observations from image-only URLs, old V1 decisions or OCR instructions", async () => {
    const f = fixture();
    const result = await runMealWithFoodV2Shadow({ imageUrl: "https://private.example/item.jpg" }, f.deps);
    await f.waitForShadow();
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

  it("rejects dynamic PII in segmentation tags instead of leaking it to analytics", () => {
    const request = {
      traceId, modality: "text" as const, entrypoint: "web" as const,
      scenarioClass: "person@example.com" as never,
      v1: baseV1(), v1Failure: null, v2: [], observations: [],
      failure: "none" as const,
      timings: { v1Ms: 1, languageMs: 0, resolverMs: 0, totalMs: 1 },
    };
    expect(() => buildFoodShadowEvent(request)).toThrow("invalid-shadow-segmentation");
  });


  it("returns V1 before a pending Gate A, resolver lookup, or telemetry sink", async () => {
    for (const pendingStage of ["gate", "lookup", "sink"] as const) {
      const f = fixture();
      const expected = baseV1();
      const input = { text: "100 g de arroz" };
      f.runV1.mockResolvedValueOnce(expected);
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      if (pendingStage === "gate") {
        f.verifyGateA.mockImplementationOnce(async () => {
          await pending;
          return { status: "approved", baseSha: "4ff6202ec7e0b9a895791c3f930cefdc43b97e3e",
            evidenceReference: "actions:gate-a-approved-artifact" };
        });
      } else if (pendingStage === "lookup") {
        f.readLocal.mockImplementationOnce(async () => {
          await pending;
          return { kind: "miss", reason: "not_found" } as const;
        });
      } else {
        f.emit.mockImplementationOnce(async () => { await pending; });
      }
      // Under the old implementation this await never finishes: V1 waited for shadow.
      expect(await runMealWithFoodV2Shadow(input, f.deps)).toBe(expected);
      expect(f.runV1).toHaveBeenCalledTimes(1);
      if (pendingStage !== "gate") {
        await vi.waitFor(() => expect(pendingStage === "lookup" ? f.readLocal : f.emit).toHaveBeenCalled());
      }
      release();
      await f.waitForShadow();
      expect(f.trackShadowTask).toHaveBeenCalledTimes(1);
    }
  });

  it("rethrows the same V1 error without waiting for a pending Gate A verification", async () => {
    const f = fixture();
    const error = new Error("v1-original-error");
    f.runV1.mockRejectedValueOnce(error);
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    f.verifyGateA.mockImplementationOnce(async () => { await pending; return null as never; });
    await expect(runMealWithFoodV2Shadow({ text: "100 g de arroz" }, f.deps)).rejects.toBe(error);
    expect(f.runV1).toHaveBeenCalledTimes(1);
    release();
    await f.waitForShadow();
    expect(f.emit).not.toHaveBeenCalled();
  });

  it("matches reordered and duplicated food identities without artificial macro drift", () => {
    const left = (name: string, calories: number, grams = 100, variant: string | null = null) => ({
      ...baseV1().items[0], foodName: name, canonicalName: name, productVariant: variant,
      quantity: grams, unit: "g", estimatedGrams: grams, calories, protein: 0, carbs: 0, fat: 0,
    });
    const right = (name: string, calories: number, grams = 100, variant: string | null = null) =>
      buildFoodResolutionDecisionFixture({
        identity: { canonicalName: name, variant },
        quantity: { value: grams, unit: "g", grams },
        nutrition: { consumed: { calories, protein: 0, carbs: 0, fat: 0 } },
      });
    const event = (v1Items: ReturnType<typeof left>[], v2Items: ReturnType<typeof right>[]) =>
      buildFoodShadowEvent({
        traceId, modality: "text", entrypoint: "replay", scenarioClass: "mixed",
        v1: { ...baseV1(), items: v1Items }, v1Failure: null, v2: v2Items,
        observations: [], failure: "none",
        timings: { v1Ms: 1, languageMs: 2, resolverMs: 3, totalMs: 6 },
      });
    const arroz = left("Arroz", 100);
    const feijao = left("Feijão", 200);
    const reversed = event([arroz, feijao], [right("Feijão", 200), right("Arroz", 100)]);
    expect(reversed.differences).toMatchObject({ comparablePairs: 2, unpairedItems: 0,
      identity: 0, variant: 0, nutrition: 0, macros: { calories: 0 } });
    const variants = event([
      left("Leite", 100, 100, "integral"), left("Leite", 140, 100, "desnatado"),
    ], [right("Leite", 140, 100, "desnatado"), right("Leite", 100, 100, "integral")]);
    expect(variants.differences).toMatchObject({ comparablePairs: 2, unpairedItems: 0,
      variant: 0, nutrition: 0, macros: { calories: 0 } });
    const repeated = event([left("Ovo", 60, 50), left("Ovo", 120, 100)],
      [right("Ovo", 120, 100), right("Ovo", 60, 50)]);
    expect(repeated.differences).toMatchObject({ comparablePairs: 2, unpairedItems: 0,
      quantity: 0, nutrition: 0, macros: { calories: 0 } });
    const insertion = event([arroz, feijao], [right("Arroz", 100),
      right("Café", 5), right("Feijão", 200)]);
    expect(insertion.differences).toMatchObject({ comparablePairs: 2, unpairedItems: 1,
      identity: 0, nutrition: 0, macros: { calories: 0 } });
    const rename = event([arroz], [right("Feijão", 200)]);
    expect(rename.differences).toMatchObject({ comparablePairs: 0, unpairedItems: 2,
      identity: 1, nutrition: 0, macros: { calories: null } });
    const realChange = event([arroz], [right("Arroz", 105)]);
    expect(realChange.differences).toMatchObject({ comparablePairs: 1, unpairedItems: 0,
      nutrition: 1, macros: { calories: 5 } });
    expect(buildFoodShadowBaseline([reversed, variants, insertion]).verifiedAccuracy).toBeNull();
  });

  it("retains micro-dollar costs instead of rounding billable attempts to zero", () => {
    expect(summarizeFoodShadowCapabilityUsage([
      { capability: "MEAL_TEXT", callRole: "primary",
        latencyMs: 7, estimatedCostUsd: 0.00001234 } as AiInferenceEvent,
    ])?.[0].estimatedCostUsd).toBe(0.00001234);
  });

});
