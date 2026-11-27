import { describe, expect, it, vi } from "vitest";
import {
  comprehendFoodMaterialLanguage,
  diagnoseFoodMaterialClarificationEvidence,
  diagnoseFoodMaterialPendingIncrements,
  diagnoseFoodMaterialUnquantifiedIncrements,
  type LinguisticRequest,
} from "../linguisticComprehension";
import { resolveFoodObservation, type FoodResolverContext } from "../resolver";
import {
  parseFoodMaterialClarificationObservationBatch,
  parseFoodMaterialObservationBatch,
  parseFoodObservation,
  type FoodObservation,
} from "../schemas";

const empty = { load: async () => [] };
const origin = "fixture:1341-clarification";
const prefix = "🍐 Café com 1 colher de chá de açúcar";
const tail = "mais um pouco";
const modes = ["text", "audio_transcript"] as const;
const cases = [
  { measured: "100 ml", nominal: "leite", value: 100, unit: "ml" },
  { measured: "100 ml", nominal: null, value: 100, unit: "ml" },
  { measured: "15,5 g", nominal: "café".normalize("NFD"), value: 15.5, unit: "g" },
] as const;
const anchored = (raw: string, text: string, from = 0) => {
  const start = raw.indexOf(text, from);
  if (start < 0) throw Error("literal ausente no caso sintético");
  return { start, end: start + text.length };
};
const request = (rawText: string, modality: (typeof modes)[number]): LinguisticRequest => ({
  rawText, sourceRef: origin, modality, locale: "pt-BR", ownerUserId: null,
  lexiconRevision: "fixture-1341-pinned-empty", now: new Date("2026-11-27T00:00:00Z"),
});
const asR3 = <T extends { clarificationEvidence: unknown; schemaVersion: number }>(
  { clarificationEvidence: _clarification, schemaVersion: _version, ...row }: T,
) => ({ ...row, schemaVersion: 3 });

