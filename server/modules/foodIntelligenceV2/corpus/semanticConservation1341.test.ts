import { describe, expect, it } from "vitest";
import { comprehendFoodLanguage } from "../linguisticComprehension";
import type { LinguisticLexiconStore } from "../linguisticComprehension";
import { extractExplicitSugarQuantity } from "../../../coffeeSugarNutrition";
import { c1bCases } from "./semanticConservation1341.test.fixture";
import type { C1bCase } from "./semanticConservation1341.test.fixture";
import { evaluateC1b, referenceSignature, summarizeC1b, validateC1bReference } from "./semanticConservation1341.test.support";

/** This suite characterizes production functions, not a mocked resolver. */
const emptyGovernedLexicon: LinguisticLexiconStore = { load: async () => [] };
const evaluateRealV2 = async (testCase: C1bCase) => {
  const observations = await comprehendFoodLanguage({
    rawText: testCase.text, sourceRef: `c1b:${testCase.id}`,
    modality: testCase.modality, ownerUserId: null, lexiconRevision: "c1b-empty-s2",
    now: new Date("2026-11-12T12:00:00.000Z"),
    ...(testCase.modality === "audio_transcript" ? { transcriptionConfidence: 0.9 } : {}),
    // #1306 has not authorized an S3 activation threshold in this experiment.
  }, emptyGovernedLexicon);
  return { observations, report: evaluateC1b(testCase, observations) };
};

/** Deterministic, not random: no unlogged seed or hand-picked parser output. */
const generatorVersion = "c1b-cartesian-v1";
function generatedEquivalents(): C1bCase[] {
  const cases: C1bCase[] = [];
  for (const [form, coffeeAmount, puddingAmount, coffeeValue, puddingValue] of [
    ["words", "uma", "duas", 1, 2],
    ["digits", "1", "2", 1, 2],
  ] as const) {
    for (const separator of [" e ", ", ", "; "] as const) {
      for (const reversed of [false, true]) {
        const coffee = `café com ${coffeeAmount} colher de chá de açúcar`;
        const pudding = `um pudim com ${puddingAmount} colheres de chá de açúcar`;
        const components = reversed ? [pudding, coffee] : [coffee, pudding];
        const facts = [
          { kind: "ingredient-quantity", owner: "café", scope: coffee,
            surface: `${coffeeAmount} colher de chá de açúcar`, ingredient: "açúcar",
            quantity: coffeeValue, unit: "colher de chá" },
          { kind: "ingredient-quantity", owner: "pudim", scope: pudding,
            surface: `${puddingAmount} colheres de chá de açúcar`, ingredient: "açúcar",
            quantity: puddingValue, unit: "colher de chá" },
        ] as const;
        cases.push({
          id: `${generatorVersion}-${form}-${separator === " e " ? "conjunction" : separator === ", " ? "comma" : "semicolon"}-${reversed ? "reverse" : "forward"}`,
          text: components.join(separator), semanticGroup: "coffee1-pudding2spoons",
          modality: "text", split: "calibration", facts,
        });
      }
    }
  }
  return cases;
}
const cases = [...c1bCases, ...generatedEquivalents()];

function diagnosticMatrix() {
  return Promise.all(cases.map(evaluateRealV2));
}

