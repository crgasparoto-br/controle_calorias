import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { compareSealedMaterialProof, preflightMaterialProofReference, prepareMaterialProofInputs } from "./semanticConservation1341.material-proof.test.support";

const pin = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
const text = "🫛 carambola com 2 g de cravo; tâmara";
const anchor = (token: string) => {
  const start = text.indexOf(token);
  if (start < 0) throw new Error("bad fixture anchor");
  return { start, end: start + token.length };
};
const facts = () => [
  { kind: "ingredient-measured", scope: anchor("🫛 carambola com 2 g de cravo"),
    owner: { name: anchor("carambola"), nameHint: "carambola", whole: { status: "absent" } },
    ingredient: anchor("cravo"), amount: { value: 2, unit: "g", measure: anchor("2 g") } },
  { kind: "independent-sibling", scope: anchor("tâmara"),
    owner: { name: anchor("tâmara"), nameHint: "tamara", whole: { status: "absent" } } },
];
const entries = () => ["text", "audio_transcript"].map((modality, i) =>
  ({ text, modality, id: (i + 1).toString().repeat(32), semanticGroup: "a".repeat(32), split: "calibration" }));
function fixture() {
  const inputs = entries();
  return { inputs, labels: { nonce: "b".repeat(64), rows: inputs.map(({ id }) => ({ id, facts: facts() })) },
    lexicon: [] as Record<string, unknown>[] };
}
function seal(data = fixture()) {
  const inputs = json(data.inputs), labels = json(data.labels), lexiconSnapshot = json(data.lexicon);
  const parserCheckoutSha = "c".repeat(40), comparatorCheckoutSha = "d".repeat(40);
  const adrSha256 = "e".repeat(64), lockfileSha256 = "f".repeat(64);
  const manifest = json({ profile: "r3-material-proof-v1", schemaVersion: 1, studyId: "9".repeat(32),
    parserSha: parserCheckoutSha, comparatorSha: comparatorCheckoutSha, adrSha256, lockfileSha256,
    lexiconRevision: "public-preflight-sample", lexiconSha256: pin(lexiconSnapshot),
    inputsSha256: pin(inputs), labelsSha256: pin(labels), caseCount: data.inputs.length });
  return { inputs, labels, lexiconSnapshot, manifest, pinnedManifestSha256: pin(manifest),
    parserCheckoutSha, comparatorCheckoutSha, adrSha256, lockfileSha256 };
}

describe("custodian reference preflight without a capture", () => {
  it("reuses reference validation and exposes counts, not labels or case identities", () => {
    expect(preflightMaterialProofReference(seal())).toEqual({
      caseCount: 2, families: { calibration: 1, holdout: 0 },
      cases: { "calibration/text": 1, "calibration/audio_transcript": 1 },
      casesByFactCount: { "calibration/text/2": 1, "calibration/audio_transcript/2": 1 },
      facts: { "calibration/text/ingredient-measured": 1, "calibration/text/independent-sibling": 1,
        "calibration/audio_transcript/ingredient-measured": 1, "calibration/audio_transcript/independent-sibling": 1 },
    });
  });

  it("rejects foreign comparator pins, byte substitution, and missing or duplicate coverage", () => {
    const config = seal();
    expect(() => preflightMaterialProofReference({ ...config, comparatorCheckoutSha: "0".repeat(40) }))
      .toThrow("comparator-checkout");
    expect(() => preflightMaterialProofReference({ ...config, labels: json({}) })).toThrow("labels-digest");
    const data = fixture();
    const removed = data.labels.rows.pop()!;
    expect(() => preflightMaterialProofReference(seal(data))).toThrow("labels-missing");
    data.labels.rows.push(data.labels.rows[0]);
    expect(() => preflightMaterialProofReference(seal(data))).toThrow("labels-duplicate");
    data.labels.rows[1] = { ...removed, id: "3".repeat(32) };
    expect(() => preflightMaterialProofReference(seal(data))).toThrow("labels-extra");
  });

  it("rejects authored, re-sealed references that split UTF-16 or borrow an anchor", () => {
    const data = fixture();
    data.labels.rows[0].facts[0].scope.start = 1; // between the surrogate halves
    expect(() => preflightMaterialProofReference(seal(data))).toThrow("label-scope");
    data.labels.rows[0].facts[0] = facts()[0];
    data.labels.rows[0].facts[0].ingredient = anchor("tâmara"); // literal exists, but belongs to sibling
    expect(() => preflightMaterialProofReference(seal(data))).toThrow("label-anchor");
  });

  it("rejects lexical role conflict even when the snapshot and label digests match", () => {
    const data = fixture();
    data.lexicon.push({ id: 1, kind: "unit_term", targetType: "canonical_term", targetRef: "g",
      normalizedTerm: "carambola", locale: "pt-BR", scope: "global", userId: null,
      status: "verified", current: true, requiresClarification: false, validFrom: null, validTo: null,
      confidence: null });
    expect(() => preflightMaterialProofReference(seal(data))).toThrow("label-nominal-unit-role");
  });

  it("enforces partition boundaries and keeps the runner blind to any label capability", () => {
    const data = fixture();
    data.inputs[1].split = "holdout";
    expect(() => preflightMaterialProofReference(seal(data))).toThrow("partition");
    const config = seal();
    const readLabels = vi.fn(() => { throw new Error("the runner must not access labels"); });
    Object.defineProperty(config, "labels", { get: readLabels });
    expect(prepareMaterialProofInputs(config).inputs.map(x => Object.keys(x))).toEqual(
      Array.from({ length: 2 }, () => ["id", "rawText", "modality", "sourceRef"]),
    );
    expect(readLabels).not.toHaveBeenCalled();
  });

  it("keeps the evaluator's label opening after the receipt precondition", () => {
    const { labels, ...config } = seal();
    const readLabels = vi.fn(() => labels);
    // Missing receipt and output are sentinels, not a fabricated capture.
    expect(() => compareSealedMaterialProof({ ...config, receipt: Buffer.alloc(0), outputs: Buffer.alloc(0),
      pinnedReceiptSha256: "0".repeat(64), expectedRunId: "1".repeat(32), readLabels })).toThrow("receipt-digest");
    expect(readLabels).not.toHaveBeenCalled();
  });

});
