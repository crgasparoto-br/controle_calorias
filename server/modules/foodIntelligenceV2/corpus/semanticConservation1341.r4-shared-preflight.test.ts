import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { diagnoseFoodMaterialClarificationEvidence, diagnoseFoodMaterialUnquantifiedIncrements, type GovernedLexiconEntry } from "../linguisticComprehension";
import { comparePublicClarificationProof, compareSealedUnquantifiedMaterialProof, verifyPublicClarificationCapture } from "./semanticConservation1341.material-proof.test.support";

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

it("uses existing sealed-proof pins before labels while admitting only public R4 captures", async () => {
  const id = "1".repeat(32), studyId = "2".repeat(32), runId = "3".repeat(32);
  const parserSha = "a".repeat(40), comparatorSha = "b".repeat(40);
  const adrSha256 = "c".repeat(64), lockfileSha256 = "d".repeat(64);
  const lexicalAtUtc = "2026-11-27T10:00:00.000Z", lexiconRevision = "public-shared-r4";
  const profile = "r4-clarification-public-proof-v1", text = "Café com 1 colher de chá de açúcar e 100 ml de caju com mais um pouco e mais um pouco.";
  const input = { id, text, modality: "text", split: "calibration", semanticGroup: "4".repeat(32) };
  const request = {
    rawText: text, modality: "text" as const, sourceRef: "c1b:" + id,
    lexiconRevision, ownerUserId: null, now: new Date(lexicalAtUtc),
  };
  const lexicon = { load: async () => [] };
  const [fresh, old] = await Promise.all([
    diagnoseFoodMaterialClarificationEvidence(request, lexicon),
    diagnoseFoodMaterialUnquantifiedIncrements(request, lexicon),
  ]);
  const readLabels = vi.fn(() => { throw Error("fixture must not open labels"); });
  function packet(result: unknown = fresh, meta = {}, inputChange = {}, receiptChange = {}, snapshot: unknown = []) {
    const inputBytes = bytes([{ ...input, ...inputChange }]);
    const lexiconSnapshot = bytes(snapshot), outputs = bytes([{ id, result }]);
    const manifest = bytes({ profile, schemaVersion: 1, studyId, parserSha, comparatorSha,
      adrSha256, lockfileSha256, lexicalAtUtc, lexiconRevision, lexiconSha256: digest(lexiconSnapshot),
      inputsSha256: digest(inputBytes), labelsSha256: "e".repeat(64), caseCount: 1, ...meta });
    const pinnedManifestSha256 = digest(manifest);
    const receipt = bytes({ profile, schemaVersion: 1, studyId, runId, parserSha, lexicalAtUtc,
      manifestSha256: pinnedManifestSha256, outputsSha256: digest(outputs), ...receiptChange });
    return { manifest, inputs: inputBytes, outputs, receipt, lexiconSnapshot, pinnedManifestSha256,
      pinnedReceiptSha256: digest(receipt), expectedRunId: runId, expectedLexicalAtUtc: lexicalAtUtc,
      parserCheckoutSha: parserSha, comparatorCheckoutSha: comparatorSha, adrSha256, lockfileSha256, readLabels };
  }
  const valid = verifyPublicClarificationCapture(packet()).capture.get(id);
  expect(valid?.ordinary).toHaveLength(1);
  expect(valid?.pending).toHaveLength(2);
  expect(valid?.pending[0].clarificationEvidence?.writtenNominal?.literal).toBe("caju");
  expect(valid?.pending[1].clarificationEvidence).toBeNull();

  expect(() => compareSealedUnquantifiedMaterialProof(packet())).toThrow("manifest-shape");
  expect(() => verifyPublicClarificationCapture(packet(old))).toThrow("outputs-shape");
  expect(() => verifyPublicClarificationCapture(packet(old.ok || !("affected" in old) ? old :
    { ok: old.ok, reason: old.reason, observations: old.observations, affected: old.affected }))).toThrow("invalid-wire");
  expect(() => verifyPublicClarificationCapture(packet(fresh, { lexicalAtUtc: undefined }))).toThrow("manifest-shape");
  const other = "2026-11-28T10:00:00.000Z";
  expect(() => verifyPublicClarificationCapture(packet(fresh, { lexicalAtUtc: other }))).toThrow("lexical-clock");
  expect(() => verifyPublicClarificationCapture(packet(fresh, {}, {}, { lexicalAtUtc: other }))).toThrow("lexical-clock-receipt");
  expect(() => verifyPublicClarificationCapture(packet(fresh, {}, { split: "holdout" }))).toThrow("public-clarification-only");
  expect(() => verifyPublicClarificationCapture({ ...packet(), comparatorCheckoutSha: "9".repeat(40) })).toThrow("comparator-checkout");
  expect(() => verifyPublicClarificationCapture(packet(fresh, {}, {}, {}, [42]))).toThrow("lexicon-shape");
  expect(() => verifyPublicClarificationCapture(packet(fresh, {}, {}, {},
    [{ ...collision, validFrom: "not-a-clock" }]))).toThrow("lexicon-shape");
  expect(readLabels).not.toHaveBeenCalled();
});

