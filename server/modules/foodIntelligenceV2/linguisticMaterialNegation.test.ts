import { describe, expect, it, vi } from "vitest";
import { FOOD_CONTRACT_LIMITS } from "./contracts";
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
function nominal(term: string, id: number, extra: Partial<GovernedLexiconEntry> = {}): GovernedLexiconEntry {
  return {
    id, term, normalizedTerm: term, kind: "alias_surface", targetType: "food_variant",
    targetRef: "synthetic-food-" + id, locale: "pt-BR", scope: "global", userId: null,
    source: null, status: "verified", confidence: null, requiresClarification: false,
    current: true, validFrom: null, validTo: null, ...extra,
  };
}
const roles = { load: async () =>
  ["focaccia", "alecrim", "crepe", "gergelim-tostado", "gergelim", "tortilha", "mingau",
    "granola", "bolo", "caldo", "creme", "limão", "mostarda", "castanha", "biscoito"]
    .map((term, index) => nominal(term, index + 1)),
};
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
    const result = await comprehendFoodMaterialLanguage(request, roles);
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
    const result = await comprehendFoodMaterialLanguage(request, roles);
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
    const result = await comprehendFoodMaterialLanguage(request, roles);
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
    const result = await comprehendFoodMaterialLanguage(request, roles);
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

  const unsupportedRole = [
    "granola sem misturar", "bolo sem esquentar", "caldo sem ferver", "biscoito sem fracionar",
    "Não comi crepe sem mostarda", "não adicionar creme sem limão",
    "mingau & crepe sem gergelim", "mingau: crepe sem gergelim",
    "mingau | crepe sem gergelim", "creme sem mexer", "crepe sem lactose",
  ] as const;
  it.each(unsupportedRole.flatMap(clause =>
    (["text", "audio_transcript"] as const).map(modality => [clause, modality] as const)
  ))("mantém %s pendente em %s", async (clause, modality) => {
    const request = input(clause + "; 2 uvas", {
      modality, ...(modality === "audio_transcript" ? { transcriptionConfidence: 0.74 } : {}),
    });
    const result = await comprehendFoodMaterialLanguage(request, roles);
    if (result.ok || result.reason !== "unproven-material") throw new Error("unsupported claim was not withheld");
    expect(result.affected.some(item => item.surfaceSpan.span?.start === 0)).toBe(true);
    expect(result.observations.map(item => item.identityHints.foodName)).toEqual(["uvas"]);
    expect(result.observations.flatMap(item => item.materialClaims)).toEqual([]);
  });

  it("não aceita frase instrucional ou coordenada como um nome nominal, ainda que oferecida como alias", async () => {
    const malformedOwners = ["não adicionar creme", "mingau & crepe"];
    const store = { load: async () => [
      nominal("limão", 90), ...malformedOwners.map((term, i) => nominal(term, 91 + i)),
    ] };
    for (const owner of malformedOwners) {
      const result = await comprehendFoodMaterialLanguage(input(owner + " sem limão; 2 uvas"), store);
      if (result.ok || result.reason !== "unproven-material") throw new Error("expected lexical boundary refusal");
      expect(result.observations.map(item => item.identityHints.foodName)).toEqual(["uvas"]);
    }
  });

  it.each([
    [],
    [nominal("crepe", 1)],
    [nominal("gergelim", 2)],
    [nominal("crepe", 1), nominal("gergelim", 2, { status: "revoked" })],
    [nominal("crepe", 1), nominal("gergelim", 2), nominal("gergelim", 3)],
    [nominal("crepe", 1), nominal("gergelim", 2, { targetType: "canonical_term" })],
    [nominal("crepe", 1), nominal("gergelim", 2, { scope: "user", userId: 42, status: "active", source: "user_confirmed" })],
    [nominal("crepe", 1), nominal("gergelim", 2, { requiresClarification: true })],
  ])("não infere papéis de autoridade lexical ausente, desatualizada ou ambígua", async (...entries) => {
    const result = await comprehendFoodMaterialLanguage(input("crepe sem gergelim; 2 uvas"), { load: async () => entries });
    if (result.ok || result.reason !== "unproven-material") throw new Error("unexpected authority");
    expect(result.observations.map(item => item.identityHints.foodName)).toEqual(["uvas"]);
  });

  const ambiguousTerm = "medidas-caseiras";
  function serving(id: number, unit: string, extra: Partial<GovernedLexiconEntry> = {}) {
    return nominal(ambiguousTerm, id, {
      kind: "portion_term", targetType: "canonical_term", targetRef: unit, ...extra,
    });
  }
  const independentRoles = [nominal("crepe", 61), nominal("gergelim-tostado", 62)];
  const conflictingUnits = [serving(63, "fatia", { confidence: 0.27 }),
    serving(64, "copo", { confidence: 0.94 })];

  it.each(["text", "audio_transcript"] as const)(
    "conserva a negação local no R3 %s sem transformar interpretações concorrentes em quantidade", async modality => {
      const clause = "2 medidas-caseiras de Crêpe sEm gergelim-tostado";
      const request = input("🥣 4 uvas; " + clause + "; 3 figos", {
        modality, ...(modality === "audio_transcript" ? { transcriptionConfidence: 0.73 } : {}),
      });
      const residual = vi.fn(() => true);
      request.shouldInterpretResidual = residual;
      const entries = [...independentRoles, ...conflictingUnits];
      const store = { load: async () => entries };
      const result = await comprehendFoodMaterialLanguage(request, store);
      if (!result.ok) throw new Error(result.reason);
      expect(parseFoodMaterialObservationBatch(result.observations).ok).toBe(true);
      expect(residual).not.toHaveBeenCalled();
      expect(result.observations).toHaveLength(3);
      const [before, item, after] = result.observations;
      assertNegation(item, request, {
        owner: "crepe", ownerLiteral: "Crêpe", clause, operator: "sEm", ingredient: "gergelim-tostado",
      });
      expect(item.unresolvedReason).toBe("source_conflict");
      expect(item.quantityHints).toEqual({
        value: null, unit: null, servingText: "2", visiblePackageQuantity: null, visiblePackageUnit: null,
      });
      // The historic non-authoritative serving hint is the literal prefix,
      // not evidence for a measured quantity or a chosen interpretation.
      expect(item.rawInput!.slice(item.surfaceSpan.span!.start, item.surfaceSpan.span!.start + 1))
        .toBe(item.quantityHints.servingText);
      expect(item.evidence.filter(e => e.field.startsWith("quantity."))).toEqual([]);
      const hypotheses = item.alternatives.filter(alt => alt.hypothesisId.startsWith("unit-"));
      expect(hypotheses.map(alt => [alt.hypothesisId, alt.identityHints.foodName, alt.quantityHints.value,
        alt.quantityHints.unit, alt.evidenceIds])).toEqual([
        ["unit-63", "crepe", 2, "fatia", []], ["unit-64", "crepe", 2, "copo", []],
      ]);
      expect(item.normalizationPath.filter(step => step.lexiconEntryId === 63 || step.lexiconEntryId === 64)).toEqual([]);
      expect([before, after].map(o => [o.identityHints.foodName, o.quantityHints.value, o.materialClaims]))
        .toEqual([["uvas", 4, []], ["figos", 3, []]]);

      const reverse = await comprehendFoodMaterialLanguage(request, { load: async () => [...entries].reverse() });
      if (!reverse.ok) throw new Error(reverse.reason);
      expect(reverse.observations[1].materialClaims).toEqual(item.materialClaims);
      expect(reverse.observations[1].quantityHints).toEqual(item.quantityHints);
      expect(reverse.observations[1].unresolvedReason).toBe(item.unresolvedReason);
      expect(reverse.observations[1].alternatives.map(alt => alt.hypothesisId).sort())
        .toEqual(item.alternatives.map(alt => alt.hypothesisId).sort());

      const withPending = await comprehendFoodMaterialLanguage(request, { load: async () => [
        ...entries, serving(65, "porção", { requiresClarification: true, confidence: 0.99 }),
      ] });
      if (!withPending.ok) throw new Error(withPending.reason);
      const extended = withPending.observations[1];
      expect(extended.materialClaims).toEqual(item.materialClaims);
      expect(extended.unresolvedReason).toBe("source_conflict");
      expect(extended.quantityHints).toEqual(item.quantityHints);
      expect(extended.evidence.filter(e => e.field.startsWith("quantity."))).toEqual([]);
      expect(extended.normalizationPath.some(step => step.lexiconEntryId === 65)).toBe(false);
      const pending = extended.alternatives.find(alt => alt.hypothesisId === "unit-65");
      expect(pending).toMatchObject({ evidenceIds: [], quantityHints: { unit: "porção" } });

      const legacy = await comprehendFoodLanguage(request, store);
      expect(legacy[1]).toMatchObject({
        schemaVersion: 2, unresolvedReason: "unknown_surface",
        identityHints: { foodName: "2 medidas-caseiras de crepe sem gergelim-tostado" },
        quantityHints: { value: null, unit: null },
      });
      expect(legacy[1]).not.toHaveProperty("materialClaims");
    });

  it.each([
    ["alias desconhecido", "2 medidores-irreais de crepe sem gergelim-tostado", conflictingUnits],
    ["sem conector de", "2 medidas-caseiras crepe sem gergelim-tostado", conflictingUnits],
    ["limite nominal composto", "2 medidas-caseiras de creme doce sem gergelim-tostado",
      [...conflictingUnits, nominal("creme doce", 65)]],
    ["dono ausente", "2 medidas-caseiras de bolinho sem gergelim-tostado", conflictingUnits],
    ["dono concorrente", "2 medidas-caseiras de crepe sem gergelim-tostado",
      [...conflictingUnits, nominal("crepe", 65)]],
    ["alvo ausente", "2 medidas-caseiras de crepe sem orégano", conflictingUnits],
    ["alvo concorrente", "2 medidas-caseiras de crepe sem gergelim-tostado",
      [...conflictingUnits, nominal("gergelim-tostado", 65)]],
    ["coordenação", "2 medidas-caseiras de crepe sem gergelim-tostado e limão", conflictingUnits],
    ["framing", "não comi 2 medidas-caseiras de crepe sem gergelim-tostado", conflictingUnits],
    ["sem ligado por hífen", "2 medidas-caseiras de crepe sem-gergelim-tostado", conflictingUnits],
    ["mesma unidade duplicada", "2 medidas-caseiras de crepe sem gergelim-tostado",
      [serving(63, "copo"), serving(64, "copo")]],
    ["candidato único sob clarificação", "2 medidas-caseiras de crepe sem gergelim-tostado",
      [serving(63, "copo", { requiresClarification: true })]],
    ["segunda unidade ainda depende de clarificação", "2 medidas-caseiras de crepe sem gergelim-tostado",
      [serving(63, "copo"), serving(64, "fatia", { requiresClarification: true })]],
    ["alvo de unidade inválido ao lado de candidato real", "2 medidas-caseiras de crepe sem gergelim-tostado",
      [serving(63, "copo"), serving(64, "unidade-que-não-existe")]],
    ["tipo de alvo fora do slot de unidade", "2 medidas-caseiras de crepe sem gergelim-tostado",
      [serving(63, "copo"), serving(64, "fatia", { targetType: "food_variant" })]],
    ["alias expirado", "2 medidas-caseiras de crepe sem gergelim-tostado",
      [serving(63, "copo", { validTo: "2026-11-20T00:00:00Z" })]],
    ["alias revogado", "2 medidas-caseiras de crepe sem gergelim-tostado",
      [serving(63, "copo", { status: "revoked" })]],
    ["medida terminal descontínua", "2 medidas-caseiras de crepe e meia sem gergelim-tostado", conflictingUnits],
    ["sem espaço para a hipótese nominal", "2 medidas-caseiras de crepe sem gergelim-tostado",
      Array.from({ length: FOOD_CONTRACT_LIMITS.alternatives }, (_, i) => serving(70 + i, i === 0 ? "copo" : "fatia"))],
  ] as const)("mantém abstenção e irmão fora do recorte: %s", async (_label, clause, units) => {
    const request = input(clause + "; 2 uvas");
    const result = await comprehendFoodMaterialLanguage(request, { load: async () => [...independentRoles, ...units] });
    if (result.ok || result.reason !== "unproven-material") throw new Error("ambiguous owner escaped the slot boundary");
    expect(result.affected[0].surfaceSpan.span?.start).toBe(0);
    expect(result.observations.map(o => [o.identityHints.foodName, o.quantityHints.value, o.materialClaims]))
      .toEqual([["uvas", 2, []]]);
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
