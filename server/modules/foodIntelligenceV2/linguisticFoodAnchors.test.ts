import { describe, expect, it } from "vitest";
import {
  comprehendFoodLanguage, comprehendFoodMaterialLanguage,
  type LinguisticLexiconStore, type LinguisticRequest,
} from "./linguisticComprehension";
import { parseFoodMaterialObservationBatch, parseFoodObservation } from "./schemas";

import { compareC1bR3 } from "./corpus/semanticConservation1341.r3.test.support";
import type { C1bCase } from "./corpus/semanticConservation1341.test.fixture";

const lexicon: LinguisticLexiconStore = { load: async () => [] };
function input(rawText: string, modality: "text" | "audio_transcript"): LinguisticRequest {
  return {
    rawText, modality, sourceRef: "s1:food-anchors:" + modality,
    ownerUserId: null, lexiconRevision: "synthetic-anchors", now: new Date("2026-11-24T00:00:00Z"),
    ...(modality === "audio_transcript" ? { transcriptionConfidence: 0.74 } : {}),
  };
}
function range(start: number, text: string) {
  return { start, end: start + text.length };
}

describe("evidências lexicais exatas da comida em R3 inativo", () => {
  it.each([
    {
      modality: "text" as const,
      clauses: ["🥣  12 g de Açaí com 3 g de semente", "12 g de Açaí com 4 g de semente"],
      names: ["Açaí", "Açaí"], amounts: ["12 g", "12 g"], values: [12, 12], units: ["g", "g"],
      ingredients: ["semente", "semente"], ingredientAmounts: [3, 4],
    },
    {
      modality: "audio_transcript" as const,
      clauses: ["50,5 ml de Suco com 2 g de graviola", "½ fatia de Pão com 3 g de noz"],
      names: ["Suco", "Pão"], amounts: ["50,5 ml", "½ fatia"], values: [50.5, 0.5], units: ["ml", "fatia"],
      ingredients: ["graviola", "noz"], ingredientAmounts: [2, 3],
    },
  ])("usa a ocorrência individual $modality, preservando IDs e cláusula integral", async item => {
    const raw = item.clauses.join(";\n");
    const request = input(raw, item.modality);
    const legacy = await comprehendFoodLanguage(request, lexicon);
    const material = await comprehendFoodMaterialLanguage(request, lexicon);
    if (!material.ok) throw new Error("Expected independent scoped foods");
    expect(parseFoodMaterialObservationBatch(JSON.parse(JSON.stringify(material.observations))).ok).toBe(true);
    expect(material.observations).toHaveLength(2);
    expect(material.observations.map(value => value.observationId)).toEqual(legacy.map(value => value.observationId));
    let begin = 0;
    for (const [index, row] of material.observations.entries()) {
      const clause = item.clauses[index];
      const name = item.names[index];
      const amount = item.amounts[index];
      const expectedName = range(begin + clause.indexOf(name), name);
      const expectedMeasure = range(begin + clause.indexOf(amount), amount);
      const evidenceName = row.evidence.find(evidence => evidence.evidenceId === "ev-name-" + index);
      const evidenceMeasure = row.evidence.find(evidence => evidence.evidenceId === "ev-quantity-" + index);
      const origin = item.modality === "text" ? "text" : "transcription";
      expect(row.surfaceSpan.span).toEqual(range(begin, clause));
      expect(evidenceName).toMatchObject({
        field: "identity.foodName", origin, value: name, anchor: { sourceRef: request.sourceRef, span: expectedName },
      });
      expect(evidenceMeasure).toMatchObject({
        field: "quantity.value", origin, value: item.values[index], unit: item.units[index],
        anchor: { sourceRef: request.sourceRef, span: expectedMeasure },
      });
      expect(evidenceName?.confidence).toBe(request.transcriptionConfidence ?? null);
      expect(evidenceMeasure?.confidence).toBe(request.transcriptionConfidence ?? null);
      expect(raw.slice(expectedName.start, expectedName.end)).toBe(name);
      expect(raw.slice(expectedMeasure.start, expectedMeasure.end)).toBe(amount);
      expect(row.materialClaims).toMatchObject([{
        binding: { status: "bound", ownerObservationId: row.observationId },
        ingredient: { name: item.ingredients[index] }, amount: { value: item.ingredientAmounts[index], unit: "g" },
      }]);
      const previous = legacy[index];
      expect(parseFoodObservation(JSON.parse(JSON.stringify(previous))).ok).toBe(true);
      expect(previous.schemaVersion).toBe(2);
      expect(previous.evidence.find(evidence => evidence.evidenceId === "ev-name-" + index)?.anchor)
        .toEqual(previous.surfaceSpan);
      begin += clause.length + 2; // Source semicolon and newline remain outside either clause.
    }
  });

  it("não inventa medida para a comida nem confunde a medida do ingrediente", async () => {
    const raw = "Pera com 2 g de linhaça; 30 g de Kiwi";
    const material = await comprehendFoodMaterialLanguage(input(raw, "text"), lexicon);
    if (!material.ok) throw new Error("Expected supported clauses");
    const [first, next] = material.observations;
    expect(first.quantityHints.value).toBeNull();
    expect(first.evidence.some(evidence => evidence.field === "quantity.value")).toBe(false);
    expect(first.evidence.find(evidence => evidence.field === "identity.foodName")?.anchor.span).toEqual(range(0, "Pera"));
    expect(first.materialClaims).toMatchObject([{ ingredient: { name: "linhaça" }, amount: { value: 2, unit: "g" } }]);
    const independent = raw.indexOf("30 g");
    expect(next.evidence.find(evidence => evidence.field === "quantity.value")?.anchor.span).toEqual(range(independent, "30 g"));
    expect(next.evidence.find(evidence => evidence.field === "identity.foodName")?.anchor.span).toEqual(range(raw.indexOf("Kiwi"), "Kiwi"));
  });

  it("não atribui âncora estreita falsa a uma medida cuja superfície não é contígua", async () => {
    const raw = "2 fatias de pão e meia";
    const request = input(raw, "text");
    const [legacy] = await comprehendFoodLanguage(request, lexicon);
    const material = await comprehendFoodMaterialLanguage(request, lexicon);
    if (!material.ok) throw new Error("Expected historical support");
    const [row] = material.observations;
    expect(row.quantityHints).toEqual(legacy.quantityHints);
    expect(row.evidence.find(evidence => evidence.field === "quantity.value"))
      .toEqual(legacy.evidence.find(evidence => evidence.field === "quantity.value"));
  });
});

