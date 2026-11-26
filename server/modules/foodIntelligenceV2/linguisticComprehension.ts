/**
 * #1304 — Camada de Compreensão Linguística V2, sem cutover de entrypoints.
 * Observa a superfície: nunca resolve variante, nutrição ou MealOperation.
 * Fonte: ADR Food Intelligence Resolver V2 §4.1–4.2 e §7.1.1.
 */
import { z } from "zod";
import { DEFAULT_FOOD_LOCALE, FOOD_CONTRACT_LIMITS, FOOD_INPUT_TYPES, FOOD_MATERIAL_OBSERVATION_SCHEMA_VERSION } from "./contracts";
import { foodQualifierSchema } from "./schemaShared";
import { foldFoodSurface, readQuantity, recognizedUnit, splitFoodSurface, trimSpan } from "./linguisticSurface";
import type { ExplicitIngredientMeasure, ExplicitIngredientNegation, ExplicitPendingIncrement, FoodQuantitySourceSpans, GovernedUnitAlias, MaterialSegmentSyntax, MeasuredPrefixPendingSyntax, Segment, Span } from "./linguisticSurface";
export { foldFoodSurface, splitFoodSurface } from "./linguisticSurface";
import { parseFoodMaterialObservationBatch, parseFoodObservation, type FoodMaterialObservation, type FoodObservation } from "./schemas";
import { isLinguisticLexiconEntryValidAt } from "./linguisticLexiconValidity";

export type LinguisticModality = "text" | "audio_transcript" | "image";
export type LexiconKind =
  | "slang" | "abbreviation" | "regionalism" | "typo"
  | "alias_surface" | "portion_term" | "unit_term" | "protected_token";

export type GovernedLexiconEntry = {
  id: number;
  term: string;
  normalizedTerm: string;
  kind: LexiconKind;
  targetType: "canonical_term" | "food_variant" | "none";
  targetRef: string | null;
  locale: string;
  scope: "global" | "user";
  userId: number | null;
  source: "user_confirmed" | "imported" | "system_suggested" | null;
  status: "verified" | "provisional" | "pending_review" | "rejected" | "revoked" | "active";
  confidence: number | null;
  requiresClarification: boolean;
  current: boolean;
  validFrom: Date | null;
  validTo: Date | null;
};

export interface LinguisticLexiconStore {
  load(input: { locale: "pt-BR"; ownerUserId: number | null; revision: string; now: Date }): Promise<readonly GovernedLexiconEntry[]>;
}

export type LinguisticRequest = {
  rawText: string;
  sourceRef: string;
  modality: LinguisticModality;
  /** Source transcript confidence in [0,1], not semantic certainty or verification. */
  transcriptionConfidence?: number | null;
  /** OCR role comes from a validated boundary, never inferred from untrusted label text. */
  imageRegionRole?: "front_identity" | "caption" | "nutrition_label" | "ingredients";
  imageRegion?: FoodObservation["surfaceSpan"]["region"];
  locale?: string | null;
  ownerUserId: number | null;
  lexiconRevision: string;
  now?: Date;
  /**
   * #1306 owns calibration and the production decision to use S3.
   * With no eligibility predicate, S3 is never called.
   */
  shouldInterpretResidual?: (observation: Readonly<FoodObservation>) => boolean;
  interpreterVersion?: string;
};

const residualPayload = z.strictObject({
  alternatives: z.array(z.strictObject({
    foodName: z.string().trim().min(1).max(300),
    confidence: z.number().finite().min(0).max(1).nullable(),
    brand: z.string().trim().min(1).max(200).nullable().optional(),
    variant: z.string().trim().min(1).max(200).nullable().optional(),
    preparation: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    qualifiers: z.array(foodQualifierSchema).max(FOOD_CONTRACT_LIMITS.qualifiers).optional(),
  })).max(FOOD_CONTRACT_LIMITS.alternatives),
});
export type ResidualInterpreter = (input: Readonly<FoodObservation>) => Promise<unknown>;

/**
 * Remove only unambiguous command/destination framing; the canonical operation
 * parser remains the sole owner of the action, date and target meal.
 * The returned offsets continue to address the untouched original turn.
 */
function foodOnlySpan(full: string, segment: Segment): Segment {
  let start = segment.start;
  let end = segment.end;
  let value = segment.text;
  const meal = "(?:café da manhã|cafe da manha|almoço|almoco|jantar|lanche)";
  const prefix = new RegExp(
    "^(?:(?:adicionar|registrar|anotar|comi|consumi)" +
      "(?:\\s+(?:(?:ao|no|na)\\s+" + meal + "))?" +
      "(?:\\s*,\\s*|\\s+)" +
      "|(?:no|na)\\s+" + meal + "(?:\\s*,\\s*|\\s+)(?:comi|consumi)(?:\\s*,\\s*|\\s+))", "iu",
  ).exec(value);
  if (prefix) {
    start += prefix[0].length;
    value = full.slice(start, end);
  } else {
    // A bare meal destination is framing only when a complete quantity-led
    // food phrase follows. Otherwise retain it as original surface evidence.
    const bareMeal = new RegExp("^(?:no|na)\\s+" + meal + "(?:\\s*,)?\\s+", "iu").exec(value);
    if (bareMeal) {
      const following = readQuantity(value.slice(bareMeal[0].length));
      if (following.value !== null && following.name.trim()) {
        start += bareMeal[0].length;
        value = full.slice(start, end);
      }
    }
  }
  // Meal framing may be trailing without an initial command.
  // Its semantic operation belongs exclusively to the canonical parser.
  const suffix = new RegExp(
    "\\s*,?\\s*(?:(?:ao|no|na)\\s+|para\\s+(?:o|a)\\s+)" + meal + "\\s*$", "iu",
  ).exec(value);
  if (suffix && suffix.index > 0) end -= suffix[0].length;
  return trimSpan(full, start, end) ?? segment;
}

function anchor(sourceRef: string, span: Span | null, region: FoodObservation["surfaceSpan"]["region"] = null) {
  return { sourceRef, span, region };
}
function emptyIdentity() {
  return { foodName: null as string | null, brand: null as string | null, variant: null as string | null, preparation: [] as string[], qualifiers: [] as FoodObservation["identityHints"]["qualifiers"], barcode: null as string | null };
}
function emptyQuantity() {
  return { value: null as number | null, unit: null as string | null, servingText: null as string | null, visiblePackageQuantity: null as number | null, visiblePackageUnit: null as string | null };
}
function applicable(entry: GovernedLexiconEntry, owner: number | null, now: Date): boolean {
  if (!Number.isSafeInteger(entry.id) || entry.id <= 0 || !entry.current || entry.locale !== DEFAULT_FOOD_LOCALE) return false;
  if (!isLinguisticLexiconEntryValidAt(entry.validFrom, entry.validTo, now)) return false;
  if (entry.confidence !== null && (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1)) return false;
  if (entry.scope === "user") {
    return owner !== null && entry.userId === owner && entry.source === "user_confirmed" && entry.status === "active";
  }
  return entry.userId === null && entry.status === "verified";
}
/** No ungoverned morphological rewrite of food identity. A plural suffix
 * alone cannot distinguish an ordinary noun from a commercial name. Governed
 * aliases are the only authority for changing the identity hint (S2); S1
 * keeps the observed name and quantity independently of case/inflection.
 */
