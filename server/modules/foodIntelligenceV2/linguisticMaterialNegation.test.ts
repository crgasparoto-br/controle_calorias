import { describe, expect, it, vi } from "vitest";
import {
  comprehendFoodLanguage,
  comprehendFoodMaterialLanguage,
  type GovernedLexiconEntry,
  type LinguisticRequest,
} from "./linguisticComprehension";
import {
  parseFoodMaterialObservationBatch,
  parseFoodObservation,
  type FoodMaterialObservation,
} from "./schemas";

const empty = { load: async () => [] };
function input(rawText: string, options: Partial<LinguisticRequest> = {}): LinguisticRequest {
  return {
    rawText, sourceRef: "authored:negation", modality: "text", ownerUserId: null,
    lexiconRevision: "authored-synthetic", now: new Date("2026-11-24T00:00:00Z"), ...options,
  };
}
function span(raw: string, literal: string, from = 0) {
  const start = raw.indexOf(literal, from);
  if (start < 0) throw new Error("invalid author control");
  return { start, end: start + literal.length };
}
function assertNegation(
  row: FoodMaterialObservation,
  request: LinguisticRequest,
  expected: { owner: string; ownerLiteral?: string; clause: string; operator: string; ingredient: string; from?: number },
) {
  const expectedSpan = span(request.rawText, expected.clause, expected.from);
  expect(row.rawInput).toBe(request.rawText);
  expect(row.identityHints.foodName).toBe(expected.owner);
  expect(row.surfaceSpan).toEqual({ sourceRef: request.sourceRef, span: expectedSpan, region: null });
  expect(row.materialClaims).toHaveLength(1);
  const [claim] = row.materialClaims;
  if (claim.kind !== "negation") throw new Error("expected canonical typed negation");
  expect(claim.binding).toEqual({ status: "bound", ownerObservationId: row.observationId });
  expect(claim.ingredient.name).toBe(expected.ingredient);
  const observed = [
    [claim.operatorEvidenceId, "material.negation", expected.operator],
    [claim.ingredient.evidenceId, "material.ingredient", expected.ingredient],
  ];
  expect(new Set(observed.map(([id]) => id)).size).toBe(2);
  const ownerEvidence = row.evidence.find(item => item.field === "identity.foodName");
  const operatorSpan = span(request.rawText, " " + expected.operator + " ", expectedSpan.start);
  const literal = expected.ownerLiteral ?? request.rawText.slice(expectedSpan.start, operatorSpan.start);
  expect(ownerEvidence).toMatchObject({
    value: literal, anchor: { sourceRef: request.sourceRef, span: span(request.rawText, literal, expectedSpan.start), region: null },
  });
  for (const [id, field, literal] of observed) {
    const evidence = row.evidence.find(item => item.evidenceId === id);
    expect(evidence).toMatchObject({
      field, value: literal, unit: null, sourceId: null, verified: false,
      origin: request.modality === "audio_transcript" ? "transcription" : "text",
      confidence: request.transcriptionConfidence ?? null,
      anchor: { sourceRef: request.sourceRef, span: span(request.rawText, literal, operatorSpan.start + 1), region: null },
    });
  }
  expect(row.evidence.some(item => item.field === "material.amount")).toBe(false);
  expect(row.evidence.some(item => item.field.startsWith("nutrition."))).toBe(false);
}

