import { describe, expect, it } from "vitest";
import {
  comprehendFoodMaterialLanguage,
  diagnoseFoodMaterialPendingIncrements,
  diagnoseFoodMaterialUnquantifiedIncrements,
  type LinguisticRequest,
} from "./linguisticComprehension";
import { parseFoodMaterialObservationBatch } from "./schemas";

const empty = { load: async () => [] };
const request = (rawText: string, modality: "text" | "audio_transcript"): LinguisticRequest => ({
  rawText, modality, sourceRef: "fixture:unquantified-increment", locale: "pt-BR",
  lexiconRevision: "c1b-empty-s2", ownerUserId: null,
  now: new Date("2026-11-26T00:00:00Z"),
});

describe("diagnóstico versionado de incremento sem quantidade", () => {
  it.each(["text", "audio_transcript"] as const)("tipa o acréscimo local sem inventar medida (%s)", async modality => {
    const raw = "🍐 2 fatias de pão com 3 g de canela; MAis\tUM pouco; 5 pitangas";
    const input = request(raw, modality);
    const old = await comprehendFoodMaterialLanguage(input, empty);
    const previous = await diagnoseFoodMaterialPendingIncrements(input, empty);
    const result = await diagnoseFoodMaterialUnquantifiedIncrements(input, empty);
    expect(result.diagnosticProfile).toBe("r3-pending-increment-v2");
    if (result.ok || result.reason !== "unproven-material" ||
        previous.ok || previous.reason !== "unproven-material") throw new Error("expected pending");
    expect(previous.affected.every(row => !row.pendingObservation)).toBe(true);
    expect(result.observations).toEqual(previous.observations);
    expect(result.observations.map(row => row.identityHints.foodName)).toEqual(["pao", "pitangas"]);
    expect(result.affected).toHaveLength(1);
    const affected = result.affected[0];
    const pending = affected.pendingObservation!;
    const start = raw.indexOf("MAis");
    expect(pending.observationId).toBe(affected.observationId);
    expect(pending.surfaceSpan).toEqual(affected.surfaceSpan);
    expect(pending.identityHints.foodName).toBeNull();
    expect(pending.quantityHints.value).toBeNull();
    expect(pending.materialClaims).toEqual([{
      kind: "increment", claimId: pending.materialClaims[0].claimId,
      target: null, ingredient: null, unresolvedAmount: null,
      operatorEvidenceId: pending.evidence[0].evidenceId,
      binding: { status: "unresolved", reason: "owner_unknown", candidateObservationIds: [] },
    }]);
    expect(pending.evidence.map(e => [e.field, e.value, e.anchor.span])).toEqual([
      ["material.increment", "MAis", { start, end: start + 4 }],
    ]);
    expect(parseFoodMaterialObservationBatch([...result.observations, pending]).ok).toBe(true);
    expect(old).toEqual({ ok: false, reason: "unproven-material", observations: result.observations,
      affected: result.affected.map(({ observationId, surfaceSpan }) => ({ observationId, surfaceSpan })) });
  });

  it.each(["mais um pouco de canela", "melão mais maduro", "mais ou menos",
    "maiſ um pouco", "mais um pouco\nDe jaca", "“mais um pouco”",
    "café com 3 g de açúcar ou mais um pouco",
    "café com 3 g de açúcar e leite sem mais um pouco",
    "café com 3 g de açúcar e leite com mais um pouco de canela",
    "Café ou chá e mais um pouco",
    "Café com 1 colher de chá de açúcar ou chá e leite com mais um pouco e mais um pouco.",
    "“Café e mais um pouco; disse a pessoa”",
    "“Café; mais um pouco; chá”",
    "\"Café; mais um pouco; chá\"",
    "‘Café; mais um pouco; chá’",
    "«Café; mais um pouco; chá»",
    "(Café; mais um pouco; chá)",
    "(Café; mais um pouco; chá",
    "Café sem chá e mais um pouco",
  ])("não cria um incremento sem autoridade: %s", async raw => {
    const input = request(raw, "text");
    const result = await diagnoseFoodMaterialUnquantifiedIncrements(input, empty);
    const previous = await diagnoseFoodMaterialPendingIncrements(input, empty);
    expect({ ...result, diagnosticProfile: previous.diagnosticProfile }).toEqual(previous);
  });

  it("prova duas ocorrências coordenadas sem mover a medida já vinculada", async () => {
    const raw = "Café com 1 colher de chá de açúcar e leite com mais um pouco e mais um pouco.";
    const input = request(raw, "text");
    const result = await diagnoseFoodMaterialUnquantifiedIncrements(input, empty);
    const before = await diagnoseFoodMaterialPendingIncrements(input, empty);
    if (result.ok || result.reason !== "unproven-material") throw new Error("expected pending");
    expect(result.observations).toEqual(before.observations);
    expect(result.observations.flatMap(x => x.materialClaims)).toMatchObject([
      { kind: "ingredient", amount: { value: 1, unit: "colher de chá" } },
    ]);
    const found = [...raw.matchAll(/mais/g)].map(m => ({ start: m.index, end: m.index + 4 }));
    expect(result.affected.map(x => x.pendingObservation?.evidence.map(e => e.anchor.span)))
      .toEqual(found.map(x => [x]));
    for (const row of result.affected) {
      expect(row.pendingObservation?.materialClaims).toMatchObject([
        { kind: "increment", unresolvedAmount: null, ingredient: null, target: null },
      ]);
    }
  });

  it.each(["text", "audio_transcript"] as const)(
    "preserva a mesma abstenção não tipada sob negação Unicode em %s", async modality => {
      const composed = "Não acrescente café e mais um pouco";
      for (const form of ["NFC", "NFD"] as const) {
        const input = request(composed.normalize(form), modality);
        const result = await diagnoseFoodMaterialUnquantifiedIncrements(input, empty);
        const previous = await diagnoseFoodMaterialPendingIncrements(input, empty);
        expect({ ...result, diagnosticProfile: previous.diagnosticProfile }).toEqual(previous);
      }
    });
  it("preserva o caso explícito do perfil anterior", async () => {
    const input = request("5 pitangas; mais 4 fatias", "text");
    const previous = await diagnoseFoodMaterialPendingIncrements(input, empty);
    const result = await diagnoseFoodMaterialUnquantifiedIncrements(input, empty);
    expect({ ...result, diagnosticProfile: previous.diagnosticProfile }).toEqual(previous);
  });
});
