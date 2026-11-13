import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { comprehendFoodLanguage } from "../linguisticComprehension";
import type { LinguisticLexiconStore } from "../linguisticComprehension";
import { parseFoodObservation } from "../schemas";
import { extractExplicitSugarQuantity, normalizeSweetenedCoffeeDraftItems } from "../../../coffeeSugarNutrition";
import { parseFoodText, splitFoodTextSegments } from "../../../mealTextParsing";
import { goldenFoodCorpusCases } from "./data";
import { GOLDEN_CORPUS_VERSION } from "./contracts";
import { projectExpectedDecision } from "./projection";
import { c1bCases } from "./semanticConservation1341.test.fixture";
import type { C1bCase } from "./semanticConservation1341.test.fixture";
import { attemptDiagnosticBatchAdmission, evaluateC1b, factSourceRange, observedProjection, referenceSignature, summarizeC1b, validateC1bReference } from "./semanticConservation1341.test.support";

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

/** A synthetic contract-shaped observation for attacking the C1b oracle only.
 * Every anchor is set to the explicitly chosen original UTF-16 span. */
function anchoredDiagnosticObservation(
  template: Awaited<ReturnType<typeof evaluateRealV2>>["observations"][number],
  testCase: C1bCase, observationId: string, span: { start: number; end: number }, value: number,
) {
  const anchor = { sourceRef: `c1b:${testCase.id}`, span, region: null };
  return { ...template, observationId, rawInput: testCase.text, normalizedInput: testCase.text,
    surfaceSpan: anchor, unresolvedReason: null,
    quantityHints: { ...template.quantityHints, value, unit: "un" },
    evidence: template.evidence.map(evidence => ({ ...evidence, anchor,
      value: evidence.field === "quantity.value" ? value : evidence.value,
    })),
    normalizationPath: template.normalizationPath.map(step => ({ ...step, anchor })) };
}

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

/** The A2 reference is the source of these inputs AND expected decisions.
 * No parser prediction is used to construct the baseline or to train S2/S3.
 * These decision-level oracles cannot be compared as LCL semantic accuracy. */
const canonicalBaselineInputs = goldenFoodCorpusCases.filter(testCase =>
  (testCase.modality === "text" || testCase.modality === "audio_transcript") &&
  Boolean(testCase.modality === "audio_transcript"
    ? testCase.input.transcription ?? testCase.input.text : testCase.input.text));
async function runCanonicalA2Baseline() {
  return Promise.all(canonicalBaselineInputs.map(async testCase => {
    const rawText = testCase.modality === "audio_transcript"
      ? testCase.input.transcription ?? testCase.input.text : testCase.input.text;
    const observations = await comprehendFoodLanguage({
      rawText, sourceRef: `golden:${testCase.caseId}`,
      modality: testCase.modality === "audio_transcript" ? "audio_transcript" : "text",
      ownerUserId: null, lexiconRevision: "c1b-empty-s2",
      now: new Date("2026-11-12T12:00:00.000Z"),
    }, emptyGovernedLexicon);
    const expectedDecisions = testCase.expected.decisions.map(projectExpectedDecision);
    return { canonicalCaseId: testCase.caseId, canonicalVersion: GOLDEN_CORPUS_VERSION,
      split: testCase.split, modality: testCase.modality,
      referenceClass: testCase.decisionClass, metamorphicGroup: testCase.metamorphicGroup,
      negativeControlOf: testCase.negativeControlOf,
      expectedDecisions: expectedDecisions.map(item => ({
        status: item.status, nextAction: item.nextAction,
        identity: item.identity, quantity: item.quantity,
        alternatives: item.alternatives, unresolvedFields: item.unresolvedFields,
      })),
      observedObservations: observedProjection(observations),
      preResolutionQuantityClaims: expectedDecisions.map(decision => ({
        expectedValue: decision.quantity.value, expectedUnit: decision.quantity.unit,
        observedHintMatch: decision.quantity.value === null || decision.quantity.unit === null
          ? "not-applicable" : observations.some(observation =>
            observation.quantityHints.value === decision.quantity.value &&
            observation.quantityHints.unit === decision.quantity.unit),
      })),
      interpretation: "A2 decision oracle vs S1 pre-resolution observation — diagnostic, not an accuracy score",
    };
  }));
}

/** Characterizes the actual V1 full-input decomposition and coffee normalization.
 * Never pre-split the full sentence with oracle scopes, and never call V1 truth. */
function legacyWholeInputBaseline(testCase: C1bCase) {
  const segments = splitFoodTextSegments(testCase.text);
  let offset = 0;
  const parts = segments.map(segment => {
    const start = testCase.text.indexOf(segment, offset);
    if (start < 0) throw new Error("c1b-v1-segment-outside-original-input");
    offset = start + segment.length;
    const sugar = extractExplicitSugarQuantity(segment);
    const food = parseFoodText(segment);
    return { originalSpan: [start, offset], segment, parsedFoodName: food.foodName,
      quantity: food.quantity ?? null, unit: food.unit ?? null,
      sugar: sugar && { quantity: sugar.quantity, sourceUnit: sugar.sourceUnit,
        grams: sugar.grams } };
  });
  const coffeeDraft = normalizeSweetenedCoffeeDraftItems([], testCase.text)
    .map(item => ({ foodName: item.foodName, canonicalName: item.canonicalName,
      quantity: item.quantity, unit: item.unit }));
  return { scope: "full-input-V1-legacy-decomposition-and-coffee-normalization",
    publicPersistence: "not-measured", fullInput: testCase.text,
    parts, coffeeDraft, facts: testCase.facts.map((fact, factIndex) => {
      const [sourceStart, sourceEnd] = factSourceRange(testCase, fact);
      const containing = parts.filter(part => part.originalSpan[0] <= sourceStart &&
        part.originalSpan[1] >= sourceEnd);
      return { factIndex, sourceRange: [sourceStart, sourceEnd],
        candidateSegments: containing.map(part => part.segment),
        ownerInSameV1Segment: fact.owner === null ? "not-applicable" :
          containing.some(part => part.segment.includes(fact.owner!)),
        extractedSugarQuantities: containing.flatMap(part => part.sugar ? [part.sugar] : []),
        ownerBinding: "not-measured", interpretation: "observed segmentation; not proven typed owner binding" };
    }) };
}

function diagnosticMatrix() {
  return Promise.all(cases.map(evaluateRealV2));
}

