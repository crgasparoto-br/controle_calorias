import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  comprehendFoodLanguage, comprehendFoodMaterialLanguage, diagnoseFoodMaterialPendingIncrements,
  type GovernedLexiconEntry, type LinguisticRequest,
} from "./linguisticComprehension";
import { FOOD_CONTRACT_LIMITS } from "./contracts";
import { parseFoodMaterialObservationBatch } from "./schemas";
import { compareSealedC1bReservedStudy } from "./corpus/semanticConservation1341.reserved.test.support";

const store = { load: async () => [] };
const request = (rawText: string, modality: "text" | "audio_transcript" = "text"): LinguisticRequest => ({
  rawText, modality, sourceRef: "public:pending-increment", locale: "pt-BR",
  lexiconRevision: "authored-local", ownerUserId: null, now: new Date("2026-11-25T00:00:00Z"),
  ...(modality === "audio_transcript" ? { transcriptionConfidence: 0.67 } : {}),
});
const lexical = (id: number, term: string, extra: Partial<GovernedLexiconEntry>): GovernedLexiconEntry => ({
  id, term, normalizedTerm: term.toLowerCase(), kind: "protected_token", targetType: "none", targetRef: null,
  scope: "global", userId: null, source: null, status: "verified", locale: "pt-BR", confidence: null,
  requiresClarification: false, current: true, validFrom: null, validTo: null, ...extra,
});

