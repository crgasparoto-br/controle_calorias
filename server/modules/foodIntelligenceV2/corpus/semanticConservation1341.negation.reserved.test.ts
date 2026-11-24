import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { comprehendFoodMaterialLanguage, type FoodMaterialLanguageResult } from "../linguisticComprehension";
import type { FoodMaterialObservation } from "../schemas";
import { compareSealedR3NegationStudy } from "./semanticConservation1341.negation.reserved.test.support";
import { verifiedR3NegationStudyInputs } from "./semanticConservation1341.reserved.test.support";

const id = "1".repeat(32), studyId = "2".repeat(32), runId = "3".repeat(32);
const parserSha = "a".repeat(40), comparatorSha = "b".repeat(40);
const lexiconRevision = "public-unit-lexicon";
const raw = "🥣 4 damascos; 2 beijus SEM anis; 3 beijus sem anis";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const range = (start: number, end: number) => ({ start, end });
const sourceRef = "c1b:" + id;
const position = (snippet: string, after = 0) => {
  const start = raw.indexOf(snippet, after);
  if (start < 0) throw new Error("bad authored test anchor");
  return range(start, start + snippet.length);
};
const anchor = (span: { start: number; end: number }) => ({ sourceRef, span, region: null });
const entries = [{ id, text: raw, modality: "text", split: "holdout", semanticGroup: "4".repeat(32) }];

/** Authored labels describe observations and source intervals, not parser output. */
function answer() {
  return { nonce: "e".repeat(64), rows: [{
    id, expectedStatus: "linked", forbiddenFoodNames: ["anis"],
    negations: [
      { owner: { name: range(17, 23), nameHint: "beijus", scope: range(15, 32),
        wholeAmount: { value: 2, unit: "un", measure: range(15, 16) } },
        operator: range(24, 27), ingredient: range(28, 32) },
      { owner: { name: range(36, 42), nameHint: "beijus", scope: range(34, 51),
        wholeAmount: { value: 3, unit: "un", measure: range(34, 35) } },
        operator: range(43, 46), ingredient: range(47, 51) },
    ],
    unaffected: [{ name: range(5, 13), nameHint: "damascos", scope: range(0, 13),
      wholeAmount: { value: 4, unit: "un", measure: range(3, 4) } }],
    affected: [] as ReturnType<typeof range>[],
  }] };
}

function capturedRow(
  tag: string, surface: string, name: string, quantity: number, operator?: "SEM" | "sem",
): FoodMaterialObservation {
  const scope = position(surface);
  const nameAt = position(name, scope.start), amountAt = position(String(quantity), scope.start);
  const proof = { origin: "text", confidence: null, verified: false, sourceId: null } as const;
  const evidence: FoodMaterialObservation["evidence"] = [
    { ...proof, evidenceId: tag + ":name", field: "identity.foodName", unit: null, value: name, anchor: anchor(nameAt) },
    { ...proof, evidenceId: tag + ":count", field: "quantity.value", unit: "un", value: quantity, anchor: anchor(amountAt) },
  ];
  const materialClaims: FoodMaterialObservation["materialClaims"] = [];
  if (operator) {
    const opAt = position(operator, scope.start);
    evidence.push(
      { ...proof, evidenceId: tag + ":op", field: "material.negation", unit: null, value: operator, anchor: anchor(opAt) },
      { ...proof, evidenceId: tag + ":target", field: "material.ingredient", unit: null, value: "anis",
        anchor: anchor(position("anis", opAt.end)) });
    materialClaims.push({
      claimId: tag + ":claim", kind: "negation", binding: { status: "bound", ownerObservationId: tag },
      ingredient: { name: "anis", evidenceId: tag + ":target" }, operatorEvidenceId: tag + ":op",
    });
  }
  return {
    schemaVersion: 3, observationId: tag, rawInput: raw, normalizedInput: name,
    surfaceSpan: anchor(scope), modality: "text",
    locale: { status: "explicit", requested: "pt-BR", effective: "pt-BR" },
    identityHints: { foodName: name, brand: null, variant: null, preparation: [], qualifiers: [], barcode: null },
    quantityHints: { value: quantity, unit: "un", servingText: String(quantity),
      visiblePackageQuantity: null, visiblePackageUnit: null },
    evidence, materialClaims, normalizationPath: [], alternatives: [],
    unresolvedReason: "unknown_surface", lexiconRevision, interpreterVersion: null,
  };
}

function capture() {
  // Capture order deliberately differs from source order; labels are static.
  return [
    capturedRow("last", "3 beijus sem anis", "beijus", 3, "sem"),
    capturedRow("sibling", "🥣 4 damascos", "damascos", 4),
    capturedRow("first", "2 beijus SEM anis", "beijus", 2, "SEM"),
  ];
}
const lexicon = ["beijus", "anis"].map((term, i) => ({
  id: i + 1, term, normalizedTerm: term, kind: "alias_surface" as const,
  targetType: "food_variant" as const, targetRef: "public-fixture-" + i,
  scope: "global" as const, userId: null, source: null, status: "verified" as const,
  locale: "pt-BR", confidence: null, requiresClarification: false,
  current: true, validFrom: null, validTo: null,
}));

