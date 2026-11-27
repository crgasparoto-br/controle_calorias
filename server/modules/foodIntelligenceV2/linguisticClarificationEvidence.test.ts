import { describe, expect, it } from "vitest";
import {
  diagnoseFoodMaterialClarificationEvidence,
  diagnoseFoodMaterialUnquantifiedIncrements,
  type GovernedLexiconEntry,
  type LinguisticRequest,
} from "./linguisticComprehension";
import {
  parseFoodMaterialClarificationObservationBatch,
  type FoodMaterialClarificationObservation,
} from "./schemas";

const request = (rawText: string): LinguisticRequest => ({
  rawText, sourceRef: "fixture:clarification-lcl", modality: "text",
  ownerUserId: null, lexiconRevision: "test-only:written-measure",
  now: new Date("2026-11-27T00:00:00Z"),
});
const lexicon = (entries: GovernedLexiconEntry[] = []) => ({
  load: async () => entries,
});
const tail = "com mais um pouco e mais um pouco";
const writtenTurn = (prefix: string) => "Café com 2 g de açúcar e " + prefix + " " + tail;

async function pending(raw: string, entries: GovernedLexiconEntry[] = []) {
  const input = request(raw);
  const result = await diagnoseFoodMaterialClarificationEvidence(input, lexicon(entries));
  if (result.ok || result.reason !== "unproven-material") throw new Error("expected typed pending result");
  return result.affected.flatMap(row => row.pendingObservation ? [row.pendingObservation] : []);
}

describe("slots locais de esclarecimento sem autoridade material", () => {
  it.each([
    ["35 ml de cacau", "35 ml", 35, "ml", "cacau"],
    ["15,5 g de jaca", "15,5 g", 15.5, "g", "jaca"],
    ["0015,50 g de jaca", "0015,50 g", 15.5, "g", "jaca"],
    ["0,25 KG de açai", "0,25 KG", 0.25, "kg", "açai"],
    ["14 ml de caju", "14 ml", 14, "ml", "caju"],
    ["14 ml", "14 ml", 14, "ml", null],
  ] as const)("pina o numeral e unidade da superfície de %s, sem conversão",
    async (prefix, literal, value, unit, nominal) => {
      const raw = "🍊; " + writtenTurn(prefix);
      const rows = await pending(raw);
      expect(rows).toHaveLength(2);
      expect(rows[0].clarificationEvidence?.measure).toMatchObject({
        literal, value, unit, anchor: { span: { start: raw.indexOf(literal), end: raw.indexOf(literal) + literal.length } },
      });
      expect(rows[0].clarificationEvidence?.writtenNominal?.literal ?? null).toBe(nominal);
      expect(rows[1].clarificationEvidence).toBeNull();
      expect(rows.every(row => row.quantityHints.value === null && row.identityHints.foodName === null)).toBe(true);
      expect(parseFoodMaterialClarificationObservationBatch(rows).ok).toBe(true);
    });

  it.each(["2 g de leite quente", "0 ml de leite", "1/2 g de leite", "20 gramas de leite",
    "2 ml de", "2 ml de ml", "35ml de cacau", "35 ml cacau",
    "2 ml de integral", "2 ml de tres", "2 g de da", "9007199254740993 ml de laranja",
    "15,500000000000000001 g de jaca"])("mantém a pendência sem ampliar o dialeto de evidência: %s", async prefix => {
    const input = request(writtenTurn(prefix));
    const before = await diagnoseFoodMaterialUnquantifiedIncrements(input, lexicon());
    const rows = await pending(input.rawText);
    expect(rows.every(row => row.clarificationEvidence === null)).toBe(true);
    if (before.ok || before.reason !== "unproven-material") throw new Error("expected previous pending");
    expect(rows.map(row => row.observationId)).toEqual(
      before.affected.flatMap(row => row.pendingObservation ? [row.observationId] : []),
    );
  });

  it("exige o relógio explícito do snapshot antes de ler o léxico", async () => {
    const input = request(writtenTurn("100 ml de leite"));
    const store = { load: async () => { throw new Error("must not read without clock"); } };
    for (const now of [undefined, new Date(NaN)]) {
      expect(await diagnoseFoodMaterialClarificationEvidence({ ...input, now }, store))
        .toEqual({ ok: false, reason: "unsupported-input" });
    }
  });

  it("um homônimo vigente no léxico retém a dúvida sem simular ausência de nome", async () => {
    const raw = writtenTurn("100 ml de leite");
    const unitAlias: GovernedLexiconEntry = {
      id: 77, term: "leite", normalizedTerm: "leite", kind: "unit_term",
      targetType: "canonical_term", targetRef: "copo", locale: "pt-BR",
      scope: "global", userId: null, source: "imported", status: "verified",
      confidence: 1, requiresClarification: false, current: true,
      validFrom: null, validTo: null,
    };
    const active = await pending(raw, [unitAlias]);
    const expired = await pending(raw, [{ ...unitAlias, validTo: request(raw).now! }]);
    expect(active).toHaveLength(2);
    expect(active[0].clarificationEvidence).toBeNull();
    expect(expired[0].clarificationEvidence?.writtenNominal?.literal).toBe("leite");
    const fixed = request(raw);
    const result = await diagnoseFoodMaterialClarificationEvidence(fixed, { load: async ({ now }) => {
      // Transport receives the pinned value, not a mutable reference to
      // the Date still used locally to arbitrate applicable rows.
      expect(now.getTime()).toBe(fixed.now!.getTime());
      now.setUTCFullYear(2030);
      return [{ ...unitAlias, validTo: new Date("2026-11-28T00:00:00Z") }];
    } });
    if (result.ok || result.reason !== "unproven-material") throw new Error("expected pending");
    expect(result.affected[0].pendingObservation?.clarificationEvidence).toBeNull();

  });
});

