/** Integrity preflight for a separate, test-only C1b sample.
 * A trusted custodian must publish the manifest pin before execution and the
 * independent runner must publish the output receipt before label access.
 * Hashes bind bytes, not time, personnel access, or a trustworthy process.
 * This module never loads labels before checking the pinned output receipt.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { FoodMaterialLanguageResult } from "../linguisticComprehension";
import { foodAnchorSchema, opaqueId, type FoodAnchor } from "../schemaShared";
import { parseFoodMaterialObservationBatch } from "../schemas";
import { compareC1bR3 } from "./semanticConservation1341.r3.test.support";
import type { C1bCase } from "./semanticConservation1341.test.fixture";
import { validateC1bReference } from "./semanticConservation1341.test.support.fixture";

const opaque = z.string().regex(/^[0-9a-f]{32}$/u);
const sha = z.string().regex(/^[0-9a-f]{40}$/u);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const version = z.literal(1);
const manifestSchema = z.strictObject({
  schemaVersion: version,
  studyId: opaque,
  parserSha: sha,
  comparatorSha: sha,
  lexiconRevision: z.literal("c1b-empty-s2"),
  inputsSha256: digest,
  labelsSha256: digest,
  caseCount: z.number().int().positive(),
});
const negationManifestSchema = manifestSchema.omit({ lexiconRevision: true }).extend({
  studyKind: z.literal("r3-negation-v1"),
  lexiconRevision: opaqueId(200),
  lexiconSha256: digest,
});
const receiptSchema = z.strictObject({
  schemaVersion: version,
  studyId: opaque,
  runId: opaque,
  parserSha: sha,
  manifestSha256: digest,
  outputsSha256: digest,
});
const entrySchema = z.strictObject({
  id: opaque,
  text: z.string().refine(text => text.trim().length > 0),
  modality: z.enum(["text", "audio_transcript"]),
  split: z.enum(["calibration", "holdout"]),
  semanticGroup: opaque,
});
const refText = z.strictObject({
  value: z.string(),
  surface: z.string(),
  surfaceStart: z.number().int().nonnegative().optional(),
});
const factSchema = z.strictObject({
  kind: z.enum(["food-quantity", "food-mention", "ingredient-quantity", "negation", "unbound", "increment"]),
  owner: z.string().nullable(),
  ownerAlternatives: z.array(z.string()).optional(),
  uncertaintyReason: z.literal("owner-ambiguous-after-coordinated-items").optional(),
  requiresAbstention: z.literal(true).optional(),
  surface: z.string(),
  surfaceStart: z.number().int().nonnegative().optional(),
  scope: z.string(),
  scopeStart: z.number().int().nonnegative().optional(),
  ingredient: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  incrementTargetIndex: z.number().int().nonnegative().optional(),
  packageClaim: z.strictObject({
    surface: z.string(),
    surfaceStart: z.number().int().nonnegative().optional(),
    quantity: z.number(),
    unit: z.string(),
  }).optional(),
  identityClaims: z.strictObject({
    brand: refText.optional(),
    variant: refText.optional(),
    barcode: refText.optional(),
    preparation: z.array(refText).optional(),
    qualifiers: z.array(refText.extend({
      role: z.string().nullable(),
      attributeCode: z.string().nullable(),
    })).optional(),
  }).optional(),
});
const resultSchema = z.union([
  z.strictObject({ ok: z.literal(true), observations: z.array(z.unknown()) }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.enum(["unsupported-input", "invalid-material-observations"]),
  }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.literal("unproven-material"),
    affected: z.array(z.strictObject({
      observationId: opaqueId(),
      surfaceSpan: foodAnchorSchema,
    })).min(1),
    observations: z.array(z.unknown()),
  }),
]);
const inputsSchema = z.array(entrySchema);
const labelsSchema = z.strictObject({
  // The custodian generates a fresh random 32-byte nonce, kept with the
  // answer key, to prevent guessing answers by hashing a likely label file.
  nonce: digest,
  rows: z.array(z.strictObject({ id: opaque, facts: z.array(factSchema) })),
});
const outputsSchema = z.array(z.strictObject({ id: opaque, result: resultSchema }));

type Bytes = Uint8Array;
const sha256 = (bytes: Bytes): string => createHash("sha256").update(bytes).digest("hex");
function fail(reason: string): never {
  throw new Error("c1b-reserved-study:" + reason);
}
function checkedJson<T>(bytes: Bytes, schema: z.ZodType<T>, name: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail(name + "-invalid-json");
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fail(name + "-invalid-shape");
}
function verifyDigest(data: Bytes, expected: string, name: string) {
  if (sha256(data) !== expected) fail(name + "-digest-mismatch");
}
function uniqueById<T extends { id: string }>(rows: readonly T[], name: string): Map<string, T> {
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (byId.has(row.id)) fail(name + "-duplicate-id");
    byId.set(row.id, row);
  }
  return byId;
}
function sameIds(
  input: Map<string, unknown>, observed: Map<string, unknown>, name: string,
) {
  if (input.size !== observed.size || [...input.keys()].some(id => !observed.has(id))) {
    fail(name + "-ids-do-not-pair");
  }
}

/** The canonical schemas validate anchor shape; capture must also bind the
 * source and its in-bounds text coordinates to the separately sealed input. */