describe.each(modes)("revisão opt-in de esclarecimento: %s", modality => {
  it.each(cases)("preserva $measured / $nominal sem calcular, registrar ou adivinhar dono", async expected => {
    const raw = prefix + " e " + expected.measured + (expected.nominal ? " de " + expected.nominal : "") +
      " com " + tail + " e " + tail + ".";
    const req = request(raw, modality);
    const inputCopy = structuredClone(req);
    const old = await diagnoseFoodMaterialUnquantifiedIncrements(req, empty);
    const current = await diagnoseFoodMaterialClarificationEvidence(req, empty);
    expect(req).toEqual(inputCopy);
    if (current.ok || current.reason !== "unproven-material" || old.ok || old.reason !== "unproven-material") {
      throw Error("o grupo composto deve ficar pendente");
    }
    const [first, second] = current.affected;
    expect(current.affected).toHaveLength(2);
    expect(first.observationId).not.toBe(second.observationId);
    const [hold, continuation] = [first.pendingObservation, second.pendingObservation];
    if (!hold?.clarificationEvidence || !continuation) throw Error("prova ou ocorrência ausente");
    const evidence = hold.clarificationEvidence;
    expect(hold.schemaVersion).toBe(4);
    expect(continuation.clarificationEvidence).toBeNull();
    expect(hold.identityHints.foodName).toBeNull();
    expect(hold.quantityHints).toMatchObject({ value: null, unit: null, servingText: null });
    expect(hold.unresolvedReason).not.toBeNull();
    const measureSpan = anchored(raw, expected.measured);
    expect(evidence.measure).toMatchObject({ literal: expected.measured,
      value: expected.value, unit: expected.unit, anchor: { sourceRef: origin, span: measureSpan, region: null } });
    if (expected.nominal === null) expect(evidence.writtenNominal).toBeNull();
    else expect(evidence.writtenNominal).toMatchObject({ literal: expected.nominal, anchor: {
      sourceRef: origin, span: anchored(raw, expected.nominal, measureSpan.end), region: null } });
    const firstOperator = anchored(raw, "mais", measureSpan.end);
    const secondOperator = anchored(raw, "mais", firstOperator.end);
    for (const [pending, span] of [[hold, firstOperator], [continuation, secondOperator]] as const) {
      expect(pending.materialClaims).toHaveLength(1);
      expect(pending.materialClaims[0]).toMatchObject({
        kind: "increment", target: null, ingredient: null, unresolvedAmount: null,
        binding: { status: "unresolved", reason: "owner_unknown", candidateObservationIds: [] },
      });
      expect(pending.evidence).toContainEqual(expect.objectContaining({
        field: "material.increment", anchor: { sourceRef: origin, span, region: null },
      }));
    }
    expect(hold.materialClaims[0]).toMatchObject({ operatorEvidenceId: evidence.operatorEvidenceId });

    // The sibling's exact prior material evidence remained independent. The
    // test-only projection below compares fields; it is not a runtime adapter.
    expect(current.observations.map(asR3)).toEqual(old.observations);
    expect(current.observations[0]?.materialClaims).toMatchObject([
      { kind: "ingredient", amount: { value: 1, unit: "colher de chá" } },
    ]);
    expect([hold, continuation].map(asR3)).toEqual(old.affected.map(x => x.pendingObservation));
    expect(current.affected.map(({ observationId, surfaceSpan }) => ({ observationId, surfaceSpan })))
      .toEqual(old.affected.map(({ observationId, surfaceSpan }) => ({ observationId, surfaceSpan })));

    const pendingV1 = await diagnoseFoodMaterialPendingIncrements(req, empty);
    const standard = await comprehendFoodMaterialLanguage(req, empty);
    expect(standard).not.toHaveProperty("diagnosticProfile");
    const legacyPattern = JSON.stringify([pendingV1, standard]);
    expect(legacyPattern).not.toContain("clarificationEvidence");
    expect(legacyPattern).not.toContain('"schemaVersion":4');

    const batch = [...current.observations, hold, continuation];
    expect(parseFoodMaterialClarificationObservationBatch(batch).ok).toBe(true);
    expect(parseFoodMaterialObservationBatch(batch).ok).toBe(false);
    expect(parseFoodMaterialClarificationObservationBatch([old.observations[0], hold]).ok).toBe(false);
    expect(parseFoodMaterialObservationBatch(old.observations).ok).toBe(true);
    for (const fragment of [evidence, evidence.measure, ...(evidence.writtenNominal ? [evidence.writtenNominal] : [])]) {
      expect(parseFoodMaterialClarificationObservationBatch([fragment]).ok).toBe(false);
      expect(parseFoodMaterialObservationBatch([fragment]).ok).toBe(false);
      expect(parseFoodObservation(fragment).ok).toBe(false);
    }

    // The current real resolver only accepts the old observation boundary.
    // R4 stays opt-in and cannot even read knowledge or stage anything there.
    const context: FoodResolverContext = {
      traceId: origin, userId: null, knowledgeRevision: "public-test", policyVersion: "public-test", resolverVersion: "public-test",
    };
    const store = { readLocal: vi.fn(), readPendingEvidence: vi.fn(), stagePendingEvidence: vi.fn() };
    await expect(resolveFoodObservation(hold as unknown as FoodObservation, context, store)).rejects.toThrow("FoodObservation V2 inválida");
    for (const spy of Object.values(store)) expect(spy).not.toHaveBeenCalled();
  });
});

it("não move o volume para um alimento independente quantificado", async () => {
  const raw = "2 fatias de pão; " + prefix + " e 100 ml de leite com " + tail + " e " + tail + ".";
  const req = request(raw, "text");
  const old = await diagnoseFoodMaterialUnquantifiedIncrements(req, empty);
  const newer = await diagnoseFoodMaterialClarificationEvidence(req, empty);
  if (old.ok || old.reason !== "unproven-material" || newer.ok || newer.reason !== "unproven-material") {
    throw Error("esperado grupo pendente e alimento independente");
  }
  expect(newer.observations.map(asR3)).toEqual(old.observations);
  expect(newer.observations[0]).toMatchObject({
    identityHints: { foodName: "pao" },
    quantityHints: { value: 2, unit: "fatia" },
    clarificationEvidence: null,
  });
  expect(newer.affected[0]?.pendingObservation?.clarificationEvidence?.measure.value).toBe(100);
});

it.each([
  "Café ou chá e 100 ml de leite com mais um pouco e mais um pouco.",
  "Não registre café e 100 ml de leite com mais um pouco e mais um pouco.",
  "Na\u0303o registre café e 100 ml de leite com mais um pouco e mais um pouco.",
  "“Café; 100 ml de leite com mais um pouco e mais um pouco.”",
  "Café e 100 ml de com mais um pouco e mais um pouco.",
])("não dá autoridade de esclarecimento a um escopo não comprovado: %s", async raw => {
  const result = await diagnoseFoodMaterialClarificationEvidence(request(raw, "text"), empty);
  if (!result.ok && result.reason === "unproven-material") {
    for (const row of result.affected) {
      if (row.pendingObservation) expect(row.pendingObservation.clarificationEvidence).toBeNull();
    }
  }
  if ("observations" in result) {
    expect(result.observations.every(row => row.clarificationEvidence === null)).toBe(true);
  }
});