function selectLexicon(entries: readonly GovernedLexiconEntry[], surface: string, owner: number | null, now: Date): {
  selected: GovernedLexiconEntry | null;
  competing: GovernedLexiconEntry[];
} {
  const key = foldFoodSurface(surface);
  // Unit and portion aliases belong to the quantity slot only, even when
  // their normalized term matches a food name exactly.
  const matches = entries.filter(entry =>
    entry.kind !== "unit_term" && entry.kind !== "portion_term" &&
    applicable(entry, owner, now) && foldFoodSurface(entry.normalizedTerm) === key);
  const personal = matches.filter(entry => entry.scope === "user");
  const eligible = (personal.length ? personal : matches.filter(entry => entry.scope === "global"))
    .sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1) || a.id - b.id);
  // Multiple current meanings are evidence of ambiguity, not permission to
  // select the first row or silently drop candidate meanings.
  return {
    selected: eligible.length === 1 ? eligible[0] : null,
    competing: eligible.length > 1 ? eligible : [],
  };
}
/** Shape alone cannot establish a food role (e.g. an infinitive after a
 * negator). Reuse the pinned lexicon only as exact lexical evidence, without
 * rewriting the source surface or resolving the identity. */
function hasGovernedNominalRole(
  entries: readonly GovernedLexiconEntry[], surface: string, owner: number | null, now: Date,
): boolean {
  const { selected } = selectLexicon(entries, surface, owner, now);
  return selected !== null && selected.kind === "alias_surface" &&
    selected.targetType === "food_variant" && Boolean(selected.targetRef?.trim()) &&
    !selected.requiresClarification;
}

/** S2 may govern the *unit slot* as well as the food-name slot.
 * The lexical snapshot is already owner-scoped, grant-filtered and revision-pinned
 * by the repository; colliding meanings remain alternatives, not defaults.
 */
function governedUnitAliases(
  entries: readonly GovernedLexiconEntry[], owner: number | null, now: Date,
): GovernedUnitAlias[] {
  const groups = new Map<string, GovernedLexiconEntry[]>();
  for (const entry of entries) {
    if ((entry.kind !== "unit_term" && entry.kind !== "portion_term") ||
        !applicable(entry, owner, now)) continue;
    const term = foldFoodSurface(entry.normalizedTerm);
    if (!term || term.length > 160) continue;
    const group = groups.get(term) ?? [];
    group.push(entry);
    groups.set(term, group);
  }
  return [...groups].map(([term, matches]) => {
    const personal = matches.filter(item => item.scope === "user");
    const scoped = personal.length ? personal : matches.filter(item => item.scope === "global");
    const candidates = scoped.flatMap(item => {
      const unit = item.targetType === "canonical_term" ? recognizedUnit(item.targetRef ?? "") : null;
      return unit === null ? [] : [{
        entryId: item.id, unit, confidence: item.confidence, requiresClarification: item.requiresClarification,
      }];
    });
    const selected = scoped.length === 1 && !scoped[0].requiresClarification && candidates.length === 1
      ? candidates[0] : null;
    return { term, unit: selected?.unit ?? null, entryId: selected?.entryId ?? null,
      confidence: selected?.confidence ?? null, candidates };
  });
}

function detectQualifiers(name: string): FoodObservation["identityHints"]["qualifiers"] {
  // Complete material phrases must win over standalone "zero": "zero lactose"
  // is not a claim about sweetening.
  const words = [
    { expression: /\b(?:sem|com|zero)\s+a[cç][uú]car\b/iu, role: "sweetening" },
    { expression: /\b(?:sem|com|zero)\s+lactose\b/iu, role: "lactose" },
    { expression: /\b(?:sem|com|zero)\s+gl[uú]ten\b/iu, role: "gluten" },
    { expression: /\b(?:sem|com|zero)\s+sal\b/iu, role: "sodium" },
    { expression: /\b(?:sem|com|zero)\s+gordura\b/iu, role: "fat_level" },
    { expression: /\b(?:sem|com|zero)\s+cafe[ií]na\b/iu, role: "caffeine" },
    { expression: /\bzero\b(?!\s+(?:a[cç][uú]car|lactose|gl[uú]ten|sal|gordura|cafe[ií]na)\b)/iu, role: "sweetening" },
    { expression: /\blight\b/iu, role: "processing" },
    { expression: /\bdiet\b/iu, role: "processing" },
    { expression: /\bintegral\b/iu, role: "processing" },
    { expression: /\bUHT\b/iu, role: "processing" },
    { expression: /\bdesnatad[ao]s?\b/iu, role: "fat_level" },
    { expression: /\bfrit[ao]s?\b/iu, role: "preparation" },
    { expression: /\bcozid[ao]s?\b/iu, role: "preparation" },
  ];
  return words.flatMap(rule => {
    // Keep every explicit assertion, including opposite values for the same
    // attribute. A single .exec() silently dropped later "com lactose" after
    // "sem lactose" and concealed a material contradiction from downstream.
    const matches = name.matchAll(new RegExp(rule.expression.source, rule.expression.flags + "g"));
    return [...matches].map(match => ({
      offset: match.index, value: match[0], attributeCode: null,
      role: rule.role, confidence: null,
    }));
  }).sort((a, b) => a.offset - b.offset).map(({ offset: _offset, ...qualifier }) => qualifier);
}

const observationIdForPart = (sourceRef: string, index: number) => sourceRef.slice(0, 145) + ":obs:" + index;
type AffectedMaterial = Pick<FoodObservation, "observationId" | "surfaceSpan">;
type MaterialProjection = {
  facts: Map<string, ExplicitIngredientMeasure | ExplicitIngredientNegation | null>;
  withheld: Map<number, AffectedMaterial>;
  pendingIncrements?: Map<string, ExplicitPendingIncrement>;
  measuredPrefixes?: Map<string, AffectedMeasuredPrefix>;
};

