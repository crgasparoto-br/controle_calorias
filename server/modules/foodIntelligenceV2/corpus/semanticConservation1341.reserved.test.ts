import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { comprehendFoodMaterialLanguage, type FoodMaterialLanguageResult } from "../linguisticComprehension";
import type { C1bCase } from "./semanticConservation1341.test.fixture";
import { compareSealedC1bReservedStudy, verifiedC1bReservedInputs } from "./semanticConservation1341.reserved.test.support";

const idA = "a".repeat(32);
const idB = "b".repeat(32);
const groupA = "c".repeat(32);
const groupB = "d".repeat(32);
const parserSha = "a".repeat(40);
const comparatorSha = "b".repeat(40);
const runId = "e".repeat(32);
const json = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8");
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const inputs: Omit<C1bCase, "facts">[] = [
  { id: idA, semanticGroup: groupA, split: "calibration", modality: "text", text: "  2 ovos  " },
  { id: idB, semanticGroup: groupB, split: "holdout", modality: "text", text: "3 peras" },
];
const labels = [
  { id: idA, facts: [{ kind: "food-quantity", owner: "ovos", quantity: 2, unit: "un", scope: "2 ovos", surface: "2 ovos", ingredient: null }] },
  { id: idB, facts: [{ kind: "food-quantity", owner: "peras", quantity: 3, unit: "un", scope: "3 peras", surface: "3 peras", ingredient: null }] },
];
const unavailable = { ok: false, reason: "unsupported-input" } as const;
function sealed(options: {
  inputRows?: readonly unknown[];
  labelRows?: readonly unknown[];
  outputRows?: readonly unknown[];
  alterReceipt?: Record<string, unknown>;
} = {}) {
  const inputBytes = json(options.inputRows ?? inputs);
  const labelBytes = json({ nonce: "5".repeat(64), rows: options.labelRows ?? labels });
  const outputs = json(options.outputRows ?? [{ id: idB, result: unavailable }, { id: idA, result: unavailable }]);
  const manifest = json({
    schemaVersion: 1, studyId: "f".repeat(32), parserSha, comparatorSha,
    lexiconRevision: "c1b-empty-s2", inputsSha256: digest(inputBytes),
    labelsSha256: digest(labelBytes), caseCount: 2,
  });
  const pinnedManifestSha256 = digest(manifest);
  const receipt = json({
    schemaVersion: 1, studyId: "f".repeat(32), runId, parserSha,
    manifestSha256: pinnedManifestSha256, outputsSha256: digest(outputs),
    ...options.alterReceipt,
  });
  const readLabels = vi.fn(() => labelBytes);
  return {
    inputs: inputBytes, manifest, pinnedManifestSha256, parserCheckoutSha: parserSha,
    outputs, receipt, pinnedReceiptSha256: digest(receipt), comparatorCheckoutSha: comparatorSha,
    expectedRunId: runId, readLabels,
  };
}

it("separa a entrada do gabarito e junta por ID sem normalizar a fonte", async () => {
  const config = sealed();
  const work = verifiedC1bReservedInputs(config);
  expect(config.readLabels).not.toHaveBeenCalled();
  expect(work).toStrictEqual([
    { id: idA, rawText: "  2 ovos  ", modality: "text", sourceRef: "c1b:" + idA },
    { id: idB, rawText: "3 peras", modality: "text", sourceRef: "c1b:" + idB },
  ]);
  const outputRows: { id: string; result: FoodMaterialLanguageResult }[] = await Promise.all(
    work.map(async ({ id, ...entry }) => ({
      id,
      result: await comprehendFoodMaterialLanguage({
        ...entry, ownerUserId: null, lexiconRevision: "c1b-empty-s2",
        now: new Date("2026-11-24T12:00:00Z"),
      }, { load: async () => [] }),
    }))
  );
  // Public synthetic witness only: custody and independently recorded pins
  // are requirements of a real study, not things this test can establish.
  const evaluation = sealed({ outputRows: outputRows.reverse(), labelRows: labels.slice().reverse() });
  const report = compareSealedC1bReservedStudy(evaluation);
  expect(evaluation.readLabels).toHaveBeenCalledOnce();
  expect(report).toHaveProperty("authority", "diagnostic-only");
  expect(report.rows.map(row => [row.caseId, row.group, row.split, row.findings[0].status]))
    .toStrictEqual([[idA, groupA, "calibration", "verified"], [idB, groupB, "holdout", "verified"]]);
  expect(report).not.toHaveProperty("promote");
});

it.each([
  ["manifest", { manifest: json({}) }, "manifest-digest-mismatch"],
  ["inputs", { inputs: json([]) }, "inputs-digest-mismatch"],
  ["receipt", { receipt: json({}) }, "receipt-digest-mismatch"],
  ["outputs", { outputs: json([]) }, "outputs-digest-mismatch"],
  ["parser", { parserCheckoutSha: "e".repeat(40) }, "parser-checkout-mismatch"],
  ["comparator", { comparatorCheckoutSha: "e".repeat(40) }, "comparator-checkout-mismatch"],
  ["run", { expectedRunId: "1".repeat(32) }, "receipt-identity-mismatch"],
] as const)("nega %s alterado antes de ler rótulos", (_, change, error) => {
  const config = sealed();
  expect(() => compareSealedC1bReservedStudy({ ...config, ...change })).toThrow(error);
  expect(config.readLabels).not.toHaveBeenCalled();
});

