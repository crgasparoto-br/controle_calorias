import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFoodObservation, type FoodObservation } from "../schemas";
import type { C1bCase } from "./semanticConservation1341.test.fixture";
import { c1bCases } from "./semanticConservation1341.test.fixture";
import { attemptDiagnosticBatchAdmission, evaluateC1b, referenceSignature, validateC1bReference } from "./semanticConservation1341.test.support.fixture";

type Evidence = FoodObservation["evidence"][number];
const simple = c1bCases.find(item => item.id === "food-count-simple")!;
const source = (testCase: C1bCase, start: number, end: number) => ({
  sourceRef: `c1b:${testCase.id}`, region: null,
  span: { start, end },
});
function observation(testCase: C1bCase, name: string, amount: number | null,
  unit: string | null, start: number, end: number): FoodObservation {
  const anchor = source(testCase, start, end);
  const evidence = (field: string, value: Evidence["value"], evidenceUnit: string | null): Evidence => ({
    evidenceId: `${name}-${field}`, field, origin: "text", value,
    unit: evidenceUnit, confidence: null, verified: false, anchor, sourceId: null,
  });
  return {
    schemaVersion: 2, observationId: `test-${testCase.id}-${name}`, modality: "text",
    rawInput: testCase.text, normalizedInput: testCase.text,
    locale: { requested: null, effective: "pt-BR", status: "defaulted" },
    surfaceSpan: anchor,
    identityHints: { foodName: name, brand: null, variant: null,
      barcode: null, preparation: [], qualifiers: [] },
    quantityHints: { value: amount, unit, servingText: null,
      visiblePackageQuantity: null, visiblePackageUnit: null },
    evidence: [evidence("identity.foodName", name, null),
      ...(amount === null ? [] : [evidence("quantity.value", amount, unit)])],
    normalizationPath: [{ stage: "S1", origin: "deterministic", anchor,
      lexiconEntryId: null, confidence: null }],
    alternatives: [], unresolvedReason: null, lexiconRevision: "c1b-empty-s2",
    interpreterVersion: null,
  };
}
const good = [observation(simple, "ovos", 2, "un", 0, 6),
  observation(simple, "banana", 1, "un", 9, 17)];
function inspect(testCase: C1bCase, observations: FoodObservation[]) {
  const report = evaluateC1b(testCase, observations);
  const attempt = attemptDiagnosticBatchAdmission(testCase, observations,
    observations.map(obs => obs.observationId));
  return { grades: report.results.map(item => item.grade),
    issues: report.observationIssues.map(item => item.grade),
    complete: report.structurallyComplete, admitted: attempt.admitted };
}
function addEvidence(field: string, value: Evidence["value"], unit: string | null = null,
  anchor: Evidence["anchor"] = good[0].surfaceSpan): FoodObservation[] {
  const evidence: Evidence = { ...good[0].evidence[0], evidenceId: `adversarial-${field}`,
    field, value, unit, anchor };
  return [{ ...good[0], evidence: [...good[0].evidence, evidence] }, good[1]];
}