function buildObservation(
  request: LinguisticRequest, segment: Segment, index: number, governedUnits: readonly GovernedUnitAlias[] = [],
  preciseSourceEvidence = false, expectedConflictingUnitName?: Span,
): FoodObservation {
  const locale = request.locale === undefined || request.locale === null
    ? { requested: null, effective: DEFAULT_FOOD_LOCALE, status: "defaulted" as const }
    : request.locale === DEFAULT_FOOD_LOCALE
      ? { requested: request.locale, effective: DEFAULT_FOOD_LOCALE, status: "explicit" as const }
      : { requested: request.locale, effective: null, status: "unsupported" as const };
  const supported = locale.status !== "unsupported";
  const foodSegment = foodOnlySpan(request.rawText, segment);
  const sourceSpans: FoodQuantitySourceSpans | undefined = preciseSourceEvidence ? {} : undefined;
  const quantity = supported ? readQuantity(foodSegment.text, governedUnits, false, sourceSpans) : null;
  const candidateName = sourceSpans?.nameAfterConflictingUnit;
  const conflictingName = expectedConflictingUnitName && candidateName &&
    foodSegment.start + candidateName.start === expectedConflictingUnitName.start &&
    foodSegment.start + candidateName.end === expectedConflictingUnitName.end ? candidateName : undefined;
  const name = conflictingName ? foodSegment.text.slice(conflictingName.start, conflictingName.end) :
    supported ? (quantity?.name ?? foodSegment.text).trim() : "";
  const observed = emptyIdentity();
  // A-019: commas coalesced with a qualifier are surface punctuation,
  // not part of the normalized food identity. Raw spans/evidence keep them.
  // Comma-coordinated material qualifiers are syntax, not food identity.
  // Keep the untouched surface/evidence while matching the same S2 alias as
  // "ovos sem lactose" for "ovos, e sem lactose". Do not strip a protected
  // brand coordinator or the conjunction between separate foods.
  const normalizedName = foldFoodSurface(name, true);
  observed.qualifiers = detectQualifiers(name);
  // A-040: a bare nutrient assertion is evidence about an attribute, not a
  // food identity. Reuse the existing qualifier grammar instead of adding
  // a second vocabulary; multiword claims can stand alone, but ambiguous
  // single-word descriptors such as "light" may still be food names.
  // A-041: qualifier syntax may leave only separators and standalone list
  // coordinators. Compare whole tokens so food names such as "azeite" retain
  // their letters, without embedding a second lexical-regex materiality rule.
  const qualifierRemainder = observed.qualifiers
    .reduce((rest, item) => rest.replace(item.value, " "), name)
    .split(/[\s,;]+/u).filter(Boolean);
  const qualifierOnly = observed.qualifiers.length > 0 &&
    observed.qualifiers.every(item => item.value.trim().split(/\s+/u).length > 1) &&
    qualifierRemainder.every(token => token.toLowerCase() === "e");
  observed.foodName = name && !qualifierOnly ? normalizedName : null;
  const originalAnchor = (span: Span | null) => anchor(request.sourceRef, span,
    request.modality === "image" ? request.imageRegion ?? null : null);
  const lexicalAnchor = (span: Span | undefined) => originalAnchor(span
    ? { start: foodSegment.start + span.start, end: foodSegment.start + span.end }
    : { start: foodSegment.start, end: foodSegment.end });
  const q = emptyQuantity();
  if (quantity) {
    q.value = quantity.value;
    q.unit = quantity.unit;
    q.servingText = quantity.servingText;
  }
  const evidence: FoodObservation["evidence"] = [];
  const origin = request.modality === "audio_transcript" ? "transcription" : request.modality === "image" ? "ocr" : "text";
  // Confidence belongs to the transcription evidence, never to the normalized identity.
  const sourceConfidence = request.modality === "audio_transcript"
    ? request.transcriptionConfidence ?? null : null;
  if (name && !qualifierOnly) evidence.push({
    evidenceId: "ev-name-" + index, field: "identity.foodName",
    origin, value: name, unit: null, confidence: sourceConfidence, verified: false,
    anchor: lexicalAnchor(conflictingName ?? sourceSpans?.name), sourceId: null,
  });
  if (qualifierOnly) {
    // Anchor every asserted attribute to its own UTF-16 bytes. Do not emit a
    // fictitious identity.foodName evidence for a qualifier-only utterance.
    let searchFrom = 0;
    observed.qualifiers.forEach((qualifier, qualifierIndex) => {
      const localStart = foodSegment.text.indexOf(qualifier.value, searchFrom);
      const qualifierSpan = localStart < 0
        ? { start: foodSegment.start, end: foodSegment.end }
        : { start: foodSegment.start + localStart,
            end: foodSegment.start + localStart + qualifier.value.length };
      if (localStart >= 0) searchFrom = localStart + qualifier.value.length;
      evidence.push({
        evidenceId: "ev-qualifier-" + index + "-" + qualifierIndex,
        field: "identity.qualifiers", origin, value: qualifier.value,
        unit: null, confidence: sourceConfidence, verified: false,
        anchor: originalAnchor(qualifierSpan), sourceId: null,
      });
    });
  }
  if (q.value !== null) evidence.push({
    evidenceId: "ev-quantity-" + index, field: "quantity.value",
    origin, value: q.value, unit: q.unit, confidence: sourceConfidence, verified: false,
    anchor: lexicalAnchor(sourceSpans?.quantity), sourceId: null,
  });
  // A lexical unit mapping must be distinguishable from the S1 grammar.
  const unitAlias = quantity?.governedAlias;
  if (unitAlias?.entryId !== null && unitAlias?.entryId !== undefined) {
    evidence.push({
      evidenceId: "ev-unit-" + unitAlias.entryId + "-" + index,
      field: "quantity.unit", origin: "catalog", value: unitAlias.term,
      unit: unitAlias.unit, confidence: unitAlias.confidence, verified: false,
      anchor: originalAnchor({ start: foodSegment.start, end: foodSegment.end }), sourceId: null,
    });
  }
  const alternatives: FoodObservation["alternatives"] = [];
  if (unitAlias?.unit === null) {
    for (const candidate of unitAlias.candidates) {
      const interpreted = readQuantity(foodSegment.text, [{ ...unitAlias,
        unit: candidate.unit, entryId: candidate.entryId, confidence: candidate.confidence,
        candidates: [candidate] }]);
      alternatives.push({
        hypothesisId: "unit-" + candidate.entryId,
        identityHints: { ...observed, foodName: foldFoodSurface(interpreted.name) },
        quantityHints: { ...q, value: interpreted.value, unit: interpreted.unit,
          servingText: interpreted.servingText },
        evidenceIds: [], confidence: candidate.confidence,
      });
    }
  }
  if (alternatives.length > FOOD_CONTRACT_LIMITS.alternatives) throw new Error("linguistic-ambiguity-limit");
  const normalizationPath: FoodObservation["normalizationPath"] = supported ? [{
    stage: "S1", origin: "deterministic", lexiconEntryId: null,
    anchor: originalAnchor({ start: foodSegment.start, end: foodSegment.end }), confidence: null,
  }] : [];
  if (unitAlias?.entryId !== null && unitAlias?.entryId !== undefined) {
    normalizationPath.push({ stage: "S2", origin: "lexicon", lexiconEntryId: unitAlias.entryId,
      anchor: originalAnchor({ start: foodSegment.start, end: foodSegment.end }),
      confidence: unitAlias.confidence });
  }
  return {
    schemaVersion: 2, observationId: observationIdForPart(request.sourceRef, index),
    modality: request.modality, rawInput: request.rawText,
    normalizedInput: supported && !qualifierOnly ? normalizedName || null : null, locale,
    surfaceSpan: originalAnchor({ start: foodSegment.start, end: foodSegment.end }),
    identityHints: observed, quantityHints: q, evidence,
    normalizationPath, alternatives,
    unresolvedReason: !supported ? "unsupported_locale" : conflictingName ? "source_conflict" : "unknown_surface",
    lexiconRevision: request.lexiconRevision, interpreterVersion: null,
  };
}