describe("R4 recusa evidência usada como autoridade", () => {
  it("recusa autoridade externa do operador, nome apagado e identidade sugerida no item", async () => {
    const [row] = await pending(writtenTurn("100 ml de leite"));
    expect(row.clarificationEvidence).not.toBeNull();
    const changes: ((item: FoodMaterialClarificationObservation) => void)[] = [
      item => { item.evidence[0].verified = true; },
      item => { item.evidence[0].sourceId = 50; },
      item => { item.clarificationEvidence!.writtenNominal = null; },
      item => { item.identityHints.brand = "inventada"; },
      item => { item.quantityHints.servingText = "reutilização"; },
      item => { item.clarificationEvidence!.operatorEvidenceId += ":wrong"; },
    ];
    for (const change of changes) {
      const clone = structuredClone(row);
      change(clone);
      expect(parseFoodMaterialClarificationObservationBatch([clone]).ok).toBe(false);
    }
  });

  it.each(["cada", "isso", "dele", "também", "talvez", "depois", "beber", "framboesa",
    "CÁJU", "inventadomo"])("não confunde uma palavra escrita com prova de papel nominal: %s", async token => {
    const [reference] = await pending(writtenTurn("100 ml de caju"));
    const proof = reference.clarificationEvidence;
    if (!proof?.writtenNominal?.anchor.span) throw new Error("expected positive witness");
    const rows = await pending(writtenTurn("100 ml de " + token));
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.clarificationEvidence === null)).toBe(true);
    expect(parseFoodMaterialClarificationObservationBatch(rows).ok).toBe(true);

    const [first, second] = rows;
    const start = proof.writtenNominal.anchor.span.start;
    const fabricated = {
      ...first,
      clarificationEvidence: {
        ...proof,
        operatorEvidenceId: first.evidence[0].evidenceId,
        writtenNominal: { literal: token, anchor: { ...proof.writtenNominal.anchor,
          span: { start, end: start + token.length },
        } },
      },
    };
    expect(parseFoodMaterialClarificationObservationBatch([fabricated, second]).ok).toBe(false);
    expect(parseFoodMaterialClarificationObservationBatch([
      { ...fabricated, clarificationEvidence: { ...fabricated.clarificationEvidence, writtenNominal: null } }, second,
    ]).ok).toBe(false);
  });

  it("a segunda observação não reutiliza as âncoras da primeira", async () => {
    const [first, second] = await pending(writtenTurn("100 ml de leite"));
    const transplanted = {
      ...second,
      clarificationEvidence: { ...first.clarificationEvidence!, operatorEvidenceId: second.evidence[0].evidenceId },
    };
    expect(parseFoodMaterialClarificationObservationBatch([first, transplanted]).ok).toBe(false);
  });
});