const from = "2026-11-27T00:00:00.000Z", to = "2026-11-28T00:00:00.000Z";
const collision: GovernedLexiconEntry = {
  id: 77, term: "leite", normalizedTerm: "leite", kind: "unit_term", targetType: "canonical_term",
  targetRef: "copo", locale: "pt-BR", scope: "global", userId: null, source: "imported",
  status: "verified", confidence: 1, requiresClarification: false, current: true,
  validFrom: new Date(from), validTo: new Date(to),
};
const protectedIngredient: GovernedLexiconEntry = {
  ...collision, id: 78, term: "açúcar e 18", normalizedTerm: "açúcar e 18",
  kind: "protected_token", targetType: "none", targetRef: null,
  validFrom: new Date("2026-11-27T00:00:01.000Z"), validTo: new Date("2026-11-27T00:00:02.000Z"),
};
const scenarios = (["text", "audio_transcript"] as const).flatMap(modality => [
  { modality, role: "proven", name: "leite", clock: "2026-11-26T23:59:59.999Z" },
  { modality, role: "unproven", name: "leite", clock: from },
  { modality, role: "unproven", name: "leite", clock: "2026-11-27T23:59:59.999Z" },
  { modality, role: "proven", name: "leite", clock: to },
  { modality, role: "absent", name: "", clock: from },
  { modality, role: "unproven", name: "framboesa", clock: to },
  { modality, role: "proven", name: "caju", clock: "2026-11-27T00:00:00.999Z", protect: true },
  { modality, role: "proven", name: "caju", clock: "2026-11-27T00:00:02.000Z", protect: true },
] as const);
it.each(scenarios)("scores $modality: $name as $role at $clock", async scenario => {
  const { role, name, modality, clock: lexicalAtUtc } = scenario;
  const id = "1".repeat(32), studyId = "2".repeat(32), runId = "3".repeat(32);
  const parserSha = "a".repeat(40), comparatorSha = "b".repeat(40);
  const adrSha256 = "c".repeat(64), lockfileSha256 = "d".repeat(64);
  const lexiconRevision = "public-shared-r4-score";
  const prefix = "Café com 1 colher de chá de açúcar";
  const first = "18,5 ml" + (role === "absent" ? "" : " de " + name) + " com mais um pouco";
  const text = prefix + " e " + first + " e mais um pouco.";
  const span = (word: string, from = 0) => {
    const start = text.indexOf(word, from);
    expect(start).toBeGreaterThanOrEqual(0);
    return { start, end: start + word.length };
  };
  const firstScope = span(first), secondScope = span("mais um pouco.", firstScope.end);
  // These reference roles are authored from the phrase before parser execution.
  const label = { nonce: "e".repeat(64), rows: [{ id, facts: [
    { kind: "ingredient-measured", scope: span(prefix),
      owner: { name: span("Café"), nameHint: "cafe", whole: { status: "absent" } },
      ingredient: span("açúcar"), amount: { value: 1, unit: "colher de chá", measure: span("1 colher de chá") } },
    { kind: "pending-increment", scope: firstScope, operator: span("mais", firstScope.start), amount: null },
    { kind: "pending-increment", scope: secondScope, operator: span("mais", secondScope.start), amount: null },
  ], clarification: [{ scope: firstScope, measure: { value: 18.5, unit: "ml", measure: span("18,5 ml") },
    nominal: role === "absent" ? { status: role } : { status: role, span: span(name, firstScope.start) },
  }] }] };
  const labels = bytes(label);
  const input = { id, text, modality, split: "calibration", semanticGroup: "4".repeat(32) };
  const entries = "protect" in scenario ? [collision, protectedIngredient] : [collision];
  const inputs = bytes([input]), lexiconSnapshot = bytes(entries), profile = "r4-clarification-public-proof-v1";

  const result = await diagnoseFoodMaterialClarificationEvidence({
    rawText: text, modality: input.modality, sourceRef: "c1b:" + id,
    lexiconRevision, ownerUserId: null, now: new Date(lexicalAtUtc),
  }, { load: async ({ now }) => { expect(now.toISOString()).toBe(lexicalAtUtc); return entries; } });
  if (result.ok || result.reason !== "unproven-material") throw new Error("expected drafted pending capture");
  const readLabels = vi.fn((read: Buffer) => read);
  function evaluate(candidate: unknown, read = labels, pinned = labels) {
    const manifest = bytes({ profile, schemaVersion: 1, studyId, parserSha, comparatorSha, lexicalAtUtc,
      adrSha256, lockfileSha256, lexiconRevision, lexiconSha256: digest(lexiconSnapshot),
      inputsSha256: digest(inputs), labelsSha256: digest(pinned), caseCount: 1 });
    const pinnedManifestSha256 = digest(manifest);
    const outputs = bytes([{ id, result: candidate }]);
    const receipt = bytes({ profile, schemaVersion: 1, studyId, runId, parserSha, lexicalAtUtc,
      manifestSha256: pinnedManifestSha256, outputsSha256: digest(outputs) });
    return comparePublicClarificationProof({ manifest, inputs, outputs, receipt, lexiconSnapshot, pinnedManifestSha256,
      pinnedReceiptSha256: digest(receipt), expectedRunId: runId, expectedLexicalAtUtc: lexicalAtUtc,
      parserCheckoutSha: parserSha, comparatorCheckoutSha: comparatorSha, adrSha256, lockfileSha256, readLabels: () => readLabels(read) });
  }
  const good = evaluate(result);
  expect(good.material).toEqual({ verified: 1, abstained: 2, missing: 0, mismatch: 0, duplicate: 0, extra: 0 });
  expect(good.clarification).toMatchObject({
    measureRetained: role === "unproven" ? 0 : 1, measureMissing: 0, measureMismatch: 0,
    namedProven: Number(role === "proven"), nameAbsent: Number(role === "absent"),
    unprovenAbstention: Number(role === "unproven"), unexpected: 0,
  });
  if (name === "leite" && role === "unproven") {
    const earlier = await diagnoseFoodMaterialClarificationEvidence({
      rawText: text, modality, sourceRef: "c1b:" + id, lexiconRevision, ownerUserId: null,
      now: new Date("2026-11-26T23:59:59.999Z"),
    }, { load: async () => entries });
    expect(earlier.ok ? null : "affected" in earlier && earlier.affected[0].pendingObservation?.clarificationEvidence).toBeTruthy();
    readLabels.mockClear();
    expect(() => evaluate(earlier)).toThrow("clarification-lexical-witness");
    expect(readLabels).not.toHaveBeenCalled();
  }
  if (role !== "absent") {
    const wrongAmount = structuredClone(label);
    Object.assign(wrongAmount.rows[0].clarification[0].measure, { value: 999, unit: "kg" });
    const wrong = bytes(wrongAmount);
    expect(() => evaluate(result, wrong, wrong)).toThrow("label-clarification-measure");
  }
  if (role === "proven") {
    const mislabeled = structuredClone(label);
    mislabeled.rows[0].clarification[0].nominal.status = "unproven";
    const wrongRole = bytes(mislabeled);
    expect(() => evaluate(result, wrongRole, wrongRole)).toThrow("label-clarification-lexical-role");
    const extraByte = Buffer.concat([labels, Buffer.from(" ")]);
    expect(() => evaluate(result, extraByte)).toThrow("labels-digest");
    const invalid = structuredClone(label);
    invalid.rows[0].clarification.push(invalid.rows[0].clarification[0]);
    const duplicate = bytes(invalid);
    expect(() => evaluate(result, duplicate, duplicate)).toThrow("label-clarification-scope");
  }
  if (role !== "unproven") {
    const erased = structuredClone(result);
    erased.affected[0].pendingObservation!.clarificationEvidence = null;
    expect(evaluate(erased)).toMatchObject({ material: { abstained: 2, missing: 0 }, clarification: { measureMissing: 1 } });
    const truncated = { ...result, affected: result.affected.slice(0, 1) };
    expect(evaluate(truncated)).toMatchObject({ material: { abstained: 1, missing: 1 }, clarification: { measureMissing: 0 } });
  }
});