/** Test the *real* C1b evaluator against forged claims, not another parser. */
describe("#1341 A-1342-27 — reversible material evidence and source authority", () => {
  it("accepts independently labelled direct source facts and rejects field-shaped fabrications", async () => {
    const benign = inspect(simple, good);
    expect(good.every(item => parseFoodObservation(item).ok)).toBe(true);
    expect(benign).toEqual({ grades: ["structured", "structured"], issues: [],
      complete: true, admitted: true });
    const attacks: Array<[string, Evidence["value"], string | null]> = [
      ["identity.brand", "Marca Imaginaria", null],
      ["identity.variant", "zero lactose", null],
      ["identity.preparation", "assado", null],
      ["identity.qualifiers", "sem acucar", null],
      ["identity.barcode", "7891234567890", null],
      ["quantity.unit", "kg", null],
      ["quantity.grams", 999, "g"],
      ["quantity.milliliters", 999, "ml"],
      ["quantity.density", 1, "g/ml"],
      ["quantity.measureKind", "portion", null],
      ["variant.variantId", 99, null],
      ["nutrition.calories", 999, "kcal"],
      ["classification.isFood", false, null],
    ];
    const negativeControls: Record<string, ReturnType<typeof inspect>> = {};
    for (const [field, value, unit] of attacks) {
      const mutated = addEvidence(field, value, unit);
      expect(mutated.every(obs => parseFoodObservation(obs).ok), field).toBe(true);
      const result = inspect(simple, mutated);
      expect(result.grades[0], field).toBe("invalid-evidence");
      expect(result.issues, field).toContain("invalid-evidence");
      expect(result.complete, field).toBe(false);
      expect(result.admitted, field).toBe(false);
      negativeControls[field] = result;
    }
    // Material claims from an untrusted S3 estimate are not an S1 source proof;
    // ordinary raw-text evidence has verified=false and remains valid.
    const estimated = [{ ...good[0], evidence: good[0].evidence.map(item => ({
      ...item, origin: "ai_estimate" as const, verified: false, confidence: 0.4 })) }, good[1]];
    expect(estimated.every(obs => parseFoodObservation(obs).ok)).toBe(true);
    const estimatedResult = inspect(simple, estimated);
    expect(estimatedResult.grades[0]).toBe("invalid-evidence");
    expect(estimatedResult.admitted).toBe(false);
    const sibling = addEvidence("identity.brand", "Marca Imaginaria", null,
      source(simple, 9, 17));
    const siblingResult = inspect(simple, sibling);
    expect(siblingResult.complete).toBe(false);
    expect(siblingResult.admitted).toBe(false);
    // Existing valid quantity value cannot be discarded by the inverse gate.
    const wrongValue = addEvidence("quantity.value", 99, "un");
    expect(inspect(simple, wrongValue).grades[0]).toBe("invalid-evidence");

    const matrix = { schemaVersion: 1, issue: 1341, finding: "A-1342-27",
      sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
      subject: "diagnostic-oracle-not-public-persistence",
      positive: benign, negatives: negativeControls, sibling: siblingResult,
      estimatedOrigin: estimatedResult, publicPersistence: "not-measured",
      productionS3: "not-evaluated" };
    if (process.env.C3_EVIDENCE_OUTPUT_DIR) {
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR, { recursive: true });
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR,
        "c1b-1341-evidence-reversal.json"), JSON.stringify(matrix, null, 2));
    }
  });


  it("keeps two labelled quantities distinct and preserves a local negation with its food count", async () => {
    // A broad evidence envelope may cite two real source claims, but the
    // diagnostic must still require two independent quantity observations.
    const repeated = c1bCases.find(item => item.id === "food-repeated-literal")!;
    const one = observation(repeated, "ovos", 2, "un", 0, repeated.text.length);
    const secondQuantity = { ...one.evidence[1], evidenceId: "second-labelled-2-ovos",
      anchor: source(repeated, 14, 20) };
    const broad = { ...one, evidence: [...one.evidence, secondQuantity] };
    expect(parseFoodObservation(broad).ok).toBe(true);
    const shared = inspect(repeated, [broad]);
    expect(shared.grades).toContain("shared-quantity-observation");
    expect(shared.complete).toBe(false);
    expect(shared.admitted).toBe(false);

    // The original phrase says one pudding *and* says it has no sugar. Both
    // are independently authored facts; the same observation may prove both.
    const mixed = c1bCases.find(item => item.id === "sugar-other-negation")!;
    const start = mixed.text.indexOf("um pudim sem açúcar");
    const pudding = observation(mixed, "pudim sem açúcar", 1, "un", start, mixed.text.length);
    const withNegation: FoodObservation = { ...pudding,
      quantityHints: { ...pudding.quantityHints, servingText: "um" },
      identityHints: { ...pudding.identityHints, qualifiers: [{ value: "sem açúcar",
        role: "sweetening", attributeCode: null, confidence: null }] },
    };
    expect(parseFoodObservation(withNegation).ok).toBe(true);
    const local = inspect(mixed, [withNegation]);
    expect(local.grades[1]).toBe("structured");
    expect(local.grades[2]).toBe("structured");
    expect(local.admitted).toBe(false); // independent coffee fact is missing
    // An alternative which does not claim a food count may cite the food
    // identity proof but must not borrow the primary count's evidence ID.
    const negationAlternative = { hypothesisId: "c1b-negative-owner-count-claim",
      identityHints: { ...withNegation.identityHints, foodName: "pudim" },
      quantityHints: { ...withNegation.quantityHints,
        value: null, unit: null, servingText: null },
      evidenceIds: [withNegation.evidence[0].evidenceId], confidence: 0.5 };
    const validAlternative = { ...withNegation, alternatives: [negationAlternative] };
    const retainedCount = inspect(mixed, [validAlternative]);
    expect(retainedCount.grades[1]).toBe("structured");
    expect(retainedCount.grades[2]).toBe("structured");
    expect(retainedCount.issues).toEqual([]);
    const borrowedCount = { ...withNegation, alternatives: [{ ...negationAlternative,
      evidenceIds: withNegation.evidence.map(evidence => evidence.evidenceId) }] };
    expect(parseFoodObservation(borrowedCount).ok).toBe(true);
    const borrowedReport = inspect(mixed, [borrowedCount]);
    expect(borrowedReport.grades[1]).toBe("invalid-evidence");
    expect(borrowedReport.issues).toContain("invalid-evidence");
    expect(borrowedReport.admitted).toBe(false);
    if (process.env.C3_EVIDENCE_OUTPUT_DIR) {
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR, { recursive: true });
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR,
        "c1b-1341-hypothesis-evidence.json"), JSON.stringify({
          schemaVersion: 1, issue: 1341, finding: "A-1342-27", control: "alternative-evidence-owner",
          sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
          sameOwnerTwoQuantities: shared,
          supportedNegationWithQuantity: inspect(mixed, [validAlternative]),
          rejectedBorrowedQuantityByAlternative: borrowedReport,
          publicPersistence: "not-measured",
        }, null, 2));
    }
  });

  it("rejects a connector as a serving claim and a fabricated normalized qualifier", async () => {
    const repeated = c1bCases.find(item => item.id === "food-repeated-literal")!;
    const left = observation(repeated, "ovos", 2, "un", 0, 13);
    const right = observation(repeated, "ovos", 2, "un", 14, 20);
    const first: FoodObservation = { ...left, observationId: "labelled-first-2-ovos",
      quantityHints: { ...left.quantityHints, servingText: "2 ovos" } };
    const second: FoodObservation = { ...right, observationId: "labelled-second-2-ovos",
      quantityHints: { ...right.quantityHints, servingText: "2" } };
    expect([first, second].every(item => parseFoodObservation(item).ok)).toBe(true);
    const validPortions = inspect(repeated, [first, second]);
    expect(validPortions).toEqual({ grades: ["structured", "structured", "misbound"],
      issues: [], complete: false, admitted: false });
    const connector = { ...first, quantityHints: { ...first.quantityHints,
      servingText: "e mais" } };
    const connectorResult = inspect(repeated, [connector, second]);
    expect(connectorResult.grades[0]).toBe("invalid-evidence");
    expect(connectorResult.issues).toContain("invalid-evidence");
    expect(connectorResult.admitted).toBe(false);
    const nameNotServing = { ...first, quantityHints: { ...first.quantityHints,
      servingText: "ovos" } };
    const nameResult = inspect(repeated, [nameNotServing, second]);
    expect(nameResult.grades[0]).toBe("invalid-evidence");
    expect(nameResult.admitted).toBe(false);

    const original = inspect(simple, good);
    expect(original.complete).toBe(true);
    const normalizedName = [{ ...good[0], normalizedInput: "ovos" }, good[1]];
    expect(inspect(simple, normalizedName).complete).toBe(true);
    const inventedQualifier = [{ ...good[0], normalizedInput: "ovos sem açúcar" }, good[1]];
    expect(inventedQualifier.every(item => parseFoodObservation(item).ok)).toBe(true);
    const normalizedResult = inspect(simple, inventedQualifier);
    expect(normalizedResult.grades[0]).toBe("invalid-evidence");
    expect(normalizedResult.issues).toContain("invalid-evidence");
    expect(normalizedResult.admitted).toBe(false);
    const borrowedIdentity = [{ ...good[0], normalizedInput: "banana" }, good[1]];
    const borrowedResult = inspect(simple, borrowedIdentity);
    expect(borrowedResult.grades[0]).toBe("invalid-evidence");
    expect(borrowedResult.admitted).toBe(false);

    if (process.env.C3_EVIDENCE_OUTPUT_DIR) {
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR, { recursive: true });
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR,
        "c1b-1341-material-source-claims.json"), JSON.stringify({
          schemaVersion: 1, issue: 1341, findings: ["A-1342-29", "A-1342-31"],
          sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
          positive: { validPortions, original, normalizedName: inspect(simple, normalizedName) },
          negatives: { connectorResult, nameResult, normalizedResult, borrowedResult },
          publicPersistence: "not-measured", productionS3: "not-evaluated",
        }, null, 2));
    }
  });

  it("accepts labelled identity, qualifier, and directly measured physical units", () => {
    const identityCase: C1bCase = { id: "evidence-labelled-identity",
      text: "iogurte Marca Azul sem açúcar", modality: "text", split: "calibration",
      semanticGroup: "labelled-identity", facts: [{ kind: "food-mention", owner: "iogurte",
        surface: "iogurte", scope: "iogurte Marca Azul sem açúcar",
        ingredient: null, quantity: null, unit: null, identityClaims: {
          brand: { value: "Marca Azul", surface: "Marca Azul" },
          qualifiers: [{ value: "sem açúcar", surface: "sem açúcar",
            role: "sweetening", attributeCode: null }],
        } }] };
    const original = observation(identityCase, "iogurte", null, null, 0, identityCase.text.length);
    const brand = { ...original.evidence[0], evidenceId: "label-brand",
      field: "identity.brand", value: "Marca Azul",
      anchor: source(identityCase, 8, 18) };
    const qualifier = { ...original.evidence[0], evidenceId: "label-qualifier",
      field: "identity.qualifiers", value: "sem açúcar",
      anchor: source(identityCase, 19, 29) };
    const labelled: FoodObservation = { ...original,
      identityHints: { ...original.identityHints, brand: "Marca Azul", qualifiers: [{
        value: "sem açúcar", role: "sweetening", attributeCode: null, confidence: null }] },
      evidence: [...original.evidence, brand, qualifier] };
    const hypothesis = { hypothesisId: "same-labelled-food", identityHints: labelled.identityHints,
      quantityHints: labelled.quantityHints, evidenceIds: labelled.evidence.map(item => item.evidenceId),
      confidence: 0.6 };
    const withAlternative = { ...labelled, alternatives: [hypothesis] };
    expect(parseFoodObservation(withAlternative).ok).toBe(true);
    expect(inspect(identityCase, [labelled]).complete).toBe(true);
    expect(inspect(identityCase, [withAlternative]).admitted).toBe(true);
    const invented = { ...withAlternative, evidence: [...withAlternative.evidence,
      { ...brand, evidenceId: "ghost-in-alternative", value: "Marca Falsa" }],
      alternatives: [{ ...hypothesis,
        evidenceIds: [...hypothesis.evidenceIds, "ghost-in-alternative"] }] };
    expect(parseFoodObservation(invented).ok).toBe(true);
    expect(inspect(identityCase, [invented]).grades[0]).toBe("invalid-evidence");
    expect(inspect(identityCase, [invented]).admitted).toBe(false);

    const gramsCase: C1bCase = { id: "evidence-labelled-grams", text: "2 g de arroz",
      semanticGroup: "labelled-grams", split: "calibration", modality: "text",
      facts: [{ kind: "food-quantity", owner: "arroz", surface: "2 g de arroz",
        scope: "2 g de arroz", ingredient: null, quantity: 2, unit: "g" }] };
    const portion = observation(gramsCase, "arroz", 2, "g", 0, gramsCase.text.length);
    const withUnits = { ...portion, evidence: [...portion.evidence,
      { ...portion.evidence[1], evidenceId: "unit-g", field: "quantity.unit",
        value: "g", unit: "g" },
      { ...portion.evidence[1], evidenceId: "grams-g", field: "quantity.grams",
        value: 2, unit: "g" }] };
    expect(parseFoodObservation(withUnits).ok).toBe(true);
    expect(inspect(gramsCase, [withUnits]).complete).toBe(true);
    expect(inspect(gramsCase, [withUnits]).admitted).toBe(true);
  });
});

