/**
 * #1304 — Camada de Compreensão Linguística V2, sem cutover de entrypoints.
 * Observa a superfície: nunca resolve variante, nutrição ou MealOperation.
 * Fonte: ADR Food Intelligence Resolver V2 §4.1–4.2 e §7.1.1.
 */
import { z } from "zod";
import { DEFAULT_FOOD_LOCALE, FOOD_CONTRACT_LIMITS } from "./contracts";
import { foodQualifierSchema } from "./schemaShared";
import { foldFoodSurface, readQuantity, splitFoodSurface, trimSpan } from "./linguisticSurface";
import type { Segment, Span } from "./linguisticSurface";
export { foldFoodSurface, splitFoodSurface } from "./linguisticSurface";
import { parseFoodObservation, type FoodObservation } from "./schemas";

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
  const prefix = /^(?:adicionar\s+(?:(?:ao|no|na)\s+(?:café da manhã|cafe da manha|almoço|almoco|jantar|lanche)\s+)?|(?:no|na)\s+(?:café da manhã|cafe da manha|almoço|almoco|jantar|lanche)\s+(?:comi|consumi)\s+)/iu.exec(value);
  if (prefix) {
    start += prefix[0].length;
    value = full.slice(start, end);
    const suffix = /\s+(?:(?:ao|no|na)\s+|para\s+(?:o|a)\s+)(?:café da manhã|cafe da manha|almoço|almoco|jantar|lanche)\s*$/iu.exec(value);
    if (suffix) end -= suffix[0].length;
  }
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
  if (entry.validFrom && entry.validFrom > now || entry.validTo && entry.validTo <= now) return false;
  if (entry.confidence !== null && (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1)) return false;
  if (entry.scope === "user") {
    return owner !== null && entry.userId === owner && entry.source === "user_confirmed" && entry.status === "active";
  }
  return entry.userId === null && entry.status === "verified";
}
/**
 * Fold only regular -os/-as agreement with an explicit plural count. Preserve
 * irregular endings, unknown protected commercial tokens and the raw evidence.
 * The governed lexicon can still supply irregular, contextual inflection.
 */
function withSafeRegularAgreement(
  observation: FoodObservation, entries: readonly GovernedLexiconEntry[],
  owner: number | null, now: Date,
): FoodObservation {
  const original = observation.identityHints.foodName;
  if (!original || observation.quantityHints.value === null ||
      observation.quantityHints.value <= 1) return observation;
  const protectedTerms = entries.filter(entry =>
    entry.kind === "protected_token" && applicable(entry, owner, now))
    .map(entry => foldFoodSurface(entry.normalizedTerm));
  const protectedWords = new Set(protectedTerms.flatMap(term => term.split(/\s+/u)));
  const tokens = original.split(/\s+/u);
  const inflected = tokens.map(token => {
    if (protectedWords.has(token)) return token;
    const match = /^(.{2,}[ao])s$/u.exec(token);
    return match ? match[1] : token;
  });
  const changed = inflected.filter((token, index) => token !== tokens[index]).length;
  // A single unknown -os/-as token can be a brand (e.g. Doritos), not a
  // common noun. Do not rewrite its identity without agreement evidence.
  if (changed < 2) return observation;
  const regular = inflected.join(" ");
  return {
    ...observation, normalizedInput: regular,
    identityHints: {
      ...observation.identityHints, foodName: regular,
      qualifiers: detectQualifiers(regular),
    },
  };
}