function seal(options: {
  result?: FoodMaterialLanguageResult;
  label?: unknown;
  input?: unknown;
  outputs?: unknown;
  parser?: string;
  comparator?: string;
  run?: string;
} = {}) {
  const lexiconSnapshot = bytes(lexicon);
  const inputs = bytes(options.input ?? entries);
  const outputs = bytes(options.outputs ?? [{ id, result: options.result ?? { ok: true, observations: capture() } }]);
  const labels = bytes(options.label ?? answer());
  const manifest = bytes({
    studyKind: "r3-negation-v1", schemaVersion: 1, studyId, parserSha: options.parser ?? parserSha,
    comparatorSha: options.comparator ?? comparatorSha, lexiconRevision,
    inputsSha256: sha(inputs), labelsSha256: sha(labels), lexiconSha256: sha(lexiconSnapshot), caseCount: 1,
  });
  const receipt = bytes({
    schemaVersion: 1, studyId, runId: options.run ?? runId, parserSha: options.parser ?? parserSha,
    manifestSha256: sha(manifest), outputsSha256: sha(outputs),
  });
  return {
    inputs, outputs, receipt, manifest, lexiconSnapshot,
    pinnedManifestSha256: sha(manifest), pinnedReceiptSha256: sha(receipt),
    parserCheckoutSha: parserSha, comparatorCheckoutSha: comparatorSha,
    expectedRunId: runId, readLabels: vi.fn(() => labels),
  };
}