function withLexicon(observation: FoodObservation, entry: GovernedLexiconEntry, entries: readonly GovernedLexiconEntry[], owner: number | null, now: Date): FoodObservation {
  const snapshot = { ...observation, identityHints: { ...observation.identityHints }, evidence: [...observation.evidence], normalizationPath: [...observation.normalizationPath], alternatives: [...observation.alternatives] };
  const before = snapshot.identityHints.foodName ?? "";
  const target = entry.targetType === "canonical_term" ? foldFoodSurface(entry.targetRef?.trim() ?? "") : "";
  const qualifierKey = (value: string) => foldFoodSurface(value).replace(/s$/u, "");
  const currentQualifiers = detectQualifiers(before).map(item => qualifierKey(item.value));
  const targetQualifiers = detectQualifiers(target).map(item => qualifierKey(item.value));
  const changesQualifiers = currentQualifiers.some(item => !targetQualifiers.includes(item)) || targetQualifiers.some(item => !currentQualifiers.includes(item));
  const protectedTerms = entries.filter(item => item.kind === "protected_token" && applicable(item, owner, now))
    .map(item => foldFoodSurface(item.normalizedTerm));
  const wordBoundaryContains = (full: string, term: string) =>
    full.split(/\s+/u).some((_, index, words) => words.slice(index, index + term.split(" ").length).join(" ") === term);
  const dropsProtectedToken = protectedTerms.some(term =>
    wordBoundaryContains(foldFoodSurface(before), term) && !wordBoundaryContains(foldFoodSurface(target), term));
  const requiresHypothesis = entry.kind === "typo" || entry.targetType === "food_variant" ||
    entry.requiresClarification || changesQualifiers || dropsProtectedToken;
  if (requiresHypothesis && entry.targetRef) {
    snapshot.alternatives.push({
      hypothesisId: "lex-" + entry.id,
      identityHints: { ...snapshot.identityHints, foodName: target || before, variant: entry.targetType === "food_variant" ? entry.targetRef : snapshot.identityHints.variant },
      quantityHints: { ...snapshot.quantityHints }, evidenceIds: [], confidence: entry.confidence,
    });
    snapshot.unresolvedReason = "unknown_surface";
  } else if (target && entry.kind !== "protected_token") {
    snapshot.identityHints.foodName = target;
    snapshot.identityHints.qualifiers = detectQualifiers(target);
    snapshot.normalizedInput = target;
    snapshot.unresolvedReason = null;
  }
  snapshot.normalizationPath.push({
    stage: "S2", origin: "lexicon", lexiconEntryId: entry.id, anchor: snapshot.surfaceSpan,
    confidence: entry.confidence,
  });
  snapshot.evidence.push({
    evidenceId: "ev-lex-" + entry.id + "-" + snapshot.observationId.slice(-6),
    field: "identity.foodName", origin: "catalog", value: before,
    unit: null, confidence: entry.confidence, verified: false,
    anchor: snapshot.surfaceSpan, sourceId: null,
  });
  return snapshot;
}

