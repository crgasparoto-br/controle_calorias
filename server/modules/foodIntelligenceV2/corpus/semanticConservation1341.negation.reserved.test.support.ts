/** Specialized, sealed test-only diagnostic for literal local R3 negation. */
import { z } from "zod";
import type { FoodMaterialLanguageResult } from "../linguisticComprehension";
import type { FoodMaterialObservation } from "../schemas";
import {
  evaluatePinnedR3NegationCapture, hasSourceUtf16Boundary, type SealedR3NegationStudy,
} from "./semanticConservation1341.reserved.test.support";

const spanSchema = z.strictObject({
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
}).refine(span => span.start < span.end);
const ownerSchema = z.strictObject({
  name: spanSchema, nameHint: z.string().min(1).max(300), scope: spanSchema,
  // The source wording can include a connector ("de") omitted by the
  // quantity evidence. Amountless, uncertain servings may also have wording.
  serving: spanSchema.optional(),
  wholeAmount: z.strictObject({
    value: z.number().finite().positive(), unit: z.string().min(1).max(40), measure: spanSchema,
    unitAlias: z.strictObject({
      term: z.string().min(1).max(160), entryId: z.number().int().positive(), anchor: spanSchema,
    }).optional(),
  }).nullable(),
});
const labelsSchema = z.strictObject({
  nonce: z.string().regex(/^[0-9a-f]{64}$/u),
  rows: z.array(z.strictObject({
    id: z.string().regex(/^[0-9a-f]{32}$/u),
    expectedStatus: z.enum(["linked", "abstain", "unchanged-identity"]),
    negations: z.array(z.strictObject({ owner: ownerSchema, operator: spanSchema, ingredient: spanSchema })),
    unaffected: z.array(ownerSchema),
    affected: z.array(spanSchema),
    forbiddenFoodNames: z.array(z.string().min(1).max(300)),
  })),
});
type Span = z.infer<typeof spanSchema>;
type Owner = z.infer<typeof ownerSchema>;
type Label = z.infer<typeof labelsSchema>["rows"][number];
type Evidence = FoodMaterialObservation["evidence"][number];
type Input = { id: string; text: string; modality: "text" | "audio_transcript" };
const same = (left: Span | null, right: Span) =>
  left !== null && left.start === right.start && left.end === right.end;
const contains = (outer: Span, inner: Span) => outer.start <= inner.start && inner.end <= outer.end;
const before = (left: Span, right: Span) => left.end <= right.start;
const overlap = (a: Span, b: Span) => !before(a, b) && !before(b, a);
const key = ({ start, end }: Span) => start + ":" + end;
const sourceText = (text: string, span: Span) => text.slice(span.start, span.end);
function validSpan(text: string, span: Span) {
  return span.end <= text.length && hasSourceUtf16Boundary(text, span.start) &&
    hasSourceUtf16Boundary(text, span.end) && !!sourceText(text, span).trim();
}

const servingSpan = (owner: Owner) => owner.serving ?? owner.wholeAmount?.measure ?? null;
/** Validate the labeled occurrence, not the producer's token candidates.
 * This profile admits one complete local clause; punctuation cannot stand
 * in for horizontal separation between the labeled owner/operator/target.
 */
function literalNegation(text: string, scope: Span, name: Span, operator: Span, ingredient: Span) {
  if (sourceText(text, operator).toLowerCase() !== "sem" ||
      !before(name, operator) || !before(operator, ingredient) || ingredient.end !== scope.end) return false;
  const horizontal = /^[ \t]+$/u;
  if (!horizontal.test(text.slice(name.end, operator.start)) ||
      !horizontal.test(text.slice(operator.end, ingredient.start))) return false;

  // A reference cannot omit non-whitespace from either end of its clause
  // or bind across a hard boundary. Do not discover food names or split input.
  const leadingContext = text.slice(0, scope.start);
  const trailingContext = text.slice(scope.end);
  return !/[;\r\n]/u.test(sourceText(text, scope)) &&
    !leadingContext.slice(Math.max(leadingContext.lastIndexOf(";"), leadingContext.lastIndexOf("\n")) + 1).trim() &&
    !trailingContext.split(/[;\n]/u, 1)[0].trim();
}