/** A-1342-34: a food name must have exact independent material backing,
 * not merely start with an owner token and borrow the rest of a broad span. */
describe("#1341 A-1342-34 — exact owner-local food identity", () => {
  it("refutes concatenated connectors and sibling foods without rejecting labelled names", async () => {
    const repeated = c1bCases.find(item => item.id === "food-repeated-literal")!;
    const first = { ...observation(repeated, "ovos", 2, "un", 0, 14),
      observationId: "c1b-34-first-occurrence" };
    const second = { ...observation(repeated, "ovos", 2, "un", 14, 20),
      observationId: "c1b-34-second-occurrence" };
    const positiveRepeated = inspect(repeated, [first, second]);
    expect(positiveRepeated).toEqual({ grades: ["structured", "structured", "misbound"],
      issues: [], complete: false, admitted: false });

    const forgedConnector: FoodObservation = { ...first,
      identityHints: { ...first.identityHints, foodName: "ovos e mais" },
      evidence: first.evidence.map(item => item.field === "identity.foodName"
        ? { ...item, value: "ovos e mais", anchor: source(repeated, 2, 13) } : item) };
    const forgedConnectorObservations = [forgedConnector, second];
    expect(forgedConnectorObservations.every(item => parseFoodObservation(item).ok)).toBe(true);
    const connectorResult = inspect(repeated, forgedConnectorObservations);
    expect(connectorResult.grades[0]).toBe("invalid-evidence");
    expect(connectorResult.issues).toContain("invalid-evidence");
    expect(connectorResult.complete).toBe(false);
    expect(connectorResult.admitted).toBe(false);

    const forgedSibling: FoodObservation = { ...good[0],
      surfaceSpan: source(simple, 0, simple.text.length),
      identityHints: { ...good[0].identityHints, foodName: "ovos e 1 banana" },
      evidence: good[0].evidence.map(item => item.field === "identity.foodName"
        ? { ...item, value: "ovos e 1 banana", anchor: source(simple, 2, 17) } : item) };
    const forgedSiblingObservations = [forgedSibling, good[1]];
    expect(forgedSiblingObservations.every(item => parseFoodObservation(item).ok)).toBe(true);
    const siblingResult = inspect(simple, forgedSiblingObservations);
    expect(siblingResult.grades[0]).toBe("invalid-evidence");
    expect(siblingResult.issues).toContain("invalid-evidence");
    expect(siblingResult.complete).toBe(false);
    expect(siblingResult.admitted).toBe(false);
    expect(inspect(simple, good).admitted).toBe(true);

    const compound = c1bCases.find(item => item.id === "measure-word-food-name")!;
    const compoundName = "brigadeiro de colher";
    const compoundObs = observation(compound, compoundName, null, null, 0,
      compoundName.length);
    expect(parseFoodObservation(compoundObs).ok).toBe(true);
    const compoundResult = inspect(compound, [compoundObs]);
    expect(compoundResult.grades[0]).toBe("structured");
    expect(compoundResult.admitted).toBe(false); // the coffee ingredient is still unobserved

    const preparedCase: C1bCase = { id: "c1b-34-label-preparation",
      text: "2 ovos cozidos", modality: "text", split: "calibration",
      semanticGroup: "c1b-34-preparation", facts: [{
        kind: "food-quantity", owner: "ovos", scope: "2 ovos cozidos",
        surface: "2 ovos", ingredient: null, quantity: 2, unit: "un",
        identityClaims: { preparation: [{ value: "cozidos", surface: "cozidos" }] },
      }] };
    const preparedBase = observation(preparedCase, "ovos cozidos", 2, "un", 0,
      preparedCase.text.length);
    const prepared: FoodObservation = { ...preparedBase,
      identityHints: { ...preparedBase.identityHints, preparation: ["cozidos"] },
      evidence: [...preparedBase.evidence, { ...preparedBase.evidence[0],
        evidenceId: "c1b-34-preparation-proof", field: "identity.preparation",
        value: "cozidos", anchor: source(preparedCase, 7, 14) }] };
    expect(parseFoodObservation(prepared).ok).toBe(true);
    const labelledResult = inspect(preparedCase, [prepared]);
    expect(labelledResult).toEqual({ grades: ["structured"], issues: [],
      complete: true, admitted: true });
    const unlabelledCase: C1bCase = { ...preparedCase, facts: [
      { ...preparedCase.facts[0], identityClaims: undefined }] };
    const unlabelledObs: FoodObservation = { ...preparedBase };
    expect(parseFoodObservation(unlabelledObs).ok).toBe(true);
    const unlabelledResult = inspect(unlabelledCase, [unlabelledObs]);
    expect(unlabelledResult.grades[0]).toBe("invalid-evidence");
    expect(unlabelledResult.complete).toBe(false);
    expect(unlabelledResult.admitted).toBe(false);

    if (process.env.C3_EVIDENCE_OUTPUT_DIR) {
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR, { recursive: true });
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR, "c1b-1341-audit-escape-34.json"),
        JSON.stringify({ schemaVersion: 1, issue: 1341, finding: "A-1342-34",
          sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
          subject: "diagnostic-oracle-not-public-persistence",
          positives: { repeated: positiveRepeated, sourceLabelledPreparation: labelledResult,
            materialFoodName: compoundResult },
          negatives: { connector: connectorResult, sibling: siblingResult,
            unlabelledPreparation: unlabelledResult },
          publicPersistence: "not-measured", productionS3: "not-evaluated" }, null, 2));
    }
  });
});

