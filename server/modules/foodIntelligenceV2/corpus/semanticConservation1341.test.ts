import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { comprehendFoodLanguage } from "../linguisticComprehension";
import type { LinguisticLexiconStore } from "../linguisticComprehension";
import { extractExplicitSugarQuantity } from "../../../coffeeSugarNutrition";
import { goldenFoodCorpusCases } from "./data";
import { GOLDEN_CORPUS_VERSION } from "./contracts";
import { c1bCases } from "./semanticConservation1341.test.fixture";
import type { C1bCase } from "./semanticConservation1341.test.fixture";
import { evaluateC1b, observedProjection, referenceSignature, summarizeC1b, validateC1bReference } from "./semanticConservation1341.test.support";

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
const generatorVersion = "c1b-cartesian-v2";
function generatedEquivalents(): C1bCase[] {
  const cases: C1bCase[] = [];
  for (const [form, coffeeAmount, puddingAmount, coffeeValue, puddingValue] of [
    ["words", "uma", "duas", 1, 2],
    ["digits", "1", "2", 1, 2],
  ] as const) {
    for (const separator of [" e ", ", ", "; "] as const) {
      for (const reversed of [false, true]) {
        const coffee = `o café com ${coffeeAmount} colher de chá de açúcar`;
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
          modality: "text", split: "holdout", facts,
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
    expect(goldenFoodCorpusCases.length).toBeGreaterThan(0);
    expect(new Set(cases.map(c => c.text)).size).toBe(cases.length);
    const groupSplits = new Map<string, string>();
    const groups = new Map<string, string>();
    for (const testCase of cases) {
      const split = groupSplits.get(testCase.semanticGroup);
      if (split) expect(testCase.split, testCase.id).toBe(split);
      else groupSplits.set(testCase.semanticGroup, testCase.split);
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
    // V1 comparison is per independently labelled scope, never a binding oracle.
    const legacy = cases.map(testCase => ({
      id: testCase.id, facts: testCase.facts.map((fact, factIndex) => {
        const observed = fact.kind === "ingredient-quantity"
          ? extractExplicitSugarQuantity(fact.scope) : null;
        return { factIndex, applicable: fact.kind === "ingredient-quantity",
          detected: observed !== null, quantity: observed?.quantity ?? null,
          sourceUnit: observed?.sourceUnit ?? null, ownerVerified: "not-measured" };
      }),
    }));
    const caseResults = measured.map((entry, index) => ({
      id: cases[index].id, group: entry.report.semanticGroup,
      split: entry.report.split, modality: entry.report.modality,
      complete: entry.report.structurallyComplete,
      expected: referenceSignature(cases[index]),
      observed: observedProjection(entry.observations),
      facts: entry.report.results,
    }));
    const groups = new Map<string, { expected: Set<string>; observed: Set<string>;
      variants: number; complete: boolean; split: string }>();
    for (let i=0; i<cases.length; i++) {
      const testCase=cases[i], report=reports[i];
      const group=groups.get(testCase.semanticGroup) ?? {
        expected:new Set<string>(), observed:new Set<string>(),
        variants:0, complete:true, split:testCase.split };
      group.expected.add(referenceSignature(testCase));
      group.observed.add(JSON.stringify(observedProjection(measured[i].observations)));
      group.variants++;
      group.complete &&= report.structurallyComplete;
      groups.set(testCase.semanticGroup, group);
    }
    const metamorphic = Object.fromEntries([...groups].map(([id,g])=>[id,{
      split:g.split, variants:g.variants,
      referenceConsistent:g.expected.size===1,
      observedProjectionEquivalent:g.observed.size===1,
      structurallyComplete:g.complete,
      gatePassed:g.expected.size===1 && g.observed.size===1 && g.complete,
    }]));
    const contrasts = [
      ["coffee1-pudding2spoons","coffee1-pudding2g"],
      ["coffee1-pudding2spoons","coffee-zero-pudding2"],
      ["coffee1-pudding2spoons","coffee1-pudding-zero"],
      ["coffee1-pudding2spoons","coffee1-pudding2-plus-unbound"],
      ["eggs2-banana1","bread1-milk200"],
    ] as const;
    const negativeControls=contrasts.map(([left,right])=>{
      const a=groups.get(left)!, b=groups.get(right)!;
      const referenceDifferent=[...a.expected][0]!==[...b.expected][0];
      const observedCollision=[...a.observed].some(key=>b.observed.has(key));
      return {left,right,referenceDifferent,observedCollision,
        gatePassed:referenceDifferent && !observedCollision && a.complete && b.complete};
    });
    expect(negativeControls.every(item=>item.referenceDifferent)).toBe(true);
    const aggregate = { schemaVersion:2, issue:1341, generatorVersion,
      sampleSha:process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
      corpusRevision:"c1b-annotated-v2", canonicalCorpus:GOLDEN_CORPUS_VERSION,
      canonicalCases:goldenFoodCorpusCases.length, lexiconRevision:"c1b-empty-s2",
      S3:"not-evaluated", providerCalls:0, ...summary,
      byClass, byModality, legacy:{scope:"partial-sugar-extractor",caseResults:legacy,
        ownerBinding:"not-measured"},
      metamorphic, negativeControls, caseResults,
      clarification:{referenceRequired:cases.filter(x=>x.facts.some(f=>f.kind==="unbound")).length,
        unresolvedSignals:measured.filter(x=>x.observations.some(o=>o.unresolvedReason!==null)).length,
        actualClarifications:"not-measured"},
      decision:"adjust-ADR-contract-before-D1-semantic-cutover" };
    console.info("C1B_1341_AGGREGATE="+JSON.stringify(aggregate));
    // Existing C3 artifact uploader also preserves this separately named C1b JSON.
    if(process.env.C3_EVIDENCE_OUTPUT_DIR){
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR,{recursive:true});
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR,"c1b-1341-semantic-conservation.json"),
        JSON.stringify(aggregate,null,2)+"\\n","utf8");
    }
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

    const compound = cases.find(c=>c.id==="sugar-owners-original")!;
    const actualCompound=await evaluateRealV2(compound);
    expect(actualCompound.observations).toHaveLength(2);
    const exchanged=actualCompound.observations.map((obs,i)=>({...obs,
      quantityHints:{...obs.quantityHints,value:i===0?2:1,unit:"colher de chá"}}));
    const mismatch=evaluateC1b(compound,exchanged);
    expect(mismatch.results.filter(x=>x.kind==="ingredient-quantity")
      .every(x=>x.grade==="misbound")).toBe(true);
    const wrongOwners=actualCompound.observations.map((obs,i)=>({...obs,
      identityHints:{...obs.identityHints,foodName:i===0?"pudim":"café"}}));
    expect(evaluateC1b(compound,wrongOwners).results.some(x=>x.grade==="misbound")).toBe(true);
    const brigadeiro=cases.find(c=>c.id==="measure-word-food-name")!;
    const brigadeiroObserved=await evaluateRealV2(brigadeiro);
    const omitted=brigadeiroObserved.observations.filter(obs=>{
      const span=obs.surfaceSpan.span;
      return !span || !obs.rawInput?.slice(span.start,span.end).includes("brigadeiro");
    });
    expect(evaluateC1b(brigadeiro,omitted).results[0].grade).toBe("silent-omission");
    const ambiguous = cases.find(c => c.id === "sugar-extra-unbound")!;
    const actual = await evaluateRealV2(ambiguous);
    expect(actual.report.structurallyComplete).toBe(false);
    expect(actual.report.results.some(x => x.kind === "unbound" && x.grade !== "structured")).toBe(true);
    // A test-level admission check must never be interpreted as proof of
    // real public persistence. Public anti-partial-write E2E belongs to #1308.
  });
});