describe("R3: negação explícita de ocorrência local sem inferência nutricional", () => {
  it("preserva a quantidade explícita do dono e ancora operador e ingrediente separadamente", async () => {
    const request = input("2 fatias de focaccia SEM alecrim");
    const result = await comprehendFoodMaterialLanguage(request, empty);
    if (!result.ok) throw new Error(result.reason);
    expect(parseFoodMaterialObservationBatch(result.observations).ok).toBe(true);
    const [row] = result.observations;
    assertNegation(row, request, {
      owner: "focaccia", ownerLiteral: "focaccia", clause: request.rawText, operator: "SEM", ingredient: "alecrim",
    });
    expect(row.quantityHints).toMatchObject({ value: 2, unit: "fatia" });
    expect(row.evidence.filter(item => item.field === "quantity.value")).toEqual([
      expect.objectContaining({ value: 2, unit: "fatia", anchor: {
        sourceRef: request.sourceRef, span: span(request.rawText, "2 fatias"), region: null,
      } }),
    ]);
  });

  it("mantém byte e posições UTF-16 originais, com origem de transcrição e irmãos", async () => {
    const clause = "Crepe sem gergelim-tostado";
    const request = input("🥣 caldo; " + clause + "\n" + clause, {
      modality: "audio_transcript", transcriptionConfidence: 0.61,
    });
    const called = vi.fn(() => true);
    request.shouldInterpretResidual = called;
    const result = await comprehendFoodMaterialLanguage(request, empty);
    if (!result.ok) throw new Error(result.reason);
    expect(result.observations).toHaveLength(3);
    expect(result.observations[0].materialClaims).toEqual([]);
    expect(new Set(result.observations.map(o => o.observationId)).size).toBe(3);
    const first = span(request.rawText, clause);
    for (const [index, row] of result.observations.slice(1).entries()) {
      assertNegation(row, request, {
        owner: "crepe", clause, operator: "sem", ingredient: "gergelim-tostado",
        from: index ? first.end : 0,
      });
      expect(row.quantityHints).toMatchObject({ value: null, unit: null });
    }
    expect(called).not.toHaveBeenCalled();
    const legacy = await comprehendFoodLanguage(request, empty);
    expect(legacy.every(item => item.schemaVersion === 2 && parseFoodObservation(item).ok)).toBe(true);
    expect(legacy.some(item => "materialClaims" in item)).toBe(false);
  });

  it.each([
    ["mingau e crepe sem gergelim", ["mingau", "crepe sem gergelim"]],
    ["crepe sem gergelim e mingau", ["crepe sem gergelim", "mingau"]],
    ["crepe sem gergelim, mingau", ["crepe sem gergelim", "mingau"]],
    ["crepe, sem gergelim", ["crepe", "sem gergelim"]],
    ["crepe sem gergelim ou castanha", ["crepe sem gergelim ou castanha"]],
    ["crepe sem gergelim sem mel", ["crepe sem gergelim sem mel"]],
    ["crepe com mel sem gergelim", ["crepe com mel sem gergelim"]],
    ["crepe (sem gergelim; mingau)", ["crepe (sem gergelim; mingau)"]],
    ["sem gergelim", ["sem gergelim"]],
    ["crepe sem 2 g de gergelim", ["crepe sem 2 g de gergelim"]],
    ["crepe sem vinte-e-duas", ["crepe sem vinte-e-duas"]],
    ["crepe sem fatias", ["crepe sem fatias"]],
    ["crepe sem qualquer", ["crepe sem qualquer"]],
  ] as const)("não adivinha o escopo de %s e conserva o irmão independente", async (clause, affected) => {
    const request = input(clause + "; 3 tâmaras");
    const result = await comprehendFoodMaterialLanguage(request, empty);
    if (result.ok || result.reason !== "unproven-material") throw new Error("expected explicit abstention");
    expect(result.affected.map(item =>
      request.rawText.slice(item.surfaceSpan.span?.start, item.surfaceSpan.span?.end)
    )).toEqual(affected);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].identityHints.foodName).toBe("tamaras");
    expect(result.observations[0].quantityHints).toMatchObject({ value: 3, unit: "un" });
    expect(result.observations[0].materialClaims).toEqual([]);
  });

  it("preserva a medida já ancorada de um irmão separado do dono da negação", async () => {
    const measured = "2 crepes com 3 g de erva-doce";
    const negated = "1 tortilha sem gergelim";
    const request = input(measured + "; " + negated);
    const result = await comprehendFoodMaterialLanguage(request, empty);
    if (!result.ok) throw new Error(result.reason);
    expect(result.observations).toHaveLength(2);
    expect(parseFoodMaterialObservationBatch(result.observations).ok).toBe(true);
    const [left, right] = result.observations;
    const [addition] = left.materialClaims;
    if (addition?.kind !== "ingredient" || !addition.amount) throw new Error("missing sibling measure");
    expect(left.evidence.find(item => item.evidenceId === addition.amount?.evidenceId)?.anchor.span)
      .toEqual(span(request.rawText, "3 g"));
    expect(left.evidence.find(item => item.field === "identity.foodName")?.anchor.span)
      .toEqual(span(request.rawText, "crepes"));
    expect(left.quantityHints).toMatchObject({ value: 2, unit: "un" });
    assertNegation(right, request, {
      owner: "tortilha", ownerLiteral: "tortilha", clause: negated,
      operator: "sem", ingredient: "gergelim",
    });
    expect(right.evidence.find(item => item.field === "quantity.value")?.anchor.span)
      .toEqual(span(request.rawText, "1"));
    expect(right.quantityHints).toMatchObject({ value: 1, unit: "un" });
  });

  it("não interpreta operador protegido pelo léxico existente", async () => {
    const name = "trufas sem fronteiras";
    const row: GovernedLexiconEntry = {
      id: 31, term: name, normalizedTerm: name, kind: "protected_token", targetType: "none",
      targetRef: null, locale: "pt-BR", scope: "global", userId: null, source: null,
      status: "verified", confidence: null, requiresClarification: false, current: true,
      validFrom: null, validTo: null,
    };
    const store = { load: async () => [row] };
    const result = await comprehendFoodMaterialLanguage(input(name), store);
    if (!result.ok) throw new Error(result.reason);
    expect(result.observations[0].materialClaims).toEqual([]);
    expect(result.observations[0].identityHints.foodName).toBe(name);
  });

  it("não cria afirmação textual para modalidade ou locale fora do recorte", async () => {
    const store = { load: vi.fn(async () => []) };
    for (const options of [{ modality: "image" }, { locale: "pt-PT" }] as const) {
      await expect(comprehendFoodMaterialLanguage(input("crepe sem gergelim", options), store))
        .resolves.toEqual({ ok: false, reason: "unsupported-input" });
    }
    expect(store.load).not.toHaveBeenCalled();
  });
});