describe("perfil opt-in R3: evidência de incremento exclusivamente pendente", () => {
  it.each(["text", "audio_transcript"] as const)("guarda apenas a evidência local em affected (%s)", async modality => {
    const raw = "🥑 4 fatias de manga; MAiS\t4 fatias\r\n5 pitangas";
    const input = request(raw, modality);
    const residual = vi.fn(() => true);
    input.shouldInterpretResidual = residual;
    const result = await diagnoseFoodMaterialPendingIncrements(input, store);
    expect(result.diagnosticProfile).toBe("r3-pending-increment-v1");
    if (result.ok || result.reason !== "unproven-material") throw new Error("expected explicit pending");
    expect(residual).not.toHaveBeenCalled();
    expect(result.affected).toHaveLength(1);
    expect(result.observations.map(x => [x.identityHints.foodName, x.quantityHints.value, x.materialClaims]))
      .toEqual([["manga", 4, []], ["pitangas", 5, []]]);
    const [affected] = result.affected;
    const nested = affected.pendingObservation;
    if (!nested) throw new Error("expected canonical pending observation");
    expect(nested.observationId).toBe(affected.observationId);
    expect(nested.surfaceSpan).toEqual(affected.surfaceSpan);
    expect(result.observations.some(x => x.observationId === nested.observationId)).toBe(false);
    expect(nested).toMatchObject({
      schemaVersion: 3, rawInput: raw, modality, normalizedInput: null,
      identityHints: { foodName: null, brand: null, variant: null, preparation: [], qualifiers: [], barcode: null },
      quantityHints: { value: null, unit: null, servingText: null, visiblePackageQuantity: null, visiblePackageUnit: null },
      alternatives: [], normalizationPath: [],
    });
    expect(nested.materialClaims).toHaveLength(1);
    const [claim] = nested.materialClaims;
    if (claim.kind !== "increment") throw new Error("wrong claim");
    expect(claim).toMatchObject({
      binding: { status: "unresolved", reason: "owner_unknown", candidateObservationIds: [] },
      ingredient: null, target: null, unresolvedAmount: { value: 4, unit: "fatia" },
    });
    const op = raw.indexOf("MAiS"), amount = op + "MAiS\t".length;
    expect(nested.evidence.map(item => [
      item.evidenceId, item.field, item.value, item.unit, item.anchor.span, item.origin, item.confidence,
    ])).toEqual([
      [claim.operatorEvidenceId, "material.increment", "MAiS", null, { start: op, end: op + 4 },
        modality === "text" ? "text" : "transcription", input.transcriptionConfidence ?? null],
      [claim.unresolvedAmount!.evidenceId, "material.amount", 4, "fatia", { start: amount, end: amount + 8 },
        modality === "text" ? "text" : "transcription", input.transcriptionConfidence ?? null],
    ]);
    expect(nested.evidence.every(e => e.anchor.sourceRef === input.sourceRef && !e.verified && e.sourceId === null)).toBe(true);
    expect(parseFoodMaterialObservationBatch([...result.observations, nested]).ok).toBe(true);

    const historical = await comprehendFoodMaterialLanguage(input, store);
    expect(historical).toEqual({ ok: false, reason: "unproven-material",
      observations: result.observations, affected: [{ observationId: affected.observationId, surfaceSpan: affected.surfaceSpan }] });
    const r2 = await comprehendFoodLanguage({ ...input, shouldInterpretResidual: undefined }, store);
    expect(r2.every(row => row.schemaVersion === 2 && !("materialClaims" in row))).toBe(true);
  });

  it.each([
    "mais", "mais 4", "mais 0 fatias", "mais 4 esferas", "mais 2 a 4 fatias",
    "mais 3 ou 4 fatias", "mais 3–4 fatias", "mais 4 fatias ou 5 fatias",
    "mais 4 fatias (talvez)", "mais 4 fatias aproximadamente",
    "mais 4 fatias de", "mais 4 fatias de manga", "mais 4 fatias manga",
    "mais, 4 fatias", "mais-4 fatias", "“mais 4 fatias”", "maiſ 4 fatias", "mais\n4 fatias",
    "4 fatias de manga, mais 4 fatias", "mais 4 fatias, 5 pitangas",
    "melão mais maduro", "Adicionar mais 4 fatias", "mais ou menos 4 fatias",
  ])("não cria prova fora do escopo: %j", async raw => {
    const input = request(raw);
    const previous = await comprehendFoodMaterialLanguage(input, store);
    const result = await diagnoseFoodMaterialPendingIncrements(input, store);
    const { diagnosticProfile, ...same } = result;
    expect(diagnosticProfile).toBe("r3-pending-increment-v1");
    expect(same).toEqual(previous);
  });

  it.each(["\n", "\r\n", "\n\n"] as const)("não tipa a medida se a linha seguinte pode começar a cauda %j", async gap => {
    const input = request("mais 4 fatias" + gap + "De jaca; 5 pitangas");
    const previous = await comprehendFoodMaterialLanguage(input, store);
    const result = await diagnoseFoodMaterialPendingIncrements(input, store);
    const { diagnosticProfile: _profile, ...unchanged } = result;
    expect(unchanged).toEqual(previous);
    if (result.ok || result.reason !== "unproven-material") throw new Error("expected untyped pending");
    expect(result.affected.every(row => !row.pendingObservation)).toBe(true);
    expect(result.observations.every(row => row.materialClaims.length === 0)).toBe(true);
    expect(result.observations.some(row => row.identityHints.foodName === "pitangas")).toBe(true);
  });

  it.each(["\ndesde cedo; 5 pitangas", "; de jaca; 5 pitangas"])(
    "não trata outro token ou ponto e vírgula como continuação: %j", async tail => {
      const result = await diagnoseFoodMaterialPendingIncrements(request("mais 4 fatias" + tail), store);
      if (result.ok || result.reason !== "unproven-material") throw new Error("expected explicit pending");
      expect(result.affected.map(row => row.pendingObservation?.materialClaims[0].kind)).toEqual(["increment"]);
      expect(result.observations.some(row => row.identityHints.foodName === "pitangas")).toBe(true);
    });

  it("respeita léxico protegido, não converte unidades nem resolve disputa de dois candidatos", async () => {
    const protection = lexical(10, "Manga Mais Fresca", {});
    const title = await diagnoseFoodMaterialPendingIncrements(request("Manga Mais Fresca"), { load: async () => [protection] });
    expect(title).toMatchObject({ ok: true, observations: [{ identityHints: { foodName: "manga mais fresca" }, materialClaims: [] }] });
    const fullName = request("Mais 3 fatias");
    const exactAlias = { load: async () => [lexical(13, fullName.rawText, { kind: "alias_surface",
      targetType: "food_variant", targetRef: "public-title" })] };
    const { diagnosticProfile, ...exact } = await diagnoseFoodMaterialPendingIncrements(fullName, exactAlias);
    expect(diagnosticProfile).toBe("r3-pending-increment-v1");
    expect(exact).toEqual(await comprehendFoodMaterialLanguage(fullName, exactAlias));
    const disputed = await diagnoseFoodMaterialPendingIncrements(request("mais 3 medidas"), { load: async () => [
      lexical(11, "medidas", { kind: "unit_term", targetType: "canonical_term", targetRef: "copo" }),
      lexical(12, "medidas", { kind: "portion_term", targetType: "canonical_term", targetRef: "fatia" }),
    ] });
    expect(disputed).toMatchObject({ ok: false, reason: "unproven-material", observations: [] });
    if (disputed.ok || disputed.reason !== "unproven-material") throw new Error("expected untyped pending");
    expect(disputed.affected.every(x => !x.pendingObservation)).toBe(true);
    const aliasOnly = { load: async () => [
      lexical(11, "medidas", { kind: "unit_term", targetType: "canonical_term", targetRef: "copo" }),
    ] };
    const customInput = request("mais 3 medidas");
    const { diagnosticProfile: _profile, ...custom } = await diagnoseFoodMaterialPendingIncrements(customInput, aliasOnly);
    expect(custom).toEqual(await comprehendFoodMaterialLanguage(customInput, aliasOnly));
    const observed = await diagnoseFoodMaterialPendingIncrements(request("mais 2 kg"), store);
    if (observed.ok || observed.reason !== "unproven-material") throw new Error("expected explicit measure");
    expect(observed.affected[0].pendingObservation?.evidence.map(x => [x.field, x.value, x.unit]))
      .toEqual([["material.increment", "mais", null], ["material.amount", 2, "kg"]]);
  });

  it("mantém o dialeto novo fora do preflight legado sem abrir rótulos", async () => {
    const id = "a".repeat(32), studyId = "b".repeat(32), runId = "c".repeat(32);
    const parserSha = "d".repeat(40), comparatorSha = "e".repeat(40);
    const input = { ...request("mais 4 fatias"), sourceRef: "c1b:" + id, lexiconRevision: "c1b-empty-s2" };
    const json = (x: unknown) => Buffer.from(JSON.stringify(x));
    const digest = (x: Uint8Array) => createHash("sha256").update(x).digest("hex");
    const inputs = json([{ id, text: input.rawText, modality: input.modality,
      split: "holdout", semanticGroup: "1".repeat(32) }]);
    const manifest = json({ schemaVersion: 1, studyId, parserSha, comparatorSha,
      lexiconRevision: input.lexiconRevision, inputsSha256: digest(inputs), labelsSha256: "3".repeat(64), caseCount: 1 });
    const result = await diagnoseFoodMaterialPendingIncrements(input, store);
    const readLabels = vi.fn(() => { throw new Error("public-sentinel"); });
    const inspect = (capture: unknown) => {
      const outputs = json([{ id, result: capture }]);
      const receipt = json({ schemaVersion: 1, studyId, runId, parserSha, manifestSha256: digest(manifest),
        outputsSha256: digest(outputs) });
      return compareSealedC1bReservedStudy({ inputs, outputs, manifest, receipt, parserCheckoutSha: parserSha,
        comparatorCheckoutSha: comparatorSha, expectedRunId: runId, pinnedManifestSha256: digest(manifest),
        pinnedReceiptSha256: digest(receipt), readLabels });
    };
    expect(() => inspect(result)).toThrow("outputs-invalid-shape");
    const { diagnosticProfile: _profile, ...notLegacy } = result;
    expect(() => inspect(notLegacy)).toThrow("outputs-invalid-shape");
    expect(readLabels).not.toHaveBeenCalled();
    const legacy = await comprehendFoodMaterialLanguage(input, store);
    expect(() => inspect(legacy)).toThrow("public-sentinel");
    expect(readLabels).toHaveBeenCalledTimes(1);
  });

  it("propaga falhas técnicas e conta o trecho pendente no orçamento", async () => {
    const error = new Error("synthetic-lexicon-unavailable");
    const load = vi.fn(async () => { throw error; });
    await expect(diagnoseFoodMaterialPendingIncrements(request("mais 2 fatias"), { load })).rejects.toBe(error);
    await expect(diagnoseFoodMaterialPendingIncrements(request(""), { load })).rejects.toThrow("invalid-linguistic-input");
    expect(load).toHaveBeenCalledTimes(1);
    await expect(diagnoseFoodMaterialPendingIncrements(
      request("mais 2 fatias;" + "x".repeat(FOOD_CONTRACT_LIMITS.nameText + 1)), store,
    )).rejects.toThrow("invalid-food-observation:invalid-contract");
    const exceeds = "mais 2 fatias;" + Array(FOOD_CONTRACT_LIMITS.observations).fill("4 uvas").join(";");
    await expect(diagnoseFoodMaterialPendingIncrements(request(exceeds), store)).rejects.toThrow("linguistic-observation-limit");
  });
});
