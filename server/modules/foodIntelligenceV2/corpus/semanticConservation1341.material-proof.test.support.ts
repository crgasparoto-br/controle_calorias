/** Focused, test-only sealed proof. It neither discovers facts nor runs a parser. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { FOOD_CONTRACT_LIMITS as limits } from "../contracts";
import { recognizedUnit } from "../linguisticSurface";
import { foodAnchorSchema, opaqueId, type FoodAnchor } from "../schemaShared";
import { parseFoodMaterialObservationBatch, type FoodMaterialObservation } from "../schemas";
import { hasSourceUtf16Boundary } from "./semanticConservation1341.reserved.test.support";

const profile = "r3-material-proof-v1";
const diagnosticProfile = z.literal("r3-pending-increment-v1");
const maxCases = 200, maxBytes = 8 * 1024 * 1024;
const id = z.string().regex(/^[0-9a-f]{32}$/u);
const head = z.string().regex(/^[0-9a-f]{40}$/u);
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const version = z.literal(1);
const split = z.enum(["calibration", "holdout"]);
const modality = z.enum(["text", "audio_transcript"]);
const manifestSchema = z.strictObject({
  profile: z.literal(profile), schemaVersion: version, studyId: id, parserSha: head, comparatorSha: head,
  adrSha256: digest, lockfileSha256: digest, lexiconRevision: opaqueId(200), lexiconSha256: digest,
  inputsSha256: digest, labelsSha256: digest, caseCount: z.number().int().positive().max(maxCases),
});
const receiptSchema = z.strictObject({
  profile: z.literal(profile), schemaVersion: version, studyId: id, runId: id, parserSha: head,
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
  z.strictObject({ kind: z.literal("pending-increment"), scope: span, operator: span, amount: anchorAmount }),
  z.strictObject({ kind: z.literal("independent-sibling"), scope: span, owner }),
]);
const labelsSchema = z.strictObject({
  nonce: digest, rows: z.array(z.strictObject({ id,
    facts: z.array(fact).min(1).max(limits.observations) })).max(maxCases),
});
type Input = z.infer<typeof inputSchema>;
type Fact = z.infer<typeof fact>;
type Span = z.infer<typeof span>;
type Owner = z.infer<typeof owner>;
type Evidence = FoodMaterialObservation["evidence"][number];
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
export interface SealedMaterialProof extends MaterialProofInputs {
  receipt: Uint8Array;
  outputs: Uint8Array;
  pinnedReceiptSha256: string;
  comparatorCheckoutSha: string;
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
function inputsFor(config: MaterialProofInputs) {
  pin(config.manifest, config.pinnedManifestSha256, "manifest");
  const manifest = decode(config.manifest, manifestSchema, "manifest");
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
  return { manifest, inputs };
}

/** Runner receives no strata, split, semantic group, outputs, receipt or label capability. */
export function prepareMaterialProofInputs(config: MaterialProofInputs) {
  const { manifest, inputs } = inputsFor(config);
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
function validated(input: Input, revision: string, result: z.infer<typeof resultSchema>) {
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
          !claim.unresolvedAmount || child.normalizedInput !== null || h.foodName !== null ||
          h.brand !== null || h.variant !== null || h.barcode !== null || h.preparation.length || h.qualifiers.length ||
          !absentQuantity(child.quantityHints) || child.quantityHints.servingText !== null ||
          child.alternatives.length || child.normalizationPath.length || child.interpreterVersion !== null ||
          child.unresolvedReason !== "unknown_surface" ||
          child.evidence.length !== 2) fail("pending-authority");
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

function reference(input: Input, facts: Fact[], lexicon: LexicalGroups) {
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
    if ("amount" in f) anchors.push(f.amount.measure);
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
    if (f.kind === "ingredient-measured" && (!wholeHardScope(input, f.scope) ||
        !/^[ \t]+com[ \t]+$/iu.test(input.text.slice(f.owner.name.end, f.amount.measure.start)) ||
        !/^[ \t]+de[ \t]+$/iu.test(input.text.slice(f.amount.measure.end, f.ingredient.start)) ||
        f.ingredient.end !== f.scope.end)) fail("label-ingredient-clause");
    if ((f.kind === "ingredient-measured" || f.kind === "pending-increment") &&
        !exactWrittenAmount(input, f.amount)) fail("label-exact-amount");
    if (f.kind === "negation-local" || f.kind === "pending-increment") {
      const left = f.kind === "negation-local" ? f.owner.name.end : f.scope.start;
      const right = f.kind === "negation-local" ? f.ingredient : f.amount.measure;
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
const quantities = (row: FoodMaterialObservation) => row.evidence.filter(e => e.field.startsWith("quantity."));
const signature = (row: { value: number | null; unit: string | null; servingText: string | null }) =>
  JSON.stringify([row.value, row.unit, row.servingText]);
function nominalHints(h: FoodMaterialObservation["identityHints"], name: string, variant: string | null = null) {
  return h.foodName === name && h.variant === variant && h.brand === null && h.barcode === null &&
    h.preparation.length === 0 && h.qualifiers.length === 0;
}

function ownerProof(input: Input, row: FoodMaterialObservation, gold: Owner) {
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

function provesFact(input: Input, row: FoodMaterialObservation, gold: Fact) {
  const [claim] = row.materialClaims;
  const byId = (id: string) => row.evidence.find(e => e.evidenceId === id);
  if (gold.kind === "pending-increment") {
    return claim?.kind === "increment" && !!claim.unresolvedAmount &&
      proof(input, byId(claim.operatorEvidenceId), "material.increment", gold.operator, literal(input, gold.operator)) &&
      proof(input, byId(claim.unresolvedAmount.evidenceId), "material.amount", gold.amount.measure, gold.amount.value, gold.amount.unit);
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
function tally(input: Input, facts: Fact[], result: ReturnType<typeof validated>, count: Finding) {
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
export function compareSealedMaterialProof(config: SealedMaterialProof) {
  const { manifest, inputs } = inputsFor(config);
  if (manifest.comparatorSha !== config.comparatorCheckoutSha) fail("comparator-checkout");
  pin(config.receipt, config.pinnedReceiptSha256, "receipt");
  const receipt = decode(config.receipt, receiptSchema, "receipt");
  if (receipt.studyId !== manifest.studyId || receipt.runId !== config.expectedRunId ||
      receipt.parserSha !== manifest.parserSha || receipt.manifestSha256 !== config.pinnedManifestSha256) fail("receipt-identity");
  pin(config.outputs, receipt.outputsSha256, "outputs");
  const outputs = index(decode(config.outputs, outputsSchema, "outputs"), "outputs", inputs);
  const capture = new Map([...inputs].map(([k, row]) => [k, validated(row, manifest.lexiconRevision, outputs.get(k)!.result)]));
  const lexicon = indexCompatibleRoles(decode(config.lexiconSnapshot, z.array(lexicalRow).max(5000), "lexicon"));
  const labelBytes = config.readLabels();
  pin(labelBytes, manifest.labelsSha256, "labels");
  const labels = index(decode(labelBytes, labelsSchema, "labels").rows, "labels", inputs);
  for (const [k, row] of inputs) reference(row, labels.get(k)!.facts, lexicon);
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
  return { authority: "diagnostic-only", profile, studyId: manifest.studyId, runId: receipt.runId,
    parserSha: manifest.parserSha, comparatorSha: manifest.comparatorSha, adrSha256: manifest.adrSha256,
    lockfileSha256: manifest.lockfileSha256, lexiconRevision: manifest.lexiconRevision, lexiconSha256: manifest.lexiconSha256,
    manifestSha256: config.pinnedManifestSha256, receiptSha256: config.pinnedReceiptSha256,
    inputsSha256: manifest.inputsSha256, outputsSha256: receipt.outputsSha256, labelsSha256: manifest.labelsSha256,
    totals, strata, reasons };
}