function validateReference(text: string, label: Label) {
  const owners = [...label.negations.map(item => item.owner), ...label.unaffected];
  const scopes = [...owners.map(item => item.scope), ...label.affected].sort((a, b) => a.start - b.start);
  const inScope = (scope: Span, span: Span) => validSpan(text, span) && contains(scope, span);
  const valid = scopes.every((span, i) => validSpan(text, span) && (!i || before(scopes[i - 1], span))) &&
    owners.every(item => {
      const serving = servingSpan(item), amount = item.wholeAmount, alias = amount?.unitAlias;
      return inScope(item.scope, item.name) &&
        (!serving || inScope(item.scope, serving) && sourceText(text, serving).trim() === sourceText(text, serving)) &&
        (!amount || serving !== null && inScope(item.scope, amount.measure) &&
          contains(serving, amount.measure) && !overlap(serving, item.name)) &&
        (!alias || inScope(item.scope, alias.anchor) && contains(alias.anchor, item.name) &&
          serving !== null && contains(alias.anchor, serving));
    }) &&
    label.negations.every(({ owner, operator, ingredient }) => {
      const serving = servingSpan(owner), alias = owner.wholeAmount?.unitAlias;
      return inScope(owner.scope, operator) && inScope(owner.scope, ingredient) &&
        literalNegation(text, owner.scope, owner.name, operator, ingredient) &&
        (!serving || before(serving, operator)) && (!alias || before(alias.anchor, operator));
    }) &&
    (label.expectedStatus === "abstain" ? label.affected.length > 0 : label.affected.length === 0) &&
    (label.expectedStatus === "linked" ? label.negations.length > 0 :
      label.expectedStatus === "abstain" || (label.negations.length === 0 && label.unaffected.length > 0));
  if (!valid) throw new Error("c1b-r3-negation:invalid-label-reference");
}

function proves(
  input: Input, evidence: Evidence | undefined, field: Evidence["field"], expected: Span,
  value: string | number, unit: string | null = null,
) {
  return !!evidence && evidence.field === field && evidence.value === value && evidence.unit === unit &&
    evidence.origin === (input.modality === "text" ? "text" : "transcription") &&
    !evidence.verified && evidence.sourceId === null && evidence.anchor.sourceRef === "c1b:" + input.id &&
    evidence.anchor.region === null && same(evidence.anchor.span, expected);
}

function provesOwner(input: Input, observation: FoodMaterialObservation, expected: Owner) {
  const localName = observation.evidence.filter(item => item.field === "identity.foodName" &&
    (item.origin === "text" || item.origin === "transcription"));
  if (observation.identityHints.foodName !== expected.nameHint || localName.length !== 1 ||
      !proves(input, localName[0], "identity.foodName", expected.name, sourceText(input.text, expected.name)) ||
      observation.evidence.some(item => item.field === "material.amount" || item.field.startsWith("nutrition."))) {
    return false;
  }
  const wanted = expected.wholeAmount;
  const serving = servingSpan(expected);
  const servingText = serving === null ? null : sourceText(input.text, serving);
  const emptyPackage = (q: FoodMaterialObservation["quantityHints"]) =>
    q.visiblePackageQuantity === null && q.visiblePackageUnit === null;
  const matchesHints = (q: FoodMaterialObservation["quantityHints"]) => emptyPackage(q) &&
    q.value === (wanted?.value ?? null) && q.unit === (wanted?.unit ?? null) && q.servingText === servingText;
  // Identity hypotheses can omit quantity or carry the proved owner hints;
  // they do not establish a second quantity or a measure of the ingredient.
  if (!matchesHints(observation.quantityHints) || !observation.alternatives.every(({ quantityHints: q }) =>
    matchesHints(q) || emptyPackage(q) && q.value === null && q.unit === null && q.servingText === null)) return false;

  const quantities = observation.evidence.filter(item => item.field.startsWith("quantity."));
  if (!wanted) return quantities.length === 0;

  const alias = wanted.unitAlias;
  const direct = quantities.find(item => item.field === "quantity.value");
  if (quantities.length !== (alias ? 2 : 1) ||
      !proves(input, direct, "quantity.value", wanted.measure, wanted.value, wanted.unit)) return false;
  if (!alias) return true;

  // S2 may supply the unit term, never an extra measured fact. Its catalog
  // record and normalization step refer to the same local owner span.
  const catalog = quantities.find(item => item.field === "quantity.unit");
  return !!catalog && catalog.origin === "catalog" && catalog.value === alias.term &&
    catalog.unit === wanted.unit && !catalog.verified && catalog.sourceId === null &&
    same(catalog.anchor.span, alias.anchor) &&
    observation.normalizationPath.some(step => step.stage === "S2" && step.origin === "lexicon" &&
      step.lexiconEntryId === alias.entryId && step.confidence === catalog.confidence &&
      same(step.anchor.span, alias.anchor));
}

const blank = () => ({
  cases: 0, expected: 0, verified: 0, abstained: 0, missing: 0, mismatch: 0, extras: 0, statusMismatches: 0,
  expectedNegations: 0, verifiedNegations: 0, expectedSiblings: 0, verifiedSiblings: 0, expectedAffected: 0,
});
type Counts = ReturnType<typeof blank>;
function add(into: Counts, from: Counts) {
  for (const k of Object.keys(into) as (keyof Counts)[]) into[k] += from[k];
}

