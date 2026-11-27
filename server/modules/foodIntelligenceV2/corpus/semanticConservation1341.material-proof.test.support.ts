/** Focused, test-only sealed proof. It neither discovers facts nor runs a parser. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { FOOD_CONTRACT_LIMITS as limits } from "../contracts";
import { foldFoodSurface, readWrittenClarificationPrefix, recognizedUnit } from "../linguisticSurface";
import { isLinguisticLexiconEntryValidAt } from "../linguisticLexiconValidity";
import { foodAnchorSchema, opaqueId, type FoodAnchor } from "../schemaShared";
import {
  parseFoodMaterialObservationBatch, parseFoodMaterialClarificationObservationBatch,
  type FoodMaterialObservation, type FoodMaterialClarificationObservation,
} from "../schemas";
import { hasSourceUtf16Boundary } from "./semanticConservation1341.reserved.test.support";

const profile = "r3-material-proof-v1";
const successor = "r3-material-proof-v2";
type Profile = typeof profile | typeof successor;
const profiles = z.enum([profile, successor]);
const diagnosticProfile = z.enum(["r3-pending-increment-v1", "r3-pending-increment-v2"]);
const maxCases = 200, maxBytes = 8 * 1024 * 1024;
const id = z.string().regex(/^[0-9a-f]{32}$/u);
const head = z.string().regex(/^[0-9a-f]{40}$/u);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const version = z.literal(1);
const split = z.enum(["calibration", "holdout"]);
const modality = z.enum(["text", "audio_transcript"]);
const manifestSchema = z.strictObject({
  profile: profiles, schemaVersion: version, studyId: id, parserSha: head, comparatorSha: head,
  adrSha256: digest, lockfileSha256: digest, lexiconRevision: opaqueId(200), lexiconSha256: digest,
  inputsSha256: digest, labelsSha256: digest, caseCount: z.number().int().positive().max(maxCases),
});
const receiptSchema = z.strictObject({
  profile: profiles, schemaVersion: version, studyId: id, runId: id, parserSha: head,
  manifestSha256: digest, outputsSha256: digest,
});
const inputSchema = z.strictObject({
  id, text: z.string().max(limits.rawText).refine(x => !!x.trim()), modality, split, semanticGroup: id,
});
const affectedSchema = z.strictObject({
  observationId: opaqueId(), surfaceSpan: foodAnchorSchema, pendingObservation: z.unknown().optional(),
});
const observations = z.array(z.unknown()).max(limits.observations);
const resultSchema = z.union([
  z.strictObject({ diagnosticProfile, ok: z.literal(true), observations }),
  z.strictObject({ diagnosticProfile, ok: z.literal(false), reason: z.literal("unproven-material"),
    observations, affected: z.array(affectedSchema).min(1).max(limits.observations) }),
  z.strictObject({ diagnosticProfile, ok: z.literal(false), reason: z.enum(["unsupported-input", "invalid-material-observations"]) }),
]);
const outputsSchema = z.array(z.strictObject({ id, result: resultSchema })).max(maxCases);
const clarificationProfile = "r4-clarification-public-proof-v1";
const lexicalUtc = z.string().refine(value => {
  const clock = new Date(value);
  return Number.isFinite(clock.getTime()) && clock.toISOString() === value;
});
const clarificationManifestSchema = manifestSchema.extend({
  profile: z.literal(clarificationProfile), lexicalAtUtc: lexicalUtc,
});
const clarificationReceiptSchema = receiptSchema.extend({
  profile: z.literal(clarificationProfile), lexicalAtUtc: lexicalUtc,
});
const clarificationResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), observations }),
  z.strictObject({ ok: z.literal(false), reason: z.literal("unproven-material"),
    observations, affected: z.array(affectedSchema).min(1).max(limits.observations) }),
]);
const clarificationOutputsSchema = z.array(z.strictObject({ id, result: clarificationResultSchema })).max(maxCases);


const span = z.strictObject({ start: z.number().int().nonnegative(), end: z.number().int().positive() })
  .refine(x => x.start < x.end);
const amount = z.strictObject({ value: z.number().finite().positive(), unit: z.string().trim().min(1).max(40) });
const anchorAmount = amount.extend({ measure: span });
// Nominal profile only: no brand, preparation, qualifier, barcode or
// primary variant. A same-name S2 variant hypothesis must be separately labeled.
const lexicalRole = z.strictObject({
  entryId: z.number().int().positive(), variant: z.string().min(1).max(limits.nameText),
});
const owner = z.strictObject({
  name: span, nameHint: z.string().min(1).max(limits.nameText), lexical: lexicalRole.optional(),
  whole: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("absent"), serving: span.optional() }),
    anchorAmount.extend({ status: z.literal("exact"), serving: span }),
    z.strictObject({ status: z.literal("unit-conflict"), serving: span,
      hypotheses: z.array(amount.extend({ serving: span })).min(2).max(limits.alternatives) }),
  ]),
});
// One authored fact per hard scope. An affected anchor without a typed
// observation cannot establish what kind of continuation (if any) occurred.
const fact = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ingredient-measured"), scope: span, owner,
    ingredient: span, amount: anchorAmount }),
  z.strictObject({ kind: z.literal("negation-local"), scope: span, owner, operator: span, ingredient: span }),
  z.strictObject({ kind: z.literal("pending-increment"), scope: span, operator: span, amount: anchorAmount.nullable() }),
  z.strictObject({ kind: z.literal("independent-sibling"), scope: span, owner }),
]);
const labelsSchema = z.strictObject({
  nonce: digest, rows: z.array(z.strictObject({ id,
    facts: z.array(fact).min(1).max(limits.observations) })).max(maxCases),
});
const clarificationFact = z.strictObject({
  scope: span, measure: anchorAmount,
  nominal: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("absent") }),
    z.strictObject({ status: z.enum(["proven", "unproven"]), span }),
  ]),
});
const clarificationLabelsSchema = labelsSchema.extend({
  rows: z.array(z.strictObject({ id,
    facts: z.array(fact).min(1).max(limits.observations),
    clarification: z.array(clarificationFact).max(limits.observations),
  })).max(maxCases),
});

type Input = z.infer<typeof inputSchema>;
type Fact = z.infer<typeof fact>;
type Span = z.infer<typeof span>;
type Owner = z.infer<typeof owner>;
type Evidence = FoodMaterialObservation["evidence"][number];
type ProofObservation = FoodMaterialObservation | FoodMaterialClarificationObservation;
const lexicalRow = z.object({
  id: z.number().int().positive(), kind: z.string(), targetType: z.string(), targetRef: z.string().nullable(),
  normalizedTerm: z.string(), locale: z.string(), scope: z.string(), userId: z.number().nullable(),
  status: z.string(), current: z.boolean(), requiresClarification: z.boolean(),
  validFrom: z.string().nullable(), validTo: z.string().nullable(), confidence: z.number().nullable(),
});

export interface MaterialProofInputs {
  manifest: Uint8Array;
  inputs: Uint8Array;
  lexiconSnapshot: Uint8Array;
  pinnedManifestSha256: string;
  parserCheckoutSha: string;
  adrSha256: string;
  lockfileSha256: string;
}
interface MaterialProofReferencePins extends MaterialProofInputs {
  comparatorCheckoutSha: string;
}

export interface MaterialProofReference extends MaterialProofReferencePins {
  labels: Uint8Array;
}

export interface SealedMaterialProof extends MaterialProofReferencePins {
  receipt: Uint8Array;
  outputs: Uint8Array;
  pinnedReceiptSha256: string;
  expectedRunId: string;
  readLabels: () => Uint8Array;
}

const fail = (reason: string): never => { throw new Error("c1b-r3-material-proof:" + reason); };
function pin(bytes: Uint8Array, expected: string, name: string) {
  if (bytes.byteLength > maxBytes) fail(name + "-budget");
  if (createHash("sha256").update(bytes).digest("hex") !== expected) fail(name + "-digest");
}
function decode<T>(bytes: Uint8Array, schema: z.ZodType<T>, name: string): T {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return fail(name + "-json"); }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fail(name + "-shape");
}
function index<T extends { id: string }>(rows: T[], name: string, expected?: ReadonlyMap<string, unknown>) {
  const out = new Map<string, T>();
  for (const row of rows) {
    if (out.has(row.id)) fail(name + "-duplicate");
    out.set(row.id, row);
  }
  if (expected) {
    if ([...out.keys()].some(k => !expected.has(k))) fail(name + "-extra");
    if ([...expected.keys()].some(k => !out.has(k))) fail(name + "-missing");
  }
  return out;
}
const sourceRef = (row: Input) => "c1b:" + row.id;
const key = ({ start, end }: Span) => start + ":" + end;
const same = (a: Span | null, b: Span) => a !== null && a.start === b.start && a.end === b.end;
const inside = (outer: Span, inner: Span) => outer.start <= inner.start && inner.end <= outer.end;
const literal = (input: Input, a: Span) => input.text.slice(a.start, a.end);
function realSpan(input: Input, a: Span) {
  return a.end <= input.text.length && !!literal(input, a).trim() &&
    hasSourceUtf16Boundary(input.text, a.start) && hasSourceUtf16Boundary(input.text, a.end);
}
function inputsFor(config: MaterialProofInputs, expected: Profile = profile) {
  pin(config.manifest, config.pinnedManifestSha256, "manifest");
  const manifest = decode(config.manifest, manifestSchema, "manifest");
  if (manifest.profile !== expected) fail("manifest-shape");
  return { manifest, inputs: verifyInputBytes(config, manifest) };
}

function verifyInputBytes(
  config: MaterialProofInputs,
  manifest: Pick<z.infer<typeof manifestSchema>,
    "parserSha" | "adrSha256" | "lockfileSha256" | "inputsSha256" | "lexiconSha256" | "caseCount">,
) {
  if (manifest.parserSha !== config.parserCheckoutSha ||
      manifest.adrSha256 !== config.adrSha256 || manifest.lockfileSha256 !== config.lockfileSha256) fail("checkout-pins");
  pin(config.inputs, manifest.inputsSha256, "inputs");
  pin(config.lexiconSnapshot, manifest.lexiconSha256, "lexicon");
  const inputs = index(decode(config.inputs, z.array(inputSchema).max(maxCases), "inputs"), "inputs");
  if (inputs.size !== manifest.caseCount) fail("input-count");
  const groups = new Map<string, Input>();
  const surfaces = new Map<string, Input>();
  const seen = new Set<string>();
  for (const row of inputs.values()) {
    const text = row.text.normalize("NFC").trim().replace(/\s+/gu, " ");
    const earlier = groups.get(row.semanticGroup);
    const peer = surfaces.get(text);
    if (earlier && earlier.split !== row.split || peer && peer.semanticGroup !== row.semanticGroup) fail("partition");
    const occurrence = row.modality + ":" + text;
    if (seen.has(occurrence)) fail("input-surface-duplicate");
    seen.add(occurrence);
    groups.set(row.semanticGroup, row);
    surfaces.set(text, row);
  }
  return inputs;
}

/** Runner receives no strata, split, semantic group, outputs, receipt or label capability. */
export function prepareMaterialProofInputs(config: MaterialProofInputs) {
  return prepareMaterialProofInputsFor(config, profile);
}
export function prepareUnquantifiedMaterialProofInputs(config: MaterialProofInputs) {
  return prepareMaterialProofInputsFor(config, successor);
}
function prepareMaterialProofInputsFor(config: MaterialProofInputs, expected: Profile) {
  const { manifest, inputs } = inputsFor(config, expected);
  return { lexiconRevision: manifest.lexiconRevision,
    inputs: [...inputs.values()].map(row => ({ id: row.id, rawText: row.text, modality: row.modality, sourceRef: sourceRef(row) })) };
}