function capturedTextSpan(anchor: FoodAnchor, sourceRef: string, textLength: number) {
  return anchor.sourceRef === sourceRef &&
    anchor.region === null &&
    anchor.span &&
    anchor.span.end <= textLength
    ? anchor.span
    : null;
}

function validatedResult(
  captured: z.infer<typeof resultSchema>,
  entry: z.infer<typeof entrySchema>,
): FoodMaterialLanguageResult {
  if (!("observations" in captured)) return captured;
  const parsed = parseFoodMaterialObservationBatch(captured.observations);
  if (!parsed.ok) return fail("outputs-invalid-r3-batch");
  const sourceRef = "c1b:" + entry.id;
  for (const observation of parsed.value) {
    const surface = capturedTextSpan(observation.surfaceSpan, sourceRef, entry.text.length);
    if (observation.rawInput !== entry.text || observation.modality !== entry.modality || !surface) {
      fail("outputs-invalid-provenance");
    }
    for (const { anchor } of [...observation.evidence, ...observation.normalizationPath]) {
      const span = capturedTextSpan(anchor, sourceRef, entry.text.length);
      if (!span || span.start < surface.start || span.end > surface.end) {
        fail("outputs-invalid-provenance");
      }
    }
  }
  if (captured.ok) return { ok: true, observations: parsed.value };

  const seen = new Set(parsed.value.map(row => row.observationId));
  for (const row of captured.affected) {
    if (
      seen.has(row.observationId) ||
      !capturedTextSpan(row.surfaceSpan, sourceRef, entry.text.length)
    ) fail("outputs-invalid-affected");
    seen.add(row.observationId);
  }
  return { ...captured, observations: parsed.value };
}

interface PinnedInputs {
  manifest: Bytes;
  inputs: Bytes;
  /** Pin from the independent, pre-run study record; not from the input file. */
  pinnedManifestSha256: string;
  /** Git HEAD checked by the operator from the trusted checkout. */
  parserCheckoutSha: string;
}
function readPinnedInputs<T extends Omit<z.infer<typeof manifestSchema>, "lexiconRevision">>(
  config: PinnedInputs, schema: z.ZodType<T>,
) {
  verifyDigest(config.manifest, config.pinnedManifestSha256, "manifest");
  const manifest = checkedJson(config.manifest, schema, "manifest");
  if (manifest.parserSha !== config.parserCheckoutSha) fail("parser-checkout-mismatch");
  verifyDigest(config.inputs, manifest.inputsSha256, "inputs");
  const inputs = checkedJson(config.inputs, inputsSchema, "inputs");
  const byId = uniqueById(inputs, "inputs");
  if (byId.size !== manifest.caseCount) fail("input-count-mismatch");
  const splits = new Map<string, (typeof inputs)[number]["split"]>();
  const surfaceGroups = new Map<string, string>();
  const uniqueSurfaces = new Set<string>();
  for (const row of inputs) {
    const earlier = splits.get(row.semanticGroup);
    if (earlier && earlier !== row.split) fail("group-crosses-splits");
    splits.set(row.semanticGroup, row.split);
    // Detect exact copies after NFC/whitespace normalization for the guard
    // only. Do not change input bytes, infer paraphrases, or score with it.
    const surface = row.text.normalize("NFC").trim().replace(/\s+/gu, " ");
    const modalitySurface = row.modality + ":" + surface;
    const group = surfaceGroups.get(surface);
    if (group && group !== row.semanticGroup) fail("same-surface-crosses-groups");
    if (uniqueSurfaces.has(modalitySurface)) fail("duplicate-input-surface");
    surfaceGroups.set(surface, row.semanticGroup);
    uniqueSurfaces.add(modalitySurface);
  }
  return { manifest, inputs, byId };
}

/** Runner-side, has no label/receipt parameter. Only these fields go to the subject. */
export function verifiedC1bReservedInputs(config: PinnedInputs) {
  return readPinnedInputs(config, manifestSchema).inputs.map(({ id, text, modality }) => ({
    id, rawText: text, modality, sourceRef: "c1b:" + id,
  }));
}

interface SealedStudy extends PinnedInputs {
  outputs: Bytes;
  receipt: Bytes;
  /** Pin independently recorded after capture and before revealing the gabarito. */
  pinnedReceiptSha256: string;
  comparatorCheckoutSha: string;
  expectedRunId: string;
  /** Give only the evaluator this capability; the runner has a separate API. */
  readLabels: () => Bytes;
}