function compareRow(input: Input, label: Label, result: FoodMaterialLanguageResult): Counts {
  const n = blank();
  n.cases = 1;
  const observations = "observations" in result ? result.observations : [];
  const affected = !result.ok && result.reason === "unproven-material" ? result.affected : [];
  if (label.expectedStatus === "abstain" ? result.ok || result.reason !== "unproven-material" : !result.ok) {
    n.statusMismatches++;
  }
  const byScope = new Map<string, FoodMaterialObservation[]>();
  const evidenceIds = new Set<string>();
  for (const o of observations) {
    const where = o.surfaceSpan.span!;
    const k = key(where);
    byScope.set(k, [...(byScope.get(k) ?? []), o]);
    if (!validSpan(input.text, where) || label.affected.some(s => overlap(where, s)) ||
        label.forbiddenFoodNames.includes(o.identityHints.foodName ?? "")) n.extras++;
    for (const item of o.evidence) {
      if (evidenceIds.has(item.evidenceId)) n.extras++;
      evidenceIds.add(item.evidenceId);
    }
  }
  const seenScope = new Set<string>();
  const expectOwner = (owner: Owner, provesClaim: (item: FoodMaterialObservation) => boolean) => {
    n.expected++;
    const k = key(owner.scope);
    seenScope.add(k);
    const occupying = byScope.get(k) ?? [];
    if (!occupying.length) {
      n.missing++;
      return false;
    }
    if (occupying.length !== 1 || !provesOwner(input, occupying[0], owner) || !provesClaim(occupying[0])) {
      n.mismatch++;
      return false;
    }
    n.verified++;
    return true;
  };
  n.expectedNegations = label.negations.length;
  n.expectedSiblings = label.unaffected.length;
  for (const { owner, operator, ingredient } of label.negations) {
    const verified = expectOwner(owner, row => {
      const [claim] = row.materialClaims;
      if (row.materialClaims.length !== 1 || claim?.kind !== "negation" ||
          claim.binding.status !== "bound" || claim.binding.ownerObservationId !== row.observationId) return false;
      const value = sourceText(input.text, ingredient);
      return claim.ingredient.name === value && claim.ingredient.evidenceId !== claim.operatorEvidenceId &&
        proves(input, row.evidence.find(e => e.evidenceId === claim.operatorEvidenceId),
          "material.negation", operator, sourceText(input.text, operator)) &&
        proves(input, row.evidence.find(e => e.evidenceId === claim.ingredient.evidenceId),
          "material.ingredient", ingredient, value);
    });
    if (verified) n.verifiedNegations++;
  }
  for (const owner of label.unaffected) {
    if (expectOwner(owner, row => row.materialClaims.length === 0)) n.verifiedSiblings++;
  }
  for (const [k, rows] of byScope) {
    if (!seenScope.has(k)) n.extras += rows.length;
    else if (rows.length > 1) n.extras += rows.length - 1;
  }
  const wantedAffected = new Set(label.affected.map(key));
  const seenAffected = new Set<string>();
  for (const item of affected) {
    const where = item.surfaceSpan.span!;
    const k = key(where);
    if (!wantedAffected.has(k) || seenAffected.has(k) || !validSpan(input.text, where)) n.extras++;
    else seenAffected.add(k);
  }
  n.expectedAffected = wantedAffected.size;
  n.expected += wantedAffected.size;
  n.abstained = seenAffected.size;
  n.missing += wantedAffected.size - seenAffected.size;
  return n;
}

/** Only aggregated outcome counts leave this evaluator; no case text or labels. */
export function compareSealedR3NegationStudy(config: SealedR3NegationStudy) {
  const { manifest, receipt, inputs, validated, labels } = evaluatePinnedR3NegationCapture(config, labelsSchema);
  // Reject invalid reference semantics for the entire sealed bundle before
  // accumulating diagnostics for even one case.
  for (const input of inputs) validateReference(input.text, labels.get(input.id)!);
  const totals = blank();
  const bySplit = { calibration: blank(), holdout: blank() };
  const byModality = { text: blank(), audio_transcript: blank() };
  for (const input of inputs) {
    const counts = compareRow(input, labels.get(input.id)!, validated.get(input.id)!);
    add(totals, counts);
    add(bySplit[input.split], counts);
    add(byModality[input.modality], counts);
  }
  return {
    authority: "diagnostic-only" as const, studyKind: manifest.studyKind,
    studyId: manifest.studyId, runId: receipt.runId,
    parserSha: manifest.parserSha, comparatorSha: manifest.comparatorSha,
    manifestSha256: config.pinnedManifestSha256, receiptSha256: config.pinnedReceiptSha256,
    inputsSha256: manifest.inputsSha256, outputsSha256: receipt.outputsSha256,
    labelsSha256: manifest.labelsSha256, lexiconSha256: manifest.lexiconSha256,
    totals, bySplit, byModality,
  };
}