/** A-1342-35: independently labelled preparation must survive harmless
 * punctuation, without treating connectors or sibling foods as preparation. */
describe("#1341 A-1342-35 — punctuation equivalence for labelled food names", () => {
  it("accepts commas and parentheses, but refutes unlabelled material", async () => {
    const build = (id: string, text: string, foodName = "ovos cozidos") => {
      const testCase: C1bCase = { id, text, modality: "text", split: "calibration",
        semanticGroup: "c1b-35-punctuation", facts: [{
          kind: "food-quantity", owner: "ovos", scope: text,
          surface: "2 ovos", ingredient: null, quantity: 2, unit: "un",
          identityClaims: { preparation: [{ value: "cozidos", surface: "cozidos" }] },
        }] };
      const base = observation(testCase, foodName, 2, "un", 0, text.length);
      const prepared: FoodObservation = { ...base,
        identityHints: { ...base.identityHints, preparation: ["cozidos"] },
        evidence: [...base.evidence, { ...base.evidence[0],
          evidenceId: `${id}-preparation`, field: "identity.preparation",
          value: "cozidos", anchor: source(testCase, text.indexOf("cozidos"),
            text.indexOf("cozidos") + "cozidos".length) }],
      };
      return { testCase, prepared };
    };
    const equivalents = [
      ["plain", "2 ovos cozidos"],
      ["parentheses", "2 ovos (cozidos)"],
      ["comma", "2 ovos, cozidos"],
      ["comma-parentheses", "2 ovos, (cozidos)"],
    ] as const;
    const positives: Record<string, ReturnType<typeof inspect>> = {};
    for (const [id, text] of equivalents) {
      const { testCase, prepared } = build(`c1b-35-${id}`, text);
      expect(parseFoodObservation(prepared).ok, id).toBe(true);
      const result = inspect(testCase, [prepared]);
      expect(result, id).toEqual({ grades: ["structured"], issues: [],
        complete: true, admitted: true });
      positives[id] = result;
    }
    const { testCase: punctuated, prepared } = build("c1b-35-neg-label", "2 ovos, cozidos");
    const noLabel: C1bCase = { ...punctuated, facts: [
      { ...punctuated.facts[0], identityClaims: undefined }] };
    const noPreparationProof = { ...prepared, evidence: prepared.evidence.filter(item =>
      item.field !== "identity.preparation") };
    const connector = build("c1b-35-neg-connector", "2 ovos, e cozidos", "ovos e cozidos");
    const sibling = build("c1b-35-neg-sibling", "2 ovos, 1 banana, cozidos",
      "ovos 1 banana cozidos");
    const negatives = {
      unlabelledPreparation: inspect(noLabel, [prepared]),
      missingPreparationProof: inspect(punctuated, [noPreparationProof]),
      unlabelledConnector: inspect(connector.testCase, [connector.prepared]),
      siblingFood: inspect(sibling.testCase, [sibling.prepared]),
    };
    for (const [id, result] of Object.entries(negatives)) {
      expect(result.grades, id).toContain("invalid-evidence");
      expect(result.issues, id).toContain("invalid-evidence");
      expect(result.complete, id).toBe(false);
      expect(result.admitted, id).toBe(false);
    }
    for (const observation of [prepared, noPreparationProof, connector.prepared,
      sibling.prepared]) expect(parseFoodObservation(observation).ok).toBe(true);
    if (process.env.C3_EVIDENCE_OUTPUT_DIR) {
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR, { recursive: true });
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR, "c1b-1341-audit-escape-35.json"),
        JSON.stringify({ schemaVersion: 1, issue: 1341, finding: "A-1342-35",
          sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
          subject: "diagnostic-oracle-not-public-persistence",
          punctuation: "comma-and-parentheses-only", positives, negatives,
          publicPersistence: "not-measured", productionS3: "not-evaluated" }, null, 2));
    }
  });
});

/** A-1342-32/33: real oracle escape regressions from an independent audit.
 * These controls are contract-shaped, not product persistence assertions. */
describe("#1341 A-1342-32/33 — empty-S2 provenance and per-hypothesis quantities", () => {
  it("rejects catalog evidence and invented S2 paths in the empty-lexicon experiment", async () => {
    const benign = inspect(simple, good);
    expect(benign.complete).toBe(true);
    const fakeS2 = { ...good[0].normalizationPath[0], stage: "S2" as const,
      origin: "lexicon" as const, lexiconEntryId: 987654 };
    const catalog = { ...good[0], evidence: good[0].evidence.map(item => ({
      ...item, origin: "catalog" as const })) };
    const attacks: Record<string, FoodObservation> = {
      catalogWithFakeS2: { ...catalog, normalizationPath: [...catalog.normalizationPath, fakeS2] },
      catalogWithoutS2: catalog,
      fakeS2WithTextEvidence: { ...good[0], normalizationPath: [...good[0].normalizationPath, fakeS2] },
      revisionWithoutLoadedLexicon: { ...good[0], lexiconRevision: "fabricated-s2-revision" },
      catalogWithFakeRevision: { ...catalog, lexiconRevision: "fabricated-s2-revision",
        normalizationPath: [...catalog.normalizationPath, fakeS2] },
    };
    const results: Record<string, ReturnType<typeof inspect>> = {};
    for (const [id, attack] of Object.entries(attacks)) {
      expect(parseFoodObservation(attack).ok, id).toBe(true);
      const result = inspect(simple, [attack, good[1]]);
      expect(result.grades[0], id).toBe("invalid-evidence");
      expect(result.issues, id).toContain("invalid-evidence");
      expect(result.complete, id).toBe(false);
      expect(result.admitted, id).toBe(false);
      results[id] = result;
    }
    if (process.env.C3_EVIDENCE_OUTPUT_DIR) {
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR, { recursive: true });
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR, "c1b-1341-audit-escape-32.json"),
        JSON.stringify({ schemaVersion: 1, issue: 1341, finding: "A-1342-32",
          sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
          lexiconRevision: "c1b-empty-s2", loadedEntries: 0,
          positiveTextSource: benign, forgedCatalogAndS2Controls: results,
          subject: "test-only-oracle", publicPersistence: "not-measured",
          productionS3: "not-evaluated" }, null, 2));
    }
  });

  it("requires the quantity proof ID for each alternative asserting a count", async () => {
    const identityId = good[0].evidence.find(item => item.field === "identity.foodName")!.evidenceId;
    const quantityId = good[0].evidence.find(item => item.field === "quantity.value")!.evidenceId;
    const alternative = { hypothesisId: "c1b-quantity-supported-alternative",
      identityHints: { ...good[0].identityHints },
      quantityHints: { ...good[0].quantityHints },
      evidenceIds: [identityId, quantityId], confidence: 0.5 };
    const withAlternative = (option: typeof alternative): FoodObservation[] => [
      { ...good[0], alternatives: [option] }, good[1],
    ];
    const positive = inspect(simple, withAlternative(alternative));
    expect(withAlternative(alternative).every(obs => parseFoodObservation(obs).ok)).toBe(true);
    expect(positive).toEqual({ grades: ["structured", "structured"], issues: [],
      complete: true, admitted: true });
    const abstaining = { ...alternative, quantityHints: { ...alternative.quantityHints,
      value: null, unit: null, servingText: null }, evidenceIds: [identityId] };
    const abstention = inspect(simple, withAlternative(abstaining));
    expect(withAlternative(abstaining).every(obs => parseFoodObservation(obs).ok)).toBe(true);
    expect(abstention.complete).toBe(true);
    expect(abstention.admitted).toBe(true);
    const attacks = {
      emptyEvidenceIds: { ...alternative, evidenceIds: [] as string[] },
      identityOnlyEvidenceIds: { ...alternative, evidenceIds: [identityId] },
      wrongQuantityValue: { ...alternative, quantityHints: {
        ...alternative.quantityHints, value: 999 } },
      abstainsButBorrowsQuantityId: { ...abstaining, evidenceIds: [identityId, quantityId] },
    };
    const results: Record<string, ReturnType<typeof inspect>> = {};
    for (const [id, attack] of Object.entries(attacks)) {
      const observations = withAlternative(attack);
      expect(observations.every(obs => parseFoodObservation(obs).ok), id).toBe(true);
      const result = inspect(simple, observations);
      expect(result.grades[0], id).toBe("invalid-evidence");
      expect(result.issues, id).toContain("invalid-evidence");
      expect(result.complete, id).toBe(false);
      expect(result.admitted, id).toBe(false);
      results[id] = result;
    }
    if (process.env.C3_EVIDENCE_OUTPUT_DIR) {
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR, { recursive: true });
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR, "c1b-1341-audit-escape-33.json"),
        JSON.stringify({ schemaVersion: 1, issue: 1341, finding: "A-1342-33",
          sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
          positiveLinkedQuantity: positive, positiveExplicitAbstention: abstention,
          negativeHypothesisClaims: results, subject: "test-only-oracle",
          publicPersistence: "not-measured", productionS3: "not-evaluated" }, null, 2));
    }
  });
});