describe("#1341: conservação semântica V1 × V2 — diagnóstico sem cutover", () => {
  it("valida o oráculo material antes de consultar qualquer parser", () => {
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
    expect(c1bCases.some(c => c.split === "holdout")).toBe(true);
    for (const testCase of cases) expect(() => validateC1bReference(testCase)).not.toThrow();
    const groups = new Map<string, string>();
    for (const testCase of cases) {
      const signature = referenceSignature(testCase);
      const previous = groups.get(testCase.semanticGroup);
      if (previous) expect(signature, testCase.id).toBe(previous);
      else groups.set(testCase.semanticGroup, signature);
    }
    // Controls are not superficial equivalents: changing a unit/owner/quantity
    // must change the independent reference even if a parser collapses outputs.
    expect(groups.get("coffee1-pudding2spoons")).not.toBe(groups.get("coffee1-pudding2g"));
    expect(groups.get("coffee1-pudding2spoons")).not.toBe(groups.get("coffee1-pudding2-plus-unbound"));
    const corrupted: C1bCase = { ...cases[0], facts: [
      { ...cases[0].facts[0], owner: "pudim" }, ...cases[0].facts.slice(1),
    ] };
    expect(() => validateC1bReference(corrupted)).toThrow("c1b-reference-owner-not-in-scope");
  });

  it("mede a LCL real, separando conteúdo rastreável de vínculos demonstrados", async () => {
    const measured = await diagnosticMatrix();
    const reports = measured.map(x => x.report);
    const summary = summarizeC1b(reports);
    expect(summary.facts).toBe(cases.reduce((n, c) => n + c.facts.length, 0));
    expect(summary.cases).toBe(cases.length);
    // The experiment is allowed to find failures. A green test confirms that
    // the detector ran and disclosed them, NOT that V2 passed the semantic gate.
    expect(summary.grades["missing-component-binding"]).toBeGreaterThan(0);
    expect(summary.casesStructurallyComplete).toBeLessThan(cases.length);
    const byClass = Object.fromEntries(
      ["calibration", "holdout"].map(split => [split,
        summarizeC1b(reports.filter(report => report.split === split))]),
    );
    const byModality = Object.fromEntries(
      ["text", "audio_transcript"].map(modality => [modality,
        summarizeC1b(reports.filter(report => report.modality === modality))]),
    );
    // The V1-specific legacy helper has a singular sugar measure output and
    // cannot prove owner bindings; it is only a partial V1 comparator.
    const legacy = { testedCases: cases.length, singleSugarMeasureFound: cases.filter(testCase =>
      extractExplicitSugarQuantity(testCase.text) !== null).length,
      ownerBindingVerified: "not-measured" };
    const caseResults = measured.map((entry, index) => ({
      id: cases[index].id, group: entry.report.semanticGroup,
      split: entry.report.split, modality: entry.report.modality,
      complete: entry.report.structurallyComplete,
      facts: entry.report.results.map(result => ({ kind: result.kind, grade: result.grade })),
    }));
    const referenceKey = (testCase: C1bCase, index: number) => {
      const fact = testCase.facts[index];
      const fold = (value: string | null) => (value ?? "?").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
      return [fact.kind, fold(fact.owner), fold(fact.ingredient),
        fact.quantity, fold(fact.unit)].join(":");
    };
    const groupOutcomes = new Map<string, { variants: number; complete: boolean; gradeKeys: Set<string> }>();
    for (let index = 0; index < cases.length; index++) {
      const testCase = cases[index], report = reports[index];
      const gradeKey = report.results.map((fact, j) => `${referenceKey(testCase, j)}=${fact.grade}`)
        .sort().join(";");
      const group = groupOutcomes.get(testCase.semanticGroup) ??
        { variants: 0, complete: true, gradeKeys: new Set<string>() };
      group.variants++;
      group.complete &&= report.structurallyComplete;
      group.gradeKeys.add(gradeKey);
      groupOutcomes.set(testCase.semanticGroup, group);
    }
    const metamorphic = Object.fromEntries([...groupOutcomes].map(([name, value]) => [name, {
      variants: value.variants, fullyStructured: value.complete,
      gradeDivergence: value.gradeKeys.size > 1,
    }]));
    const aggregate = { schemaVersion: 1, issue: 1341,
      source: "real-LCL-V2-and-partial-V1-extractor", generatorVersion,
      sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
      corpusRevision: "c1b-annotated-v1", lexiconRevision: "c1b-empty-s2",
      interpreterVersion: null, S3: "not-evaluated", providerCalls: 0,
      ...summary, byClass, byModality, legacy, metamorphic, caseResults,
      decision: "adjust-ADR-contract-before-D1-semantic-cutover" };
    console.info("C1B_1341_AGGREGATE=" + JSON.stringify(aggregate));
    // Every missing component is an open architectural obligation, not
    // evidence of zero fallback or accurate nutrition in production.
    for (const report of reports) {
      expect(report.results.every(result => result.caseId === report.caseId)).toBe(true);
      expect(report.results.every(result => result.sourceRange[1] > result.sourceRange[0])).toBe(true);
    }
  });

  it("refuta omissão, reatribuição e aprovação de gravação parcial", async () => {
    const testCase = cases.find(c => c.id === "food-count-simple")!;
    const { observations, report } = await evaluateRealV2(testCase);
    expect(report.structurallyComplete).toBe(true);
    expect(report.results.every(x => x.grade === "structured")).toBe(true);

    const withoutSecond = evaluateC1b(testCase, observations.slice(0, 1));
    expect(withoutSecond.results[1].grade).toBe("silent-omission");
    expect(withoutSecond.structurallyComplete).toBe(false);

    const switched = observations.map((observation, index) => ({
      ...observation,
      quantityHints: { ...observation.quantityHints,
        value: observations[1 - index].quantityHints.value,
        unit: observations[1 - index].quantityHints.unit },
    }));
    const silentlyClosed = evaluateC1b(testCase, observations.map((item, index) => ({
      ...item, unresolvedReason: null,
      quantityHints: index === 0 ? { ...item.quantityHints, value: null } : item.quantityHints,
    })));
    expect(silentlyClosed.results[0].grade).toBe("false-closed");

    const misbound = evaluateC1b(testCase, switched);
    expect(misbound.results.every(x => x.grade === "misbound")).toBe(true);
    expect(misbound.structurallyComplete).toBe(false);

    const ambiguous = cases.find(c => c.id === "sugar-extra-unbound")!;
    const actual = await evaluateRealV2(ambiguous);
    expect(actual.report.structurallyComplete).toBe(false);
    expect(actual.report.results.some(x => x.kind === "unbound" && x.grade !== "structured")).toBe(true);
    // A test-level admission check must never be interpreted as proof of
    // real public persistence. Public anti-partial-write E2E belongs to #1308.
  });
});
