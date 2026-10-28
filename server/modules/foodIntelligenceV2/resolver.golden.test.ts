/**
 * #1305: the Golden Food Corpus must execute the actual domain resolver.
 *
 * This is a deliberately uncalibrated, read-only integration scenario. Its
 * expected failing gate is evidence that the harness does not misrepresent an
 * incomplete V2 knowledge base as the ADR's >=95% accuracy certification.
 * No expected/caseId is read by the resolver.
 */
import { describe, expect, it } from "vitest";
import { runGoldenFoodCorpus, type CorpusResolverUnderTest } from "./corpus";
import { comprehendFoodLanguage } from "./linguisticComprehension";
import { resolveFoodObservations } from "./resolver";
import type { FoodKnowledgeStore, GovernedFoodMatch } from "./knowledgeRead";

const known: GovernedFoodMatch = {
  kind: "match", matchingEvidence: "exact_variant",
  foodId: 101, variantId: 102, profileId: 103, variantName: "Mortadela",
  sourceId: 104, sourceVersion: "fixture-source-1",
  sourceReference: "https://example.org/test-only",
  governanceStatus: "verified",
  nutrition: {
    caloriesKcal: 270, proteinG: 12, carbG: 3, fatG: 23,
    basisQuantity: 100, basisUnit: "g",
  },
  portions: [{ portionId: 105, foodEntityId: 101, variantId: 102,
    label: "fatia", unit: "fatia", quantity: 1, grams: 20, status: "verified",
    measureKind: "exact", confidence: null, sourceId: 106, sourceVersion: "portion-v1",
    sourceReference: "https://example.org/portions/105", sourcePortionCode: "slice-105",
    evidenceId: 107, validFrom: null, validTo: null, updatedAt: "2026-10-20T00:00:00Z" }],
};
/** Fixture for the repository boundary, not a second resolver or an oracle. */
const store: FoodKnowledgeStore = {
  async readLocal(request) {
    return request.normalizedName === "mortadela"
      ? known : { kind: "miss", reason: "not_found" };
  },
  async readPendingEvidence() { return null; },
  async stagePendingEvidence() { return false; },
};

const sut: CorpusResolverUnderTest = {
  id: "food-intelligence-v2-domain-resolver",
  revision: "c2-1305",
  async resolve({ case: input }) {
    const text = input.modality === "audio_transcript"
      ? (input.input.transcription ?? input.input.text)
      : input.modality === "image" || input.modality === "multimodal"
        ? (input.input.ocrText ?? input.input.caption ?? input.input.text)
        : input.input.text;
    const modality = input.modality === "audio_transcript" ? "audio_transcript"
      : input.modality === "image" ? "image" : "text";
    const observations = await comprehendFoodLanguage({
      rawText: text, sourceRef: "corpus:observed-surface",
      modality, imageRegionRole: modality === "image" ? "caption" : undefined,
      ownerUserId: 7, lexiconRevision: "fixture-lexicon-v1",
    }, { async load() { return []; } });
    const decisions = await resolveFoodObservations(observations, {
      traceId: "corpus:trace", userId: 7,
      knowledgeRevision: "fixture-knowledge-v1",
      policyVersion: "fixture-policy-v1",
      resolverVersion: "c2-1305",
    }, store);
    // MealOperation belongs to its canonical parser, not the C2 food resolver.
    return { decisions, operation: null, knowledgeWrites: [] };
  },
};

describe("#1305 Golden Food Corpus through the real V2 resolver", () => {
  it("runs the independent corpus and refuses false approval without knowledge/cutover gates", async () => {
    const report = await runGoldenFoodCorpus(sut, {
      revisions: {
        code: "c2-1305", knowledge: "fixture-knowledge-v1",
        lexicon: "fixture-lexicon-v1", model: "deterministic",
        policy: "fixture-policy-v1", resolver: "c2-1305",
      },
    });
    expect(report.caseCount).toBeGreaterThan(50);
    expect(report.resolveCalls).toBe(report.caseCount);
    expect(report.resolver.id).toBe(sut.id);
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.gate.status).not.toBe("passed");
    expect(report.byModality.length).toBeGreaterThan(0);
    expect(report.byDecisionClass.length).toBeGreaterThan(0);
    // The actual C2 resolver, with one deliberately limited governed fixture,
    // is the only baseline measured here. This is NOT a calibrated V2 accuracy
    // result and MUST NOT be substituted by the corpus self-test oracle.
    const splitSummary = report.bySplit.map(split => ({
      split: split.segment,
      cases: split.cases,
      resolvableLabeled: split.resolvableLabeled,
      matchRate: split.matchRate,
      matchedCases: split.matchedCases,
      failedCases: split.failedCases,
      abstentions: split.abstentions,
    }));
    expect(splitSummary.some(row => row.split === "calibration")).toBe(true);
    expect(splitSummary.some(row => row.split === "holdout")).toBe(true);
    expect(report.byBrand.length).toBeGreaterThan(0);
    expect(report.byMeasure.length).toBeGreaterThan(0);
    // Safe aggregate statistics: no raw food text, personal history or media.
    console.info("C3_REAL_RESOLVER_FIXTURE_BASELINE " + JSON.stringify({
      resolver: report.resolver, corpusVersion: report.corpusVersion,
      revisions: report.revisions, calls: report.resolveCalls,
      gate: report.gate.status, blockingReasons: report.gate.blockReasons,
      bySplit: splitSummary,
      failureClasses: Object.fromEntries(
        [...new Set(report.failures.flatMap(item => item.codes))].sort()
          .map(code => [code, report.failures.filter(item => item.codes.includes(code)).length])
      ),
    }));
  });
});