/** A-1342-36/37: equivalent punctuation must work for the actual asserted
 * foodName and every hypothesis, without weakening labelled-source checks. */
describe("#1341 A-1342-36/37 — owner-bound punctuation and alternatives", () => {
  it("preserves labelled prepared names in primary observations and alternatives", async () => {
    const build = (id: string, text: string, foodName: string) => {
      const testCase: C1bCase = { id, text, modality: "text", split: "calibration",
        semanticGroup: "c1b-36-37-punctuation", facts: [{
          kind: "food-quantity", owner: "ovos", scope: text,
          surface: "2 ovos", ingredient: null, quantity: 2, unit: "un",
          identityClaims: { preparation: [{ value: "cozidos", surface: "cozidos" }] },
        }] };
      const base = observation(testCase, foodName, 2, "un", 0, text.length);
      const proofId = id + "-preparation-evidence";
      const prepared: FoodObservation = { ...base,
        identityHints: { ...base.identityHints, preparation: ["cozidos"] },
        evidence: [...base.evidence, { ...base.evidence[0],
          evidenceId: proofId, field: "identity.preparation", value: "cozidos",
          anchor: source(testCase, text.indexOf("cozidos"),
            text.indexOf("cozidos") + "cozidos".length) }],
      };
      const alternative = {
        hypothesisId: id + "-alternative", identityHints: { ...prepared.identityHints },
        quantityHints: { ...prepared.quantityHints },
        evidenceIds: prepared.evidence.map(item => item.evidenceId),
        confidence: 0.5,
      };
      return { testCase, prepared, alternative, proofId };
    };
    const variants = [
      ["plain", "2 ovos cozidos", "ovos cozidos"],
      ["parentheses", "2 ovos (cozidos)", "ovos (cozidos)"],
      ["comma", "2 ovos, cozidos", "ovos, cozidos"],
      ["comma-parentheses", "2 ovos, (cozidos)", "ovos, (cozidos)"],
    ] as const;
    const positives: Record<string, { primary: ReturnType<typeof inspect>;
      alternative: ReturnType<typeof inspect> }> = {};
    for (const [id, text, foodName] of variants) {
      const { testCase, prepared, alternative } = build("c1b-36-37-" + id, text, foodName);
      const withAlternative: FoodObservation = { ...prepared, alternatives: [alternative] };
      expect(parseFoodObservation(prepared).ok, id).toBe(true);
      expect(parseFoodObservation(withAlternative).ok, id).toBe(true);
      const primary = inspect(testCase, [prepared]);
      const hypothesis = inspect(testCase, [withAlternative]);
      for (const result of [primary, hypothesis]) {
        expect(result, id).toEqual({ grades: ["structured"], issues: [],
          complete: true, admitted: true });
      }
      positives[id] = { primary, alternative: hypothesis };
    }

    const { testCase, prepared, alternative, proofId } = build(
      "c1b-36-37-negative", "2 ovos, cozidos", "ovos, cozidos");
    const missingProof: FoodObservation = { ...prepared, alternatives: [{
      ...alternative, evidenceIds: alternative.evidenceIds.filter(id => id !== proofId),
    }] };
    const duplicatedOwner: FoodObservation = { ...prepared, alternatives: [
      alternative, { ...alternative, hypothesisId: "same-owner-rewritten",
        identityHints: { ...alternative.identityHints, foodName: "ovos (cozidos)" } },
    ] };
    // The original text mentions the preparation, but the fact has no
    // independent preparation label. Primary "ovos" remains a valid count.
    const withoutLabel: C1bCase = { ...testCase, facts: [
      { ...testCase.facts[0], identityClaims: undefined }] };
    const ownerOnly = observation(withoutLabel, "ovos", 2, "un", 0, withoutLabel.text.length);
    const inventedPreparation: FoodObservation = { ...ownerOnly, alternatives: [{
      ...alternative, identityHints: { ...ownerOnly.identityHints,
        foodName: "ovos, cozidos", preparation: ["cozidos"] },
      evidenceIds: ownerOnly.evidence.map(item => item.evidenceId),
    }] };
    const connector: FoodObservation = { ...good[0], alternatives: [{
      ...alternative, hypothesisId: "forged-connector",
      identityHints: { ...good[0].identityHints, foodName: "ovos e 1 banana",
        preparation: [] },
      quantityHints: { ...good[0].quantityHints },
      evidenceIds: good[0].evidence.map(item => item.evidenceId),
    }] };
    const negatives = {
      alternativeWithoutPreparationEvidence: inspect(testCase, [missingProof]),
      duplicateOwnerWithDifferentPunctuation: inspect(testCase, [duplicatedOwner]),
      unlabelledPreparationInAlternative: inspect(withoutLabel, [inventedPreparation]),
      connectorAndSiblingAsAlternative: inspect(simple, [connector, good[1]]),
    };
    expect(inspect(withoutLabel, [ownerOnly]).complete).toBe(true);
    for (const [id, result] of Object.entries(negatives)) {
      expect(result.grades, id).toContain("invalid-evidence");
      expect(result.issues, id).toContain("invalid-evidence");
      expect(result.complete, id).toBe(false);
      expect(result.admitted, id).toBe(false);
    }
    for (const sample of [missingProof, duplicatedOwner, inventedPreparation, connector]) {
      expect(parseFoodObservation(sample).ok).toBe(true);
    }
    if (process.env.C3_EVIDENCE_OUTPUT_DIR) {
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR, { recursive: true });
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR,
        "c1b-1341-audit-escape-36-37.json"), JSON.stringify({
          schemaVersion: 1, issue: 1341, findings: ["A-1342-36", "A-1342-37"],
          sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
          subject: "diagnostic-oracle-not-public-persistence",
          positives, negatives, publicPersistence: "not-measured",
          productionS3: "not-evaluated",
        }, null, 2));
    }
  });
});