function scopeOf(input: Input, anchor: FoodAnchor) {
  if (anchor.sourceRef !== sourceRef(input) || anchor.region !== null || !anchor.span || !realSpan(input, anchor.span)) {
    return fail("source-provenance");
  }
  return anchor.span;
}
function noPackage(q: FoodMaterialObservation["quantityHints"]) {
  return q.visiblePackageQuantity === null && q.visiblePackageUnit === null;
}
function absentQuantity(q: FoodMaterialObservation["quantityHints"]) {
  return q.value === null && q.unit === null && noPackage(q);
}
function verifyCaptureProvenance(input: Input, revision: string,
  all: readonly ProofObservation[]) {
  const evidenceIds = new Set<string>();
  for (const row of all) {
    const scope = scopeOf(input, row.surfaceSpan);
    if (row.rawInput !== input.text || row.modality !== input.modality || row.lexiconRevision !== revision) fail("entry-provenance");
    for (const item of [...row.evidence, ...row.normalizationPath]) {
      if (!inside(scope, scopeOf(input, item.anchor))) fail("owner-provenance");
    }
    for (const e of row.evidence) {
      if (evidenceIds.has(e.evidenceId)) fail("evidence-duplicate");
      evidenceIds.add(e.evidenceId);
    }
  }
}

function validated(input: Input, revision: string, result: z.infer<typeof resultSchema>,
  version: Profile, lexicon?: LexicalGroups) {
  if (result.diagnosticProfile !== (version === successor ? "r3-pending-increment-v2" : "r3-pending-increment-v1")) fail("outputs-shape");
  if (!("observations" in result)) return fail("producer-technical-" + result.reason);
  const affected = "affected" in result ? result.affected : [];
  if (result.observations.length + affected.length > limits.observations) fail("occurrence-budget");
  const children = affected.flatMap(row => row.pendingObservation === undefined ? [] : [row.pendingObservation]);
  const batch = parseFoodMaterialObservationBatch([...result.observations, ...children]);
  if (!batch.ok) return fail("invalid-wire");
  const all = batch.value;
  const rows = all.slice(0, result.observations.length);
  const pending = all.slice(rows.length);
  let childIndex = 0;
  const usedIds = new Set(rows.map(row => row.observationId));
  verifyCaptureProvenance(input, revision, all);
  for (const row of rows) {
    if (row.materialClaims.some(claim => claim.kind === "increment" || claim.binding.status !== "bound")) fail("ordinary-pending");
  }
  const omissions = affected.map(item => {
    const scope = scopeOf(input, item.surfaceSpan);
    if (usedIds.has(item.observationId)) fail("affected-duplicate");
    usedIds.add(item.observationId);
    // The canonical parser preserves array order. Check the child exactly
    // where it was captured; looking it up by ID would repair crossed parents.
    const child = item.pendingObservation === undefined ? undefined : pending[childIndex++];
    if (item.pendingObservation !== undefined &&
        (!child || child.observationId !== item.observationId ||
        !same(child.surfaceSpan.span, scope))) fail("pending-parent");
    if (child) {
      const [claim] = child.materialClaims;
      const h = child.identityHints;
      if (child.materialClaims.length !== 1 || claim.kind !== "increment" ||
          claim.binding.status !== "unresolved" || claim.binding.reason !== "owner_unknown" ||
          claim.binding.candidateObservationIds.length || claim.ingredient !== null || claim.target !== null ||
          (!claim.unresolvedAmount && version !== successor) || child.normalizedInput !== null || h.foodName !== null ||
          h.brand !== null || h.variant !== null || h.barcode !== null || h.preparation.length || h.qualifiers.length ||
          !absentQuantity(child.quantityHints) || child.quantityHints.servingText !== null ||
          child.alternatives.length || child.normalizationPath.length || child.interpreterVersion !== null ||
          child.unresolvedReason !== "unknown_surface" ||
          child.evidence.length !== (claim.unresolvedAmount ? 2 : 1)) fail("pending-authority");
      if (claim?.kind === "increment" && !claim.unresolvedAmount) {
        const e = child.evidence[0];
        const operator = e.anchor.span;
        if (!operator || !lexicon || !indefiniteScope(input, scope, operator, lexicon) ||
            !proof(input, e, "material.increment", operator, literal(input, operator))) fail("pending-authority");
      }
    }
    return { scope, child };
  });
  if (pending.length !== childIndex) fail("pending-parent");
  return { rows, omissions };
}

function wholeHardScope(input: Input, scope: Span) {
  const before = input.text.slice(0, scope.start);
  const after = input.text.slice(scope.end);
  return !/[;\r\n]/u.test(literal(input, scope)) &&
    !before.slice(Math.max(before.lastIndexOf(";"), before.lastIndexOf("\n")) + 1).trim() &&
    !after.split(/[;\n]/u, 1)[0].trim();
}