function selectLexicon(entries: readonly GovernedLexiconEntry[], surface: string, owner: number | null, now: Date): {
  selected: GovernedLexiconEntry | null;
  competing: GovernedLexiconEntry[];
} {
  const key = foldFoodSurface(surface);
  const matches = entries.filter(entry => applicable(entry, owner, now) && foldFoodSurface(entry.normalizedTerm) === key);
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
function detectQualifiers(name: string): FoodObservation["identityHints"]["qualifiers"] {
  const words = [
    { expression: /\bsem a[cç][uú]car\b/iu, role: "sweetening" },
    { expression: /\bcom a[cç][uú]car\b/iu, role: "sweetening" },
    { expression: /\bzero\b/iu, role: "sweetening" },
    { expression: /\blight\b/iu, role: "processing" },
    { expression: /\bdiet\b/iu, role: "processing" },
    { expression: /\bintegral\b/iu, role: "processing" },
    { expression: /\bdesnatad[ao]s?\b/iu, role: "fat_level" },
    { expression: /\bfrit[ao]s?\b/iu, role: "preparation" },
    { expression: /\bcozid[ao]s?\b/iu, role: "preparation" },
  ];
  return words.flatMap(rule => {
    const match = rule.expression.exec(name);
    return match ? [{ value: match[0], attributeCode: null, role: rule.role, confidence: null }] : [];
  });
}

function buildObservation(request: LinguisticRequest, segment: Segment, index: number): FoodObservation {
  const locale = request.locale === undefined || request.locale === null
    ? { requested: null, effective: DEFAULT_FOOD_LOCALE, status: "defaulted" as const }
    : request.locale === DEFAULT_FOOD_LOCALE
      ? { requested: request.locale, effective: DEFAULT_FOOD_LOCALE, status: "explicit" as const }
      : { requested: request.locale, effective: null, status: "unsupported" as const };
  const supported = locale.status !== "unsupported";
  const foodSegment = foodOnlySpan(request.rawText, segment);
  const quantity = supported ? readQuantity(foodSegment.text) : null;
  const name = supported ? (quantity?.name ?? foodSegment.text).trim() : "";
  const observed = emptyIdentity();
  observed.foodName = name ? foldFoodSurface(name) : null;
  observed.qualifiers = detectQualifiers(name);
  const originalAnchor = (span: Span | null) => anchor(request.sourceRef, span,
    request.modality === "image" ? request.imageRegion ?? null : null);
  const q = emptyQuantity();
  if (quantity) {
    q.value = quantity.value;
    q.unit = quantity.unit;
    q.servingText = quantity.servingText;
  }
  const evidence: FoodObservation["evidence"] = [];
  const origin = request.modality === "audio_transcript" ? "transcription" : request.modality === "image" ? "ocr" : "text";
  if (name) evidence.push({
    evidenceId: "ev-name-" + index, field: "identity.foodName",
    origin, value: name, unit: null, confidence: null, verified: false,
    anchor: originalAnchor({ start: foodSegment.start, end: foodSegment.end }), sourceId: null,
  });
  if (q.value !== null) evidence.push({
    evidenceId: "ev-quantity-" + index, field: "quantity.value",
    origin, value: q.value, unit: q.unit, confidence: null, verified: false,
    anchor: originalAnchor({ start: foodSegment.start, end: foodSegment.end }), sourceId: null,
  });
  return {
    schemaVersion: 2, observationId: request.sourceRef.slice(0, 145) + ":obs:" + index,
    modality: request.modality, rawInput: request.rawText,
    normalizedInput: supported ? foldFoodSurface(name) || null : null, locale,
    surfaceSpan: originalAnchor({ start: foodSegment.start, end: foodSegment.end }),
    identityHints: observed, quantityHints: q, evidence,
    normalizationPath: supported ? [{ stage: "S1", origin: "deterministic", lexiconEntryId: null, anchor: originalAnchor({ start: foodSegment.start, end: foodSegment.end }), confidence: null }] : [],
    alternatives: [],
    unresolvedReason: !supported ? "unsupported_locale" : "unknown_surface",
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

function addResidual(observation: FoodObservation, payload: unknown, interpreterVersion: string): FoodObservation {
  const parsed = residualPayload.safeParse(payload);
  if (!parsed.success) throw new Error("invalid-linguistic-interpreter-response");
  const alternatives = [...observation.alternatives];
  const evidence = [...observation.evidence];
  const hypotheses = [...parsed.data.alternatives].sort((a, b) =>
    (b.confidence ?? -1) - (a.confidence ?? -1) || a.foodName.localeCompare(b.foodName));
  for (let i = 0; i < hypotheses.length; i++) {
    const proposed = hypotheses[i];
    const existing = observation.identityHints;
    // Explicit material qualifiers are evidence, not proposals the provider may invert.
    for (const qualifier of proposed.qualifiers ?? []) {
      if (qualifier.role !== null && existing.qualifiers.some(explicit =>
        explicit.role === qualifier.role &&
        foldFoodSurface(explicit.value) !== foldFoodSurface(qualifier.value))) {
        throw new Error("contradictory-linguistic-interpreter-qualifier");
      }
    }
    if (proposed.preparation?.length && existing.qualifiers.some(q =>
      q.role === "preparation" &&
      !proposed.preparation!.some(value => foldFoodSurface(value) === foldFoodSurface(q.value)))) {
      throw new Error("contradictory-linguistic-interpreter-preparation");
    }
    const evidenceIds: string[] = [];
    const addEvidence = (field: string, value: string, confidence: number | null) => {
      const evidenceId = "ev-s3-" + i + "-" + evidenceIds.length;
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
    for (const qualifier of proposed.qualifiers ?? []) {
      addEvidence("identity.qualifiers", qualifier.value, qualifier.confidence ?? proposed.confidence);
    }
    const qualifiers = [...existing.qualifiers];
    for (const qualifier of proposed.qualifiers ?? []) {
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
      hypothesisId: "s3-" + i,
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
): Promise<FoodObservation[]> {
  if (!request.rawText.trim() || request.rawText.length > FOOD_CONTRACT_LIMITS.rawText ||
      !request.sourceRef.trim() || request.sourceRef.length > 145 ||
      !request.lexiconRevision.trim() || request.lexiconRevision.length > FOOD_CONTRACT_LIMITS.shortText ||
      request.ownerUserId !== null && (!Number.isSafeInteger(request.ownerUserId) || request.ownerUserId <= 0)) {
    throw new Error("invalid-linguistic-input");
  }
  const now = request.now ?? new Date();
  if (Number.isNaN(now.getTime()) ||
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
  const parts = evidenceOnlyImage
    ? [{ text: request.rawText, start: 0, end: request.rawText.length }]
    : splitFoodSurface(request.rawText);
  if (parts.length > FOOD_CONTRACT_LIMITS.observations) throw new Error("linguistic-observation-limit");
  if (request.locale !== null && request.locale !== undefined && request.locale !== DEFAULT_FOOD_LOCALE) {
    return parts.map((part, index) => validate(buildObservation(request, part, index)));
  }
  if (evidenceOnlyImage) {
    const item = buildObservation(request, parts[0], 0);
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
  const results: FoodObservation[] = [];
  for (let i = 0; i < parts.length; i++) {
    let observation = buildObservation(request, parts[i], i);
    // Governed exact aliases (including personal confirmed aliases) take
    // precedence over a lossy morphological interpretation of their surface.
    const exactChoice = selectLexicon(
      entries, observation.identityHints.foodName ?? "", request.ownerUserId, now,
    );
    if (!exactChoice.selected && exactChoice.competing.length === 0) {
      observation = withSafeRegularAgreement(observation, entries, request.ownerUserId, now);
    }
    const lexiconChoice = exactChoice.selected || exactChoice.competing.length
      ? exactChoice
      : selectLexicon(entries, observation.identityHints.foodName ?? "", request.ownerUserId, now);
    if (lexiconChoice.selected) {
      observation = withLexicon(observation, lexiconChoice.selected, entries, request.ownerUserId, now);
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
        observation = validate(addResidual(observation, await interpreter(observation), request.interpreterVersion));
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

function validate(input: FoodObservation): FoodObservation {
  const checked = parseFoodObservation(input);
  if (!checked.ok) throw new Error("invalid-food-observation:" + checked.code);
  return checked.value;
}