async function sharedQuantityWitness(owners: [string, string] = ["Nabo", "Couve"]) {
  const [left, right] = owners.map(name => "30 g de " + name);
  const text = left + "; " + right;
  const sample: C1bCase = {
    id: "author-shared-quantity-anchors", semanticGroup: "new-author-controls",
    split: "calibration", modality: "audio_transcript", text,
    facts: [left, right].map((phrase, index) => ({
      kind: "food-quantity", owner: owners[index],
      scope: phrase, surface: phrase, scopeStart: index ? left.length + 2 : 0,
      surfaceStart: index ? left.length + 2 : 0, ingredient: null, quantity: 30, unit: "g",
    })),
  };
  const produced = await comprehendFoodMaterialLanguage({
    ...input(text, "audio_transcript"), sourceRef: "c1b:" + sample.id, lexiconRevision: "c1b-empty-s2",
  }, lexicon);
  if (!produced.ok) throw new Error("Expected scoped fixture");
  return { sample, produced };
}

describe("prova composta R3 não reinterpreta o oráculo histórico", () => {
  it.each([["Nabo", "Couve"], ["Nabo", "Nabo"]] as [string, string][])(
    "comprova dois fatos com quantidades iguais, distintos por posição: %s / %s", async (a, b) => {
      const { sample, produced } = await sharedQuantityWitness([a, b]);
      const before = structuredClone(produced);
      const report = compareC1bR3(sample, produced);
      expect(report.diagnosticBatchComplete).toBe(true);
      expect(report.findings.map(item => item.proof)).toEqual(["existing-observation-field", "existing-observation-field"]);
      expect(produced).toEqual(before);
      // Sinal legado amplo continua sendo analisado pelo mesmo caminho prévio.
      for (const row of before.observations) {
        row.evidence.find(evidence => evidence.field === "quantity.value")!.anchor = row.surfaceSpan;
      }
      expect(compareC1bR3(sample, before).diagnosticBatchComplete).toBe(true);
    }
  );

  it.each([
    "amount", "unit", "swapped_equal_amount", "swapped_equal_owner", "swapped_owner",
    "wrong_source", "wrong_origin", "shifted", "truncated", "missing_measure",
    "missing_name", "extra_context", "extra_serving_context", "invalid_claim",
  ] as const)("não aceita evidência composta com %s, mesmo que o irmão esteja íntegro", async violation => {
    const { sample, produced } = await sharedQuantityWitness(violation === "swapped_equal_owner" ? ["Nabo", "Nabo"] : undefined);
    const [first, second] = produced.observations;
    const firstMeasure = first.evidence.find(item => item.field === "quantity.value")!;
    const firstName = first.evidence.find(item => item.field === "identity.foodName")!;
    const secondMeasure = second.evidence.find(item => item.field === "quantity.value")!;
    const secondName = second.evidence.find(item => item.field === "identity.foodName")!;
    if (violation === "amount") first.quantityHints.value = firstMeasure.value = 31;
    if (violation === "unit") first.quantityHints.unit = firstMeasure.unit = "ml";
    if (violation === "swapped_equal_amount") firstMeasure.anchor = structuredClone(secondMeasure.anchor);
    if (violation === "swapped_equal_owner") firstName.anchor = structuredClone(secondName.anchor);
    if (violation === "swapped_owner") first.identityHints.foodName = "couve";
    if (violation === "wrong_source") firstMeasure.anchor.sourceRef = "c1b:other-source";
    if (violation === "wrong_origin") firstName.origin = "text";
    if (violation === "shifted") firstMeasure.anchor.span!.start++;
    if (violation === "truncated") firstMeasure.anchor.span!.end--;
    if (violation === "missing_measure") first.evidence = first.evidence.filter(item => item !== firstMeasure);
    if (violation === "missing_name") first.evidence = first.evidence.filter(item => item !== firstName);
    if (violation === "extra_context") firstName.anchor.span!.start -= 3; // includes the connector.
    if (violation === "extra_serving_context") first.quantityHints.servingText = "30 g de Nabo";
    if (violation === "invalid_claim") {
      first.identityHints.brand = "não rotulada";
      first.evidence.push({
        ...firstName, evidenceId: "other-author-field", field: "identity.brand", value: "não rotulada",
      });
    }
    if (violation === "shifted" || violation === "truncated") {
      expect(parseFoodMaterialObservationBatch(produced.observations).ok).toBe(true);
    }
    const report = compareC1bR3(sample, produced);
    expect(report.diagnosticBatchComplete).toBe(false);
    expect(report.findings[0].status).not.toBe("verified");
  });
});