// Boundary witnesses, not a second parser: count/decimal (at most two
// decimal places) or a literal vulgar fraction, with at most one S1 unit
// token. A sign, range, written number or compound unit is outside this proof.
const numberForm = /^(?:(?:0|[1-9][0-9]*)(?:[,.][0-9]{1,2})?|[¼½¾])$/u;
function literalNumber(value: string): number | null {
  if (!numberForm.test(value)) return null;
  if (value === "¼" || value === "½" || value === "¾") return value === "¼" ? .25 : value === "½" ? .5 : .75;
  // Bound the coefficient as well as the rendered number. Otherwise very
  // large decimals can round to the same integer and appear to match.
  if (!Number.isSafeInteger(Number(value.replace(/[,.]/u, "")))) return null;
  const number = Number(value.replace(",", "."));
  return number > 0 ? number : null;
}
function exactWrittenAmount(input: Input, wanted: z.infer<typeof anchorAmount>, implicitUn = false) {
  const parts = /^([0-9.,]+|[¼½¾])(?:[ \t]*([\p{L}][\p{L}\p{M}]*))?$/u.exec(literal(input, wanted.measure));
  return !!parts && literalNumber(parts[1]) === wanted.value &&
    (parts[2] ? recognizedUnit(parts[2]) === wanted.unit : implicitUn && wanted.unit === "un");
}
function exactQualifiedSpoon(input: Input, wanted: z.infer<typeof anchorAmount>) {
  // Only the exact qualified unit and numeral of the authored anchor; the
  // bound ingredient connector is checked independently by reference().
  const parts = /^([0-9.,]+|[¼½¾])[ \t]+colher(?:es)?[ \t]+de[ \t]+(chá|cha|café|cafe|sopa|sobremesa)$/iu
    .exec(literal(input, wanted.measure));
  if (!parts || literalNumber(parts[1]) !== wanted.value) return false;
  const name = parts[2].toLowerCase();
  return wanted.unit === "colher de " + (name === "cha" ? "chá" : name === "cafe" ? "café" : name);
}
const spelling = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/gu, "")
  .toLocaleLowerCase("pt-BR").trim().replace(/\s+/gu, " ");
const space = /^[ \t]+$/u;
const de = /^[ \t]+de[ \t]+$/iu;
const decorations = /^(?:(?:\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*[ \t]+)*)$/u;
type LexicalRow = z.infer<typeof lexicalRow>;
const possibleGlobal = (row: LexicalRow) => row.locale === "pt-BR" && row.scope === "global" &&
  row.userId === null && row.status === "verified" && row.current && Number.isSafeInteger(row.id) &&
  (row.confidence === null || row.confidence >= 0 && row.confidence <= 1);
const unconditional = (row: LexicalRow) => row.validFrom === null && row.validTo === null;
const unitKind = (row: LexicalRow) => row.kind === "unit_term" || row.kind === "portion_term";

type LexicalGroups = ReadonlyMap<string, readonly LexicalRow[]>;
function indexCompatibleRoles(rows: readonly LexicalRow[]): LexicalGroups {
  const out = new Map<string, LexicalRow[]>();
  for (const row of rows) {
    if (!possibleGlobal(row)) continue;
    const key = spelling(row.normalizedTerm);
    const existing = out.get(key);
    if (existing) existing.push(row);
    else out.set(key, [row]);
  }
  return out;
}

function nominalStart(input: Input, scope: Span, gold: Owner, lexicon: LexicalGroups) {
  const wanted = gold.whole;
  const prefixStart = wanted.status === "absent" ? gold.name.start : wanted.serving.start;
  if (!decorations.test(input.text.slice(scope.start, prefixStart))) fail("label-nominal-boundary");
  if (wanted.status === "absent") {
    if (wanted.serving && !inside(gold.name, wanted.serving)) fail("label-nominal-boundary");
    return;
  }
  if (wanted.status === "exact") {
    if (!exactWrittenAmount(input, wanted, true)) fail("label-exact-amount");
    const connector = input.text.slice(wanted.measure.end, wanted.serving.end);
    if (wanted.serving.start !== wanted.measure.start || connector !== "" && !/^[ \t]+de$/iu.test(connector) ||
        !space.test(input.text.slice(wanted.serving.end, gold.name.start))) fail("label-nominal-boundary");
    return;
  }

  const [first] = wanted.hypotheses;
  const prefix = first.serving;
  const count = literalNumber(literal(input, wanted.serving));
  if (count === null || prefix.start !== wanted.serving.start ||
      wanted.hypotheses.some(option => !same(option.serving, prefix) || option.value !== count) ||
      !de.test(input.text.slice(prefix.end, gold.name.start))) fail("label-unit-conflict");
  const suffix = input.text.slice(wanted.serving.end, prefix.end);
  const alias = suffix.trim();
  if (!alias || !/^[ \t]+\S/u.test(suffix) || recognizedUnit(alias.split(/[ \t]+/u, 1)[0]) !== null) fail("label-unit-conflict");
  const candidates = (lexicon.get(spelling(alias)) ?? []).filter(unitKind);
  if (candidates.some(row => !unconditional(row))) fail("label-unit-conflict");
  const represented = candidates.flatMap(row => {
    const unit = row.targetType === "canonical_term" && row.targetRef ? recognizedUnit(row.targetRef) : null;
    return unit ? [{ unit, proved: !row.requiresClarification }] : [];
  });
  const expected = wanted.hypotheses.map(option => option.unit).sort();
  if (new Set(represented.filter(x => x.proved).map(x => x.unit)).size < 2 ||
      JSON.stringify(represented.map(x => x.unit).sort()) !== JSON.stringify(expected)) fail("label-unit-conflict");
}

function nominalRole(row: LexicalRow) {
  return row.kind === "alias_surface" && row.targetType === "food_variant" &&
    !!row.targetRef?.trim() && !row.requiresClarification && unconditional(row);
}
function uniqueNominalRole(name: string, lexicon: LexicalGroups) {
  const group = lexicon.get(name) ?? [];
  return group.length === 1 && nominalRole(group[0]) ? group[0] : null;
}

// Nominal witnesses, not an ingredient recognizer. Apply the same boundary
// to owner, ingredient and sibling. Only a non-negated slot can use one
// simple nominal link; plausible but undecidable spellings are out of scope.
const nominalLink = /^(?:de|da|do|das|dos)$/u;
const nonNominalAtom = /^(?:e|ou|nem|com|sem|mais|por|para|mas|que|se|zero|um|uma|uns|umas|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|mil|milhao|milhoes|meio|meia)$/u;
function nominalAtoms(raw: string, compound: boolean) {
  const words = raw.split(/[ \t]+/u);
  const atom = (word: string) => {
    const key = spelling(word);
    return /^\p{L}[\p{L}\p{M}]*$/u.test(word) &&
      !nominalLink.test(key) && !nonNominalAtom.test(key) && recognizedUnit(word) === null;
  };
  if (words.length === 1 && atom(words[0])) return [spelling(words[0])];
  if (compound && words.length === 3 && atom(words[0]) &&
      nominalLink.test(spelling(words[1])) && atom(words[2])) return [spelling(words[0]), spelling(words[2])];
  return null;
}
function nominalAuthority(raw: string, atoms: string[], lexicon: LexicalGroups) {
  const full = spelling(raw);
  for (const key of new Set([full, ...atoms])) {
    const group = lexicon.get(key) ?? [];
    // No ranking by confidence, kind or id. A live unit homonym or dated
    // interpretation cannot certify this narrow, time-independent food slot.
    if (group.some(row => unitKind(row))) fail("label-nominal-unit-role");
    if (group.length && (group.length > 1 || !nominalRole(group[0]))) fail("label-lexical-role");
  }
}