it("rejeita uma medida adulterada, emprestada, promovida ou remapeada para a outra cauda", async () => {
  const raw = "2 fatias de pão; " + prefix + " e 100 ml de leite com " + tail + " e " + tail + ".";
  const result = await diagnoseFoodMaterialClarificationEvidence(request(raw, "text"), empty);
  if (result.ok || result.reason !== "unproven-material") throw Error("esperado grupo pendente");
  const pending = result.affected.map(x => x.pendingObservation);
  const [first, second] = pending;
  if (!first?.clarificationEvidence || !second) throw Error("esperadas duas ocorrências e prova");
  const { operatorEvidenceId: _operatorEvidenceId, ...withoutOperatorId } = first.clarificationEvidence;
  const omittedId = { ...first, clarificationEvidence: withoutOperatorId };
  const measured = first.clarificationEvidence.measure;
  const operator = first.evidence[0];
  const amountEvidence = { ...operator, evidenceId: "fixture:wrong-increment-amount",
    field: "material.amount", value: measured.value, unit: measured.unit, anchor: measured.anchor };
  const tests = [
    { ...first, evidence: [...first.evidence, amountEvidence], materialClaims: first.materialClaims.map(claim =>
      claim.kind === "increment" ? { ...claim, unresolvedAmount: {
        value: measured.value, unit: measured.unit, evidenceId: amountEvidence.evidenceId,
      } } : claim) },
    { ...first, clarificationEvidence: { ...first.clarificationEvidence, measure: { ...measured, value: 125 } } },
    { ...first, clarificationEvidence: { ...first.clarificationEvidence, measure: { ...measured, unit: "g" } } },
    { ...first, clarificationEvidence: { ...first.clarificationEvidence,
      measure: { ...measured, anchor: { ...measured.anchor, sourceRef: "fixture:other-source" } } } },
    { ...first, clarificationEvidence: { ...first.clarificationEvidence,
      measure: { ...measured, anchor: { ...measured.anchor, span: anchored(raw, "2 fatias") } } } },
    { ...first, clarificationEvidence: { ...first.clarificationEvidence, operatorEvidenceId: second.evidence[0].evidenceId } },
    { ...first, clarificationEvidence: { ...first.clarificationEvidence, writtenNominal: null } },
    { ...first, quantityHints: { ...first.quantityHints, value: 100, unit: "ml" } },
    { ...first, identityHints: { ...first.identityHints, foodName: "leite" } },
    { ...first, unresolvedReason: null },
    omittedId,
    { ...first, schemaVersion: 3 },
  ];
  for (const altered of tests) {
    expect(parseFoodMaterialClarificationObservationBatch([...result.observations, altered, second]).ok)
      .toBe(false);
  }
  expect(parseFoodMaterialObservationBatch([{ ...first, schemaVersion: 3 }]).ok).toBe(false);
});

it("não valida prova transportada para negação, alternativa ou fala sem alterar os offsets locais", async () => {
  const raw = prefix + " e 100 ml de leite com " + tail + " e " + tail + ".";
  const result = await diagnoseFoodMaterialClarificationEvidence(request(raw, "text"), empty);
  if (result.ok || result.reason !== "unproven-material") throw Error("esperado grupo pendente");
  const first = result.affected[0]?.pendingObservation;
  if (!first?.clarificationEvidence) throw Error("esperada medida retida");
  expect(parseFoodMaterialClarificationObservationBatch([first]).ok).toBe(true);
  for (const change of ["Sem comida", "Café ou chá", "“Café"] as const) {
    const sameWidth = 14;
    const other = change.padEnd(sameWidth) + raw.slice(sameWidth);
    expect(other.length).toBe(raw.length);
    expect(other.slice(first.surfaceSpan.span!.start)).toBe(raw.slice(first.surfaceSpan.span!.start));
    expect(parseFoodMaterialClarificationObservationBatch([{ ...first, rawInput: other }]).ok).toBe(false);
  }
});