function addResidual(
  observation: FoodObservation, payload: unknown, interpreterVersion: string, observationIndex: number,
): FoodObservation {
  const parsed = residualPayload.safeParse(payload);
  if (!parsed.success) throw new Error("invalid-linguistic-interpreter-response");
  const alternatives = [...observation.alternatives];
  const evidence = [...observation.evidence];
  const hypotheses = [...parsed.data.alternatives].sort((a, b) =>
    (b.confidence ?? -1) - (a.confidence ?? -1) || a.foodName.localeCompare(b.foodName));
  for (let i = 0; i < hypotheses.length; i++) {
    const proposed = hypotheses[i];
    const existing = observation.identityHints;
    // A proposal may hide contradictory assertions in foodName while omitting
    // qualifiers. Check both sources and reject internal polarity conflicts.
    const proposedQualifiers = detectQualifiers(proposed.foodName);
    // Keep qualified assertions embedded in the suggested name even when the
    // interpreter omits qualifiers[]. Structured duplicates enrich, not repeat,
    // the inferred qualifier and must not change its semantic role.
    for (const structured of proposed.qualifiers ?? []) {
      const index = proposedQualifiers.findIndex(inferred =>
        foldFoodSurface(inferred.value) === foldFoodSurface(structured.value));
      if (index < 0) {
        proposedQualifiers.push(structured);
      } else {
        const inferred = proposedQualifiers[index];
        if (inferred.role && structured.role && inferred.role !== structured.role) {
          throw new Error("contradictory-linguistic-interpreter-role");
        }
        proposedQualifiers[index] = {
          ...inferred, ...structured,
          role: inferred.role ?? structured.role,
          confidence: structured.confidence ?? inferred.confidence,
        };
      }
    }
    for (const qualifier of proposedQualifiers) {
      if (qualifier.role !== null && existing.qualifiers.some(explicit =>
        explicit.role === qualifier.role &&
        foldFoodSurface(explicit.value) !== foldFoodSurface(qualifier.value))) {
        throw new Error("contradictory-linguistic-interpreter-qualifier");
      }
      if (qualifier.role !== null && proposedQualifiers.some(other =>
        other !== qualifier && other.role === qualifier.role &&
        foldFoodSurface(other.value) !== foldFoodSurface(qualifier.value))) {
        throw new Error("internally-contradictory-linguistic-interpreter-qualifier");
      }
    }
    if (proposed.preparation?.length && existing.qualifiers.some(q =>
      q.role === "preparation" &&
      !proposed.preparation!.some(value => foldFoodSurface(value) === foldFoodSurface(q.value)))) {
      throw new Error("contradictory-linguistic-interpreter-preparation");
    }
    const evidenceIds: string[] = [];
    const addEvidence = (field: string, value: string, confidence: number | null) => {
      const evidenceId = "ev-s3-" + observationIndex + "-" + i + "-" + evidenceIds.length;
      evidence.push({
        evidenceId, field, origin: "ai_estimate", value, unit: null,
        confidence, verified: false, anchor: observation.surfaceSpan, sourceId: null,
      });
      evidenceIds.push(evidenceId);
    };
    addEvidence("identity.foodName", proposed.foodName, proposed.confidence);
    if (proposed.brand) addEvidence("identity.brand", proposed.brand, proposed.confidence);
    if (proposed.variant) addEvidence("identity.variant", proposed.variant, proposed.confidence);
    for (const preparation of proposed.preparation ?? []) {
      addEvidence("identity.preparation", preparation, proposed.confidence);
    }
    for (const qualifier of proposedQualifiers) {
      addEvidence("identity.qualifiers", qualifier.value, qualifier.confidence ?? proposed.confidence);
    }
    const qualifiers = [...existing.qualifiers];
    for (const qualifier of proposedQualifiers) {
      if (!qualifiers.some(value => foldFoodSurface(value.value) === foldFoodSurface(qualifier.value))) {
        qualifiers.push(qualifier);
      }
    }
    const preparation = [...existing.preparation];
    for (const value of proposed.preparation ?? []) {
      if (!preparation.some(item => foldFoodSurface(item) === foldFoodSurface(value))) {
        preparation.push(value);
      }
    }
    alternatives.push({
      hypothesisId: "s3-" + observationIndex + "-" + i,
      identityHints: {
        ...existing, foodName: proposed.foodName,
        brand: proposed.brand ?? existing.brand,
        variant: proposed.variant ?? existing.variant,
        preparation, qualifiers,
      },
      quantityHints: { ...observation.quantityHints }, evidenceIds,
      confidence: proposed.confidence,
    });
  }
  return {
    ...observation, evidence, alternatives, interpreterVersion,
    normalizationPath: [...observation.normalizationPath, {
      stage: "S3", origin: "interpreter", lexiconEntryId: null,
      anchor: observation.surfaceSpan, confidence: null,
    }],
    unresolvedReason: alternatives.length ? "unknown_surface" : observation.unresolvedReason,
  };
}

/**
 * A LCL não persiste, consulta nutrição, cria MealOperation ou pergunta ao usuário.
 * Falha do repositório governado é explícita, nunca reclassificada como "sem léxico".
 * O caller passa owner autorizado e revisão fixada pelo envelope V2.
 */