const conjunction = /^[ \t]+[Ee][ \t]+$/u;
function hardTail(input: Input, pos: number) {
  return input.text.slice(pos).split(/[;\n]/u, 1)[0];
}
// Review the original context as a whole, independent of the parser's
// segmented parts. Do not treat punctuation inside a quote as a reset.
function independentIndefiniteContext(input: Input, scope: Span, operator: Span, lexicon: LexicalGroups) {
  const before = input.text.slice(0, scope.start);
  const start = Math.max(before.lastIndexOf(";"), before.lastIndexOf("\n")) + 1;
  const local = input.text.slice(start, scope.end) + hardTail(input, scope.end);
  const rawWords = [...local.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu)];
  const words = rawWords.map(word => spelling(word[0]));
  if (words.some(word => word === "ou" || word === "sem" || word === "nao" || word === "nem" || word === "nunca")) return false;
  // Resolve no meaning from active names. Any matching non-unit identity role
  // is enough to invalidate this witness, including competing or time-scoped
  // roles: the proof packet has no trusted lexical clock.
  const rawScope = literal(input, scope);
  for (const roleKey of new Set([spelling(rawScope), spelling(rawScope.replace(/\.$/u, ""))])) {
    if ((lexicon.get(roleKey) ?? []).some(role => !unitKind(role))) return false;
  }
  // Independently locate the operator token and query slices of the original
  // words against the pinned protected-name index. A soft split must not
  // erase a governed phrase overlapping the cue.
  const at = rawWords.findIndex(token => start + token.index === operator.start);
  if (at < 0) return false;
  const coordination = rawWords.findIndex(token => /^[Ee]$/u.test(token[0]) &&
    start + token.index + 1 < scope.start &&
    /^[ \t]+$/u.test(input.text.slice(start + token.index + 1, scope.start)));
  const relevant = (coordination < 0 ? [at] : [at, coordination]);
  for (const [key, group] of lexicon) {
    if (!group.some(role => role.kind === "protected_token")) continue;
    const term = key.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? [];
    if (!term.length || term.length > words.length) continue;
    for (const pivot of relevant) {
      for (let offset = 0; offset < term.length; offset++) {
        const from = pivot - offset;
        if (term[offset] === words[pivot] && from >= 0 && from + term.length <= words.length &&
            term.every((word, index) => word === words[from + index])) return false;
      }
    }
  }
  const envelopeMarks = (source: string) => [...source].filter((mark, i, chars) => {
    if (!/["'“”‘’«»()[\]{}]/u.test(mark)) return false;
    if (!/['’]/u.test(mark)) return true;
    const wordAtom = /^[\p{L}\p{M}\p{N}]$/u;
    return !wordAtom.test(chars[i - 1] ?? "") || !wordAtom.test(chars[i + 1] ?? "");
  });
  if (envelopeMarks(local).length) return false;
  const marks = envelopeMarks(input.text.slice(0, start));
  const pairs = ['""', "''", "“”", "‘’", "«»", "()", "[]", "{}"];
  const unclosed: string[] = [];
  for (const mark of marks) {
    if (unclosed.at(-1) === mark) unclosed.pop();
    else {
      const opener = pairs.find(pair => pair[0] === mark);
      if (opener) unclosed.push(opener[1]);
    }
  }
  return unclosed.length === 0;
}

function indefiniteScope(input: Input, scope: Span, operator: Span, lexicon: LexicalGroups) {
  if (!inside(scope, operator) || !/^[Mm][Aa][Ii][Ss]$/u.test(literal(input, operator)) ||
      !independentIndefiniteContext(input, scope, operator, lexicon) ||
      /^[ \t\r]*\n[ \t\r\n]*de(?=[ \t;\r\n]|$)/iu.test(input.text.slice(scope.end))) return false;
  const ending = input.text.slice(operator.end, scope.end);
  if (wholeHardScope(input, scope) && operator.start === scope.start) {
    return /^[ \t]+[Uu][Mm][ \t]+[Pp][Oo][Uu][Cc][Oo]$/u.test(ending);
  }
  const before = input.text.slice(0, scope.start);
  const localHead = before.slice(Math.max(before.lastIndexOf(";"), before.lastIndexOf("\n")) + 1);
  const prefix = input.text.slice(scope.start, operator.start);
  const rest = hardTail(input, scope.end);
  return /\S[ \t]+[Ee][ \t]+$/u.test(localHead) &&
    (!prefix || (/(?:^|[ \t])[Cc][Oo][Mm][ \t]+$/u.test(prefix) &&
      !/[()[\]{}"'“”]/u.test(prefix) &&
      !/(?<![\p{L}\p{M}\p{N}])(?:ou|sem|mais)(?![\p{L}\p{M}\p{N}])/iu.test(prefix))) &&
    (/^[ \t]+[Uu][Mm][ \t]+[Pp][Oo][Uu][Cc][Oo]$/u.test(ending) ||
      !rest.trim() && /^[ \t]+[Uu][Mm][ \t]+[Pp][Oo][Uu][Cc][Oo]\.$/u.test(ending)) &&
    (!rest.trim() || /^[ \t]+[Ee][ \t]+\S/u.test(rest));
}
function witnessedMeasuredPrefix(input: Input, scope: Span, facts: Fact[], version: Profile, lexicon: LexicalGroups) {
  if (wholeHardScope(input, scope)) return true;
  if (version !== successor || /[;\r\n]/u.test(literal(input, scope))) return false;
  const before = input.text.slice(0, scope.start);
  if (before.slice(Math.max(before.lastIndexOf(";"), before.lastIndexOf("\n")) + 1).trim()) return false;
  const tail = facts.filter(f => f.scope.start >= scope.end &&
    f.scope.start < scope.end + hardTail(input, scope.end).length)
    .sort((a,b) => a.scope.start - b.scope.start);
  if (!tail.length) return false;
  let end = scope.end;
  for (const f of tail) {
    if (f.kind !== "pending-increment" || f.amount !== null ||
        !conjunction.test(input.text.slice(end, f.scope.start)) ||
        !indefiniteScope(input, f.scope, f.operator, lexicon)) return false;
    end = f.scope.end;
  }
  return !hardTail(input, end).trim();
}
function reference(input: Input, facts: Fact[], lexicon: LexicalGroups, version: Profile) {
  const scopes = facts.map(x => x.scope).sort((a, b) => a.start - b.start);
  if (scopes.some((x, i) => !realSpan(input, x) || i > 0 && scopes[i - 1].end > x.start)) fail("label-scope");
  for (const f of facts) {
    const anchors = "owner" in f ? [f.owner.name, f.owner.whole.serving] : [];
    if ("owner" in f && f.owner.whole.status === "exact") {
      const { measure, serving } = f.owner.whole;
      if (!inside(serving, measure)) fail("label-measure");
      anchors.push(measure);
    }
    if ("owner" in f && f.owner.whole.status === "unit-conflict") {
      const { hypotheses, serving } = f.owner.whole;
      if (new Set(hypotheses.map(x => x.unit)).size < 2 ||
          hypotheses.some(x => !inside(x.serving, serving) || x.serving.end > f.owner.name.start)) fail("label-unit-conflict");
      anchors.push(...hypotheses.map(x => x.serving));
    }
    if ("ingredient" in f) anchors.push(f.ingredient);
    if ("operator" in f) anchors.push(f.operator);
    if ("amount" in f && f.amount) anchors.push(f.amount.measure);
    if (anchors.some(a => a && (!realSpan(input, a) || !inside(f.scope, a)))) fail("label-anchor");
    if ("owner" in f) {
      // The authored label may fold pt-BR nominal spelling, never substitute
      // another name. This comparison does not ask the producer for identity.
      const raw = literal(input, f.owner.name);
      if (spelling(raw) !== f.owner.nameHint) fail("label-nominal-name");
      const atoms = nominalAtoms(raw, f.kind !== "negation-local");
      if (!atoms) return fail("label-nominal-boundary");
      nominalAuthority(raw, atoms, lexicon);
      nominalStart(input, f.scope, f.owner, lexicon);
      if (f.kind === "independent-sibling" &&
          (f.owner.name.end !== f.scope.end || !wholeHardScope(input, f.scope))) fail("label-nominal-boundary");
    }
    const role = "owner" in f && f.owner.lexical;
    if (role && "owner" in f) {
      const selected = uniqueNominalRole(f.owner.nameHint, lexicon);
      if (!selected || selected.id !== role.entryId || selected.targetRef !== role.variant) fail("label-lexical-role");
    }
    if (f.kind === "ingredient-measured" || f.kind === "negation-local") {
      const raw = literal(input, f.ingredient);
      const atoms = nominalAtoms(raw, f.kind === "ingredient-measured");
      if (!atoms) return fail("label-target-nominal");
      nominalAuthority(raw, atoms, lexicon);
      if (f.kind === "negation-local" && (!role || !uniqueNominalRole(spelling(raw), lexicon))) fail("label-lexical-role");
    }
    // This positive arm is deliberately narrower than the parser. Both
    // literal connectors and the whole original clause must be proved;
    // label ordering alone could launder a negation or a neighboring item.
    if (f.kind === "ingredient-measured" && (!witnessedMeasuredPrefix(input, f.scope, facts, version, lexicon) ||
        !/^[ \t]+com[ \t]+$/iu.test(input.text.slice(f.owner.name.end, f.amount.measure.start)) ||
        !/^[ \t]+de[ \t]+$/iu.test(input.text.slice(f.amount.measure.end, f.ingredient.start)) ||
        f.ingredient.end !== f.scope.end)) fail("label-ingredient-clause");
    if (f.kind === "pending-increment" && f.amount === null) {
      if (version !== successor) fail("labels-shape");
      if (!indefiniteScope(input, f.scope, f.operator, lexicon)) fail("label-operator");
    } else if ((f.kind === "ingredient-measured" || f.kind === "pending-increment") &&
        !exactWrittenAmount(input, f.amount!) &&
        !(version === successor && f.kind === "ingredient-measured" && exactQualifiedSpoon(input, f.amount))) {
      fail("label-exact-amount");
    }
    if (f.kind === "negation-local" || (f.kind === "pending-increment" && f.amount)) {
      const left = f.kind === "negation-local" ? f.owner.name.end : f.scope.start;
      const right = f.kind === "negation-local" ? f.ingredient : f.amount!.measure;
      const token = f.kind === "negation-local" ? "sem" : "mais";
      const trailing = input.text.slice(f.scope.end);
      if (literal(input, f.operator).toLowerCase() !== token || !wholeHardScope(input, f.scope) ||
          (f.kind === "negation-local" ? !/^[ \t]+$/u.test(input.text.slice(left, f.operator.start)) : left !== f.operator.start) ||
          !/^[ \t]+$/u.test(input.text.slice(f.operator.end, right.start)) || right.end !== f.scope.end ||
          f.kind === "pending-increment" &&
            /^[ \t\r]*\n[ \t\r\n]*de(?=[ \t;\r\n]|$)/iu.test(trailing)) fail("label-operator");
    }
    if ("owner" in f && f.owner.whole.serving &&
        (f.owner.whole.serving.end > f.owner.name.start && f.owner.whole.status !== "absent" ||
        f.kind === "negation-local" && f.owner.whole.serving.end > f.operator.start)) fail("label-serving");
  }
}

function proof(input: Input, evidence: Evidence | undefined, field: Evidence["field"],
  span: Span, value: string | number, unit: string | null = null) {
  return !!evidence && evidence.field === field && evidence.value === value && evidence.unit === unit &&
    !evidence.verified && evidence.sourceId === null && same(evidence.anchor.span, span) &&
    evidence.origin === (input.modality === "text" ? "text" : "transcription");
}
const quantities = (row: ProofObservation) => row.evidence.filter(e => e.field.startsWith("quantity."));
const signature = (row: { value: number | null; unit: string | null; servingText: string | null }) =>
  JSON.stringify([row.value, row.unit, row.servingText]);
function nominalHints(h: FoodMaterialObservation["identityHints"], name: string, variant: string | null = null) {
  return h.foodName === name && h.variant === variant && h.brand === null && h.barcode === null &&
    h.preparation.length === 0 && h.qualifiers.length === 0;
}

function ownerProof(input: Input, row: ProofObservation, gold: Owner) {
  if (!nominalHints(row.identityHints, gold.nameHint) || row.normalizedInput !== gold.nameHint ||
      row.interpreterVersion !== null || row.normalizationPath.some(x => x.stage === "S3") ||
      !noPackage(row.quantityHints)) return false;

  const names = row.evidence.filter(e => e.field === "identity.foodName" &&
    (e.origin === "text" || e.origin === "transcription"));
  if (names.length !== 1 || !proof(input, names[0], "identity.foodName", gold.name, literal(input, gold.name)) ||
      row.evidence.some(e => e.field.startsWith("nutrition.") || e.field.startsWith("variant.") ||
        e.field.startsWith("classification.") || e.field.startsWith("identity.") && e.field !== "identity.foodName")) return false;

  const lexical = gold.lexical;
  const echoes = row.evidence.filter(e => e.field === "identity.foodName" && e !== names[0]);
  const lexicalSteps = row.normalizationPath.filter(x => x.stage === "S2");
  const q = row.quantityHints, evidence = quantities(row);
  const alternatives = row.alternatives.filter(x => !lexical || x.hypothesisId !== "lex-" + lexical.entryId);
  if (lexical) {
    const [echo] = echoes, [step] = lexicalSteps;
    const variant = row.alternatives.filter(x => x.hypothesisId === "lex-" + lexical.entryId);
    if (echoes.length !== 1 || lexicalSteps.length !== 1 || variant.length !== 1 ||
        echo.origin !== "catalog" || echo.value !== gold.nameHint || echo.unit !== null ||
        echo.verified || echo.sourceId !== null || !same(echo.anchor.span, row.surfaceSpan.span!) ||
        step.origin !== "lexicon" || step.lexiconEntryId !== lexical.entryId || step.confidence !== echo.confidence ||
        !same(step.anchor.span, row.surfaceSpan.span!) ||
        !nominalHints(variant[0].identityHints, gold.nameHint, lexical.variant) ||
        variant[0].evidenceIds.length || variant[0].confidence !== echo.confidence ||
        !noPackage(variant[0].quantityHints) || signature(variant[0].quantityHints) !== signature(q)) return false;
  } else if (echoes.length || lexicalSteps.length) {
    return false;
  }

  const want = gold.whole;
  if (q.servingText !== (want.serving ? literal(input, want.serving) : null)) return false;
  if (want.status === "unit-conflict") {
    if (!absentQuantity(q) || evidence.length || row.unresolvedReason !== "source_conflict" ||
        alternatives.some(x => x.quantityHints.value === null || x.quantityHints.unit === null ||
          !noPackage(x.quantityHints) || !nominalHints(x.identityHints, gold.nameHint) || x.evidenceIds.length)) return false;
    const got = alternatives.map(x => signature(x.quantityHints)).sort();
    const expected = want.hypotheses.map(x => signature({ ...x, servingText: literal(input, x.serving) })).sort();
    return JSON.stringify(got) === JSON.stringify(expected);
  }
  if (alternatives.length) return false;
  if (want.status === "absent") return absentQuantity(q) && !evidence.length;
  return q.value === want.value && q.unit === want.unit && evidence.length === 1 &&
    proof(input, evidence[0], "quantity.value", want.measure, want.value, want.unit);
}

function provesFact(input: Input, row: ProofObservation, gold: Fact) {
  const [claim] = row.materialClaims;
  const byId = (id: string) => row.evidence.find(e => e.evidenceId === id);
  if (gold.kind === "pending-increment") {
    return claim?.kind === "increment" &&
      proof(input, byId(claim.operatorEvidenceId), "material.increment", gold.operator, literal(input, gold.operator)) &&
      (gold.amount === null ? claim.unresolvedAmount === null : !!claim.unresolvedAmount &&
        proof(input, byId(claim.unresolvedAmount.evidenceId), "material.amount", gold.amount.measure, gold.amount.value, gold.amount.unit));
  }
  if (!ownerProof(input, row, gold.owner)) return false;
  if (gold.kind === "independent-sibling") return row.materialClaims.length === 0;
  if (row.materialClaims.length !== 1 || claim.binding.status !== "bound" || claim.binding.ownerObservationId !== row.observationId ||
      (claim.kind !== "negation" && claim.kind !== "ingredient") || claim.ingredient.name !== literal(input, gold.ingredient) ||
      !proof(input, byId(claim.ingredient.evidenceId), "material.ingredient", gold.ingredient, claim.ingredient.name)) return false;
  if (gold.kind === "negation-local") {
    return claim.kind === "negation" &&
      proof(input, byId(claim.operatorEvidenceId), "material.negation", gold.operator, literal(input, gold.operator));
  }
  return claim.kind === "ingredient" && !!claim.amount &&
    proof(input, byId(claim.amount.evidenceId), "material.amount", gold.amount.measure, gold.amount.value, gold.amount.unit);
}

const counts = () => ({ verified: 0, abstained: 0, missing: 0, mismatch: 0, duplicate: 0, extra: 0 });
type Counts = ReturnType<typeof counts>;
type Finding = (kind: Fact["kind"] | "unlabeled", event: keyof Counts, reason: string) => void;
function tally(input: Input, facts: Fact[], result: {
  rows: readonly ProofObservation[];
  omissions: readonly { scope: Span; child?: ProofObservation }[];
}, count: Finding) {
  const actual = [
    ...result.rows.map(row => ({ scope: row.surfaceSpan.span!, ordinary: row })),
    ...result.omissions.map(row => ({ ...row, ordinary: undefined })),
  ];
  const matched = new Set<string>();
  for (const gold of facts) {
    const scope = key(gold.scope);
    matched.add(scope);
    const rows = actual.filter(row => key(row.scope) === scope);
    const emit = (event: keyof Counts, reason: string) => count(gold.kind, event, reason);
    if (rows.length === 0) { emit("missing", "scope-absent"); continue; }
    if (rows.length > 1) {
      for (let i = 1; i < rows.length; i++) emit("duplicate", "scope-repeated");
      continue;
    }
    const row = rows[0];
    const child = "child" in row ? row.child : undefined;
    if (gold.kind === "pending-increment") {
      if (child && provesFact(input, child, gold)) emit("abstained", "typed-pending-anchored");
      else if (!row.ordinary && !child) emit("missing", "pending-evidence-absent");
      else emit("mismatch", "pending-evidence-or-partition");
    } else if (row.ordinary && provesFact(input, row.ordinary, gold)) {
      emit("verified", "explicit-local-proof");
    } else {
      emit("mismatch", row.ordinary ? "owner-or-evidence-differs" : "unexpected-abstention");
    }
  }
  for (const row of actual) if (!matched.has(key(row.scope))) count("unlabeled", "extra", "scope-not-labeled");
}

/** Reads labels only after the complete capture has passed all checks. */
function verifyComparatorCheckout(manifest: z.infer<typeof manifestSchema>, sha: string) {
  if (manifest.comparatorSha !== sha) fail("comparator-checkout");
}

function lexicalRolesFor(snapshot: Uint8Array) {
  return indexCompatibleRoles(decode(snapshot, z.array(lexicalRow).max(5000), "lexicon"));
}

function labelsFor(manifest: z.infer<typeof manifestSchema>, inputs: ReadonlyMap<string, Input>,
  lexicon: LexicalGroups, bytes: Uint8Array) {
  pin(bytes, manifest.labelsSha256, "labels");
  const labels = index(decode(bytes, labelsSchema, "labels").rows, "labels", inputs);
  for (const [k, row] of inputs) reference(row, labels.get(k)!.facts, lexicon, manifest.profile);
  return labels;
}

/** Custodian-only pre-capture validation. No outputs, receipt or producer accepted.
 * Counts support quota review; they do not prove equivalence or human authorship.
 */
export function preflightMaterialProofReference(config: MaterialProofReference) {
  return preflightMaterialProofReferenceFor(config, profile);
}
export function preflightUnquantifiedMaterialProofReference(config: MaterialProofReference) {
  return preflightMaterialProofReferenceFor(config, successor);
}
function preflightMaterialProofReferenceFor(config: MaterialProofReference, expected: Profile) {
  const { manifest, inputs } = inputsFor(config, expected);
  verifyComparatorCheckout(manifest, config.comparatorCheckoutSha);
  const labels = labelsFor(manifest, inputs, lexicalRolesFor(config.lexiconSnapshot), config.labels);
  const cases: Record<string, number> = {};
  const facts: Record<string, number> = {};
  const casesByFactCount: Record<string, number> = {};
  const families = { calibration: new Set<string>(), holdout: new Set<string>() };
  const increment = (by: Record<string, number>, k: string) => { by[k] = (by[k] ?? 0) + 1; };
  for (const [k, row] of inputs) {
    const cell = row.split + "/" + row.modality;
    const authored = labels.get(k)!.facts;
    increment(cases, cell);
    increment(casesByFactCount, cell + "/" + authored.length);
    families[row.split].add(row.semanticGroup);
    for (const fact of authored) increment(facts, cell + "/" + fact.kind);
  }
  return { caseCount: inputs.size, cases, facts, casesByFactCount,
    families: { calibration: families.calibration.size, holdout: families.holdout.size } };
}

export function compareSealedMaterialProof(config: SealedMaterialProof) {
  return compareSealedMaterialProofFor(config, profile);
}

export function compareSealedUnquantifiedMaterialProof(config: SealedMaterialProof) {
  return compareSealedMaterialProofFor(config, successor);
}

const planningKind = z.enum(["ingredient-measured", "negation-local", "pending-increment", "independent-sibling"]);
const planningPolarity = z.enum(["preserve", "change"]);
const planningWire = z.strictObject({
  version: z.literal(1),
  manifestSha256: digest,
  projectionSha256: digest,
  excludedFamilies: z.array(id).max(maxCases),
  minima: z.array(z.strictObject({
    split, modality, kind: planningKind,
    families: z.number().int().min(1).max(maxCases),
    preserve: z.number().int().min(1).max(maxCases),
    change: z.number().int().min(1).max(maxCases),
  })).min(1).max(16),
  pairs: z.array(z.strictObject({
    members: z.tuple([id, id]), kind: planningKind, expectation: planningPolarity,
  })).max(maxCases * 4),
});

type PlanningCell = Pick<Input, "split" | "modality"> & { kind: Fact["kind"] };
const planningKey = ({ split, modality, kind }: PlanningCell) => [split, modality, kind].join("/");
const rowCell = (row: Input, kind: Fact["kind"]) => planningKey({ ...row, kind });
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Test-only planning support for existing R3 profiles. No capture or access authority. */
export function preflightProspectiveMaterialProof(
  config: MaterialProofReference & {
    plan: Uint8Array;
    pinnedPlanSha256: string;
    requiredCells: readonly PlanningCell[];
  },
  selected: Profile,
) {
  pin(config.plan, config.pinnedPlanSha256, "plan");
  const plan = decode(config.plan, planningWire, "plan");
  // Requiring the single compact parsed representation also rejects duplicate keys.
  if (sha256(Buffer.from(JSON.stringify(plan))) !== config.pinnedPlanSha256) fail("plan-noncanonical");
  if (plan.manifestSha256 !== config.pinnedManifestSha256) fail("plan-manifest");
  const { inputs, manifest } = inputsFor(config, selected);
  verifyComparatorCheckout(manifest, config.comparatorCheckoutSha);
  const required = new Set(config.requiredCells.map(planningKey));
  const declared = new Set(plan.minima.map(planningKey));
  if (!required.size || required.size !== config.requiredCells.length || declared.size !== plan.minima.length
      || required.size !== declared.size || [...required].some(cell => !declared.has(cell))) fail("plan-required-cells");
  const labels = labelsFor(manifest, inputs, lexicalRolesFor(config.lexiconSnapshot), config.labels);
  const projection = Buffer.from(JSON.stringify(prepareMaterialProofInputsFor(config, selected)));
  pin(projection, plan.projectionSha256, "plan-projection");
  const excluded = new Set(plan.excludedFamilies);
  if (excluded.size !== plan.excludedFamilies.length) fail("plan-duplicate-exclusion");
  const familyCells = new Map<string, Set<string>>();
  const pairCells = new Map<string, Set<string>>();
  const register = (cells: Map<string, Set<string>>, cell: string, group: string) => {
    const groups = cells.get(cell) ?? new Set<string>();
    groups.add(group);
    cells.set(cell, groups);
  };
  for (const [caseId, row] of inputs) {
    if (excluded.has(row.semanticGroup)) fail("plan-excluded-family");
    for (const entry of labels.get(caseId)!.facts) register(familyCells, rowCell(row, entry.kind), row.semanticGroup);
  }
  const used = new Set<string>();
  for (const pair of plan.pairs) {
    const [aId, bId] = pair.members;
    const a = inputs.get(aId), b = inputs.get(bId);
    if (!a || !b || aId === bId) return fail("plan-pair-members");
    const signature = [pair.kind, ...pair.members.slice().sort()].join("/");
    if (used.has(signature)) fail("plan-duplicate-pair");
    used.add(signature);
    const cell = rowCell(a, pair.kind);
    if (cell !== rowCell(b, pair.kind) || a.semanticGroup !== b.semanticGroup) fail("plan-pair-cell");
    if (!required.has(cell)) fail("plan-pair-unregistered");
    if (!pair.members.every(caseId => labels.get(caseId)!.facts.some(item => item.kind === pair.kind))) fail("plan-pair-kind");
    register(pairCells, cell + "/" + pair.expectation, a.semanticGroup);
  }
  for (const requirement of plan.minima) {
    const cell = planningKey(requirement);
    if ((familyCells.get(cell)?.size ?? 0) < requirement.families) fail("plan-family-minimum");
    for (const mode of ["preserve", "change"] as const) {
      if ((pairCells.get(cell + "/" + mode)?.size ?? 0) < requirement[mode]) fail("plan-pair-minimum");
    }
  }
  // Counts of declared (kind, unordered case pair) keys, not physical
  // pairs or evidence of semantic equivalence. No case or label is returned.
  return { status: "diagnostic-planning-only" as const, manifestSha256: plan.manifestSha256,
    planSha256: config.pinnedPlanSha256, projectionSha256: plan.projectionSha256,
    checkedCells: required.size, checkedPairDeclarations: used.size };
}

function verifyReceiptBytes<T extends {
  profile: string; studyId: string; runId: string; parserSha: string; manifestSha256: string; outputsSha256: string;
}>(
  config: SealedMaterialProof, manifest: { profile: string; studyId: string; parserSha: string },
  schema: z.ZodType<T>,
): T {
  pin(config.receipt, config.pinnedReceiptSha256, "receipt");
  const receipt = decode(config.receipt, schema, "receipt");
  if (receipt.profile !== manifest.profile || receipt.studyId !== manifest.studyId || receipt.runId !== config.expectedRunId ||
      receipt.parserSha !== manifest.parserSha || receipt.manifestSha256 !== config.pinnedManifestSha256) fail("receipt-identity");
  pin(config.outputs, receipt.outputsSha256, "outputs");
  return receipt;
}

function compareSealedMaterialProofFor(config: SealedMaterialProof, version: Profile) {
  const { manifest, inputs } = inputsFor(config, version);
  verifyComparatorCheckout(manifest, config.comparatorCheckoutSha);
  const receipt = verifyReceiptBytes(config, manifest, receiptSchema);
  const outputs = index(decode(config.outputs, outputsSchema, "outputs"), "outputs", inputs);
  const captureLexicon = version === successor ? lexicalRolesFor(config.lexiconSnapshot) : undefined;
  const capture = new Map([...inputs].map(([k, row]) => [k,
    validated(row, manifest.lexiconRevision, outputs.get(k)!.result, version, captureLexicon)]));
  const lexicon = captureLexicon ?? lexicalRolesFor(config.lexiconSnapshot);
  const labels = labelsFor(manifest, inputs, lexicon, config.readLabels());
  const totals = counts();
  const strata: Record<string, Counts> = {};
  const reasons: Record<string, number> = {};
  for (const [k, row] of inputs) tally(row, labels.get(k)!.facts, capture.get(k)!, (kind, event, reason) => {
    totals[event]++;
    const stratum = [row.split, row.modality, kind].join("/");
    (strata[stratum] ??= counts())[event]++;
    const why = stratum + "/" + reason;
    reasons[why] = (reasons[why] ?? 0) + 1;
  });
  return { authority: "diagnostic-only", profile: version, studyId: manifest.studyId, runId: receipt.runId,
    parserSha: manifest.parserSha, comparatorSha: manifest.comparatorSha, adrSha256: manifest.adrSha256,
    lockfileSha256: manifest.lockfileSha256, lexiconRevision: manifest.lexiconRevision, lexiconSha256: manifest.lexiconSha256,
    manifestSha256: config.pinnedManifestSha256, receiptSha256: config.pinnedReceiptSha256,
    inputsSha256: manifest.inputsSha256, outputsSha256: receipt.outputsSha256, labelsSha256: manifest.labelsSha256,
    totals, strata, reasons };
}

// R3 has no trusted lexical clock. R4 projects the active global rows for its
// independently pinned instant, without widening the inherited R3 contract.
const timedLexicalRow = lexicalRow.extend({
  kind: z.enum(["slang", "abbreviation", "regionalism", "typo", "alias_surface", "portion_term", "unit_term", "protected_token"]),
  targetType: z.enum(["canonical_term", "food_variant", "none"]),
  scope: z.enum(["global", "user"]),
  status: z.enum(["verified", "provisional", "pending_review", "rejected", "revoked", "active"]),
  validFrom: lexicalUtc.nullable(), validTo: lexicalUtc.nullable(),
}).refine(row => row.validFrom === null || row.validTo === null ||
  Date.parse(row.validFrom) < Date.parse(row.validTo));
function publicLexicon(snapshot: Uint8Array, lexicalAtUtc: string) {
  const at = new Date(lexicalAtUtc);
  const date = (bound: string | null) => bound === null ? null : new Date(bound);
  const rows = decode(snapshot, z.array(timedLexicalRow).max(5000), "lexicon")
    .filter(row => possibleGlobal(row) && isLinguisticLexiconEntryValidAt(date(row.validFrom), date(row.validTo), at));
  const rolesBySurface = new Map<string, LexicalRow[]>();
  const unitTerms = new Set<string>();
  for (const row of rows) {
    const term = foldFoodSurface(row.normalizedTerm);
    if (unitKind(row)) {
      if (term.length > 0 && term.length <= 160) unitTerms.add(term);
    } else {
      const group = rolesBySurface.get(term) ?? [];
      group.push(row);
      rolesBySurface.set(term, group);
    }
  }
  return {
    // The R3 boundary helper treats dated rows as merely possible. After
    // projection these rows describe only the verified instant, not all time.
    roles: indexCompatibleRoles(rows.map(row => ({ ...row, validFrom: null, validTo: null }))),
    rolesBySurface, unitTerms,
    unitFences: [...unitTerms].map(term => ({
      term, unit: null, entryId: null, confidence: null, candidates: [],
    })),
  };
}
type PublicLexicon = ReturnType<typeof publicLexicon>;

function publicWrittenWitness(input: Input, scope: Span, operator: Span, lexicon: PublicLexicon) {
  // This is a local witness for an authored or captured occurrence. It does
  // not run the producer, invent a reference fact, or repair a missing row.
  if (!indefiniteScope(input, scope, operator, lexicon.roles)) return null;
  const surface = { ...scope, text: literal(input, scope) };
  const prefix = readWrittenClarificationPrefix(surface, operator, lexicon.unitFences);
  if (!prefix) return null;
  const tokens = [prefix.measure.unit, literal(input, operator),
    input.text.slice(prefix.measure.start, operator.start).trim(),
    ...(prefix.writtenNominal ? [prefix.writtenNominal.text] : [])];
  if (tokens.some(value => {
    const term = foldFoodSurface(value);
    const roles = lexicon.rolesBySurface.get(term) ?? [];
    return lexicon.unitTerms.has(term) || roles.length > 1 || roles[0]?.requiresClarification === true;
  })) return null;
  return prefix;
}

/** Experimental public calibration only. Never opens labels, never authenticates
 * actual custody, and does not accept the legacy result/profile by adaptation. */
export function verifyPublicClarificationCapture(
  config: SealedMaterialProof & { expectedLexicalAtUtc: string },
) {
  pin(config.manifest, config.pinnedManifestSha256, "manifest");
  const manifest = decode(config.manifest, clarificationManifestSchema, "manifest");
  const inputs = verifyInputBytes(config, manifest);
  if (manifest.comparatorSha !== config.comparatorCheckoutSha) fail("comparator-checkout");
  if (manifest.lexicalAtUtc !== config.expectedLexicalAtUtc) fail("lexical-clock");
  if ([...inputs.values()].some(row => row.split !== "calibration")) fail("public-clarification-only");
  const receipt = verifyReceiptBytes(config, manifest, clarificationReceiptSchema);
  if (receipt.lexicalAtUtc !== manifest.lexicalAtUtc) fail("lexical-clock-receipt");
  const lexicon = publicLexicon(config.lexiconSnapshot, manifest.lexicalAtUtc);
  const outputs = index(decode(config.outputs, clarificationOutputsSchema, "outputs"), "outputs", inputs);
  const capture = new Map([...inputs].map(([caseId, input]) => {
    const result = outputs.get(caseId)!.result;
    const affected = result.ok ? [] : result.affected;
    if (affected.some(row => row.pendingObservation === undefined)) fail("pending-child-absent");
    if (result.observations.length + affected.length > limits.observations) fail("occurrence-budget");
    const parsed = parseFoodMaterialClarificationObservationBatch([
      ...result.observations, ...affected.map(row => row.pendingObservation),
    ]);
    if (!parsed.ok) return fail("invalid-wire");
    verifyCaptureProvenance(input, manifest.lexiconRevision, parsed.value);
    const ordinary = parsed.value.slice(0, result.observations.length);
    const pending = parsed.value.slice(ordinary.length);
    if (ordinary.some(row => row.clarificationEvidence !== null ||
        row.materialClaims.some(claim => claim.kind === "increment" || claim.binding.status !== "bound"))) fail("ordinary-pending");
    for (const [i, item] of affected.entries()) {
      const child = pending[i], scope = scopeOf(input, item.surfaceSpan), [claim] = child.materialClaims;
      if (child.observationId !== item.observationId || !same(child.surfaceSpan.span, scope)) fail("pending-parent");
      if (i > 0 && scopeOf(input, affected[i - 1].surfaceSpan).end > scope.start) fail("pending-order");
      if (child.materialClaims.length !== 1 || claim.kind !== "increment" ||
          claim.binding.status !== "unresolved" || claim.binding.reason !== "owner_unknown" ||
          claim.binding.candidateObservationIds.length || claim.target !== null || claim.ingredient !== null ||
          claim.unresolvedAmount !== null || child.normalizedInput !== null || !absentQuantity(child.quantityHints) ||
          child.quantityHints.servingText !== null || child.identityHints.foodName !== null || child.identityHints.brand !== null ||
          child.identityHints.variant !== null || child.identityHints.barcode !== null || child.identityHints.preparation.length ||
          child.identityHints.qualifiers.length || child.alternatives.length || child.normalizationPath.length ||
          child.interpreterVersion !== null || child.unresolvedReason !== "unknown_surface" || child.evidence.length !== 1 ||
          child.evidence[0].field !== "material.increment" || child.evidence[0].evidenceId !== claim.operatorEvidenceId ||
          child.evidence[0].sourceId !== null || child.evidence[0].verified) fail("pending-authority");
      const operator = child.evidence[0].anchor.span;
      if (!operator || !indefiniteScope(input, scope, operator, lexicon.roles)) return fail("pending-context");
      const got = child.clarificationEvidence;
      if (got !== null) {
        const witness = publicWrittenWitness(input, scope, operator, lexicon);
        if (!witness || witness.measure.value !== got.measure.value || witness.measure.unit !== got.measure.unit ||
            !same(got.measure.anchor.span, witness.measure) || witness.measure.text !== got.measure.literal ||
            (witness.writtenNominal === null) !== (got.writtenNominal === null) ||
            (witness.writtenNominal && got.writtenNominal &&
              (!same(got.writtenNominal.anchor.span, witness.writtenNominal) ||
               witness.writtenNominal.text !== got.writtenNominal.literal))) fail("clarification-lexical-witness");
      }
    }
    return [caseId, { ordinary, pending }] as const;
  }));
  return { manifest, receipt, capture, inputs, lexicon };
}

/** Public-only diagnostics reusing the material proof tally. A legitimate
 * packet with missing semantic content is scored after the labels are read,
 * not misclassified as transport tampering or adequate coverage. */
export function comparePublicClarificationProof(
  config: SealedMaterialProof & { expectedLexicalAtUtc: string },
) {
  const { manifest, inputs, capture, lexicon } = verifyPublicClarificationCapture(config);
  const bytes = config.readLabels();
  pin(bytes, manifest.labelsSha256, "labels");
  const gold = index(decode(bytes, clarificationLabelsSchema, "labels").rows, "labels", inputs);
  const material = counts();
  const clarification = {
    measureRetained: 0, measureMissing: 0, measureMismatch: 0, namedProven: 0,
    nameAbsent: 0, nominalMismatch: 0, unprovenAbstention: 0, unexpected: 0,
  };
  for (const [id, input] of inputs) {
    const label = gold.get(id)!;
    reference(input, label.facts, lexicon.roles, successor);
    const { ordinary, pending } = capture.get(id)!;
    tally(input, label.facts, {
      rows: ordinary, omissions: pending.map(child => ({ scope: child.surfaceSpan.span!, child })),
    }, (_role, event) => { material[event]++; });
    const affected = new Map(pending.map(row => [key(row.surfaceSpan.span!), row]));
    const eligibleScopes = new Set<string>();
    for (const want of label.clarification) {
      const scopeKey = key(want.scope);
      const increment = label.facts.find(f => f.kind === "pending-increment" && key(f.scope) === scopeKey);
      if (!increment || increment.kind !== "pending-increment" || increment.amount !== null ||
          eligibleScopes.has(scopeKey) || !realSpan(input, want.measure.measure) ||
          !inside(want.scope, want.measure.measure) || want.measure.measure.start !== want.scope.start) return fail("label-clarification-scope");
      eligibleScopes.add(scopeKey);
      const mid = want.nominal.status === "absent" ? null : want.nominal.span;
      if (mid !== null && (!realSpan(input, mid) || !inside(want.scope, mid) ||
          !/^[ \t]+de[ \t]+$/iu.test(input.text.slice(want.measure.measure.end, mid.start)))) fail("label-clarification-nominal");
      const before = mid?.end ?? want.measure.measure.end;
      if (before >= increment.operator.start || !/^[ \t]+com[ \t]+$/iu.test(
          input.text.slice(before, increment.operator.start))) fail("label-clarification-operator");
      // Validate a declared measure even if the name is unsupported. Use
      // the original measure and operator tail with only the nominal removed
      // to obtain a literal-only measure witness, not an alternate label.
      const measureText = literal(input, want.measure.measure);
      const connector = input.text.slice(before, increment.operator.start);
      const surfaceText = measureText + connector + input.text.slice(increment.operator.start, want.scope.end);
      const offset = measureText.length + connector.length;
      const measureOnly = readWrittenClarificationPrefix(
        { text: surfaceText, start: 0, end: surfaceText.length },
        { start: offset, end: offset + increment.operator.end - increment.operator.start },
      );
      if (!measureOnly || measureOnly.measure.end !== measureText.length ||
          measureOnly.measure.value !== want.measure.value || measureOnly.measure.unit !== want.measure.unit) {
        fail("label-clarification-measure");
      }
      const witness = publicWrittenWitness(input, want.scope, increment.operator, lexicon);
      // Absence describes the literal slot. Even an absent slot can
      // be ineligible for written proof when a governed unit collides.
      const expectedRole = mid === null ? "absent" : witness === null ? "unproven" : "proven";
      if (want.nominal.status !== expectedRole ||
          (witness?.writtenNominal && !same(mid, witness.writtenNominal))) fail("label-clarification-lexical-role");
      const row = affected.get(scopeKey);
      const got = row?.clarificationEvidence;
      if (witness === null) {
        if (row && got === null) clarification.unprovenAbstention++;
        else clarification.unexpected++;
        continue;
      }
      if (!got) { clarification.measureMissing++; continue; }
      const observed = got.measure;
      if (observed.value !== want.measure.value || observed.unit !== want.measure.unit ||
          observed.literal !== literal(input, want.measure.measure) ||
          !same(observed.anchor.span, want.measure.measure)) clarification.measureMismatch++;
      else clarification.measureRetained++;
      if (want.nominal.status === "absent" && got.writtenNominal === null) clarification.nameAbsent++;
      else if (want.nominal.status === "proven" && got.writtenNominal !== null &&
          same(got.writtenNominal.anchor.span, want.nominal.span) &&
          got.writtenNominal.literal === literal(input, want.nominal.span)) clarification.namedProven++;
      else clarification.nominalMismatch++;
    }
    for (const [scope, row] of affected) {
      if (!eligibleScopes.has(scope) && row.clarificationEvidence !== null) clarification.unexpected++;
    }
  }
  return { authority: "public-diagnostic-only", material, clarification } as const;
}