/** A-1342-38: the identity evidence value, not just identityHints.foodName,
 * must be independently labelled within the precise source occurrence. */
describe("#1341 A-1342-38 — source-labelled identity evidence", () => {
  it("rejects evidence-only connector claims and preserves labelled preparation", async () => {
    const repeated = c1bCases.find(item => item.id === "food-repeated-literal")!;
    const first: FoodObservation = { ...observation(repeated, "ovos", 2, "un", 0, 14),
      observationId: "c1b-38-first-occurrence" };
    const second: FoodObservation = { ...observation(repeated, "ovos", 2, "un", 14, 20),
      observationId: "c1b-38-second-occurrence" };
    const positiveRepeated = inspect(repeated, [first, second]);
    expect(positiveRepeated).toEqual({ grades: ["structured", "structured", "misbound"],
      issues: [], complete: false, admitted: false });
    // The actual foodName and count remain valid; only the evidence.value
    // claims new, non-labelled words within the original source span.
    const forged = [
      { id: "connector", value: "ovos e", start: 2, end: 8 },
      { id: "connector-and-increment", value: "ovos e mais", start: 2, end: 13 },
    ];
    const negatives: Record<string, ReturnType<typeof inspect>> = {};
    for (const attack of forged) {
      const altered: FoodObservation = { ...first,
        evidence: first.evidence.map(item => item.field === "identity.foodName"
          ? { ...item, value: attack.value, anchor: source(repeated, attack.start, attack.end) }
          : item),
      };
      const observations = [altered, second];
      expect(observations.every(item => parseFoodObservation(item).ok), attack.id).toBe(true);
      const result = inspect(repeated, observations);
      expect(result.grades[0], attack.id).toBe("invalid-evidence");
      expect(result.issues, attack.id).toContain("invalid-evidence");
      expect(result.complete, attack.id).toBe(false);
      expect(result.admitted, attack.id).toBe(false);
      negatives[attack.id] = result;
    }

    // Harmless commas and parentheses do not erase explicitly labelled
    // preparation; both primary and alternative retain field-specific proofs.
    const text = "2 ovos, (cozidos)";
    const labelledCase: C1bCase = { id: "c1b-38-preparation", text, modality: "text",
      split: "calibration", semanticGroup: "c1b-38-preparation", facts: [{
        kind: "food-quantity", owner: "ovos", scope: text, surface: "2 ovos",
        ingredient: null, quantity: 2, unit: "un",
        identityClaims: { preparation: [{ value: "cozidos", surface: "cozidos" }] },
      }] };
    const preparedBase = observation(labelledCase, "ovos, (cozidos)", 2, "un", 0, text.length);
    const prepared: FoodObservation = { ...preparedBase,
      identityHints: { ...preparedBase.identityHints, preparation: ["cozidos"] },
      evidence: [...preparedBase.evidence, { ...preparedBase.evidence[0],
        evidenceId: "c1b-38-preparation-proof", field: "identity.preparation",
        value: "cozidos", anchor: source(labelledCase, 9, 16) }],
    };
    const alternative: FoodObservation = { ...prepared, alternatives: [{
      hypothesisId: "c1b-38-source-labelled-alternative",
      identityHints: prepared.identityHints, quantityHints: prepared.quantityHints,
      evidenceIds: prepared.evidence.map(item => item.evidenceId), confidence: 0.5,
    }] };
    expect(parseFoodObservation(prepared).ok).toBe(true);
    expect(parseFoodObservation(alternative).ok).toBe(true);
    const positivePrepared = inspect(labelledCase, [prepared]);
    const positiveAlternative = inspect(labelledCase, [alternative]);
    for (const result of [positivePrepared, positiveAlternative]) {
      expect(result).toEqual({ grades: ["structured"], issues: [],
        complete: true, admitted: true });
    }
    if (process.env.C3_EVIDENCE_OUTPUT_DIR) {
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR, { recursive: true });
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR,
        "c1b-1341-audit-escape-38.json"), JSON.stringify({
          schemaVersion: 1, issue: 1341, finding: "A-1342-38",
          sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
          subject: "diagnostic-oracle-not-public-persistence",
          positives: { original: positiveRepeated, labelledPreparation: positivePrepared,
            labelledAlternative: positiveAlternative },
          negatives, publicPersistence: "not-measured", productionS3: "not-evaluated",
        }, null, 2));
    }
  });
});


/** A-1342-39: an independent food mention or negation must consume its own
 * typed material proof, not reuse a single broad observation/qualifier. */