export async function comprehendFoodLanguage(
  request: LinguisticRequest, lexicon: LinguisticLexiconStore,
  interpreter?: ResidualInterpreter,
  material?: MaterialProjection,
): Promise<FoodObservation[]> {
  if (!request.rawText.trim() || request.rawText.length > FOOD_CONTRACT_LIMITS.rawText ||
      !request.sourceRef.trim() || request.sourceRef.length > 145 ||
      !request.lexiconRevision.trim() || request.lexiconRevision.length > FOOD_CONTRACT_LIMITS.shortText ||
      request.ownerUserId !== null && (!Number.isSafeInteger(request.ownerUserId) || request.ownerUserId <= 0)) {
    throw new Error("invalid-linguistic-input");
  }
  // Reject unsupported channel metadata and invalid numeric confidence before any
  // lexicon/provider access. Missing transcript confidence stays explicitly null.
  if ((request.modality !== "audio_transcript" &&
       request.transcriptionConfidence !== undefined) ||
      (request.transcriptionConfidence != null &&
       (!Number.isFinite(request.transcriptionConfidence) ||
        request.transcriptionConfidence < 0 || request.transcriptionConfidence > 1))) {
    throw new Error("invalid-linguistic-transcription-confidence");
  }
  // Only an absent instant defaults to the current time; an explicit null is invalid.
  const now = request.now === undefined ? new Date() : request.now;
  if (!isLinguisticLexiconEntryValidAt(null, null, now) ||
      request.modality !== "image" && (request.imageRegion !== undefined || request.imageRegionRole !== undefined) ||
      request.modality === "image" && request.imageRegion !== undefined &&
        (request.imageRegion === null ||
          ![request.imageRegion.x, request.imageRegion.y, request.imageRegion.width,
            request.imageRegion.height].every(value => Number.isFinite(value)) ||
          request.imageRegion.x < 0 || request.imageRegion.y < 0 ||
          request.imageRegion.width <= 0 || request.imageRegion.height <= 0 ||
          request.imageRegion.x + request.imageRegion.width > 1 ||
          request.imageRegion.y + request.imageRegion.height > 1)) {
    throw new Error("invalid-linguistic-region-or-time");
  }
  // OCR label sections are not meal items. Keep exactly one evidence-only
  // observation so ingredient lines never become separate foods.
  const evidenceOnlyImage = request.modality === "image" &&
    request.imageRegionRole !== "front_identity" && request.imageRegionRole !== "caption";
  if (request.locale !== null && request.locale !== undefined && request.locale !== DEFAULT_FOOD_LOCALE) {
    const unsupportedParts = evidenceOnlyImage
      ? [{ text: request.rawText, start: 0, end: request.rawText.length }]
      : splitFoodSurface(request.rawText);
    if (unsupportedParts.length > FOOD_CONTRACT_LIMITS.observations) throw new Error("linguistic-observation-limit");
    return unsupportedParts.map((part, index) => validate(buildObservation(request, part, index)));
  }
  if (evidenceOnlyImage) {
    const item = buildObservation(request,
      { text: request.rawText, start: 0, end: request.rawText.length }, 0);
    const region = request.imageRegion ?? null;
    const spanAnchor = { ...item.surfaceSpan, region };
    item.surfaceSpan = spanAnchor;
    item.normalizedInput = null;
    item.identityHints = emptyIdentity();
    item.quantityHints = emptyQuantity();
    item.normalizationPath = [];
    item.evidence = [{
      evidenceId: "ev-ocr-0", field: request.imageRegionRole === "nutrition_label"
        ? "nutrition.basis" : "identity.qualifiers",
      origin: "ocr", value: request.rawText, unit: null, confidence: null,
      verified: false, anchor: spanAnchor, sourceId: null,
    }];
    item.unresolvedReason = "unknown_surface";
    return [validate(item)];
  }
  const entries = await lexicon.load({ locale: DEFAULT_FOOD_LOCALE, ownerUserId: request.ownerUserId, revision: request.lexiconRevision, now });
  if (entries.length > 5000) throw new Error("linguistic-lexicon-limit");
  const units = governedUnitAliases(entries, request.ownerUserId, now);
  // A-026: an ungoverned splitter must not preempt the protected S2 snapshot.
  // Revoked, expired, pending and other-user terms are never shielding rules.
  const protectedTerms = entries.filter(entry =>
    entry.kind === "protected_token" && applicable(entry, request.ownerUserId, now),
  ).map(entry => entry.normalizedTerm);
  const syntax: MaterialSegmentSyntax[] | undefined = material ? [] : undefined;
  const parsedParts = splitFoodSurface(request.rawText, units, protectedTerms, syntax,
    material?.pendingIncrements !== undefined, material?.measuredPrefixes !== undefined);
  if (parsedParts.length > FOOD_CONTRACT_LIMITS.observations) throw new Error("linguistic-observation-limit");
  const results: FoodObservation[] = [];
  for (let i = 0; i < parsedParts.length; i++) {
    const part = parsedParts[i];
    const segmentSyntax = syntax?.[i];
    const withheld = segmentSyntax?.withheldScope;
    if (material && withheld) {
      // This scope has no buildable observation. Keep its original position
      // and count already-checked parts before omitting internal soft splits.
      if (!material.withheld.has(withheld.start)) {
        material.withheld.set(withheld.start, {
          observationId: observationIdForPart(request.sourceRef, i),
          surfaceSpan: anchor(request.sourceRef, withheld),
        });
      }
      continue;
    }
    let observation = buildObservation(request, part, i, units, material !== undefined);
    // Governed exact aliases (including personal confirmed aliases) take
    // precedence over a lossy morphological interpretation of their surface.
    const exactChoice = selectLexicon(
      entries, observation.identityHints.foodName ?? "", request.ownerUserId, now,
    );
    let conflictingUnitPending = false;
    if (material && segmentSyntax) {
      const previous = results.at(-1);
      const previousIsMaterial = previous !== undefined && material.facts.has(previous.observationId);
      const constituent = exactChoice.selected || exactChoice.competing.length
        ? null : segmentSyntax.measure ?? segmentSyntax.negation;
      // Meal/command framing is excluded by the existing observation scope.
      // A constituent crossing that scope is not an ingredient occurrence.
      const span = observation.surfaceSpan.span;
      if (constituent && span) {
        const from = "operator" in constituent ? constituent.operator.start : constituent.measureSpan.start;
        if (from >= span.start && constituent.ingredient.end <= span.end) {
          const conflictingOwnerName = "operator" in constituent ? constituent.conflictingGovernedOwner : undefined;
          const owner = buildObservation(request, constituent.owner, i, units, true, conflictingOwnerName);
          let rolesProven = true;
          if ("operator" in constituent) {
            const name = owner.evidence.find(item => item.field === "identity.foodName");
            const nameSpan = name?.anchor.span;
            // Use the exact name evidence, not a normalized guess from the
            // entire clause. Both slots must independently prove a food role.
            // The already-governed name can add one identity hypothesis. If
            // retaining it would exhaust the existing wire budget, abstain.
            rolesProven = !!nameSpan && name?.anchor.sourceRef === request.sourceRef &&
              nameSpan.start >= span.start && nameSpan.end <= from &&
              (!conflictingOwnerName ||
                nameSpan.start === conflictingOwnerName.start && nameSpan.end === conflictingOwnerName.end &&
                owner.alternatives.length < FOOD_CONTRACT_LIMITS.alternatives) &&
              typeof name.value === "string" &&
              request.rawText.slice(nameSpan.start, nameSpan.end) === name.value &&
              hasGovernedNominalRole(entries, name.value, request.ownerUserId, now) &&
              hasGovernedNominalRole(entries, constituent.ingredient.text, request.ownerUserId, now);
          }
          if (owner.identityHints.foodName !== null && rolesProven) {
            observation = { ...owner, surfaceSpan: observation.surfaceSpan };
            conflictingUnitPending = conflictingOwnerName !== undefined;
            material.facts.set(observation.observationId, constituent);
          }
        }
      }
      // An unresolved clause does not end scope: otherwise a second conjoined
      // unknown would leak as an independent food merely because the first abstained.
      const ambiguousSibling = previousIsMaterial && segmentSyntax.continuation;
      if (!material.facts.has(observation.observationId) &&
          (ambiguousSibling || segmentSyntax.materialOperator)) {
        material.facts.set(observation.observationId, null);
        if (segmentSyntax.pendingIncrement && !exactChoice.selected && exactChoice.competing.length === 0 &&
            span?.start === part.start && span.end === part.end) {
          material.pendingIncrements?.set(observation.observationId, segmentSyntax.pendingIncrement);
        }
        const trial = segmentSyntax.measuredPrefixPending;
        if (trial && material.measuredPrefixes && !exactChoice.selected && !exactChoice.competing.length &&
            span?.start === part.start && span.end === part.end &&
            (!trial.requiresPriorMeasuredSibling || (previous && previousIsMaterial &&
              material.facts.get(previous.observationId) !== null))) {
          const proof = projectMeasuredPrefix(request, trial, part, entries, now);
          if (proof) material.measuredPrefixes.set(observation.observationId, proof);
        }
      }
    }
    const lexiconChoice = exactChoice.selected || exactChoice.competing.length
      ? exactChoice
      : selectLexicon(entries, observation.identityHints.foodName ?? "", request.ownerUserId, now);
    if (lexiconChoice.selected) {
      observation = withLexicon(observation, lexiconChoice.selected, entries, request.ownerUserId, now);
      // This lexical identity hypothesis cannot settle a different slot.
      if (conflictingUnitPending) observation.unresolvedReason = "source_conflict";
    } else if (lexiconChoice.competing.length > 0) {
      if (lexiconChoice.competing.length > FOOD_CONTRACT_LIMITS.alternatives) {
        throw new Error("linguistic-ambiguity-limit");
      }
      observation.alternatives = lexiconChoice.competing.map(item => ({
        hypothesisId: "lex-" + item.id,
        identityHints: { ...observation.identityHints,
          foodName: item.targetType === "canonical_term" && item.targetRef
            ? foldFoodSurface(item.targetRef) : observation.identityHints.foodName },
        quantityHints: { ...observation.quantityHints },
        evidenceIds: [], confidence: item.confidence,
      }));
      observation.normalizationPath.push(...lexiconChoice.competing.map(item => ({
        stage: "S2" as const, origin: "lexicon" as const,
        lexiconEntryId: item.id, anchor: observation.surfaceSpan,
        confidence: item.confidence,
      })));
    }
    observation = validate(observation);
    if (observation.unresolvedReason !== null && request.shouldInterpretResidual?.(observation) && interpreter) {
      if (!request.interpreterVersion?.trim()) throw new Error("linguistic-interpreter-version-required");
      try {
        observation = validate(addResidual(observation, await interpreter(observation), request.interpreterVersion, i));
      } catch {
        // No silent provider fallback: record a typed unavailable evidence with
        // no invented name, nutrition, or interpreter normalization step.
        observation = validate({
          ...observation, unresolvedReason: "provider_unavailable",
          evidence: [...observation.evidence, {
            evidenceId: "ev-s3-unavailable-" + i, field: "identity.foodName",
            origin: "unavailable", value: null, unit: null, confidence: null,
            verified: false, anchor: observation.surfaceSpan, sourceId: null,
          }],
        });
      }
    }
    results.push(observation);
  }
  return results;
}

