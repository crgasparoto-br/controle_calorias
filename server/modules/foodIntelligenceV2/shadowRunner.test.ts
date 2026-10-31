import { describe, expect, it, vi } from "vitest";
import { emitAiInferenceEvents, withAiInferenceAttemptCapture, type AiInferenceEvent } from "../../_core/ai/observability";
import type { CanonicalMealProcessingResult } from "../../nutritionEngineTypes";
import { buildV1HistoricalSnapshotFixture, buildFoodObservationFixture, buildFoodResolutionDecisionFixture } from "./fixtures";
import type { FoodKnowledgeRequest, FoodKnowledgeStore } from "./knowledgeRead";
import type { LinguisticLexiconStore } from "./linguisticComprehension";
import { buildFoodShadowBaseline, buildFoodShadowEvent, summarizeFoodShadowCapabilityUsage, type FoodShadowEvent } from "./shadowComparison";
import { readOnlyFoodKnowledge, runMealWithFoodV2Shadow } from "./shadowRunner";
import { MAX_SHADOW_EVENT_COST_USD } from "./shadowPairing";
import { snapshotFoodV1ForShadow } from "./shadowV1Snapshot";

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
    verifyGateA, trackShadowTask, waitForShadow: async () => {
      // The observer and tracker are intentionally registered after V1 settles.
      await new Promise<void>(resolve => setImmediate(resolve));
      await Promise.all(tasks);
    } };
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

  it("A-025 leaves V1 untouched by optional accessors when shadow is disabled or Gate A is absent", async () => {
    for (const noShadow of ["flag-off", "no-gate"] as const) {
      const f = fixture();
      if (noShadow === "flag-off") f.deps.enabled = false;
      const deps = noShadow === "no-gate" ? { ...f.deps, verifyGateA: undefined } : f.deps;
      const result = baseV1();
      const input = { text: "arroz", get transcript(): string { throw new Error("private optional getter"); } };
      f.runV1.mockImplementationOnce(async request => {
        expect(request).toBe(input);
        expect(request.text).toBe("arroz");
        return result;
      });
      await expect(runMealWithFoodV2Shadow(input, deps)).resolves.toBe(result);
      expect(f.runV1).toHaveBeenCalledTimes(1);
      expect(f.verifyGateA).not.toHaveBeenCalled();
      expect(f.trackShadowTask).not.toHaveBeenCalled();
      await f.waitForShadow();
      expect(f.emit).not.toHaveBeenCalled();
    }
  });

  it("A-025 prevents optional getter side effects from modifying the V1 request", async () => {
    for (const enabled of [false, true]) {
      const f = fixture();
      f.deps.enabled = enabled;
      let reads = 0;
      const input = {
        text: "arroz",
        get transcript(): string { reads++; this.text = "banana"; return "banana"; },
      };
      f.runV1.mockImplementationOnce(async request => {
        expect(request.text).toBe("arroz");
        return baseV1();
      });
      await expect(runMealWithFoodV2Shadow(input, f.deps)).resolves.toHaveProperty("items");
      await f.waitForShadow();
      expect(reads).toBe(0);
      expect(input.text).toBe("arroz");
      expect(f.runV1).toHaveBeenCalledTimes(1);
      if (enabled) expect(f.emit).toHaveBeenCalledOnce();
      else expect(f.emit).not.toHaveBeenCalled();
    }
  });

  it("A-025 degrades descriptor inspection failures without suppressing V1", async () => {
    const f = fixture();
    const target = { text: "arroz" };
    const input = new Proxy(target, {
      getOwnPropertyDescriptor() { throw new Error("unreadable shadow evidence"); },
    });
    const expected = baseV1();
    f.runV1.mockResolvedValueOnce(expected);
    expect(await runMealWithFoodV2Shadow(input, f.deps)).toBe(expected);
    expect(f.runV1).toHaveBeenCalledWith(input);
    await f.waitForShadow();
    expect(f.emit).toHaveBeenCalledOnce();
    expect(f.emit.mock.calls[0][0]).toMatchObject({
      failure: "evidence_unavailable", v2Outcome: "not_compared", verifiedCorrect: null,
    });
    expect(JSON.stringify(f.emit.mock.calls[0][0])).not.toContain("unreadable shadow evidence");
  });

  it("RISK-001 ignores test-only enable overrides in production", async () => {
    const oldEnvironment = process.env.NODE_ENV;
    const oldFlag = process.env.FOOD_V2_SHADOW_ENABLED;
    try {
      process.env.NODE_ENV = "production";
      process.env.FOOD_V2_SHADOW_ENABLED = "false";
      const f = fixture();
      const input = { text: "arroz" };
      const expected = baseV1();
      f.runV1.mockResolvedValueOnce(expected);
      expect(await runMealWithFoodV2Shadow(input, f.deps)).toBe(expected);
      await f.waitForShadow();
      expect(f.runV1).toHaveBeenCalledOnce();
      expect(f.verifyGateA).not.toHaveBeenCalled();
      expect(f.trackShadowTask).not.toHaveBeenCalled();
      expect(f.emit).not.toHaveBeenCalled();
    } finally {
      if (oldEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = oldEnvironment;
      if (oldFlag === undefined) delete process.env.FOOD_V2_SHADOW_ENABLED;
      else process.env.FOOD_V2_SHADOW_ENABLED = oldFlag;
    }
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

  it("A-020 captures minimal immutable V1 comparison data before response mutation", async () => {
    const f = fixture();
    const original = baseV1();
    const captured = snapshotFoodV1ForShadow(original);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.items)).toBe(true);
    expect(Object.isFrozen(captured.items[0])).toBe(true);
    expect(Object.isFrozen(captured.semanticContract)).toBe(true);
    expect(Object.keys(captured).sort()).toEqual(["items", "semanticContract"]);
    expect(JSON.stringify(captured)).not.toContain(original.sourceText);
    f.runV1.mockResolvedValueOnce(original);
    const returned = await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, f.deps);
    expect(returned).toBe(original);
    returned.items[0].calories = 1e306;
    returned.items[0].foodName = "changed after return";
    returned.items[0].resolution = { nutritionOrigin: "catalog", nutritionVerified: true };
    returned.items.push({ ...returned.items[0] });
    returned.semanticContract.needsClarification = true;
    await f.waitForShadow();
    expect(f.emit).toHaveBeenCalledOnce();
    expect(f.emit.mock.calls[0][0]).toMatchObject({
      v1Outcome: "resolved", v1ItemCount: 1,
      flagged: { possibleSilentFallback: 1 }, verifiedCorrect: null,
    });
    expect(captured.items[0].calories).toBe(81);
    expect(captured.semanticContract.needsClarification).toBe(false);
    expect(f.runV1).toHaveBeenCalledOnce();
  });

  it("A-020 captures the V1 clarification outcome before the caller mutates its error", async () => {
    const f = fixture();
    const original = Object.assign(new Error("private V1 exception"), {
      code: "food_identity_clarification_required",
    });
    f.runV1.mockRejectedValueOnce(original);
    let received: unknown;
    try { await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, f.deps); }
    catch (error) { received = error; }
    expect(received).toBe(original);
    original.code = "changed_after_rejection";
    await f.waitForShadow();
    expect(f.emit).toHaveBeenCalledOnce();
    expect(f.emit.mock.calls[0][0]).toMatchObject({
      run: "partial", v1Outcome: "clarification",
      v1ItemsObserved: false, verifiedCorrect: null,
    });
    expect(JSON.stringify(f.emit.mock.calls[0][0])).not.toContain("private V1 exception");
  });

  it("A-020 preserves V1 even if a projection getter throws", async () => {
    const f = fixture();
    const original = baseV1();
    Object.defineProperty(original.items[0], "calories", {
      get() { throw new Error("private V1 snapshot getter failure"); },
    });
    f.runV1.mockResolvedValueOnce(original);
    expect(await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, f.deps)).toBe(original);
    await f.waitForShadow();
    expect(f.emit).toHaveBeenCalledOnce();
    expect(f.emit.mock.calls[0][0]).toMatchObject({
      run: "partial", v1Outcome: "not_compared", v1ItemsObserved: false,
      verifiedCorrect: null,
    });
    expect(JSON.stringify(f.emit.mock.calls[0][0])).not.toContain("private V1 snapshot getter failure");
  });

  it("A-015 measures sequential shadow latency monotonically when the system clock moves backwards", async () => {
    const f = fixture();
    const dateNow = vi.spyOn(Date, "now");
    let ticks = 0;
    dateNow.mockImplementation(() => 1_750_000_000_000 - ++ticks * 100_000);
    try {
      const v1 = await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, f.deps);
      await f.waitForShadow();
      expect(v1).toHaveProperty("items");
      expect(f.emit).toHaveBeenCalledOnce();
      const { timings } = f.emit.mock.calls[0][0];
      expect(timings.totalMs).toBeGreaterThan(0);
      expect(timings.totalMs + 0.002).toBeGreaterThanOrEqual(
        timings.v1Ms + timings.languageMs + timings.resolverMs,
      );
    } finally {
      dateNow.mockRestore();
    }
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
    expect(f.emit.mock.calls[0][0].run).toBe("partial");
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

  it("A-017 keeps a valid V1/V2 event when the optional capability reader throws", async () => {
    const f = fixture();
    const expected = baseV1();
    f.runV1.mockResolvedValueOnce(expected);
    const deps = { ...f.deps, readCapabilityEvents: () => {
      throw new Error("private capability-reader failure");
    } };
    expect(await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, deps)).toBe(expected);
    await f.waitForShadow();
    expect(f.emit).toHaveBeenCalledTimes(1);
    const event = f.emit.mock.calls[0][0];
    expect(event).toMatchObject({ run: "compared", failure: "none",
      capabilityUsage: null, verifiedCorrect: null });
    expect(JSON.stringify(event)).not.toContain("private capability-reader failure");
    expect(f.runV1).toHaveBeenCalledTimes(1);
  });

  it("A-017 rejects malformed provider timing without dropping the meal comparison", async () => {
    const f = fixture();
    const deps = { ...f.deps, readCapabilityEvents: () => [{
      capability: "MEAL_TEXT" as const, callRole: "primary" as const,
      latencyMs: 1e306, estimatedCostUsd: null,
    }] };
    const original = baseV1();
    f.runV1.mockResolvedValueOnce(original);
    expect(await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, deps)).toBe(original);
    await f.waitForShadow();
    expect(f.emit).toHaveBeenCalledTimes(1);
    expect(f.emit.mock.calls[0][0]).toMatchObject({
      run: "compared", capabilityUsage: null, verifiedCorrect: null,
    });
    expect(f.runV1).toHaveBeenCalledTimes(1);
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

  it("A-007 reports V1 clarification exceptions without fabricated complete comparisons", () => {
    const original = {
      traceId, modality: "text" as const, entrypoint: "replay" as const,
      scenarioClass: "ambiguous" as const,
      v1: null, v1Failure: "clarification" as const,
      v2: [buildFoodResolutionDecisionFixture()], observations: [buildFoodObservationFixture()],
      failure: "none" as const,
      timings: { v1Ms: 2, languageMs: 3, resolverMs: 4, totalMs: 9 },
    };
    const v1Clarifies = buildFoodShadowEvent(original);
    expect(v1Clarifies).toMatchObject({
      run: "partial", v1Outcome: "clarification", v2Outcome: "resolved",
      v1ItemCount: 0, differences: { comparablePairs: 0, clarification: true },
    });
    const baseline = buildFoodShadowBaseline([v1Clarifies]);
    expect(baseline.segments[0]).toMatchObject({
      runs: 1, partial: 1, compared: 0, pairedItems: 0,
      clarificationDifferences: 1, macroAbsDelta: { calories: null },
    });
    expect(baseline.verifiedAccuracy).toBeNull();
    const bothClarify = buildFoodShadowEvent({ ...original, v2: [
      buildFoodResolutionDecisionFixture({ status: "ambiguous", nextAction: "clarify" }),
    ] });
    expect(bothClarify.run).toBe("partial");
    expect(bothClarify.differences.clarification).toBe(false);
    const genericFailure = buildFoodShadowEvent({ ...original, v1Failure: "failed" });
    expect(genericFailure.run).toBe("partial");
    expect(genericFailure.differences.clarification).toBeNull();
    const missingV2 = buildFoodShadowEvent({ ...original, v2: null });
    expect(missingV2.run).toBe("partial");
    expect(missingV2.differences.clarification).toBeNull();
    const fullyComparable = buildFoodShadowEvent({
      ...original, v1: baseV1(), v1Failure: null,
    });
    expect(fullyComparable.run).toBe("compared");
    expect(fullyComparable.differences.clarification).toBe(false);
  });

  it("replays classes and modalities without turning agreement into verified correctness", () => {
    const base = {
      traceId, modality: "text" as const, entrypoint: "replay" as const,
      scenarioClass: "generic" as const, v1: baseV1(), v1Failure: null,
      v2: [buildFoodResolutionDecisionFixture()], observations: [buildFoodObservationFixture()],
      timings: { v1Ms: 5, languageMs: 4, resolverMs: 8, totalMs: 20 }, failure: "none" as const,
    };
    const event = buildFoodShadowEvent(base);
    const unavailable = buildFoodShadowEvent({ ...base,
      traceId: "0ad100b8-35bd-44cd-932a-e895e51ec7a2", modality: "image", v2: null,
      observations: [], failure: "evidence_unavailable",
      timings: { v1Ms: 5, languageMs: 0, resolverMs: 0, totalMs: 5 } });
    const report = buildFoodShadowBaseline([event, unavailable]);
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


  it("A-016 settles V1 before synchronous Gate A and task-tracking callbacks run", async () => {
    for (const v1Fails of [false, true]) {
      const f = fixture();
      const result = baseV1();
      const originalError = new Error("original V1 error");
      if (v1Fails) f.runV1.mockRejectedValueOnce(originalError);
      else f.runV1.mockResolvedValueOnce(result);
      let v1Settled = false;
      const prematureCallbacks: string[] = [];
      const originalGate = f.verifyGateA.getMockImplementation()!;
      const originalTracker = f.trackShadowTask.getMockImplementation()!;
      // Callback ordering, rather than a flaky wall-clock budget, detects
      // even expensive synchronous work before the caller's settlement.
      f.verifyGateA.mockImplementation(() => {
        if (!v1Settled) prematureCallbacks.push("gate");
        return originalGate();
      });
      f.trackShadowTask.mockImplementation(task => {
        if (!v1Settled) prematureCallbacks.push("tracker");
        originalTracker(task);
      });
      if (v1Fails) {
        await expect(runMealWithFoodV2Shadow({ text: "100 g de arroz" }, f.deps))
          .rejects.toBe(originalError);
      } else {
        await expect(runMealWithFoodV2Shadow({ text: "100 g de arroz" }, f.deps))
          .resolves.toBe(result);
      }
      v1Settled = true;
      await f.waitForShadow();
      expect(prematureCallbacks).toEqual([]);
      expect(f.runV1).toHaveBeenCalledTimes(1);
      expect(f.verifyGateA).toHaveBeenCalledTimes(1);
      expect(f.trackShadowTask).toHaveBeenCalledTimes(1);
      expect(f.emit).toHaveBeenCalledTimes(1);
    }
  });

  it("A-016 preserves the V1 response if the deferred task tracker throws", async () => {
    const f = fixture();
    const expected = baseV1();
    f.runV1.mockResolvedValueOnce(expected);
    f.trackShadowTask.mockImplementationOnce(() => {
      throw new Error("private tracker failure");
    });
    expect(await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, f.deps)).toBe(expected);
    await vi.waitFor(() => expect(f.emit).toHaveBeenCalledTimes(1));
    expect(f.trackShadowTask).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.emit.mock.calls[0][0])).not.toContain("private tracker failure");
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
        observations: v2Items.map(() => buildFoodObservationFixture()), failure: "none",
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
      v1UnpairedItems: 0, v2UnpairedItems: 1,
      identity: 0, nutrition: 0, macros: { calories: 0 } });
    const removal = event([arroz, feijao], [right("Feijão", 200)]);
    expect(removal.differences).toMatchObject({ comparablePairs: 1, unpairedItems: 1,
      v1UnpairedItems: 1, v2UnpairedItems: 0,
      identity: 0, nutrition: 0, macros: { calories: 0 } });
    const variantChange = event([left("Leite", 100, 100, "integral")],
      [right("Leite", 100, 100, "desnatado")]);
    // Variant labels that expressly disagree must not form nutrition pairs.
    expect(variantChange.differences).toMatchObject({ comparablePairs: 0,
      unpairedItems: 2, variant: 1, nutrition: 0, macros: { calories: null } });
    const rename = event([arroz], [right("Feijão", 200)]);
    expect(rename.differences).toMatchObject({ comparablePairs: 0, unpairedItems: 2,
      v1UnpairedItems: 1, v2UnpairedItems: 1,
      identity: 1, nutrition: 0, macros: { calories: null } });
    const realChange = event([arroz], [right("Arroz", 105)]);
    expect(realChange.differences).toMatchObject({ comparablePairs: 1, unpairedItems: 0,
      nutrition: 1, macros: { calories: 5 } });
    // A-005: the baseline must not erase one-sided insertions or removals.
    // Reordering never creates a gap; genuine nutritional drift stays separate.
    const baseline = buildFoodShadowBaseline([reversed, insertion, removal, rename, realChange]
      .map((entry, index) => ({ ...entry,
        traceId: `b4e590ab-35bd-44cd-932a-${(index + 1).toString().padStart(12, "0")}`,
      })));
    expect(baseline.verifiedAccuracy).toBeNull();
    expect(baseline.rolloutEligible).toBe(false);
    expect(baseline.segments).toHaveLength(1);
    expect(baseline.segments[0]).toMatchObject({
      modality: "text", scenarioClass: "mixed", runs: 5, compared: 5,
      pairedItems: 6, unpairedItems: 4, v1UnpairedItems: 2, v2UnpairedItems: 2,
      identityDifferences: 1, nutritionDifferences: 1, macroAbsDelta: { calories: 5 },
    });
    // Missing evidence from a partial multimodal run must remain observable,
    // but cannot be counted as a complete comparable pair or verified accuracy.
    const partial = buildFoodShadowBaseline([{
      ...insertion, modality: "multimodal" as const, run: "partial" as const,
    }]);
    expect(partial.segments[0]).toMatchObject({
      runs: 1, compared: 0, partial: 1, pairedItems: 0,
      unpairedItems: 1, v1UnpairedItems: 0, v2UnpairedItems: 1,
      nutritionDifferences: 0, macroAbsDelta: { calories: null },
    });
  });

  it("A-009 prefers persisted variant IDs over equal labels and misleading nutrition", () => {
    const historical = (id: number | null, calories: number) => ({
      ...baseV1().items[0], foodName: "Leite", canonicalName: "Leite",
      brand: "Marca", productVariant: "caixa", historicalRef: id === null ? "catalog:45" : `variant:${id}`,
      quantity: 100, unit: "g", estimatedGrams: 100,
      calories, protein: 0, carbs: 0, fat: 0,
    });
    const resolved = (id: number | null, calories: number, name = "Leite") =>
      buildFoodResolutionDecisionFixture({
        identity: { canonicalName: name, brand: "Marca", variant: "caixa",
          foodEntityId: 42, variantId: id },
        quantity: { value: 100, unit: "g", grams: 100 },
        nutrition: { consumed: { calories, protein: 0, carbs: 0, fat: 0 } },
      });
    const compare = (v1Items: ReturnType<typeof historical>[], v2Items: ReturnType<typeof resolved>[]) =>
      buildFoodShadowEvent({
        traceId, modality: "text", entrypoint: "replay", scenarioClass: "commercial",
        v1: { ...baseV1(), items: v1Items }, v1Failure: null,
        v2: v2Items, observations: v2Items.map(() => buildFoodObservationFixture()), failure: "none",
        timings: { v1Ms: 1, languageMs: 2, resolverMs: 3, totalMs: 6 },
      });

    const same = compare([historical(101, 100)], [resolved(101, 100)]);
    expect(same.differences).toMatchObject({
      comparablePairs: 1, unpairedItems: 0, identity: 0, variant: 0,
      variantIdUnverifiable: 0, macros: { calories: 0 },
    });

    // Different immutable IDs invalidate the nutrition pair despite identical labels.
    const changed = compare([historical(101, 100)], [resolved(102, 100)]);
    expect(changed.differences).toMatchObject({
      comparablePairs: 0, unpairedItems: 2, identity: 1, variant: 1,
      v1UnpairedItems: 1, v2UnpairedItems: 1,
      variantIdUnverifiable: 0, macros: { calories: null },
    });
    const changedReport = buildFoodShadowBaseline([changed]);
    expect(changedReport.segments[0]).toMatchObject({
      variantDifferences: 1, unpairedItems: 2, pairedItems: 0,
      variantIdUnverifiable: 0, macroAbsDelta: { calories: null },
    });

    // A text/macro-only matcher would incorrectly pair the two by calories.
    const switchedNutrition = compare(
      [historical(101, 100), historical(102, 200)],
      [resolved(102, 100), resolved(101, 200)],
    );
    expect(switchedNutrition.differences).toMatchObject({
      comparablePairs: 2, unpairedItems: 0, variant: 0, variantIdUnverifiable: 0,
      nutrition: 2, macros: { calories: 200 },
    });
    const reordered = compare(
      [historical(101, 100), historical(102, 200)],
      [resolved(102, 200), resolved(101, 100)],
    );
    expect(reordered.differences).toMatchObject({
      comparablePairs: 2, unpairedItems: 0, variant: 0, variantIdUnverifiable: 0,
      nutrition: 0, macros: { calories: 0 },
    });

    // Legacy catalog ID is not in the V2 variant namespace; no inferred crosswalk.
    const legacy = compare([historical(null, 100)], [resolved(101, 100)]);
    expect(legacy.differences).toMatchObject({
      comparablePairs: 1, variant: 0, variantIdUnverifiable: 1,
    });
    expect(buildFoodShadowBaseline([legacy]).segments[0].variantIdUnverifiable).toBe(1);
    expect(JSON.stringify([same, changed, legacy])).not.toContain("variant:101");
    expect(JSON.stringify([same, changed, legacy])).not.toContain("catalog:45");

    // An immutable ID still matches after its human-readable name changes.
    const renamed = compare([historical(101, 100)], [resolved(101, 100, "Leite renomeado")]);
    expect(renamed.differences).toMatchObject({
      comparablePairs: 1, unpairedItems: 0, identity: 1, variant: 0,
    });
  });

  it("A-010 honors persisted family IDs even when display labels and macros agree", () => {
    const saved = (reference: string | null, calories: number, name = "Leite") => ({
      ...baseV1().items[0], historicalRef: reference, foodName: name, canonicalName: name,
      brand: null, productVariant: null, quantity: 1, unit: "un", estimatedGrams: 100,
      calories, protein: 0, carbs: 0, fat: 0,
    });
    const resolved = (family: number | null, variant: number | null, calories: number, name = "Leite") =>
      buildFoodResolutionDecisionFixture({
        identity: { canonicalName: name, foodEntityId: family, variantId: variant,
          variant: variant === null ? null : "caixa" },
        quantity: { value: 1, unit: "un", grams: 100 },
        nutrition: { consumed: { calories, protein: 0, carbs: 0, fat: 0 } },
      });
    const compare = (v1Items: ReturnType<typeof saved>[], v2Items: ReturnType<typeof resolved>[]) =>
      buildFoodShadowEvent({
        traceId, modality: "text", entrypoint: "replay", scenarioClass: "commercial",
        v1: { ...baseV1(), items: v1Items }, v1Failure: null,
        v2: v2Items, observations: v2Items.map(() => buildFoodObservationFixture()), failure: "none",
        timings: { v1Ms: 1, languageMs: 2, resolverMs: 3, totalMs: 6 },
      });

    // Both names and nutrition agree, but the two known family IDs do not.
    const changedFamily = compare([saved("food:10", 100)], [resolved(11, 101, 100)]);
    expect(changedFamily.differences).toMatchObject({
      comparablePairs: 0, unpairedItems: 2, identity: 1,
      v1UnpairedItems: 1, v2UnpairedItems: 1, macros: { calories: null },
    });
    expect(changedFamily.differences.variantIdUnverifiable).toBe(0);
    expect(buildFoodShadowBaseline([changedFamily]).segments[0]).toMatchObject({
      pairedItems: 0, identityDifferences: 1, macroAbsDelta: { calories: null },
    });

    // A missing V2 family cannot silently override a known saved family.
    const missingFamily = compare([saved("food:10", 100)], [resolved(null, null, 100)]);
    expect(missingFamily.differences).toMatchObject({
      comparablePairs: 0, unpairedItems: 2, macros: { calories: null },
    });

    // Same family despite a renamed label is comparable; rename is reported.
    const renamed = compare([saved("food:10", 100)], [resolved(10, 102, 100, "Leite renomeado")]);
    expect(renamed.differences).toMatchObject({
      comparablePairs: 1, unpairedItems: 0, identity: 1,
      variantIdUnverifiable: 1, macros: { calories: 0 },
    });

    // Family-only snapshots reordered across distinct names are aligned by
    // their saved labels before declaring a false rename.
    const sameFamilyReordered = compare([
      saved("food:10", 100, "Leite A"), saved("food:10", 100, "Leite B"),
    ], [
      resolved(10, null, 100, "Leite B"), resolved(10, null, 100, "Leite A"),
    ]);
    expect(sameFamilyReordered.differences).toMatchObject({
      comparablePairs: 2, identity: 0, nutrition: 0, macros: { calories: 0 },
    });

    // A legacy catalog ID is not a family/variant crosswalk.
    const legacy = compare([saved("catalog:45", 100)], [resolved(11, 101, 100)]);
    expect(legacy.differences).toMatchObject({
      comparablePairs: 1, variantIdUnverifiable: 1, macros: { calories: 0 },
    });

    // A known variant has higher priority than a family-only snapshot.
    const prioritized = compare([
      saved("food:10", 200), saved("variant:101", 100),
    ], [
      resolved(10, 101, 100), resolved(10, 102, 200),
    ]);
    expect(prioritized.differences).toMatchObject({
      comparablePairs: 2, unpairedItems: 0, nutrition: 0, macros: { calories: 0 },
    });
    expect(JSON.stringify([changedFamily, missingFamily, renamed, sameFamilyReordered, legacy, prioritized]))
      .not.toContain("food:10");
  });

  it("RISK-001 optimizes all same-name duplicates instead of greedy local minima", () => {
    const saved = (calories: number, historicalRef: string | null = null) => ({
      ...baseV1().items[0], foodName: "Ovo", canonicalName: "Ovo", historicalRef,
      brand: null, productVariant: null, quantity: 1, unit: "un", estimatedGrams: 100,
      calories, protein: 0, carbs: 0, fat: 0,
    });
    const resolved = (calories: number, family: number | null = null) =>
      buildFoodResolutionDecisionFixture({
        identity: { canonicalName: "Ovo", foodEntityId: family, variantId: null },
        quantity: { value: 1, unit: "un", grams: 100 },
        nutrition: { consumed: { calories, protein: 0, carbs: 0, fat: 0 } },
      });
    const compare = (items: ReturnType<typeof saved>[], decisions: ReturnType<typeof resolved>[]) =>
      buildFoodShadowEvent({
        traceId, modality: "text", entrypoint: "replay", scenarioClass: "mixed",
        v1: { ...baseV1(), items }, v1Failure: null,
        v2: decisions, observations: decisions.map(() => buildFoodObservationFixture()), failure: "none",
        timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
      });

    // Greedy chooses 50=>50 (0), 40=>30 (10), 10=>60 (50):
    // total delta 60. The minimum-cost complete assignment has delta 40.
    const v1 = [saved(10), saved(40), saved(50)];
    const v2 = [resolved(30), resolved(50), resolved(60)];
    for (const event of [
      compare(v1, v2),
      compare([...v1].reverse(), [...v2].reverse()),
      compare([v1[1], v1[2], v1[0]], [v2[2], v2[0], v2[1]]),
      // The strong family-ID tier must not revert to greedy matching either.
      compare(v1.map(item => ({ ...item, historicalRef: "food:10" })),
        v2.map(item => ({ ...item, identity: { ...item.identity, foodEntityId: 10 } }))),
    ]) {
      expect(event.differences).toMatchObject({
        comparablePairs: 3, unpairedItems: 0, macros: { calories: 40 },
      });
      expect(event.verifiedCorrect).toBeNull();
      expect(buildFoodShadowBaseline([event]).segments[0]).toMatchObject({
        runs: 1, pairedItems: 3, macroAbsDelta: { calories: 40 },
      });
    }
  });

  it("retains micro-dollar costs instead of rounding billable attempts to zero", () => {
    expect(summarizeFoodShadowCapabilityUsage([
      { capability: "MEAL_TEXT", callRole: "primary",
        latencyMs: 7, estimatedCostUsd: 0.00001234 } as AiInferenceEvent,
    ])?.[0].estimatedCostUsd).toBe(0.00001234);
  });

  it("A-015 rejects extreme provider timing instead of publishing a fabricated zero", () => {
    const sample = (latencyMs: number) => ({
      capability: "MEAL_TEXT" as const, callRole: "primary" as const,
      latencyMs, estimatedCostUsd: null,
    });
    expect(() => summarizeFoodShadowCapabilityUsage([sample(1e306)]))
      .toThrow("invalid-shadow-capability-latency");
    expect(() => summarizeFoodShadowCapabilityUsage([sample(-1)]))
      .toThrow("invalid-shadow-capability-latency");
    expect(summarizeFoodShadowCapabilityUsage([sample(0)])).toMatchObject([
      { capability: "MEAL_TEXT", calls: 1, totalLatencyMs: 0 },
    ]);
  });

  it("A-019 rejects overflowing or over-budget numeric cost while preserving genuine zero", () => {
    const events = (costs: number[]) => costs.map(estimatedCostUsd => ({
      capability: "MEAL_TEXT" as const, callRole: "primary" as const,
      latencyMs: 1, estimatedCostUsd,
    }));
    expect(summarizeFoodShadowCapabilityUsage(events([0]))).toMatchObject([
      { calls: 1, costMeasuredCalls: 1, estimatedCostUsd: 0 },
    ]);
    expect(summarizeFoodShadowCapabilityUsage(events([1e-12]))).toMatchObject([
      { calls: 1, costMeasuredCalls: 1, estimatedCostUsd: 1e-12 },
    ]);
    expect(summarizeFoodShadowCapabilityUsage(events([MAX_SHADOW_EVENT_COST_USD]))).toMatchObject([
      { calls: 1, costMeasuredCalls: 1, estimatedCostUsd: MAX_SHADOW_EVENT_COST_USD },
    ]);
    for (const costs of [
      [1e308, 1e308], [MAX_SHADOW_EVENT_COST_USD, 0.01],
      [-1], [Infinity],
    ]) {
      expect(() => summarizeFoodShadowCapabilityUsage(events(costs)))
        .toThrow("invalid-shadow-capability-cost");
    }
  });

  it("A-019 degrades only auxiliary cost metrics on overflow and still emits the V1/V2 event", async () => {
    const f = fixture();
    const original = baseV1();
    f.runV1.mockResolvedValueOnce(original);
    const deps = { ...f.deps, readCapabilityEvents: () => [
      { capability: "MEAL_TEXT" as const, callRole: "primary" as const,
        latencyMs: 1, estimatedCostUsd: 1e308 },
      { capability: "MEAL_TEXT" as const, callRole: "retry" as const,
        latencyMs: 1, estimatedCostUsd: 1e308 },
    ] };
    expect(await runMealWithFoodV2Shadow({ text: "100 g de arroz" }, deps)).toBe(original);
    await f.waitForShadow();
    expect(f.runV1).toHaveBeenCalledTimes(1);
    expect(f.emit).toHaveBeenCalledTimes(1);
    expect(f.emit.mock.calls[0][0]).toMatchObject({
      run: "compared", failure: "none", capabilityUsage: null, verifiedCorrect: null,
    });
  });

  it("captures V1 attempt counts, retries, latency and cost per request without a sink or PII", async () => {
    const a = fixture();
    const b = fixture();
    const attempt = (capability: "MEAL_TEXT" | "NUTRITION_SEARCH",
      callRole: "primary" | "retry", latencyMs: number,
      estimatedCostUsd: number | null) => ({
        capability, callRole, latencyMs, estimatedCostUsd,
        attemptIndex: callRole === "retry" ? 2 : 1,
        correlation: { raw: "private-user@do-not-export.example" },
        executionId: "private-user-id",
      } as AiInferenceEvent);
    a.runV1.mockImplementationOnce(async () => {
      await emitAiInferenceEvents([
        attempt("MEAL_TEXT", "primary", 5, 0.01),
        attempt("MEAL_TEXT", "retry", 7, 0.02),
        // Rejected before the provider boundary: not an actual external call.
        { ...attempt("MEAL_TEXT", "primary", 0, null), attemptIndex: 0 },
      ], null);
      await Promise.resolve();
      return baseV1();
    });
    b.runV1.mockImplementationOnce(async () => {
      await Promise.resolve();
      await emitAiInferenceEvents([
        attempt("NUTRITION_SEARCH", "primary", 11, null),
      ], null);
      return baseV1();
    });
    await Promise.all([
      runMealWithFoodV2Shadow({ text: "arroz" }, a.deps),
      runMealWithFoodV2Shadow({ text: "feijao" }, b.deps),
    ]);
    await Promise.all([a.waitForShadow(), b.waitForShadow()]);
    const first = a.emit.mock.calls[0][0];
    const second = b.emit.mock.calls[0][0];
    expect(first.capabilityUsage).toEqual([{
      capability: "MEAL_TEXT", calls: 2, retries: 1,
      totalLatencyMs: 12, estimatedCostUsd: 0.03, costMeasuredCalls: 2,
    }]);
    expect(second.capabilityUsage).toEqual([{
      capability: "NUTRITION_SEARCH", calls: 1, retries: 0,
      totalLatencyMs: 11, estimatedCostUsd: null, costMeasuredCalls: 0,
    }]);
    expect(JSON.stringify([first, second])).not.toContain("private-user");
    expect(a.runV1).toHaveBeenCalledTimes(1);
    expect(b.runV1).toHaveBeenCalledTimes(1);
  });

  it("fails closed on an overflowing attempt capture and preserves the V1 error", async () => {
    const f = fixture();
    const v1Error = new Error("sensitive v1 failure");
    const attempt = { capability: "MEAL_TEXT", callRole: "primary",
      attemptIndex: 1, latencyMs: 1, estimatedCostUsd: 0.001 } as AiInferenceEvent;
    let overflowResult: readonly unknown[] | null = [];
    await withAiInferenceAttemptCapture(
      async () => { await emitAiInferenceEvents(Array.from({ length: 257 }, () => attempt), null); },
      attempts => { overflowResult = attempts; },
    );
    expect(overflowResult).toBeNull();
    f.runV1.mockImplementationOnce(async () => {
      await emitAiInferenceEvents([attempt], null);
      throw v1Error;
    });
    await expect(runMealWithFoodV2Shadow({ text: "arroz" }, f.deps)).rejects.toBe(v1Error);
    await f.waitForShadow();
    const event = f.emit.mock.calls[0][0];
    expect(event.v1Outcome).toBe("failed");
    expect(event.capabilityUsage?.[0]).toMatchObject({ calls: 1, estimatedCostUsd: 0.001 });
    expect(JSON.stringify(event)).not.toContain("sensitive v1 failure");
  });

});