describe("#1341 A-1342-39 — repeated non-quantity material", () => {
  it("rejects reused food mentions and negations while preserving independently sourced claims", async () => {
    const mentions: C1bCase = { id: "c1b-39-mentions", text: "banana e banana",
      modality: "text", split: "calibration", semanticGroup: "c1b-39-mentions",
      facts: [0, 9].map(surfaceStart => ({ kind: "food-mention" as const,
        owner: "banana", scope: "banana e banana", surface: "banana", surfaceStart,
        ingredient: null, quantity: null, unit: null })) };
    const mentionBroad = observation(mentions, "banana", null, null, 0, mentions.text.length);
    const mentionFirst = observation(mentions, "banana", null, null, 0, 6);
    const mentionSecond: FoodObservation = { ...observation(mentions, "banana", null, null, 9, 15),
      observationId: "c1b-39-second-banana" };
    const mentionNegatives = {
      oneObservation: inspect(mentions, [mentionBroad]),
      duplicateIdentityProof: inspect(mentions, [{ ...mentionBroad,
        evidence: [...mentionBroad.evidence, { ...mentionBroad.evidence[0],
          evidenceId: "c1b-39-duplicate-identity-proof" }] }]),
      missingSecondObservation: inspect(mentions, [mentionFirst]),
    };
    for (const [name, result] of Object.entries(mentionNegatives)) {
      expect(result.complete, name).toBe(false);
      expect(result.admitted, name).toBe(false);
      expect(result.grades.some(grade => grade === "shared-material-observation" ||
        grade === "silent-omission"), name).toBe(true);
    }
    const mentionPositive = inspect(mentions, [mentionFirst, mentionSecond]);
    expect(mentionPositive).toEqual({ grades: ["structured", "structured"],
      issues: [], complete: true, admitted: true });

    const text = "café sem açúcar e café sem açúcar";
    const firstNegation = text.indexOf("sem açúcar");
    const secondNegation = text.lastIndexOf("sem açúcar");
    const secondCafe = text.lastIndexOf("café");
    const negations: C1bCase = { id: "c1b-39-negations", text,
      modality: "text", split: "calibration", semanticGroup: "c1b-39-negations",
      facts: [firstNegation, secondNegation].map(surfaceStart => ({ kind: "negation" as const,
        owner: "café", scope: text, surface: "sem açúcar", surfaceStart,
        ingredient: "açúcar", quantity: null, unit: null })) };
    const qualifier = { value: "sem açúcar", role: "sweetening", attributeCode: null,
      confidence: null };
    const withNegation = (obs: FoodObservation, start: number, end: number): FoodObservation => ({
      ...obs, identityHints: { ...obs.identityHints, qualifiers: [qualifier] },
      evidence: [...obs.evidence, { ...obs.evidence[0], field: "identity.qualifiers",
        evidenceId: `c1b-39-negation-proof-${start}`, value: "sem açúcar",
        anchor: source(negations, start, end) }],
    });
    const negationBroad = withNegation(observation(negations, "café", null, null,
      0, text.length), 0, text.length);
    const negationFirst = withNegation(observation(negations, "café", null, null,
      0, firstNegation + "sem açúcar".length), firstNegation,
      firstNegation + "sem açúcar".length);
    const negationSecond: FoodObservation = { ...withNegation(observation(negations,
      "café", null, null, secondCafe, text.length), secondNegation, text.length),
      observationId: "c1b-39-second-coffee" };
    const negationNegatives = {
      oneBroadQualifier: inspect(negations, [negationBroad]),
      duplicatedQualifierWithoutNewEvidence: inspect(negations, [{ ...negationBroad,
        identityHints: { ...negationBroad.identityHints, qualifiers: [qualifier, qualifier] } }]),
      missingSecondProof: inspect(negations, [negationFirst]),
    };
    for (const [name, result] of Object.entries(negationNegatives)) {
      expect(result.complete, name).toBe(false);
      expect(result.admitted, name).toBe(false);
      expect(result.grades.some(grade => grade === "shared-material-observation" ||
        grade === "silent-omission"), name).toBe(true);
    }
    const negationPositive = inspect(negations, [negationFirst, negationSecond]);
    expect(negationPositive).toEqual({ grades: ["structured", "structured"],
      issues: [], complete: true, admitted: true });
    // Two identical qualifier slots violate the canonical schema even with
    // separate evidence. The diagnostic must refuse this schema-shaped bypass.
    const duplicateClaims: FoodObservation = { ...negationBroad,
      identityHints: { ...negationBroad.identityHints, qualifiers: [qualifier, qualifier] },
      evidence: [negationBroad.evidence[0], negationFirst.evidence[1],
        negationSecond.evidence[1]] };
    const duplicatedWithSeparateEvidence = inspect(negations, [duplicateClaims]);
    expect(duplicatedWithSeparateEvidence.complete).toBe(false);
    expect(duplicatedWithSeparateEvidence.admitted).toBe(false);
    expect(parseFoodObservation(duplicateClaims).ok).toBe(false);

    const shaped = [mentionBroad, mentionFirst, mentionSecond, negationBroad,
      negationFirst, negationSecond];
    expect(shaped.every(obs => parseFoodObservation(obs).ok)).toBe(true);
    if (process.env.C3_EVIDENCE_OUTPUT_DIR) {
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR, { recursive: true });
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR,
        "c1b-1341-audit-escape-39.json"), JSON.stringify({
          schemaVersion: 1, issue: 1341, finding: "A-1342-39",
          sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
          subject: "diagnostic-oracle-not-public-persistence",
          sourceFacts: { mentions: mentions.facts, negations: negations.facts },
          positives: { independentlyObservedMentions: mentionPositive,
            independentlyObservedNegations: negationPositive },
          negatives: { mentions: mentionNegatives, negations: negationNegatives,
            duplicateQualifierDespiteSeparateEvidence: duplicatedWithSeparateEvidence },
          publicPersistence: "not-measured", productionS3: "not-evaluated",
        }, null, 2));
    }
  });
});


/** A-1342-40: an additive operator is separate material evidence, not a quantity. */
describe("#1341 A-1342-40 - independent increment provenance", () => {
  it("refutes quantity-only closure, untyped source spans and malformed targets", async () => {
    const plus = c1bCases.find(c => c.id === "food-repeated-literal")!;
    const plain = c1bCases.find(c => c.id === "food-repeated-coordinated")!;
    const first = observation(plus, "ovos", 2, "un", 0, 6);
    const second = { ...observation(plus, "ovos", 2, "un", 14, 20),
      observationId: "c1b-40-second" };
    const omission = inspect(plus, [first, second]);
    expect(omission).toEqual({ grades: ["structured", "structured", "silent-omission"],
      issues: [], complete: false, admitted: false });
    const broad: FoodObservation = { ...observation(plus, "ovos", 2, "un", 9, 20),
      observationId: "c1b-40-broad" };
    const unsupported = inspect(plus, [first, broad]);
    expect(unsupported.grades[2]).toBe("increment-unproven");
    expect(unsupported.complete).toBe(false);
    expect(unsupported.admitted).toBe(false);
    const pending: FoodObservation = { ...broad, unresolvedReason: "unknown_surface" };
    const pendingResult = inspect(plus, [first, pending]);
    expect(pendingResult.grades).toEqual(["structured", "structured", "traceable-unresolved"]);
    expect(pendingResult.complete).toBe(false);
    expect(pendingResult.admitted).toBe(false);
    expect([first, second, broad, pending].every(o => parseFoodObservation(o).ok)).toBe(true);
    const left = observation(plain, "ovos", 2, "un", 0, 6);
    const right: FoodObservation = { ...observation(plain, "ovos", 2, "un", 9, 15),
      observationId: "c1b-40-plain-second" };
    const control = inspect(plain, [left, right]);
    expect(control).toEqual({ grades: ["structured", "structured"],
      issues: [], complete: true, admitted: true });
    expect(referenceSignature(plus)).not.toBe(referenceSignature(plain));
    const siblings = ["food-repeated-equal", "food-repeated-distinct"].map(id => {
      const c = c1bCases.find(item => item.id === id)!;
      expect(() => validateC1bReference(c)).not.toThrow();
      expect(c.facts[2].kind).toBe("increment");
      return { id, grade: evaluateC1b(c, []).results[2].grade };
    });
    expect(siblings.every(item => item.grade === "silent-omission")).toBe(true);
    for (const target of [undefined, 0]) {
      const corrupted: C1bCase = { ...plus, facts: plus.facts.map(fact =>
        fact.kind === "increment" ? { ...fact, incrementTargetIndex: target } : fact) };
      expect(() => validateC1bReference(corrupted))
        .toThrow("c1b-reference-increment-target-invalid");
    }
    if (process.env.C3_EVIDENCE_OUTPUT_DIR) {
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR, { recursive: true });
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR,
        "c1b-1341-audit-escape-40.json"), JSON.stringify({
          schemaVersion: 1, issue: 1341, finding: "A-1342-40",
          sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
          reference: { withIncrement: plus.facts, withoutIncrement: plain.facts,
            signaturesDifferent: referenceSignature(plus) !== referenceSignature(plain) },
          negatives: { omission, unsupported, pendingResult, siblings, invalidTargetIndices: [null, 0] },
          positive: { control },
          boundaries: { typedIncrementInFoodObservation: false,
            semanticV2Gate: "not-approved", publicPersistence: "not-measured",
            nutritionalAccuracy: "not-measured", productionS3: "not-evaluated" },
        }, null, 2));
    }
  });
});