type MaterialLanguageResult =
  | { ok: true; observations: FoodMaterialObservation[] }
  | { ok: false; reason: "unsupported-input" | "invalid-material-observations" }
  | { ok: false; reason: "unproven-material";
      affected: Pick<FoodObservation, "observationId" | "surfaceSpan">[];
      observations: FoodMaterialObservation[] };

export type FoodMaterialLanguageResult = MaterialLanguageResult & { diagnosticProfile?: never };

const pendingIncrementProfile = "r3-pending-increment-v1" as const;
type PendingIncrementDiagnostic = { diagnosticProfile: typeof pendingIncrementProfile } & (
  Exclude<MaterialLanguageResult, { reason: "unproven-material" }> |
  { ok: false; reason: "unproven-material";
    affected: (AffectedMaterial & { pendingObservation?: FoodMaterialObservation })[];
    observations: FoodMaterialObservation[] }
);

/** Internal fixture/diagnostic producer. No provider, resolver or persistent
 * consumer accepts this shape. Unsupported clauses cannot yield a batch pass. */
export async function comprehendFoodMaterialLanguage(
  request: LinguisticRequest, lexicon: LinguisticLexiconStore,
): Promise<FoodMaterialLanguageResult> {
  return collectFoodMaterialLanguage(request, lexicon);
}

/** The explicitly selected diagnostic profile does not redefine legacy R3
 * observations. Full canonical pending observations are confined to affected.
 */
export async function diagnoseFoodMaterialPendingIncrements(
  request: LinguisticRequest, lexicon: LinguisticLexiconStore,
): Promise<PendingIncrementDiagnostic> {
  const pending = new Map<string, FoodMaterialObservation>();
  const result = await collectFoodMaterialLanguage(request, lexicon, pending);
  if (!("affected" in result)) return { ...result, diagnosticProfile: pendingIncrementProfile };
  return { ...result, diagnosticProfile: pendingIncrementProfile,
    affected: result.affected.map(row => {
      const pendingObservation = pending.get(row.observationId);
      return pendingObservation ? { ...row, pendingObservation } : row;
    }),
  };
}

const measuredPrefixProfile = "r3-measured-prefix-pending-local-prototype-v2" as const;
// This is lexical provenance for a withheld clause, not a meal item. Neither
// the sidecar nor its children can pass a FoodObservation decoder detached.
type AffectedMeasuredPrefix = {
  kind: "withheld-lexical-evidence";
  materializable: false;
  sourceRef: string;
  modality: "text" | "audio_transcript";
  lexiconRevision: string;
  clause: Span;
  measuredSurface: {
    kind: "lexically-attributed-measure";
    materializable: false;
    span: Span;
    nominalSurface: { kind: "literal-not-resolved-identity"; span: Span; literal: string };
    measure: { span: Span; literal: string; value: number; unit: string; literalUnit: string };
  };
  pendingSurface: {
    kind: "indefinite-increment-without-binding";
    materializable: false;
    span: Span;
    operator: { span: Span; literal: string };
    owner: null;
    target: null;
    amount: null;
  };
};

function projectMeasuredPrefix(
  request: LinguisticRequest, trial: MeasuredPrefixPendingSyntax, part: Segment,
  entries: readonly GovernedLexiconEntry[], now: Date,
): AffectedMeasuredPrefix | null {
  if (request.modality !== "text" && request.modality !== "audio_transcript") return null;
  if (detectQualifiers(trial.name.text).length) return null;
  // An applicable competing lexical interpretation in any of these slots is
  // an abstention, even when S1 did not consult that kind of alias. Do not
  // mistake an active unit/portion term for a nominal or vice versa.
  const slots = [trial.name.text, trial.unitSurface, trial.tail.text].map(x => " " + foldFoodSurface(x) + " ");
  if (entries.some(e => {
    if (!applicable(e, request.ownerUserId, now)) return false;
    const term = foldFoodSurface(e.normalizedTerm);
    return !!term && slots.some(slot => slot.includes(" " + term + " "));
  })) return null;

  const span = ({ start, end }: Span) => ({ start, end });
  return {
    kind: "withheld-lexical-evidence", materializable: false, sourceRef: request.sourceRef,
    modality: request.modality, lexiconRevision: request.lexiconRevision, clause: span(part),
    measuredSurface: {
      kind: "lexically-attributed-measure", materializable: false, span: span(trial.prefix),
      nominalSurface: { kind: "literal-not-resolved-identity", span: span(trial.name), literal: trial.name.text },
      measure: { span: span(trial.amount), literal: trial.amount.text, value: trial.value, unit: trial.unit,
        literalUnit: trial.unitSurface },
    },
    pendingSurface: {
      kind: "indefinite-increment-without-binding", materializable: false, span: span(trial.tail),
      operator: { span: span(trial.operator), literal: trial.operator.text },
      owner: null, target: null, amount: null,
    },
  };
}

type MeasuredPrefixDiagnostic = { diagnosticProfile: typeof measuredPrefixProfile } & (
  Exclude<MaterialLanguageResult, { reason: "unproven-material" }> |
  { ok: false; reason: "unproven-material";
    affected: (AffectedMaterial & { evidenceOnly?: AffectedMeasuredPrefix })[];
    observations: FoodMaterialObservation[] }
);