describe("#1341: conservação semântica V1 × V2 — diagnóstico sem cutover", () => {
  it("valida o oráculo material antes de consultar qualquer parser", () => {
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
    expect(c1bCases.some(c => c.split === "holdout")).toBe(true);
    for (const testCase of cases) expect(() => validateC1bReference(testCase)).not.toThrow();
    expect(canonicalBaselineInputs.length).toBeGreaterThan(0);
    // The actual canonical A2 references, not locally rewritten labels, are
    // consumed in runCanonicalA2Baseline. These two references prove lineage.
    expect(canonicalBaselineInputs.find(c => c.caseId === "c-mortadela-1-5-virgula")?.input.text)
      .toBe(cases.find(c => c.id === "food-decimal-fraction")?.text);
    expect(canonicalBaselineInputs.find(c => c.caseId === "c-mortadela-uma-fatia-e-meia")?.input.text)
      .toBe(cases.find(c => c.id === "food-written-fraction")?.text);
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
    expect(groups.get("eggs2-plus-eggs2")).not.toBe(groups.get("eggs2-plus-eggs3"));
    expect(groups.get("coffee1-pudding2spoons")).not.toBe(groups.get("coffee1-pudding2g"));
    expect(groups.get("coffee1-pudding2spoons")).not.toBe(groups.get("coffee1-pudding2-plus-unbound"));
    const corrupted: C1bCase = { ...cases[0], facts: [
      { ...cases[0].facts[0], owner: "pudim" }, ...cases[0].facts.slice(1),
    ] };
    expect(() => validateC1bReference(corrupted)).toThrow("c1b-reference-owner-not-in-scope");
    const emptyOwner: C1bCase = { ...cases[0], facts: [
      { ...cases[0].facts[0], owner: "" }, ...cases[0].facts.slice(1),
    ] };
    expect(() => validateC1bReference(emptyOwner)).toThrow("c1b-reference-owner-not-in-scope");
    const ambiguous = cases.find(c => c.id === "sugar-extra-unbound")!;
    const incomplete: C1bCase = { ...ambiguous, facts: ambiguous.facts.map(fact =>
      fact.kind === "unbound" ? { ...fact, ownerAlternatives: ["café"] } : fact) };
    expect(() => validateC1bReference(incomplete))
      .toThrow("c1b-reference-ambiguous-owners-incomplete");
    const repeatedLiteral = cases.find(c => c.id === "food-repeated-literal")!;
    expect(repeatedLiteral.facts.map(fact => factSourceRange(repeatedLiteral, fact)))
      .toEqual([[0, 6], [14, 20]]);
    const replaceSecond = (fact: C1bCase["facts"][number]): C1bCase => ({
      ...repeatedLiteral, facts: [repeatedLiteral.facts[0], fact],
    });
    expect(() => validateC1bReference(replaceSecond({ ...repeatedLiteral.facts[1],
      surfaceStart: undefined }))).toThrow("c1b-reference-unlocatable-or-ambiguous");
    expect(() => validateC1bReference(replaceSecond({ ...repeatedLiteral.facts[1],
      surfaceStart: 13 }))).toThrow("c1b-reference-offset-not-matching-original");
    expect(() => validateC1bReference(replaceSecond({ ...repeatedLiteral.facts[1],
      surfaceStart: 0 }))).toThrow("c1b-reference-duplicate-fact-occurrence");
  });

  it("mede a LCL real, separando conteúdo rastreável de vínculos demonstrados", async () => {
    const measured = await diagnosticMatrix();
    const reports = measured.map(x => x.report);
    const summary = summarizeC1b(reports);
    expect(summary.facts).toBe(cases.reduce((n, c) => n + c.facts.length, 0));
    expect(summary.cases).toBe(cases.length);
    // The experiment is allowed to find failures. A green test confirms that
    // the detector ran and disclosed them, NOT that V2 passed the semantic gate.
    expect(summary.grades["ingredient-quantity-unobserved"] +
      summary.grades["ingredient-quantity-mismatch"] +
      summary.grades["missing-component-binding"]).toBeGreaterThan(0);
    expect(summary.casesStructurallyComplete).toBeLessThan(cases.length);
    const byClass = Object.fromEntries(
      ["calibration", "holdout"].map(split => [split,
        summarizeC1b(reports.filter(report => report.split === split))]),
    );
    const byModality = Object.fromEntries(
      ["text", "audio_transcript"].map(modality => [modality,
        summarizeC1b(reports.filter(report => report.modality === modality))]),
    );
    // Both baselines execute actual source functions on the *whole* input:
    // A2 canonical decisions remain the independent normative reference; V1
    // is an observed partial pre-resolution comparator, never an oracle.
    const canonicalBaseline = await runCanonicalA2Baseline();
    expect(canonicalBaseline.length).toBe(canonicalBaselineInputs.length);
    expect(canonicalBaseline.some(row => row.canonicalCaseId === "c-mortadela-1-5-virgula"))
      .toBe(true);
    const legacy = cases.map(legacyWholeInputBaseline);
    expect(legacy.length).toBe(cases.length);
    const caseResults = measured.map((entry, index) => ({
      id: cases[index].id, group: entry.report.semanticGroup,
      split: entry.report.split, modality: entry.report.modality,
      complete: entry.report.structurallyComplete,
      expected: referenceSignature(cases[index]),
      observed: observedProjection(entry.observations),
      observedAlternatives: entry.observations.flatMap(obs => obs.alternatives.map(alt => ({
        foodName: alt.identityHints.foodName,
        quantity: alt.quantityHints.value, unit: alt.quantityHints.unit,
      }))),
      facts: entry.report.results, observationIssues: entry.report.observationIssues,
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
      structurallyComplete:g.complete, evaluable:g.variants>1,
      gatePassed:g.variants>1 && g.expected.size===1 && g.observed.size===1 && g.complete,
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

    // Negative controls operate on the real LCL output, never on another
    // parser's prediction. Publish their observed grades with the CI matrix.
    const simpleIndex = cases.findIndex(c => c.id === "food-count-simple");
    const simpleCase = cases[simpleIndex];
    const simpleObservations = measured[simpleIndex].observations;
    const fullIds = simpleObservations.map(obs => obs.observationId);
    const unresolvedAttempt = attemptDiagnosticBatchAdmission(simpleCase, simpleObservations, fullIds);
    const syntheticResolved = simpleObservations.map(obs => ({ ...obs, unresolvedReason: null }));
    const resolvedAttempt = attemptDiagnosticBatchAdmission(simpleCase, syntheticResolved, fullIds);
    const changedSource = simpleObservations.map(obs => ({ ...obs,
      surfaceSpan: { ...obs.surfaceSpan, sourceRef: "c1b:other-input" },
    }));
    const changedEvidence = simpleObservations.map(obs => ({ ...obs,
      evidence: obs.evidence.map((ev, i) => i === 0 ? { ...ev,
        anchor: { ...ev.anchor, sourceRef: "c1b:other-input" } } : ev),
    }));
    const changedNormalization = simpleObservations.map(obs => ({ ...obs,
      normalizationPath: obs.normalizationPath.map((step, i) => i === 0 ? {
        ...step, anchor: { ...step.anchor, sourceRef: "c1b:other-input" },
      } : step),
    }));
    expect(simpleObservations.every(obs => obs.evidence.length > 0 && obs.normalizationPath.length > 0)).toBe(true);
    const sourceReport = evaluateC1b(simpleCase, changedSource);
    const evidenceReport = evaluateC1b(simpleCase, changedEvidence);
    const normalizationReport = evaluateC1b(simpleCase, changedNormalization);
    for (const report of [sourceReport, evidenceReport, normalizationReport]) {
      expect(report.results.every(x => x.grade === "invalid-provenance")).toBe(true);
      expect(report.structurallyComplete).toBe(false);
    }
    expect(attemptDiagnosticBatchAdmission(simpleCase, changedSource,
      changedSource.map(obs => obs.observationId)).admitted).toBe(false);
    expect(measured[simpleIndex].report.structurallyComplete).toBe(true);
    expect(unresolvedAttempt.admitted).toBe(false);
    expect(unresolvedAttempt.unresolvedObservations).toHaveLength(simpleObservations.length);
    expect(resolvedAttempt.admitted).toBe(true);
    expect(resolvedAttempt.unresolvedObservations).toHaveLength(0);

    // Independent reverse coverage: the detector must reject facts *invented*
    // by the parser, duplicate observations and contradictory/missing evidence.
    // These controls use a synthetic resolved state solely to exercise the
    // diagnostic admission predicate, never a public meal writer.
    const target = syntheticResolved.find(obs => obs.identityHints.foodName === "ovos")!;
    const patchTarget = (change: typeof target) => syntheticResolved.map(obs =>
      obs.observationId === target.observationId ? change : obs);
    const addedFood = [...syntheticResolved, { ...target,
      observationId: target.observationId + ":fabricated",
      identityHints: { ...target.identityHints, foodName: "maçã" },
      evidence: target.evidence.map(item => item.field === "identity.foodName"
        ? { ...item, value: "maçã" } : item),
    }];
    const duplicatedFood = [...syntheticResolved, { ...target,
      observationId: target.observationId + ":duplicate" }];
    const wrongIdentityProof = patchTarget({ ...target,
      evidence: target.evidence.map(item => item.field === "identity.foodName"
        ? { ...item, value: "banana" } : item),
    });
    const numeral = { start: target.surfaceSpan.span!.start,
      end: target.surfaceSpan.span!.start + 1 };
    const identityAnchorWrong = patchTarget({ ...target,
      evidence: target.evidence.map(item => item.field === "identity.foodName"
        ? { ...item, anchor: { ...item.anchor, span: numeral } } : item),
    });
    const overWide = { ...target.surfaceSpan, span: { start: 0, end: simpleCase.text.length } };
    const crossOwnerEvidence = patchTarget({ ...target, surfaceSpan: overWide,
      evidence: target.evidence.map(item => ({ ...item, anchor: overWide })),
      normalizationPath: target.normalizationPath.map(step => ({ ...step, anchor: overWide })),
    });
    const missingProof = patchTarget({ ...target, evidence: [], normalizationPath: [] });
    const missingQuantityProof = patchTarget({ ...target,
      evidence: target.evidence.filter(item => item.field !== "quantity.value"),
    });
    const wrongQuantityProof = patchTarget({ ...target,
      evidence: target.evidence.map(item => item.field === "quantity.value"
        ? { ...item, value: 99 } : item),
    });
    const wrongNormalizationAnchor = patchTarget({ ...target,
      normalizationPath: target.normalizationPath.map(step => ({ ...step,
        anchor: { ...step.anchor, span: numeral },
      })),
    });
    const adversarial = {
      addedFood, duplicatedFood, wrongIdentityProof, identityAnchorWrong,
      crossOwnerEvidence, missingProof, missingQuantityProof, wrongQuantityProof, wrongNormalizationAnchor,
    };
    const attacks = Object.fromEntries(Object.entries(adversarial).map(([id, inputs]) => {
      const report = evaluateC1b(simpleCase, inputs);
      const allIds = inputs.map(obs => obs.observationId);
      const attempt = attemptDiagnosticBatchAdmission(simpleCase, inputs, allIds);
      expect(report.structurallyComplete, id).toBe(false);
      expect(attempt.admitted, id).toBe(false);
      return [id, { grades: report.results.map(item => item.grade),
        observationIssues: report.observationIssues.map(item => item.grade),
        structurallyComplete: report.structurallyComplete, admitted: attempt.admitted }];
    }));
    expect(attacks.addedFood.observationIssues).toContain("unexpected-observation");
    expect(attacks.duplicatedFood.observationIssues).toContain("duplicate-observation");
    for (const id of ["wrongIdentityProof", "identityAnchorWrong", "crossOwnerEvidence", "missingProof",
      "missingQuantityProof", "wrongQuantityProof", "wrongNormalizationAnchor"] as const) {
      expect(attacks[id].grades, id).toContain("invalid-evidence");
      expect(attacks[id].observationIssues, id).toContain("invalid-evidence");
    }
    expect(evaluateC1b(simpleCase, syntheticResolved).structurallyComplete).toBe(true);
    expect(attemptDiagnosticBatchAdmission(simpleCase, addedFood,
      syntheticResolved.map(obs => obs.observationId)).admitted).toBe(false);
    expect(attemptDiagnosticBatchAdmission(simpleCase, duplicatedFood,
      syntheticResolved.map(obs => obs.observationId)).admitted).toBe(false);

    // A-1342-17: a one-quantity observation cannot prove two independent
    // increments of the SAME food, even with equal values and broad anchors.
    const repeated = cases.find(c => c.id === "food-repeated-equal")!;
    const distinct = cases.find(c => c.id === "food-repeated-distinct")!;
    const eggsTemplate = simpleObservations.find(obs => obs.identityHints.foodName === "ovos")!;
    const allOfRepeated = { start: 0, end: repeated.text.length };
    const singleRepeated = anchoredDiagnosticObservation(eggsTemplate, repeated,
      "c1b-repeated-single", allOfRepeated, 2);
    const sharedQuantity = evaluateC1b(repeated, [singleRepeated]);
    const sharedAttempt = attemptDiagnosticBatchAdmission(repeated, [singleRepeated],
      [singleRepeated.observationId]);
    expect(parseFoodObservation(singleRepeated).ok).toBe(true);
    expect(sharedQuantity.results.map(fact => fact.grade))
      .toContain("shared-quantity-observation");
    expect(sharedQuantity.structurallyComplete).toBe(false);
    expect(sharedAttempt.admitted).toBe(false);
    expect(sharedAttempt.blocked.some(item => item.reason === "shared-quantity-observation")).toBe(true);
    const occurrenceSpan = (text: string, literal: string) => ({
      start: text.indexOf(literal), end: text.indexOf(literal) + literal.length,
    });
    const independentRepeated = [
      anchoredDiagnosticObservation(eggsTemplate, repeated, "c1b-repeated-first",
        occurrenceSpan(repeated.text, "2 ovos"), 2),
      anchoredDiagnosticObservation(eggsTemplate, repeated, "c1b-repeated-second",
        occurrenceSpan(repeated.text, "dois ovos"), 2),
    ];
    expect(independentRepeated.every(obs => parseFoodObservation(obs).ok)).toBe(true);
    const independentReport = evaluateC1b(repeated, independentRepeated);
    expect(independentReport.results.map(fact => fact.grade)).toEqual(["structured", "structured"]);
    expect(independentReport.observationIssues).toEqual([]);
    expect(independentReport.structurallyComplete).toBe(true);
    const independentAttempt = attemptDiagnosticBatchAdmission(repeated, independentRepeated,
      independentRepeated.map(obs => obs.observationId));
    expect(independentAttempt.admitted).toBe(true);

    // A-1342-20: two EXACTLY equal literals must preserve distinct authored
    // UTF-16 occurrences, without guessing which occurrence the parser meant.
    const repeatedLiteral = cases.find(c => c.id === "food-repeated-literal")!;
    const [firstLiteral, secondLiteral] = repeatedLiteral.facts.map(fact => {
      const [start, end] = factSourceRange(repeatedLiteral, fact);
      return { start, end };
    });
    const literalFirst = anchoredDiagnosticObservation(eggsTemplate, repeatedLiteral,
      "c1b-literal-first", firstLiteral, 2);
    const literalSecond = anchoredDiagnosticObservation(eggsTemplate, repeatedLiteral,
      "c1b-literal-second", secondLiteral, 2);
    const literalIndependent = [literalFirst, literalSecond];
    expect(literalIndependent.every(obs => parseFoodObservation(obs).ok)).toBe(true);
    const literalPositive = evaluateC1b(repeatedLiteral, literalIndependent);
    const literalPositiveAttempt = attemptDiagnosticBatchAdmission(repeatedLiteral,
      literalIndependent, literalIndependent.map(obs => obs.observationId));
    expect(literalPositive.results.map(fact => fact.sourceRange))
      .toEqual([[0, 6], [14, 20]]);
    expect(literalPositive.results.map(fact => fact.grade)).toEqual(["structured", "structured"]);
    expect(literalPositive.observationIssues).toEqual([]);
    expect(literalPositive.structurallyComplete).toBe(true);
    expect(literalPositiveAttempt.admitted).toBe(true);
    // A-1342-23: a serving phrase from the second identical occurrence must
    // not prove the first, even when both share the same authored scope.
    const firstOwnServing = { ...literalFirst, quantityHints: {
      ...literalFirst.quantityHints, servingText: "2 ovos" } };
    expect(evaluateC1b(repeatedLiteral, [firstOwnServing, literalSecond]).structurallyComplete).toBe(true);
    const firstBorrowingSecond = { ...literalFirst, quantityHints: {
      ...literalFirst.quantityHints, servingText: "mais 2 ovos" } };
    const borrowedInputs = [firstBorrowingSecond, literalSecond];
    const borrowedServingReport = evaluateC1b(repeatedLiteral, borrowedInputs);
    const borrowedServingAdmission = attemptDiagnosticBatchAdmission(repeatedLiteral, borrowedInputs,
      borrowedInputs.map(obs => obs.observationId));
    expect(parseFoodObservation(firstBorrowingSecond).ok).toBe(true);
    expect(borrowedServingReport.results[0].grade).toBe("invalid-evidence");
    expect(borrowedServingReport.structurallyComplete).toBe(false);
    expect(borrowedServingAdmission.admitted).toBe(false);
    const literalOmitted = evaluateC1b(repeatedLiteral, [literalFirst]);
    expect(literalOmitted.results.map(fact => fact.grade))
      .toEqual(["structured", "silent-omission"]);
    expect(attemptDiagnosticBatchAdmission(repeatedLiteral, [literalFirst],
      [literalFirst.observationId]).admitted).toBe(false);
    // Even separate proof anchors for both occurrences cannot turn ONE
    // quantityHints value into two independent quantities.
    const oneBroadLiteral = anchoredDiagnosticObservation(eggsTemplate, repeatedLiteral,
      "c1b-literal-broad", { start: 0, end: repeatedLiteral.text.length }, 2);
    const broadQuantityProof = oneBroadLiteral.evidence.find(item => item.field === "quantity.value")!;
    const sharedLiteral = { ...oneBroadLiteral, evidence: [
      ...oneBroadLiteral.evidence.filter(item => item.field !== "quantity.value"),
      { ...broadQuantityProof, evidenceId: "c1b-literal-first-proof",
        anchor: { ...broadQuantityProof.anchor, span: firstLiteral } },
      { ...broadQuantityProof, evidenceId: "c1b-literal-second-proof",
        anchor: { ...broadQuantityProof.anchor, span: secondLiteral } },
    ] };
    const literalShared = evaluateC1b(repeatedLiteral, [sharedLiteral]);
    expect(literalShared.results.map(fact => fact.grade))
      .toContain("shared-quantity-observation");
    expect(literalShared.structurallyComplete).toBe(false);
    expect(attemptDiagnosticBatchAdmission(repeatedLiteral, [sharedLiteral],
      [sharedLiteral.observationId]).admitted).toBe(false);

    const oneDistinct = anchoredDiagnosticObservation(eggsTemplate, distinct,
      "c1b-distinct-single", { start: 0, end: distinct.text.length }, 2);
    const distinctReport = evaluateC1b(distinct, [oneDistinct]);
    expect(distinctReport.structurallyComplete).toBe(false);
    expect(attemptDiagnosticBatchAdmission(distinct, [oneDistinct],
      [oneDistinct.observationId]).admitted).toBe(false);
    const independentDistinct = [
      anchoredDiagnosticObservation(eggsTemplate, distinct, "c1b-distinct-first",
        occurrenceSpan(distinct.text, "2 ovos"), 2),
      anchoredDiagnosticObservation(eggsTemplate, distinct, "c1b-distinct-second",
        occurrenceSpan(distinct.text, "3 ovos"), 3),
    ];
    expect(evaluateC1b(distinct, independentDistinct).structurallyComplete).toBe(true);

    // A-1342-18: preserve owner ambiguity, but do not hide wrong/missing
    // numerical content behind a generic traceable-unresolved grade.
    const gramCase = cases.find(c => c.id === "sugar-extra-gram")!;
    const gramObservations = measured[cases.indexOf(gramCase)].observations;
    const continuation = gramObservations.find(obs => {
      const span = obs.surfaceSpan.span;
      return span !== null && gramCase.text.slice(span.start, span.end).includes("mais 1 g de açúcar");
    })!;
    expect(continuation).toBeDefined();
    const continuationAnchor = continuation.surfaceSpan;
    const quantityEvidence = { ...continuation.evidence[0], evidenceId: "c1b-ambiguous-quantity",
      field: "quantity.value", value: 1, unit: "g", anchor: continuationAnchor };
    const labelledContinuation = { ...continuation,
      identityHints: { ...continuation.identityHints, foodName: null },
      quantityHints: { ...continuation.quantityHints, value: 1, unit: "g" },
      evidence: [quantityEvidence],
      alternatives: (["café", "pudim"] as const).map((foodName, index) => ({
        hypothesisId: `c1b-ambiguous-owner-${index}`, confidence: 0.5, evidenceIds: [],
        identityHints: { ...continuation.identityHints, foodName },
        quantityHints: { ...continuation.quantityHints, value: 1, unit: "g" },
      })),
    };
    expect(parseFoodObservation(labelledContinuation).ok).toBe(true);
    const continuedWith = (observation: typeof labelledContinuation) => gramObservations.map(obs =>
      obs.observationId === continuation.observationId ? observation : obs);
    const continuationFact = (obs: typeof labelledContinuation) => evaluateC1b(gramCase, continuedWith(obs))
      .results.find(fact => fact.kind === "unbound")!.grade;
    expect(continuationFact(labelledContinuation)).toBe("traceable-unresolved");
    const wrongQuantity = { ...labelledContinuation,
      quantityHints: { ...labelledContinuation.quantityHints, value: 999 },
      evidence: [{ ...quantityEvidence, value: 999 }],
    };
    const wrongUnit = { ...labelledContinuation,
      quantityHints: { ...labelledContinuation.quantityHints, unit: "kg" },
      evidence: [{ ...quantityEvidence, unit: "kg" }],
    };
    const missingQuantity = { ...labelledContinuation,
      quantityHints: { ...labelledContinuation.quantityHints, value: null, unit: null },
      evidence: [],
    };
    expect(continuationFact(wrongQuantity)).toBe("unbound-quantity-mismatch");
    expect(continuationFact(wrongUnit)).toBe("unbound-quantity-mismatch");
    expect(continuationFact(missingQuantity)).toBe("unbound-quantity-unobserved");
    for (const observation of [wrongQuantity, wrongUnit, missingQuantity]) {
      expect(attemptDiagnosticBatchAdmission(gramCase, continuedWith(observation),
        gramObservations.map(obs => obs.observationId)).admitted).toBe(false);
    }
    // A-1342-21: alternatives are claims, not harmless annotation. An
    // unexpected owner, repeated owner or invented amount cannot be hidden
    // behind a correctly abstaining primary observation.
    const extraOwner = { ...labelledContinuation, alternatives: [
      ...labelledContinuation.alternatives,
      { ...labelledContinuation.alternatives[0], hypothesisId: "c1b-extra-owner",
        identityHints: { ...labelledContinuation.identityHints, foodName: "laranja" } },
    ] };
    const repeatedOwner = { ...labelledContinuation, alternatives: [
      ...labelledContinuation.alternatives,
      { ...labelledContinuation.alternatives[0], hypothesisId: "c1b-repeated-owner" },
    ] };
    const changedAlternativeQuantity = { ...labelledContinuation, alternatives: [
      { ...labelledContinuation.alternatives[0], quantityHints: {
        ...labelledContinuation.alternatives[0].quantityHints, value: 999 } },
      labelledContinuation.alternatives[1],
    ] };
    const changedAlternativeUnit = { ...labelledContinuation, alternatives: [
      { ...labelledContinuation.alternatives[0], quantityHints: {
        ...labelledContinuation.alternatives[0].quantityHints, unit: "kg" } },
      labelledContinuation.alternatives[1],
    ] };
    const changedAlternativeServing = { ...labelledContinuation, alternatives: [
      { ...labelledContinuation.alternatives[0], quantityHints: {
        ...labelledContinuation.alternatives[0].quantityHints, servingText: "999 g" } },
      labelledContinuation.alternatives[1],
    ] };
    const alternativeAttacks = { extraOwner, repeatedOwner,
      changedAlternativeQuantity, changedAlternativeUnit, changedAlternativeServing };
    expect(continuationFact(labelledContinuation)).toBe("traceable-unresolved");
    const alternativeAttackResults = Object.fromEntries(Object.entries(alternativeAttacks)
      .map(([id, observation]) => {
        expect(parseFoodObservation(observation).ok, id).toBe(true);
        const report = evaluateC1b(gramCase, continuedWith(observation));
        const grade = report.results.find(fact => fact.kind === "unbound")!.grade;
        expect(grade, id).toBe("invalid-evidence");
        expect(report.observationIssues.map(issue => issue.grade), id)
          .toContain("invalid-evidence");
        expect(attemptDiagnosticBatchAdmission(gramCase, continuedWith(observation),
          gramObservations.map(obs => obs.observationId)).admitted, id).toBe(false);
        return [id, { grade, admitted: false }];
      }));
    const quantityRemediationControls = {
      sameOwnerRepeated: { caseId: repeated.id, expected: "shared-quantity-observation",
        grades: sharedQuantity.results.map(fact => fact.grade),
        structurallyComplete: sharedQuantity.structurallyComplete, admitted: sharedAttempt.admitted,
        twoIndependentObservationsComplete: independentReport.structurallyComplete,
        twoIndependentObservationsAdmitted: independentAttempt.admitted },
      sameOwnerDifferent: { caseId: distinct.id, incomplete: !distinctReport.structurallyComplete,
        twoIndependentObservationsComplete: evaluateC1b(distinct, independentDistinct).structurallyComplete },
      ambiguousQuantity: { caseId: gramCase.id, baseline: continuationFact(labelledContinuation),
        wrongValue: continuationFact(wrongQuantity), wrongUnit: continuationFact(wrongUnit),
        missing: continuationFact(missingQuantity) },
    };

    // A-1342-19: a name containing a measure word has NO measured portion.
    // Coherent fabricated evidence must never make it structurally complete.
    const mentionCase: C1bCase = {
      id: "c1b-regression-food-mention", text: "brigadeiro de colher",
      semanticGroup: "c1b-regression-food-mention", split: "calibration", modality: "text",
      facts: [cases.find(c => c.id === "measure-word-food-name")!.facts[0]],
    };
    const mentionTemplate = measured[cases.findIndex(c => c.id === "measure-word-food-name")]
      .observations.find(obs => obs.identityHints.foodName === "brigadeiro de colher")!;
    const mentionAnchor = { sourceRef: `c1b:${mentionCase.id}`, region: null,
      span: { start: 0, end: mentionCase.text.length } };
    const mentionValid = { ...mentionTemplate,
      observationId: "c1b-food-mention", rawInput: mentionCase.text,
      normalizedInput: mentionCase.text, surfaceSpan: mentionAnchor,
      unresolvedReason: null,
      evidence: mentionTemplate.evidence.map(item => ({ ...item, anchor: mentionAnchor })),
      normalizationPath: mentionTemplate.normalizationPath.map(step => ({ ...step, anchor: mentionAnchor })),
    };
    expect(parseFoodObservation(mentionValid).ok).toBe(true);
    const mentionPositive = evaluateC1b(mentionCase, [mentionValid]);
    expect(mentionPositive.results[0].grade).toBe("structured");
    expect(mentionPositive.structurallyComplete).toBe(true);
    expect(attemptDiagnosticBatchAdmission(mentionCase, [mentionValid],
      [mentionValid.observationId]).admitted).toBe(true);
    const mentionQuantityProof = { ...eggsTemplate.evidence.find(item => item.field === "quantity.value")!,
      evidenceId: "c1b-invented-quantity", anchor: mentionAnchor };
    const inventedMention = (value: number, unit: string) => ({ ...mentionValid,
      quantityHints: { ...mentionValid.quantityHints, value, unit },
      evidence: [...mentionValid.evidence,
        { ...mentionQuantityProof, value, unit }],
    });
    const inventedVariants = [inventedMention(99, "g"), inventedMention(1, "colher")];
    const inventedMentionAttacks = inventedVariants.map(observation => {
      expect(parseFoodObservation(observation).ok).toBe(true);
      const report = evaluateC1b(mentionCase, [observation]);
      const admission = attemptDiagnosticBatchAdmission(mentionCase, [observation],
        [observation.observationId]);
      expect(report.results[0].grade).toBe("invalid-evidence");
      expect(report.observationIssues.map(item => item.grade)).toContain("invalid-evidence");
      expect(report.structurallyComplete).toBe(false);
      expect(admission.admitted).toBe(false);
      return { value: observation.quantityHints.value, unit: observation.quantityHints.unit,
        grade: report.results[0].grade, admitted: admission.admitted };
    });
    const leftoverUnitMention = { ...mentionValid,
      quantityHints: { ...mentionValid.quantityHints, value: null, unit: "g" } };
    expect(evaluateC1b(mentionCase, [leftoverUnitMention]).results[0].grade)
      .toBe("invalid-evidence");
    // A valid first fact cannot become "structured" from a fabricated quantity
    // merely because a second, independent coffee fact remains incomplete.
    const actualMentionCase = cases.find(c => c.id === "measure-word-food-name")!;
    const actualMentionObservations = measured[cases.indexOf(actualMentionCase)].observations;
    const inventedInHoldout = actualMentionObservations.map(obs =>
      obs.identityHints.foodName === "brigadeiro de colher" ? {
        ...obs, quantityHints: { ...obs.quantityHints, value: 99, unit: "g" },
        evidence: [...obs.evidence, { ...mentionQuantityProof,
          anchor: obs.surfaceSpan }],
      } : obs);
    expect(evaluateC1b(actualMentionCase, inventedInHoldout).results[0].grade)
      .toBe("invalid-evidence");
    // A-1342-21: both fully resolved mentions and unresolved continuations
    // must reject hypotheses not supported by the manual fact reference.
    const benignMentionAlternative = { hypothesisId: "c1b-mention-equivalent",
      identityHints: { ...mentionValid.identityHints },
      quantityHints: { ...mentionValid.quantityHints },
      evidenceIds: mentionValid.evidence.map(item => item.evidenceId), confidence: 0.5 };
    const mentionWithBenignAlternative = { ...mentionValid,
      alternatives: [benignMentionAlternative] };
    expect(parseFoodObservation(mentionWithBenignAlternative).ok).toBe(true);
    expect(evaluateC1b(mentionCase, [mentionWithBenignAlternative]).structurallyComplete).toBe(true);
    const mentionWithInventedAlternative = { ...mentionWithBenignAlternative,
      alternatives: [{ ...benignMentionAlternative,
        quantityHints: { ...benignMentionAlternative.quantityHints, value: 99, unit: "g" } }] };
    const mentionWithInventedOwner = { ...mentionWithBenignAlternative,
      alternatives: [{ ...benignMentionAlternative,
        identityHints: { ...benignMentionAlternative.identityHints, foodName: "laranja" } }] };
    // A-1342-24: an alternative may not invent a negation or preparation
    // without a matching, source-anchored independent fact for its owner.
    const inventedQualifier = { value: "sem açúcar", attributeCode: null,
      role: "sweetening", confidence: 0.99 };
    const mentionWithInventedNegation = { ...mentionWithBenignAlternative,
      alternatives: [{ ...benignMentionAlternative, identityHints: {
        ...benignMentionAlternative.identityHints, qualifiers: [inventedQualifier] } }] };
    const mentionWithInventedPreparation = { ...mentionWithBenignAlternative,
      alternatives: [{ ...benignMentionAlternative, identityHints: {
        ...benignMentionAlternative.identityHints, qualifiers: [
          { ...inventedQualifier, value: "assado", role: "preparation" }] } }] };
    const negationCase = cases.find(c => c.id === "sugar-other-negation")!;
    const originalNegations = measured[cases.indexOf(negationCase)].observations;
    const negationObservation = originalNegations.find(obs =>
      obs.identityHints.qualifiers.some(q => q.role === "sweetening"))!;
    const withSupportedNegation = { ...negationObservation, alternatives: [{
      hypothesisId: "c1b-supported-negation", identityHints: negationObservation.identityHints,
      quantityHints: negationObservation.quantityHints, confidence: 0.5,
      evidenceIds: negationObservation.evidence.map(item => item.evidenceId),
    }] };
    expect(parseFoodObservation(withSupportedNegation).ok).toBe(true);
    const supportedNegationReport = evaluateC1b(negationCase, originalNegations.map(obs =>
      obs.observationId === negationObservation.observationId ? withSupportedNegation : obs));
    expect(supportedNegationReport.results[1].grade).toBe("structured");

    // A-1342-22: servingText is original-source text, not a free-form
    // quantity oracle. Visible packaging is separately labelled metadata.
    const sourceBackedServing = { ...mentionValid, quantityHints: {
      ...mentionValid.quantityHints, servingText: "brigadeiro de colher" } };
    expect(evaluateC1b(mentionCase, [sourceBackedServing]).structurallyComplete).toBe(true);
    const unsupportedServing = { ...mentionValid,
      quantityHints: { ...mentionValid.quantityHints, servingText: "99 g" } };
    const siblingServing = actualMentionObservations.map(obs =>
      obs.identityHints.foodName === "brigadeiro de colher" ? { ...obs,
        quantityHints: { ...obs.quantityHints,
          servingText: actualMentionCase.facts[1].surface } } : obs);
    expect(evaluateC1b(actualMentionCase, siblingServing).results[0].grade)
      .toBe("invalid-evidence");
    const unsupportedPackageValue = { ...mentionValid,
      quantityHints: { ...mentionValid.quantityHints, visiblePackageQuantity: 99,
        visiblePackageUnit: "g" } };
    const unsupportedPackageUnit = { ...mentionValid,
      quantityHints: { ...mentionValid.quantityHints, visiblePackageUnit: "g" } };
    const unsupportedPackageAmount = { ...mentionValid,
      quantityHints: { ...mentionValid.quantityHints, visiblePackageQuantity: 99 } };
    const unsupportedCombined = { ...unsupportedPackageValue,
      quantityHints: { ...unsupportedPackageValue.quantityHints, servingText: "99 g" } };
    const secondaryQuantityAttacks = { mentionWithInventedAlternative,
      mentionWithInventedOwner, mentionWithInventedNegation, mentionWithInventedPreparation,
      unsupportedServing, unsupportedPackageValue, unsupportedPackageUnit,
      unsupportedPackageAmount, unsupportedCombined };
    const secondaryAttackResults = Object.fromEntries(Object.entries(secondaryQuantityAttacks)
      .map(([id, observation]) => {
        expect(parseFoodObservation(observation).ok, id).toBe(true);
        const report = evaluateC1b(mentionCase, [observation]);
        const attempt = attemptDiagnosticBatchAdmission(mentionCase, [observation],
          [observation.observationId]);
        expect(report.results[0].grade, id).toBe("invalid-evidence");
        expect(report.observationIssues.map(issue => issue.grade), id)
          .toContain("invalid-evidence");
        expect(report.structurallyComplete, id).toBe(false);
        expect(attempt.admitted, id).toBe(false);
        return [id, { grade: report.results[0].grade, admitted: attempt.admitted }];
      }));
    const packageCase: C1bCase = {
      id: "c1b-regression-source-backed-package",
      text: "iogurte, embalagem de 170 g", modality: "text", split: "calibration",
      semanticGroup: "c1b-regression-source-backed-package",
      facts: [{ kind: "food-mention", owner: "iogurte", surface: "iogurte",
        scope: "iogurte, embalagem de 170 g", ingredient: null,
        quantity: null, unit: null,
        packageClaim: { surface: "170 g", quantity: 170, unit: "g" } }],
    };
    validateC1bReference(packageCase);
    const packageAnchor = { sourceRef: `c1b:${packageCase.id}`, region: null,
      span: { start: 0, end: packageCase.text.length } };
    const packagePositive = { ...mentionValid, observationId: "c1b-source-backed-package",
      rawInput: packageCase.text, normalizedInput: packageCase.text,
      surfaceSpan: packageAnchor,
      identityHints: { ...mentionValid.identityHints, foodName: "iogurte" },
      quantityHints: { ...mentionValid.quantityHints,
        visiblePackageQuantity: 170, visiblePackageUnit: "g" },
      evidence: mentionValid.evidence.map(item => ({ ...item, anchor: packageAnchor,
        value: item.field === "identity.foodName" ? "iogurte" : item.value })),
      normalizationPath: mentionValid.normalizationPath.map(step => ({ ...step, anchor: packageAnchor })) };
    expect(parseFoodObservation(packagePositive).ok).toBe(true);
    expect(evaluateC1b(packageCase, [packagePositive]).structurallyComplete).toBe(true);
    expect(attemptDiagnosticBatchAdmission(packageCase, [packagePositive],
      [packagePositive.observationId]).admitted).toBe(true);
    const labelledPackageAttacks = {
      missingPackage: { ...packagePositive, quantityHints: { ...packagePositive.quantityHints,
        visiblePackageQuantity: null, visiblePackageUnit: null } },
      wrongAmount: { ...packagePositive, quantityHints: { ...packagePositive.quantityHints,
        visiblePackageQuantity: 171 } },
      wrongUnit: { ...packagePositive, quantityHints: { ...packagePositive.quantityHints,
        visiblePackageUnit: "kg" } },
    };
    for (const [id, observation] of Object.entries(labelledPackageAttacks)) {
      expect(parseFoodObservation(observation).ok, id).toBe(true);
      expect(evaluateC1b(packageCase, [observation]).structurallyComplete, id).toBe(false);
      expect(attemptDiagnosticBatchAdmission(packageCase, [observation],
        [observation.observationId]).admitted, id).toBe(false);
    }
    const newRemediationControls = {
      unsupportedMentionQuantity: { caseId: mentionCase.id,
        benignGrade: mentionPositive.results[0].grade,
        benignSyntheticAdmission: true, inventedVariants: inventedMentionAttacks,
        leftoverUnitGrade: evaluateC1b(mentionCase, [leftoverUnitMention]).results[0].grade,
        existingHoldoutGrade: evaluateC1b(actualMentionCase, inventedInHoldout).results[0].grade },
      identicalLiteralOccurrences: { caseId: repeatedLiteral.id,
        sourceRanges: literalPositive.results.map(fact => fact.sourceRange),
        independentGrades: literalPositive.results.map(fact => fact.grade),
        independentSyntheticAdmission: literalPositiveAttempt.admitted,
        omittedGrades: literalOmitted.results.map(fact => fact.grade),
        sharedGrades: literalShared.results.map(fact => fact.grade),
        sharedSyntheticAdmission: false },
      alternativeAndSecondaryQuantities: {
        cases: [mentionCase.id, gramCase.id, packageCase.id],
        benignMentionAlternative: true, sourceBackedServing: true,
        sourceBackedPackage: true, unsupportedAlternatives: alternativeAttackResults,
        unsupportedSecondaryFields: secondaryAttackResults,
        rejectedLabelledPackage: Object.keys(labelledPackageAttacks),
        borrowedServingFromSibling: "invalid-evidence",
        sameScopeBorrowedServing: { caseId: repeatedLiteral.id,
          ownServingComplete: true, borrowedGrade: borrowedServingReport.results[0].grade,
          borrowedComplete: borrowedServingReport.structurallyComplete,
          borrowedAdmitted: borrowedServingAdmission.admitted },
        supportedNegationAlternative: supportedNegationReport.results[1].grade,
        publicPersistence: "not-measured",
      },
    };

    const localNegationIndex = cases.findIndex(c => c.id === "sugar-local-negation");
    const localNegation = cases[localNegationIndex];
    const negationObservations = measured[localNegationIndex].observations;
    const wrongNegationOwner = negationObservations.map(obs =>
      obs.identityHints.qualifiers.some(q => q.role === "sweetening" && q.value === "sem açúcar")
        ? { ...obs, identityHints: { ...obs.identityHints, foodName: "pudim" } } : obs);
    const negationReport = evaluateC1b(localNegation, wrongNegationOwner);
    expect(measured[localNegationIndex].report.results[0].grade).toBe("structured");
    expect(negationReport.results[0].grade).toBe("misbound");
    const remediationControls = {
      provenance: { expected: "invalid-provenance", source: sourceReport.results.map(x => x.grade),
        evidence: evidenceReport.results.map(x => x.grade),
        normalization: normalizationReport.results.map(x => x.grade) },
      negationOwner: { caseId: localNegation.id, expected: "misbound",
        observed: negationReport.results[0].grade },
      diagnosticAdmission: { caseId: simpleCase.id,
        actualUnresolved: unresolvedAttempt.unresolvedObservations,
        realObservedAdmitted: unresolvedAttempt.admitted,
        syntheticResolvedAdmitted: resolvedAttempt.admitted,
        publicPersistence: "not-measured" },
      reverseCoverageAndEvidence: { caseId: simpleCase.id,
        positiveStructurallyComplete: evaluateC1b(simpleCase, syntheticResolved).structurallyComplete,
        positiveSyntheticAdmission: resolvedAttempt.admitted, attacks },
      quantityConservation: quantityRemediationControls,
      postAuditLiteralAndMention: newRemediationControls,
    };
    const aggregate = { schemaVersion:7, issue:1341, generatorVersion,
      sampleSha:process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
      corpusRevision:"c1b-annotated-v2", canonicalCorpus:GOLDEN_CORPUS_VERSION,
      canonicalCases:goldenFoodCorpusCases.length, canonicalExecuted:canonicalBaseline.length,
      lexiconRevision:"c1b-empty-s2",
      S3:"not-evaluated", providerCalls:0, ...summary,
      byClass, byModality,
      canonicalBaseline: { source:"Golden Food Corpus #1299",
        coverage:"all runnable text/audio transcript cases in canonical A2 fixture",
        referenceKind:"expected decisions; not S1/LCL ground truth",
        cases:canonicalBaseline },
      legacy:{scope:"full-input-V1-segmentation-and-coffee-normalizer",
        caseResults:legacy, ownerBinding:"not-measured", publicPersistence:"not-measured"},
      metamorphic, negativeControls, remediationControls, caseResults,
      clarification:{referenceRequired:cases.filter(x=>x.facts.some(f=>f.kind==="unbound")).length,
        unresolvedSignals:measured.filter(x=>x.observations.some(o=>o.unresolvedReason!==null)).length,
        potentiallyUnnecessaryUnresolvedSignals:measured.filter((x,i)=>
          !cases[i].facts.some(f=>f.kind==="unbound") &&
          x.observations.some(o=>o.unresolvedReason!==null)).length,
        actualClarifications:"not-measured"},
      decision:"adjust-ADR-contract-before-D1-semantic-cutover" };
    console.info("C1B_1341_AGGREGATE="+JSON.stringify(aggregate));
    // Existing C3 artifact uploader also preserves this separately named C1b JSON.
    if(process.env.C3_EVIDENCE_OUTPUT_DIR){
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR,{recursive:true});
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR,"c1b-1341-semantic-conservation.json"),
        JSON.stringify(aggregate,null,2),"utf8");
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
    const presentButUntyped = actualCompound.observations.map((obs, i) => ({ ...obs,
      quantityHints: { ...obs.quantityHints, value: i + 1, unit: "colher de chá" },
    }));
    expect(evaluateC1b(compound, presentButUntyped).results.filter(x =>
      x.kind === "ingredient-quantity").every(x => x.grade === "missing-component-binding"))
      .toBe(true);
    const droppedNumeral = presentButUntyped.map((obs, i) => i === 0 ? { ...obs,
      quantityHints: { ...obs.quantityHints, value: null, unit: null } } : obs);
    expect(evaluateC1b(compound, droppedNumeral).results[0].grade)
      .toBe("ingredient-quantity-unobserved");
    const incompatibleNumber = presentButUntyped.map((obs, i) => i === 0 ? { ...obs,
      quantityHints: { ...obs.quantityHints, value: 4 } } : obs);
    expect(evaluateC1b(compound, incompatibleNumber).results[0].grade)
      .toBe("ingredient-quantity-mismatch");
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
    const proposedPartial = actual.observations.slice(0, 2)
      .map(obs => obs.observationId);
    const partialAdmission = attemptDiagnosticBatchAdmission(ambiguous,
      actual.observations, proposedPartial);
    expect(partialAdmission.admitted).toBe(false);
    expect(partialAdmission.blocked.length).toBeGreaterThan(0);
    const fullAmbiguousAttempt = attemptDiagnosticBatchAdmission(ambiguous,
      actual.observations, actual.observations.map(obs => obs.observationId));
    expect(fullAmbiguousAttempt.admitted).toBe(false);
    const unresolvedBatch = attemptDiagnosticBatchAdmission(testCase, observations,
      observations.map(obs => obs.observationId));
    expect(unresolvedBatch.admitted).toBe(false);
    expect(unresolvedBatch.unresolvedObservations).toHaveLength(observations.length);
    // The safe positive is a synthetic *diagnostic-only* resolved state. S1's
    // unknown_surface cannot be treated as a public mutation authorization.
    const syntheticResolved = observations.map(obs => ({ ...obs, unresolvedReason: null }));
    const allValid = attemptDiagnosticBatchAdmission(testCase, syntheticResolved,
      syntheticResolved.map(obs => obs.observationId));
    expect(allValid.admitted).toBe(true);
    expect(allValid.unresolvedObservations).toHaveLength(0);
    const wrongSubset = attemptDiagnosticBatchAdmission(testCase, syntheticResolved,
      [syntheticResolved[0].observationId]);
    expect(wrongSubset.admitted).toBe(false);
    expect(wrongSubset.blocked.some(item => item.reason === "silent-omission")).toBe(true);
    const otherNegation = cases.find(c => c.id === "sugar-other-negation")!;
    const otherNegationObserved = await evaluateRealV2(otherNegation);
    expect(otherNegationObserved.report.results[1].grade).toBe("structured");
    const switchedNegationOwner = otherNegationObserved.observations.map(obs =>
      obs.identityHints.qualifiers.some(q => q.role === "sweetening" && q.value === "sem açúcar")
        ? { ...obs, identityHints: { ...obs.identityHints, foodName: "café" } } : obs);
    expect(evaluateC1b(otherNegation, switchedNegationOwner).results[1].grade).toBe("misbound");
    // Deliberately diagnostic-only. The public persistence gate remains #1308.
  });
});