/** A-1342-41: additive relation must bind to the occurrence, not just its value. */
describe("#1341 A-1342-41 - distinct additive targets for repeated quantities", () => {
  it("rejects equal-valued target reuse and preserves occurrence-sensitive metamorphics", async () => {
    const repeated = c1bCases.find(c => c.id === "food-repeated-triple-literal")!;
    const written = c1bCases.find(c => c.id === "food-repeated-triple-written")!;
    expect(() => validateC1bReference(repeated)).not.toThrow();
    expect(() => validateC1bReference(written)).not.toThrow();
    expect(referenceSignature(repeated)).toBe(referenceSignature(written));
    // A deliberately broad authored scope is valid, but must not allow the
    // first "mais" to jump over the second occurrence onto the third one.
    const wide: C1bCase = { ...repeated, facts: repeated.facts.map(fact =>
      fact.kind === "increment" ? { ...fact, scope: repeated.text,
        scopeStart: undefined } : fact) };
    expect(() => validateC1bReference(wide)).not.toThrow();
    expect(referenceSignature(wide)).toBe(referenceSignature(repeated));
    const retarget = (firstTarget: number, secondTarget: number): C1bCase => ({
      ...wide, facts: wide.facts.map((fact, index) => fact.kind === "increment"
        ? { ...fact, incrementTargetIndex: index === 3 ? firstTarget : secondTarget } : fact),
    });
    // Both references point to existing, identically valued food facts.
    // The old oracle accepted them, and reported the same signature.
    const attacks = { reusedTarget: retarget(2, 2),
      reversedTarget: retarget(2, 1), sharedEarlierTarget: retarget(1, 1) };
    const expectedError = "c1b-reference-increment-target-invalid";
    const refuted: Record<string, {
      input: string; incrementClaims: Array<{ sourceStart: number | null;
        scope: string; targetIndex: number | null }>;
      expected: string; observed: string; passed: boolean;
    }> = {};
    const assertRefuted = (name: string, attack: C1bCase): void => {
      let observed = "accepted";
      try { validateC1bReference(attack); }
      catch (error) { observed = error instanceof Error ? error.message : String(error); }
      expect(observed, name).toBe(expectedError);
      refuted[name] = { input: attack.text,
        incrementClaims: attack.facts.filter(fact => fact.kind === "increment").map(fact => ({
          sourceStart: fact.surfaceStart ?? null, scope: fact.scope,
          targetIndex: fact.incrementTargetIndex ?? null,
        })),
        expected: expectedError, observed, passed: observed === expectedError };
    };
    for (const [name, attack] of Object.entries(attacks)) assertRefuted(name, attack);
    // Four identical food facts and two increments: same value/unit/owner,
    // different valid destinations (second+third versus second+fourth).
    const four = (id: string, text: string, foodOffsets: readonly number[],
      incrementOffsets: readonly number[], targets: readonly number[]): C1bCase => ({
      ...repeated, id, text, facts: [
        ...foodOffsets.map(offset => ({ ...repeated.facts[0], scope: text, surfaceStart: offset })),
        ...incrementOffsets.map((offset, index) => ({ ...repeated.facts[3],
          scope: "mais 2 ovos", scopeStart: offset, surfaceStart: offset,
          incrementTargetIndex: targets[index] })),
      ],
    });
    const adjacent = four("add-to-2-and-3", "2 ovos e mais 2 ovos e mais 2 ovos e 2 ovos",
      [0, 14, 28, 37], [9, 23], [1, 2]);
    const separated = four("add-to-2-and-4", "2 ovos e mais 2 ovos e 2 ovos e mais 2 ovos",
      [0, 14, 23, 37], [9, 32], [1, 3]);
    expect(() => validateC1bReference(adjacent)).not.toThrow();
    expect(() => validateC1bReference(separated)).not.toThrow();
    expect(referenceSignature(adjacent)).not.toBe(referenceSignature(separated));
    // With a broad source clause, a *valid* later target used to evade the
    // original validator even though an intervening food occurrence exists.
    const skippedSibling: C1bCase = { ...adjacent, facts: adjacent.facts.map((fact, index) =>
      index === 5 ? { ...fact, scope: adjacent.text, scopeStart: undefined,
        incrementTargetIndex: 3 } : fact) };
    assertRefuted("skippedSibling", skippedSibling);
    const quantities = [0, 14, 28].map((start, i) => ({
      ...observation(repeated, "ovos", 2, "un", start, start + 6),
      observationId: `c1b-41-${i}` }));
    expect(quantities.every(o => parseFoodObservation(o).ok)).toBe(true);
    const diagnostic = inspect(repeated, quantities);
    expect(diagnostic).toEqual({ grades: ["structured", "structured", "structured",
      "silent-omission", "silent-omission"], issues: [], complete: false, admitted: false });
    if (process.env.C3_EVIDENCE_OUTPUT_DIR) {
      await mkdir(process.env.C3_EVIDENCE_OUTPUT_DIR, { recursive: true });
      await writeFile(join(process.env.C3_EVIDENCE_OUTPUT_DIR,
        "c1b-1341-audit-escape-41.json"), JSON.stringify({
        schemaVersion: 1, issue: 1341, finding: "A-1342-41",
        sampleSha: process.env.VERIFICATION_HEAD_SHA || "local-unpinned",
        reference: { literalCaseId: repeated.id, writtenCaseId: written.id,
          repeatedFacts: repeated.facts, writtenFacts: written.facts,
          equivalentSignature: referenceSignature(repeated) === referenceSignature(written) },
        positive: { broadScopeAccepted: true,
          equivalentSignatures: { literal: referenceSignature(repeated),
            written: referenceSignature(written) },
          differentTargetSignatures: { adjacent: referenceSignature(adjacent),
            separated: referenceSignature(separated) },
          distinctTargetSignatures: referenceSignature(adjacent) !== referenceSignature(separated) },
        negatives: { plausibleWrongImplementation:
          "choose any equal-valued food quantity inside broad scope, reusing or skipping targets",
          procedure: "validateC1bReference over independently labelled increment targets",
          controls: refuted },
        diagnostic,
        boundaries: { typedIncrementInFoodObservation: false,
          semanticV2Gate: "not-approved", publicPersistence: "not-measured",
          productionS3: "not-evaluated" },
      }, null, 2));
    }
  });
});