/** Prototype only: never project either child into ordinary observations. */
export async function diagnoseFoodMaterialMeasuredPrefixPending(
  request: LinguisticRequest, lexicon: LinguisticLexiconStore,
): Promise<MeasuredPrefixDiagnostic> {
  const proof = new Map<string, AffectedMeasuredPrefix>();
  const result = await collectFoodMaterialLanguage(request, lexicon, undefined, proof);
  if (!("affected" in result)) return { ...result, diagnosticProfile: measuredPrefixProfile };
  return { ...result, diagnosticProfile: measuredPrefixProfile,
    affected: result.affected.map(row => {
      const evidenceOnly = proof.get(row.observationId);
      return evidenceOnly ? { ...row, evidenceOnly } : row;
    }),
  };
}

async function collectFoodMaterialLanguage(
  request: LinguisticRequest, lexicon: LinguisticLexiconStore,
  pending?: Map<string, FoodMaterialObservation>,
  measuredPrefix?: Map<string, AffectedMeasuredPrefix>,
): Promise<FoodMaterialLanguageResult> {
  const [textModality, transcriptModality] = FOOD_INPUT_TYPES;
  const modality = request.modality;
  if (modality !== textModality && modality !== transcriptModality ||
      request.locale != null && request.locale !== DEFAULT_FOOD_LOCALE) {
    return { ok: false, reason: "unsupported-input" };
  }
  const material: MaterialProjection = {
    facts: new Map(), withheld: new Map(), pendingIncrements: pending ? new Map() : undefined,
    measuredPrefixes: measuredPrefix,
  };
  const base = await comprehendFoodLanguage({
    ...request, shouldInterpretResidual: undefined, interpreterVersion: undefined,
  }, lexicon, undefined, material);
  if (base.some(item => item.modality !== modality)) {
    return { ok: false, reason: "invalid-material-observations" };
  }
  const affected = [...material.withheld.values()];
  const candidates = base.flatMap<FoodMaterialObservation>(observation => {
    const fact = material.facts.get(observation.observationId);
    if (fact === null) {
      const { observationId, surfaceSpan } = observation;
      affected.push({ observationId, surfaceSpan });
      const increment = material.pendingIncrements?.get(observationId);
      if (increment && pending) {
        const claimId = observationId + ":material";
        const operatorEvidenceId = claimId + ":operator";
        const amountId = claimId + ":amount";
        const evidence = {
          origin: modality === transcriptModality ? "transcription" as const : "text" as const,
          confidence: request.transcriptionConfidence ?? null, verified: false, sourceId: null,
        };
        pending.set(observationId, {
          ...observation, modality, schemaVersion: FOOD_MATERIAL_OBSERVATION_SCHEMA_VERSION,
          normalizedInput: null, identityHints: emptyIdentity(), quantityHints: emptyQuantity(),
          alternatives: [], normalizationPath: [], unresolvedReason: "unknown_surface",
          evidence: [{
            ...evidence, evidenceId: operatorEvidenceId, field: "material.increment", value: increment.operator.text,
            unit: null, anchor: anchor(request.sourceRef, { start: increment.operator.start, end: increment.operator.end }),
          }, {
            ...evidence, evidenceId: amountId, field: "material.amount", value: increment.value, unit: increment.unit,
            anchor: anchor(request.sourceRef, increment.measureSpan),
          }],
          materialClaims: [{
            kind: "increment", claimId, operatorEvidenceId, ingredient: null, target: null,
            binding: { status: "unresolved", reason: "owner_unknown", candidateObservationIds: [] },
            unresolvedAmount: { value: increment.value, unit: increment.unit, evidenceId: amountId },
          }],
        });
      }
      return []; // Never expose a guessed food for the clause that needs clarification.
    }
    const candidate: FoodMaterialObservation = {
      ...observation, modality,
      schemaVersion: FOOD_MATERIAL_OBSERVATION_SCHEMA_VERSION, materialClaims: [],
    };
    if (!fact) return [candidate];
    const claimId = observation.observationId + ":material";
    const ingredientId = claimId + ":ingredient";
    const origin = modality === transcriptModality ? "transcription" : "text";
    const evidence = {
      origin, confidence: request.transcriptionConfidence ?? null, verified: false, sourceId: null,
    } as const;
    const binding = { status: "bound", ownerObservationId: observation.observationId } as const;
    const sourceEvidence = <Field extends "material.ingredient" | "material.negation">(
      field: Field, evidenceId: string, source: Segment,
    ) => ({
      ...evidence, evidenceId, field, value: source.text, unit: null,
      anchor: anchor(request.sourceRef, { start: source.start, end: source.end }),
    });
    if ("operator" in fact) {
      const operatorEvidenceId = claimId + ":operator";
      return [{
        ...candidate,
        materialClaims: [{
          kind: "negation", claimId, binding,
          ingredient: { name: fact.ingredient.text, evidenceId: ingredientId },
          operatorEvidenceId,
        }],
        evidence: [...observation.evidence,
          sourceEvidence("material.ingredient", ingredientId, fact.ingredient),
          sourceEvidence("material.negation", operatorEvidenceId, fact.operator)],
      }];
    }
    const amountId = claimId + ":amount";
    return [{
      ...candidate, materialClaims: [{
        kind: "ingredient", claimId,
        binding, ingredient: { name: fact.ingredient.text, evidenceId: ingredientId },
        amount: { value: fact.value, unit: fact.unit, evidenceId: amountId },
      }], evidence: [...observation.evidence, sourceEvidence("material.ingredient", ingredientId, fact.ingredient), {
        ...evidence, evidenceId: amountId, field: "material.amount", ingredientEvidenceId: ingredientId,
        value: fact.value, unit: fact.unit, anchor: anchor(request.sourceRef, fact.measureSpan),
      }],
    }];
  });
  // Only canonical children of the older profile enter the wire validator.
  // Measured-prefix extras are inert lexical projections, never observations.
  const checked = parseFoodMaterialObservationBatch(pending ? [...candidates, ...pending.values()] : candidates);
  if (!checked.ok) return { ok: false, reason: "invalid-material-observations" };
  if (pending) {
    pending.clear();
    for (const row of checked.value.slice(candidates.length)) pending.set(row.observationId, row);
  }
  const observations = pending ? checked.value.slice(0, candidates.length) : checked.value;
  return affected.length
    ? { ok: false, reason: "unproven-material",
      affected: affected.sort((left, right) => left.surfaceSpan.span!.start - right.surfaceSpan.span!.start),
      observations }
    : { ok: true, observations };
}

function validate(input: FoodObservation): FoodObservation {
  const checked = parseFoodObservation(input);
  if (!checked.ok) throw new Error("invalid-food-observation:" + checked.code);
  return checked.value;
}
