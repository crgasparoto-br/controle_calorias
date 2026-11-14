import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFoodObservation, type FoodObservation } from "../schemas";
import type { C1bCase } from "./semanticConservation1341.test.fixture";
import { c1bCases } from "./semanticConservation1341.test.fixture";
import { attemptDiagnosticBatchAdmission, evaluateC1b } from "./semanticConservation1341.test.support";

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