it.each([
  [[inputs[0], { ...inputs[1], id: idA }], "inputs-duplicate-id"],
  [[inputs[0], { ...inputs[1], semanticGroup: groupA }], "group-crosses-splits"],
  [[inputs[0], { ...inputs[1], text: "2  ovos", modality: "audio_transcript" }], "same-surface-crosses-groups"],
  [[inputs[0], { ...inputs[1], text: "2  ovos", semanticGroup: groupA, split: "calibration" }], "duplicate-input-surface"],
] as const)("nega entrada duplicada ou grupo em duas partições (%j)", (inputRows, error) => {
  const config = sealed({ inputRows });
  expect(() => verifiedC1bReservedInputs(config)).toThrow(error);
  expect(() => compareSealedC1bReservedStudy(config)).toThrow(error);
  expect(config.readLabels).not.toHaveBeenCalled();
});

it.each([
  [[{ id: idA, result: unavailable }, { id: idA, result: unavailable }], "outputs-duplicate-id"],
  [[{ id: idA, result: unavailable }, { id: "1".repeat(32), result: unavailable }], "outputs-ids-do-not-pair"],
  [[{ id: idA, result: unavailable }], "outputs-ids-do-not-pair"],
  [[{ id: idA, result: { ...unavailable, promote: true } }, { id: idB, result: unavailable }], "outputs-invalid-shape"],
] as const)("nega captura sem par, duplicada ou com instrução de promoção (%j)", (outputRows, error) => {
  const config = sealed({ outputRows });
  expect(() => compareSealedC1bReservedStudy(config)).toThrow(error);
  expect(config.readLabels).not.toHaveBeenCalled();
});

it.each([
  [[labels[0], { ...labels[1], id: idA }], "labels-duplicate-id"],
  [[labels[0], { ...labels[1], id: "1".repeat(32) }], "labels-ids-do-not-pair"],
  [[labels[0]], "labels-ids-do-not-pair"],
] as const)("nega rótulo sem par ou duplicado depois de verificar a captura (%j)", (labelRows, error) => {
  const config = sealed({ labelRows });
  expect(() => compareSealedC1bReservedStudy(config)).toThrow(error);
  expect(config.readLabels).toHaveBeenCalledOnce();
});

it("nega troca de gabarito mesmo com captura e recibo válidos", () => {
  const config = sealed();
  config.readLabels.mockReturnValue(json({ nonce: "5".repeat(64), rows: labels.slice().reverse() }));
  expect(() => compareSealedC1bReservedStudy(config)).toThrow("labels-digest-mismatch");
  expect(config.readLabels).toHaveBeenCalledOnce();
});

it("não aceita recibo válido por hash mas atribuído a outro estudo ou parser", () => {
  for (const alterReceipt of [
    { studyId: "0".repeat(32) },
    { parserSha: "0".repeat(40) },
    { manifestSha256: "0".repeat(64) },
  ]) {
    const config = sealed({ alterReceipt });
    expect(() => compareSealedC1bReservedStudy(config)).toThrow("receipt-identity-mismatch");
    expect(config.readLabels).not.toHaveBeenCalled();
  }
});

const anchoredAffected = {
  observationId: "synthetic-affected",
  surfaceSpan: { sourceRef: "c1b:" + idA, span: { start: 2, end: 8 }, region: null },
};
const unproven = {
  ok: false, reason: "unproven-material", observations: [], affected: [anchoredAffected],
} as const;
it.each([
  [{ ok: true, observations: [{}] }, "outputs-invalid-r3-batch"],
  [{ ...unproven, observations: [{ observationId: "x", schemaVersion: 2 }] }, "outputs-invalid-r3-batch"],
  [{ ...unproven, affected: [] }, "outputs-invalid-shape"],
  [{ ...unproven, affected: [{
    ...anchoredAffected,
    surfaceSpan: { ...anchoredAffected.surfaceSpan, sourceRef: "c1b:" + idB },
  }] }, "outputs-invalid-affected"],
  [{ ...unproven, affected: [{
    ...anchoredAffected,
    surfaceSpan: { ...anchoredAffected.surfaceSpan, span: { start: 2, end: 99 } },
  }] }, "outputs-invalid-affected"],
  [{ ...unproven, affected: [anchoredAffected, anchoredAffected] }, "outputs-invalid-affected"],
] as const)("não abre gabarito para captura malformada com recibo válido (%j)", (result, error) => {
  const config = sealed({ outputRows: [{ id: idA, result }, { id: idB, result: unavailable }] });
  expect(() => compareSealedC1bReservedStudy(config)).toThrow("c1b-reserved-study:" + error);
  expect(config.readLabels).not.toHaveBeenCalled();
});

it("preserva abstenção válida no escopo da fonte sem promovê-la", () => {
  const config = sealed({ outputRows: [{ id: idA, result: unproven }, { id: idB, result: unavailable }] });
  const report = compareSealedC1bReservedStudy(config);
  expect(config.readLabels).toHaveBeenCalledOnce();
  expect(report.rows[0]).toMatchObject({
    authority: "diagnostic-only", diagnosticBatchComplete: false,
    findings: [{ status: "abstained" }],
  });
});