function capturePreflight<T extends Omit<z.infer<typeof manifestSchema>, "lexiconRevision">>(
  config: SealedStudy, schema: z.ZodType<T>,
) {
  const { manifest, inputs, byId } = readPinnedInputs(config, schema);
  if (manifest.comparatorSha !== config.comparatorCheckoutSha) fail("comparator-checkout-mismatch");
  verifyDigest(config.receipt, config.pinnedReceiptSha256, "receipt");
  const receipt = checkedJson(config.receipt, receiptSchema, "receipt");
  if (receipt.manifestSha256 !== config.pinnedManifestSha256 ||
      receipt.studyId !== manifest.studyId || receipt.parserSha !== manifest.parserSha ||
      receipt.runId !== config.expectedRunId) fail("receipt-identity-mismatch");
  verifyDigest(config.outputs, receipt.outputsSha256, "outputs");
  const captured = uniqueById(checkedJson(config.outputs, outputsSchema, "outputs"), "outputs");
  sameIds(byId, captured, "outputs");
  const validated = new Map(inputs.map(entry => [
    entry.id, validatedResult(captured.get(entry.id)!.result, entry),
  ]));

  return { manifest, inputs, byId, receipt, validated };
}

function pinnedLabels<T extends { rows: { id: string }[] }>(
  config: SealedStudy, pinned: string, byId: Map<string, unknown>, schema: z.ZodType<T>,
): Map<string, T["rows"][number]> {
  // Only the evaluator requests labels; snapshots and pins have already passed.
  const bytes = config.readLabels();
  verifyDigest(bytes, pinned, "labels");
  const labels = uniqueById<T["rows"][number]>(checkedJson(bytes, schema, "labels").rows, "labels");
  sameIds(byId, labels, "labels");
  return labels;
}

interface NegationPinnedInputs extends PinnedInputs {
  /** Exact bytes of the authorized synthetic lexicon, supplied separately, never a live data source. */
  lexiconSnapshot: Bytes;
}
export interface SealedR3NegationStudy extends SealedStudy, NegationPinnedInputs {}

/** Runner API strictly pinned to the specialized protocol, without a label capability. */
export function verifiedR3NegationStudyInputs(config: NegationPinnedInputs) {
  const { manifest, inputs } = readPinnedInputs(config, negationManifestSchema);
  verifyDigest(config.lexiconSnapshot, manifest.lexiconSha256, "lexicon");
  return {
    lexiconRevision: manifest.lexiconRevision,
    inputs: inputs.map(({ id, text, modality }) => ({ id, rawText: text, modality, sourceRef: "c1b:" + id })),
  };
}

export function hasSourceUtf16Boundary(text: string, at: number): boolean {
  return !(/[\uD800-\uDBFF]/u.test(text[at - 1] ?? "") && /[\uDC00-\uDFFF]/u.test(text[at] ?? ""));
}

export function evaluatePinnedR3NegationCapture<T extends { rows: { id: string }[] }>(
  config: SealedR3NegationStudy, schema: z.ZodType<T>,
) {
  const { manifest, inputs, byId, receipt, validated } = capturePreflight(config, negationManifestSchema);
  verifyDigest(config.lexiconSnapshot, manifest.lexiconSha256, "lexicon");
  for (const input of inputs) {
    const result = validated.get(input.id)!;
    if (!("observations" in result)) continue;
    const check = (where: FoodAnchor) => where.span !== null &&
      hasSourceUtf16Boundary(input.text, where.span.start) &&
      hasSourceUtf16Boundary(input.text, where.span.end);
    for (const item of result.observations) {
      if (item.lexiconRevision !== manifest.lexiconRevision) fail("outputs-lexicon-revision-mismatch");
      if (![item.surfaceSpan, ...item.evidence.map(e => e.anchor), ...item.normalizationPath.map(e => e.anchor)].every(check)) {
        fail("outputs-invalid-utf16-boundary");
      }
    }
    if (!result.ok && result.affected.some(item => !check(item.surfaceSpan))) {
      fail("outputs-invalid-utf16-boundary");
    }
  }
  const labels = pinnedLabels(config, manifest.labelsSha256, byId, schema);
  return { manifest, inputs, receipt, validated, labels };
}

/** Evaluate the sealed study after capture. No runtime writes, promotion, or admission. */
export function compareSealedC1bReservedStudy(config: SealedStudy) {
  const { manifest, inputs, byId, receipt, validated } = capturePreflight(config, manifestSchema);
  const labels = pinnedLabels(config, manifest.labelsSha256, byId, labelsSchema);
  const cases: C1bCase[] = inputs.map(row => ({ ...row, facts: labels.get(row.id)!.facts }));
  cases.forEach(validateC1bReference);
  return {
    authority: "diagnostic-only" as const,
    studyId: manifest.studyId,
    runId: receipt.runId,
    parserSha: manifest.parserSha,
    comparatorSha: manifest.comparatorSha,
    manifestSha256: config.pinnedManifestSha256,
    receiptSha256: config.pinnedReceiptSha256,
    inputsSha256: manifest.inputsSha256,
    outputsSha256: receipt.outputsSha256,
    labelsSha256: manifest.labelsSha256,
    rows: cases.map(test => ({
      group: test.semanticGroup,
      ...compareC1bR3(test, validated.get(test.id)!),
    })),
  };
}