describe("sealed R3 negation diagnostic (public synthetic fixtures)", () => {
  it("matches occurrences in UTF-16, not by order or repeated food names", () => {
    const sealed = seal();
    expect(verifiedR3NegationStudyInputs(sealed)).toEqual({
      lexiconRevision, inputs: [{ id, rawText: raw, modality: "text", sourceRef }],
    });
    expect(sealed.readLabels).not.toHaveBeenCalled();
    const r = compareSealedR3NegationStudy(sealed);
    expect(r).toMatchObject({ authority: "diagnostic-only", studyKind: "r3-negation-v1",
      totals: { cases: 1, expected: 3, verified: 3, abstained: 0, missing: 0, mismatch: 0, extras: 0,
        statusMismatches: 0, expectedNegations: 2, verifiedNegations: 2, expectedSiblings: 1, verifiedSiblings: 1 },
      bySplit: { holdout: { verified: 3 }, calibration: { verified: 0 } },
      byModality: { text: { verified: 3 }, audio_transcript: { verified: 0 } } });
    expect(sealed.readLabels).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(r)).not.toContain(raw);
    expect(r).not.toHaveProperty("rows");
  });

  it.each(["text", "audio_transcript"] as const)("compares the actual opt-in producer with a pinned public %s fixture", async mode => {
    const input = [{ ...entries[0], modality: mode }];
    const verified = verifiedR3NegationStudyInputs(seal({ input }));
    const [{ rawText, sourceRef, modality }] = verified.inputs;
    const result = await comprehendFoodMaterialLanguage({
      rawText, sourceRef, modality, locale: "pt-BR", ownerUserId: null,
      lexiconRevision: verified.lexiconRevision, now: new Date("2026-11-24T12:00:00Z"),
      ...(mode === "audio_transcript" ? { transcriptionConfidence: 0.71 } : {}),
    }, { load: async args => {
      expect(args.revision).toBe(lexiconRevision);
      return lexicon;
    } });
    const compared = compareSealedR3NegationStudy(seal({ result, input }));
    expect(compared.totals).toMatchObject({ verified: 3, mismatch: 0, missing: 0, extras: 0, statusMismatches: 0 });
    expect(compared.byModality[mode].verified).toBe(3);
  });

  it.each([
    ["quantity evidence with zero", (r: FoodMaterialObservation[]) => r[0].evidence.push({
      ...r[0].evidence[1], evidenceId: "zero", value: 0,
      anchor: r[0].evidence.find(e => e.field === "material.ingredient")!.anchor,
    }), { mismatch: 1 }],
    ["borrowed valid literal", (r: FoodMaterialObservation[]) => {
      const op = r[0].evidence.find(e => e.field === "material.negation")!;
      op.value = r[0].evidence[0].value;
      op.anchor = r[0].evidence[0].anchor;
    }, { mismatch: 1 }],
    ["amounts swapped between identically named owners", (r: FoodMaterialObservation[]) => {
      const a = r[0], b = r[2];
      [a.quantityHints.value, b.quantityHints.value] = [b.quantityHints.value, a.quantityHints.value];
      a.evidence[1].value = a.quantityHints.value;
      b.evidence[1].value = b.quantityHints.value;
    }, { mismatch: 2 }],
    ["different identity text", (r: FoodMaterialObservation[]) => {
      r[0].identityHints.foodName = "not-the-anchored-owner";
    }, { mismatch: 1 }],
    ["missing independent sibling", (r: FoodMaterialObservation[]) => { r.splice(1, 1); }, { missing: 1 }],
    ["erased negation", (r: FoodMaterialObservation[]) => {
      r[0].materialClaims = [];
      r[0].evidence = r[0].evidence.filter(e => !e.field.startsWith("material."));
    }, { mismatch: 1 }],
  ] as const)("detects %s without relying on the digest guard", (_name, mutate, count) => {
    const observations = capture();
    mutate(observations);
    const fixture = seal({ result: { ok: true, observations } });
    expect(compareSealedR3NegationStudy(fixture).totals).toMatchObject(count);
    expect(fixture.readLabels).toHaveBeenCalledTimes(1); // repinned wire-valid mutation
  });

  it("reports proved abstention separately from an undisclosed positive loss", () => {
    const label = answer();
    const [removed] = label.rows[0].negations.splice(1, 1);
    label.rows[0].expectedStatus = "abstain";
    label.rows[0].affected = [removed.owner.scope];
    const observations = capture().filter(row => row.observationId !== "last");
    const result = { ok: false, reason: "unproven-material", observations,
      affected: [{ observationId: "pending", surfaceSpan: anchor(removed.owner.scope) }] } as const;
    const r = compareSealedR3NegationStudy(seal({ label, result: { ...result, affected: [...result.affected] } }));
    expect(r.totals).toMatchObject({ expected: 3, verified: 2, abstained: 1, expectedAffected: 1, statusMismatches: 0, extras: 0 });
    const incorrectlyWithheld = compareSealedR3NegationStudy(seal({ result: { ...result, affected: [...result.affected] } }));
    expect(incorrectlyWithheld.totals).toMatchObject({ missing: 1, abstained: 0, statusMismatches: 1 });
  });

  it.each(["parser", "comparator", "receipt", "missing-id", "duplicate-id", "source", "owner", "origin", "swapped", "hash", "lexicon", "lexicon-revision", "utf16"] as const)(
    "does not request labels for invalid preflight %s", fault => {
      const result = { ok: true as const, observations: capture() };
      const rows = [{ id, result }];
      if (fault === "lexicon-revision") result.observations[0].lexiconRevision = "other-lexicon";
      if (fault === "utf16") result.observations[1].surfaceSpan.span!.start = 1;
      if (fault === "source") result.observations[0].surfaceSpan.sourceRef = "other-source";
      if (fault === "owner") result.observations[0].materialClaims[0].binding = { status: "bound", ownerObservationId: "sibling" };
      if (fault === "origin") result.observations[0].evidence[2].origin = "transcription";
      if (fault === "swapped") {
        const [op, target] = result.observations[0].evidence.slice(2);
        [op.anchor, target.anchor] = [target.anchor, op.anchor];
      }
      const sealed = seal({
        outputs: fault === "missing-id" ? [] : fault === "duplicate-id" ? [...rows, ...rows] : rows,
        ...(fault === "parser" ? { parser: "c".repeat(40) } : {}),
        ...(fault === "comparator" ? { comparator: "c".repeat(40) } : {}),
        ...(fault === "receipt" ? { run: "c".repeat(32) } : {}),
      });
      if (fault === "hash") sealed.outputs = bytes([]);
      if (fault === "lexicon") sealed.lexiconSnapshot = bytes([]);
      expect(() => compareSealedR3NegationStudy(sealed)).toThrow("c1b-reserved-study:");
      expect(sealed.readLabels).not.toHaveBeenCalled();
    }
  );

  it("verifies an explicitly unchanged sibling identity without crediting negation", () => {
    const label = answer();
    label.rows[0].negations = [];
    label.rows[0].expectedStatus = "unchanged-identity";
    const result = { ok: true as const, observations: capture().filter(row => row.observationId === "sibling") };
    expect(compareSealedR3NegationStudy(seal({ label, result })).totals)
      .toMatchObject({ expected: 1, verified: 1, abstained: 0, mismatch: 0, extras: 0 });
    expect(compareSealedR3NegationStudy(seal({ label })).totals.extras).toBe(2);
  });

  it("rejects invalid label UTF-16 after exactly one authenticated label read", () => {
    const label = answer();
    label.rows[0].unaffected[0].scope = range(1, 13); // splits the astral prefix
    const sealed = seal({ label });
    expect(() => compareSealedR3NegationStudy(sealed)).toThrow("invalid-label-reference");
    expect(sealed.readLabels).toHaveBeenCalledTimes(1);
  });

  it("checks label bytes before trying to parse", () => {
    const sealed = seal();
    sealed.readLabels.mockReturnValue(Buffer.from("not JSON"));
    expect(() => compareSealedR3NegationStudy(sealed)).toThrow("labels-digest-mismatch");
    expect(sealed.readLabels).toHaveBeenCalledTimes(1);
  });
});
