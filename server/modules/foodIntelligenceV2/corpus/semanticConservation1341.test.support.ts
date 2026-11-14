/**
 * #1341 experimental fact-conservation oracle, not a second parser or a writer.
 * References are authored without inspecting V1/V2 outputs. Only actual
 * FoodObservation fields may establish structured semantic coverage.
 */
import type { FoodObservation } from "../schemas";
import { projectObservation } from "./projection";
import type { C1bCase, C1bFact, C1bTextClaim } from "./semanticConservation1341.test.fixture";

export type C1bGrade =
  | "structured" | "traceable-unresolved" | "missing-component-binding"
  | "ingredient-quantity-unobserved" | "ingredient-quantity-mismatch"
  | "owner-alternatives-missing" | "unbound-as-food" | "misbound"
  | "unbound-quantity-unobserved" | "unbound-quantity-mismatch"
  | "shared-quantity-observation"
  | "silent-omission" | "invalid-provenance" | "invalid-evidence" | "false-closed";
export type C1bResult = {
  caseId: string;
  factIndex: number;
  kind: C1bFact["kind"];
  grade: C1bGrade;
  sourceRange: [number, number];
  scopeRange: [number, number];
  expected: { owner: string | null; ownerAlternatives: readonly string[]; requiresAbstention: boolean;
    ingredient: string | null; quantity: number | null; unit: string | null; uncertaintyReason: string | null;
    packageClaim: { quantity: number; unit: string; sourceRange: [number, number] } | null;
    identityClaims: C1bFact["identityClaims"] | null };
  observed: { foodNames: (string | null)[]; quantityHints: FoodObservation["quantityHints"][];
    unresolvedReasons: (string | null)[]; alternativeOwnerNames: string[]; abstained: boolean;
    sourceRefs: string[]; evidenceSourceRefs: string[]; normalizationSourceRefs: string[] };
};
export type C1bObservationIssue = {
  observationIndex: number;
  observationId: string;
  grade: "unexpected-observation" | "duplicate-observation" | "invalid-provenance" | "invalid-evidence";
  matchedFactIndices: number[];
};
export type C1bCaseReport = {
  caseId: string;
  semanticGroup: string;
  split: C1bCase["split"];
  modality: C1bCase["modality"];
  results: C1bResult[];
  observationIssues: C1bObservationIssue[];
  /** Diagnostic admission only. Never substitute this for the public mutation gate. */
  structurallyComplete: boolean;
};

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/\s+/gu, " ").trim();
}

function uniqueSpan(text: string, literal: string): [number, number] {
  const start = text.indexOf(literal);
  if (start < 0 || text.indexOf(literal, start + 1) >= 0) {
    throw new Error("c1b-reference-unlocatable-or-ambiguous");
  }
  return [start, start + literal.length];
}
function locatedSpan(text: string, literal: string, start?: number): [number, number] {
  if (start === undefined) return uniqueSpan(text, literal);
  if (!Number.isSafeInteger(start) || start < 0 || text.slice(start, start + literal.length) !== literal) {
    throw new Error("c1b-reference-offset-not-matching-original");
  }
  return [start, start + literal.length];
}
/** Authored input offsets are facts about the original text, not parser predictions. */
export function factSourceRange(testCase: C1bCase, fact: C1bFact): [number, number] {
  return locatedSpan(testCase.text, fact.surface, fact.surfaceStart);
}
function factScopeRange(testCase: C1bCase, fact: C1bFact): [number, number] {
  return locatedSpan(testCase.text, fact.scope, fact.scopeStart);
}
function contains(outer: [number, number], inner: [number, number]): boolean {
  return outer[0] <= inner[0] && outer[1] >= inner[1];
}
function spanOf(observation: FoodObservation): [number, number] | null {
  const span = observation.surfaceSpan.span;
  return span ? [span.start, span.end] : null;
}
function hasOriginalProvenance(testCase: C1bCase, observation: FoodObservation): boolean {
  const source = observation.surfaceSpan;
  const expectedSourceRef = "c1b:" + testCase.id;
  const sourceSpan = spanOf(observation);
  if (observation.rawInput !== testCase.text || observation.modality !== testCase.modality ||
      source.sourceRef !== expectedSourceRef || source.region !== null ||
      sourceSpan === null || sourceSpan[0] < 0 || sourceSpan[1] > testCase.text.length) {
    return false;
  }
  // Validate both the material source and its supporting evidence; a correct
  // textual overlap cannot launder an anchor pointing at a different input.
  return [...observation.evidence.map(item => item.anchor),
    ...observation.normalizationPath.map(item => item.anchor)].every(anchor =>
    anchor.sourceRef === expectedSourceRef && anchor.region === null &&
    anchor.span !== null && anchor.span.start >= 0 &&
    anchor.span.end <= testCase.text.length &&
    contains(sourceSpan, [anchor.span.start, anchor.span.end]));
}
function ownerMatchesIdentity(foodName: string | null, owner: string | null): boolean {
  if (!foodName || !owner) return false;
  const name = fold(foodName).replace(/^(?:o|a|um|uma)\s+/u, "");
  const expected = fold(owner);
  return name === expected || name.startsWith(expected + " ");
}

/** Resolve source text to the *same observed occurrence*, not merely a
 * shared clause. Repeated facts can have identical literals and broad scopes. */
function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}
function hasSourceBackedServingText(testCase: C1bCase, observation: FoodObservation,
  fact: C1bFact, serving: string): boolean {
  const observed = spanOf(observation);
  const scope = factScopeRange(testCase, fact);
  if (observed === null || !contains(scope, observed)) return false;
  const otherClaims = testCase.facts.filter(other => other !== fact)
    .map(other => factSourceRange(testCase, other));
  const proofSpans = [...observation.evidence.map(item => item.anchor.span),
    ...observation.normalizationPath.map(step => step.anchor.span)]
    .filter((span): span is { start: number; end: number } => span !== null);
  const normalizedServing = fold(serving);
  let supported = false;
  // Match against original UTF-16 substrings. The small normalization margin
  // tolerates accents/spacing without deriving a second food parser or owner.
  for (let start = observed[0]; start < observed[1]; start++) {
    for (let end = start + 1; end <= Math.min(observed[1], start + serving.length + 16); end++) {
      const raw = testCase.text.slice(start, end);
      if (!raw.trim() || raw !== raw.trim() || fold(raw) !== normalizedServing) continue;
      const range: [number, number] = [start, end];
      if (!contains(scope, range) || !proofSpans.some(span => contains([span.start, span.end], range))) {
        continue;
      }
      // If any matching occurrence belongs to a sibling fact, the serving
      // assertion is ambiguous even when another occurrence matches this fact.
      if (otherClaims.some(other => overlaps(other, range))) return false;
      supported = true;
    }
  }
  return supported;
}

/** Source labels, not numeric parsing, decide what a quantity field may assert.
 * A visible package amount must never masquerade as a consumed amount. */
function hasSourceBackedQuantityFields(testCase: C1bCase, observation: FoodObservation,
  fact: C1bFact, hints: FoodObservation["quantityHints"]): boolean {
  const serving = hints.servingText;
  if (serving !== null && !hasSourceBackedServingText(testCase, observation, fact, serving)) {
    return false;
  }
  const claim = fact.packageClaim;
  const hasPackageFields = hints.visiblePackageQuantity !== null || hints.visiblePackageUnit !== null;
  if (!claim) return !hasPackageFields;
  if (!hasPackageFields || hints.visiblePackageQuantity !== claim.quantity ||
      fold(hints.visiblePackageUnit ?? "") !== fold(claim.unit)) return false;
  const packageRange = locatedSpan(testCase.text, claim.surface, claim.surfaceStart);
  const observedRange = spanOf(observation);
  return observedRange !== null && contains(factScopeRange(testCase, fact), packageRange) &&
    contains(observedRange, packageRange);
}

/** Every source-backed assertion must have an independent label in its owner's
 * original scope plus matching field-specific evidence; matching text alone
 * cannot authorize an invented identity or a wrong semantic qualifier role. */
function hasLabelledEvidence(testCase: C1bCase, observation: FoodObservation,
  fact: C1bFact, label: C1bTextClaim, fields: readonly string[], evidenceIds: readonly string[] | null,
  requireExactValue: boolean): boolean {
  const source = locatedSpan(testCase.text, label.surface, label.surfaceStart);
  const observed = spanOf(observation);
  if (observed === null || !contains(factScopeRange(testCase, fact), source) ||
      !contains(observed, source)) return false;
  // A label of this fact cannot be satisfied by an occurrence owned by a
  // different fact, even if a broad span also covers that sibling.
  if (testCase.facts.some(other => other !== fact && other.owner !== fact.owner &&
      overlaps(factSourceRange(testCase, other), source))) return false;
  return observation.evidence.some(item =>
    (evidenceIds === null || evidenceIds.includes(item.evidenceId)) &&
    fields.includes(item.field) && typeof item.value === "string" &&
    (requireExactValue ? fold(item.value) === fold(label.value)
      : fold(item.value).includes(fold(label.value))) &&
    item.anchor.span !== null &&
    contains([item.anchor.span.start, item.anchor.span.end], source) &&
    fold(testCase.text.slice(item.anchor.span.start, item.anchor.span.end))
      .includes(fold(label.surface)));
}

function hasSupportedIdentityAssertions(testCase: C1bCase, observation: FoodObservation,
  fact: C1bFact, identity: FoodObservation["identityHints"],
  evidenceIds: readonly string[] | null): boolean {
  const manual = fact.identityClaims;
  for (const field of ["brand", "variant", "barcode"] as const) {
    const value = identity[field];
    const label = manual?.[field];
    if (value === null && label === undefined) continue;
    if (value === null || label === undefined ||
        (field === "barcode" ? value !== label.value : fold(value) !== fold(label.value)) ||
        !hasLabelledEvidence(testCase, observation, fact, label,
          [`identity.${field}`], evidenceIds, true)) return false;
  }
  const expectedPreparation = manual?.preparation ?? [];
  if (identity.preparation.length !== expectedPreparation.length) return false;
  const remaining = [...expectedPreparation];
  for (const value of identity.preparation) {
    const index = remaining.findIndex(label => fold(label.value) === fold(value) &&
      hasLabelledEvidence(testCase, observation, fact, label,
        ["identity.preparation"], evidenceIds, true));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  for (const qualifier of identity.qualifiers) {
    const labelled = (manual?.qualifiers ?? []).filter(label =>
      fold(label.value) === fold(qualifier.value) &&
      label.role === qualifier.role && label.attributeCode === qualifier.attributeCode);
    const supported = labelled.some(label => hasLabelledEvidence(testCase, observation, fact,
      label, ["identity.qualifiers", "identity.foodName"], evidenceIds, false)) ||
      testCase.facts.some(reference => reference.kind === "negation" &&
        qualifier.role === "sweetening" && qualifier.attributeCode === null &&
        ownerMatchesIdentity(identity.foodName, reference.owner) &&
        fold(reference.surface) === fold(qualifier.value) &&
        hasLabelledEvidence(testCase, observation, reference,
          { value: reference.surface, surface: reference.surface,
            surfaceStart: reference.surfaceStart },
          ["identity.qualifiers", "identity.foodName"], evidenceIds, false));
    if (!supported) return false;
  }
  // A labelled material qualifier cannot silently disappear either.
  if ((manual?.qualifiers ?? []).some(label => !identity.qualifiers.some(qualifier =>
      fold(qualifier.value) === fold(label.value) && qualifier.role === label.role &&
      qualifier.attributeCode === label.attributeCode))) return false;
  return true;
}

/** Every hypothesis is checked against independent owner/quantity labels.
 * A source-spanning observation cannot launder a fabricated alternative. */
function hasSupportedAlternatives(testCase: C1bCase, observation: FoodObservation,
  fact: C1bFact): boolean {
  const allowedOwners = fact.kind === "unbound" ? (fact.ownerAlternatives ?? [])
    : fact.owner === null ? [] : [fact.owner];
  const seenOwners = new Set<string>();
  return observation.alternatives.every(alternative => {
    const name = alternative.identityHints.foodName;
    const owner = fold(name ?? "").replace(/^(?:o|a|um|uma)\s+/u, "");
    if (!owner || !allowedOwners.some(expected => fold(expected) === owner) ||
        seenOwners.has(owner)) return false;
    seenOwners.add(owner);
    const hints = alternative.quantityHints;
    if (hints.value !== fact.quantity || fold(hints.unit ?? "") !== fold(fact.unit ?? "") ||
        !hasSourceBackedQuantityFields(testCase, observation, fact, hints)) return false;
    if (alternative.evidenceIds.some(id => !observation.evidence.some(item => item.evidenceId === id)) ||
        !hasSupportedIdentityAssertions(testCase, observation, fact,
          alternative.identityHints, alternative.evidenceIds)) {
      return false;
    }
    if (hints.value !== null) {
      const sourceRange = factSourceRange(testCase, fact);
      if (!observation.evidence.some(item => item.field === "quantity.value" &&
          item.value === hints.value && fold(item.unit ?? "") === fold(hints.unit ?? "") &&
          item.anchor.span !== null && contains(
            [item.anchor.span.start, item.anchor.span.end], sourceRange))) return false;
    }
    return true;
  });
}
/** C1b uses the independent fact spans in BOTH directions: a parser cannot
 * invent an extra food or duplicate an observed food and still pass coverage. */
function observationClaimsFact(testCase: C1bCase, observation: FoodObservation, fact: C1bFact): boolean {
  const span = spanOf(observation);
  if (span === null || !contains(span, factSourceRange(testCase, fact))) return false;
  if (fact.owner === null) return true;
  const scope = factScopeRange(testCase, fact);
  const owner = ownerRange(testCase, fact, scope);
  return owner !== null && contains(span, owner) &&
    ownerMatchesIdentity(observation.identityHints.foodName, fact.owner);
}

/** SourceRef/offset validity alone is insufficient: a text anchor and the
 * evidence values must substantiate the identity, quantity and qualifiers.
 * No new text parser or lexical oracle is introduced. */
function hasMaterialEvidence(testCase: C1bCase, observation: FoodObservation, fact: C1bFact): boolean {
  const claimRange = factSourceRange(testCase, fact);
  const scopeRange = factScopeRange(testCase, fact);
  const observationRange = spanOf(observation);
  // A proof that also consumes a sibling's clause cannot establish this
  // independently labelled owner, even when the owner token is present.
  const anchors = [...observation.evidence.map(item => item.anchor),
    ...observation.normalizationPath.map(step => step.anchor)];
  if (observationRange === null || !contains(scopeRange, observationRange) ||
      anchors.some(anchor => anchor.span === null ||
        !contains(scopeRange, [anchor.span.start, anchor.span.end]))) return false;
  if (observation.evidence.length === 0 || observation.normalizationPath.length === 0 ||
      !observation.normalizationPath.some(step => step.stage === "S1" &&
        step.anchor.span !== null && contains([step.anchor.span.start, step.anchor.span.end], claimRange))) {
    return false;
  }
  if (!hasSourceBackedQuantityFields(testCase, observation, fact, observation.quantityHints) ||
      !hasSupportedIdentityAssertions(testCase, observation, fact, observation.identityHints, null) ||
      !hasSupportedAlternatives(testCase, observation, fact)) return false;
  const rawAt = (anchor: FoodObservation["surfaceSpan"]): string =>
    anchor.span === null ? "" : fold(testCase.text.slice(anchor.span.start, anchor.span.end));
  const identityProofs = observation.evidence.filter(item => item.field === "identity.foodName");
  const identity = observation.identityHints.foodName;
  if (identity !== null) {
    if (identityProofs.length === 0 || identityProofs.some(item =>
      typeof item.value !== "string" || !fold(item.value).includes(fold(identity)) ||
      !rawAt(item.anchor).includes(fold(item.value)))) return false;
  } else if (identityProofs.length > 0) return false;

  const quantityProofs = observation.evidence.filter(item => item.field === "quantity.value");
  const quantity = observation.quantityHints;
  // A measure word in a food name is not a labelled portion. The oracle must
  // refute a self-consistent yet fabricated quantity/evidence for this mention.
  if (fact.kind === "food-mention" && (quantity.value !== null ||
      quantity.unit !== null || quantityProofs.length > 0)) return false;
  if (quantity.value !== null) {
    if (quantityProofs.length === 0 || quantityProofs.some(item =>
      item.value !== quantity.value || fold(item.unit ?? "") !== fold(quantity.unit ?? ""))) {
      return false;
    }
    if (fact.kind === "food-quantity" && !quantityProofs.some(item =>
      item.anchor.span !== null && contains([item.anchor.span.start, item.anchor.span.end], claimRange))) {
      return false;
    }
  } else if (quantityProofs.length > 0) return false;

  // The independent labels, owner and semantic role were checked above;
  // text overlap alone never proves a claimed qualifier.
  return true;
}

function equalQuantity(observation: FoodObservation, fact: C1bFact): boolean {
  return observation.quantityHints.value === fact.quantity &&
    fold(observation.quantityHints.unit ?? "") === fold(fact.unit ?? "");
}
function ownerRange(testCase: C1bCase, fact: C1bFact, scope: [number, number]): [number, number] | null {
  if (fact.owner === null) return null;
  if (!fact.owner.trim()) throw new Error("c1b-reference-owner-not-in-scope");
  const claim = factSourceRange(testCase, fact);
  const candidates: [number, number][] = [];
  for (let at = testCase.text.indexOf(fact.owner, scope[0]); at >= 0 && at + fact.owner.length <= scope[1];
    at = testCase.text.indexOf(fact.owner, at + fact.owner.length)) {
    candidates.push([at, at + fact.owner.length]);
  }
  if (!candidates.length) throw new Error("c1b-reference-owner-not-in-scope");
  // Repeated owners within one clause must bind to the occurrence belonging
  // to the material claim, not always the first owner in the sentence.
  return candidates.find(range => contains(claim, range)) ??
    [...candidates].reverse().find(range => range[1] <= claim[0]) ?? candidates[0];
}

/** Fails on an invalid human reference before observing either parser. */
export function validateC1bReference(testCase: C1bCase): void {
  if (!testCase.id || !testCase.semanticGroup || !testCase.facts.length) {
    throw new Error("c1b-reference-incomplete");
  }
  const occurrences = new Set<string>();
  for (const fact of testCase.facts) {
    const scope = factScopeRange(testCase, fact);
    const source = factSourceRange(testCase, fact);
    if (!contains(scope, source)) throw new Error("c1b-reference-claim-outside-scope");
    if (fact.packageClaim) {
      const claim = fact.packageClaim;
      const packageRange = locatedSpan(testCase.text, claim.surface, claim.surfaceStart);
      if ((fact.kind !== "food-mention" && fact.kind !== "food-quantity") ||
          !Number.isFinite(claim.quantity) || claim.quantity <= 0 || !claim.unit.trim() ||
          !contains(scope, packageRange)) throw new Error("c1b-reference-package-invalid");
    }
    if (fact.identityClaims) {
      const claims = fact.identityClaims;
      const textLabels = [claims.brand, claims.variant, claims.barcode,
        ...(claims.preparation ?? []), ...(claims.qualifiers ?? [])]
        .filter((claim): claim is C1bTextClaim => claim !== undefined);
      for (const claim of textLabels) {
        if (!claim.value.trim() || !claim.surface.trim() ||
            !fold(claim.surface).includes(fold(claim.value)) ||
            !contains(scope, locatedSpan(testCase.text, claim.surface, claim.surfaceStart))) {
          throw new Error("c1b-reference-identity-claim-invalid");
        }
      }
      if (fact.owner === null || (claims.preparation ?? []).some(claim => !claim.value.trim()) ||
          (claims.qualifiers ?? []).some(claim =>
            !((claim.role === null || claim.role.trim()) &&
              (claim.attributeCode === null || claim.attributeCode.trim())))) {
        throw new Error("c1b-reference-identity-claim-invalid");
      }
    }
    const occurrenceKey = `${fact.kind}:${source[0]}:${source[1]}`;
    if (occurrences.has(occurrenceKey)) throw new Error("c1b-reference-duplicate-fact-occurrence");
    occurrences.add(occurrenceKey);
    ownerRange(testCase, fact, scope);
    if (fact.kind === "unbound") {
      const alternatives = fact.ownerAlternatives ?? [];
      if (!fact.requiresAbstention || !fact.uncertaintyReason || alternatives.length < 2 ||
          new Set(alternatives.map(fold)).size !== alternatives.length ||
          alternatives.some(name => !fold(testCase.text).includes(fold(name)))) {
        throw new Error("c1b-reference-ambiguous-owners-incomplete");
      }
      if ((fact.quantity === null) !== (fact.unit === null) ||
          (fact.quantity !== null && (!Number.isFinite(fact.quantity) || fact.quantity <= 0))) {
        throw new Error("c1b-reference-ambiguous-quantity-invalid");
      }
    } else if (fact.ownerAlternatives || fact.uncertaintyReason || fact.requiresAbstention) {
      throw new Error("c1b-reference-unexpected-ambiguity");
    }
    if (fact.kind === "unbound" && fact.owner !== null ||
        fact.kind !== "unbound" && fact.owner === null ||
        (fact.kind === "food-quantity" || fact.kind === "ingredient-quantity") &&
          (fact.quantity === null || !Number.isFinite(fact.quantity) || fact.quantity <= 0 || !fact.unit) ||
        fact.kind === "negation" && (fact.quantity !== null || fact.unit !== null) ||
        fact.kind === "food-mention" && (fact.quantity !== null || fact.unit !== null || fact.ingredient !== null) ||
        fact.kind === "ingredient-quantity" && !fact.ingredient) {
      throw new Error("c1b-reference-invalid-fact");
    }
  }
}

/** A single reference fact is always checked against original UTF-16 spans. */
function inspectFact(testCase: C1bCase, fact: C1bFact, factIndex: number,
  observations: readonly FoodObservation[]): C1bResult {
  const sourceRange = factSourceRange(testCase, fact);
  const scopeRange = factScopeRange(testCase, fact);
  const owner = ownerRange(testCase, fact, scopeRange);
  const spanCovering = observations.filter(obs => {
    const span = spanOf(obs);
    return span !== null && contains(span, sourceRange);
  });
  const invalidProvenance = spanCovering.some(obs => !hasOriginalProvenance(testCase, obs));
  const covering = spanCovering.filter(obs => hasOriginalProvenance(testCase, obs));
  const attached = owner === null ? covering : covering.filter(obs => {
    const span = spanOf(obs);
    return span !== null && contains(span, owner);
  });
  const alternativeOwnerNames = [...new Set(attached.flatMap(obs =>
    obs.alternatives.map(option => option.identityHints.foodName).filter((name): name is string => name !== null)))];
  const abstained = attached.length > 0 && attached.every(obs =>
    obs.identityHints.foodName === null && obs.unresolvedReason !== null);
  let grade: C1bGrade;
  if (invalidProvenance) grade = "invalid-provenance";
  else if (!covering.length) grade = "silent-omission";
  else if (!attached.length) grade = "misbound";
  else if (fact.kind === "ingredient-quantity") {
    // No typed ingredient relation exists yet: never call the binding structured.
    // But reject an explicit quantity or owner claimed by the wrong sibling.
    const wrongAmount = attached.some(obs => testCase.facts.some(other =>
      other.kind === "ingredient-quantity" && other.owner !== fact.owner &&
      other.quantity !== fact.quantity && obs.quantityHints.value === other.quantity &&
      fold(obs.quantityHints.unit ?? "") === fold(other.unit ?? "")));
    const wrongOwner = attached.length > 0 && attached.every(obs => {
      const name = fold(obs.identityHints.foodName ?? "").replace(/^(?:o|a|um|uma)\s+/u, "");
      const expected = fold(fact.owner ?? "");
      if (name === expected || name.startsWith(expected + " ")) return false;
      return testCase.facts.some(other => other.owner && other.owner !== fact.owner &&
        (name === fold(other.owner) || name.startsWith(fold(other.owner) + " ")));
    });
    // A span is traceability, not materialized ingredient quantity. Distinguish
    // absent numbers, incompatible numbers, and a correct hint lacking a typed
    // owner/ingredient relation. None of these grades authorizes mutation.
    grade = wrongAmount || wrongOwner ? "misbound"
      : attached.every(obs => obs.quantityHints.value === null)
        ? "ingredient-quantity-unobserved"
        : attached.some(obs => equalQuantity(obs, fact))
          ? "missing-component-binding" : "ingredient-quantity-mismatch";
  } else if (fact.kind === "food-mention") {
    const found = attached.some(obs => {
      const name = fold(obs.identityHints.foodName ?? "").replace(/^(?:o|a|um|uma)\s+/u, "");
      return name === fold(fact.owner ?? "");
    });
    grade = found ? "structured" : attached.some(obs => obs.unresolvedReason !== null)
      ? "traceable-unresolved" : "false-closed";
  } else if (fact.kind === "food-quantity") {
    const bound = attached.some(obs => fold(obs.identityHints.foodName ?? "") === fold(fact.owner ?? "") &&
      equalQuantity(obs, fact));
    if (bound) grade = "structured";
    else if (observations.some(obs => !attached.includes(obs) && equalQuantity(obs, fact))) grade = "misbound";
    else grade = attached.some(obs => obs.unresolvedReason !== null) ? "traceable-unresolved" : "false-closed";
  } else if (fact.kind === "negation") {
    const asserting = attached.filter(obs => obs.identityHints.qualifiers.some(qualifier =>
      qualifier.role === "sweetening" && fold(qualifier.value) === fold(fact.surface)));
    // Matching the qualifier alone is insufficient: the negation belongs to
    // its explicitly labelled food, not merely to a covering text span.
    grade = asserting.some(obs => !ownerMatchesIdentity(obs.identityHints.foodName, fact.owner))
      ? "misbound" : asserting.length > 0 ? "structured"
        : attached.some(obs => obs.unresolvedReason !== null)
          ? "traceable-unresolved" : "false-closed";
  } else {
    // An unattached ingredient continuation is not a new food. An unresolved
    // observation which exposes it as identity is not safe for auto-commit.
    const expectedOwners = fact.ownerAlternatives ?? [];
    const alternativesComplete = expectedOwners.every(name =>
      alternativeOwnerNames.some(observed => fold(observed) === fold(name)));
    grade = attached.some(obs => obs.identityHints.foodName !== null)
      ? "unbound-as-food"
      : !abstained ? "false-closed"
        : !alternativesComplete ? "owner-alternatives-missing"
          : fact.quantity !== null && attached.every(obs => obs.quantityHints.value === null)
            ? "unbound-quantity-unobserved"
            : fact.quantity !== null && attached.some(obs => !equalQuantity(obs, fact))
              ? "unbound-quantity-mismatch" : "traceable-unresolved";
  }
  if ((grade === "structured" || grade === "traceable-unresolved" ||
      grade === "owner-alternatives-missing") && attached.some(obs =>
    observationClaimsFact(testCase, obs, fact) &&
    !hasMaterialEvidence(testCase, obs, fact))) grade = "invalid-evidence";
  return { caseId: testCase.id, factIndex, kind: fact.kind, grade, sourceRange, scopeRange,
    expected: { owner: fact.owner, ownerAlternatives: fact.ownerAlternatives ?? [],
      requiresAbstention: fact.requiresAbstention ?? false,
      ingredient: fact.ingredient, quantity: fact.quantity, unit: fact.unit,
      uncertaintyReason: fact.uncertaintyReason ?? null,
      packageClaim: fact.packageClaim ? { quantity: fact.packageClaim.quantity,
        unit: fact.packageClaim.unit,
        sourceRange: locatedSpan(testCase.text, fact.packageClaim.surface,
          fact.packageClaim.surfaceStart) } : null,
      identityClaims: fact.identityClaims ?? null },
    observed: { foodNames: attached.map(obs => obs.identityHints.foodName),
      quantityHints: attached.map(obs => ({ ...obs.quantityHints })),
      unresolvedReasons: attached.map(obs => obs.unresolvedReason),
      alternativeOwnerNames, abstained,
      sourceRefs: spanCovering.map(obs => obs.surfaceSpan.sourceRef),
      evidenceSourceRefs: spanCovering.flatMap(obs => obs.evidence.map(item => item.anchor.sourceRef)),
      normalizationSourceRefs: spanCovering.flatMap(obs =>
        obs.normalizationPath.map(item => item.anchor.sourceRef)) },
  };
}

export function evaluateC1b(testCase: C1bCase, observations: readonly FoodObservation[]): C1bCaseReport {
  validateC1bReference(testCase);
  const results = testCase.facts.map((fact, index) => inspectFact(testCase, fact, index, observations));
  // FoodObservation has exactly one quantityHints value. Even a perfectly
  // anchored observation must never count as proof of TWO material quantities,
  // including repeated mentions of the same owner and the same amount.
  // Deterministic maximum bipartite matching avoids false collisions when
  // distinct observations can independently substantiate every quantity fact.
  const quantityOwners = new Map<number, number>(); // observation index -> fact index
  const assignQuantity = (factIndex: number, visited: Set<number>): boolean => {
    const fact = testCase.facts[factIndex];
    for (const [index, observation] of observations.entries()) {
      if (visited.has(index) || !hasOriginalProvenance(testCase, observation) ||
          !observationClaimsFact(testCase, observation, fact) ||
          !equalQuantity(observation, fact) ||
          !hasMaterialEvidence(testCase, observation, fact)) continue;
      visited.add(index);
      const previouslyAssigned = quantityOwners.get(index);
      if (previouslyAssigned === undefined || assignQuantity(previouslyAssigned, visited)) {
        quantityOwners.set(index, factIndex);
        return true;
      }
    }
    return false;
  };
  for (const [index, fact] of testCase.facts.entries()) {
    if (results[index].grade !== "structured" ||
        (fact.kind !== "food-quantity" && fact.kind !== "ingredient-quantity")) continue;
    if (!assignQuantity(index, new Set<number>())) {
      results[index] = { ...results[index], grade: "shared-quantity-observation" };
    }
  }
  const observedFactIndices = new Set<number>();
  const observedIds = new Set<string>();
  const observationIssues: C1bObservationIssue[] = [];
  observations.forEach((observation, observationIndex) => {
    const matchedFactIndices = testCase.facts.flatMap((fact, index) =>
      observationClaimsFact(testCase, observation, fact) ? [index] : []);
    let grade: C1bObservationIssue["grade"] | null = null;
    if (!hasOriginalProvenance(testCase, observation)) grade = "invalid-provenance";
    else if (matchedFactIndices.length === 0) grade = "unexpected-observation";
    else if (observedIds.has(observation.observationId) ||
      matchedFactIndices.some(index => observedFactIndices.has(index))) grade = "duplicate-observation";
    else if (matchedFactIndices.some(index =>
      !hasMaterialEvidence(testCase, observation, testCase.facts[index]))) grade = "invalid-evidence";
    if (grade !== null) observationIssues.push({
      observationIndex, observationId: observation.observationId, grade, matchedFactIndices,
    });
    observedIds.add(observation.observationId);
    for (const index of matchedFactIndices) observedFactIndices.add(index);
  });
  return { caseId: testCase.id, semanticGroup: testCase.semanticGroup,
    split: testCase.split, modality: testCase.modality,
    results, observationIssues,
    structurallyComplete: results.every(item => item.grade === "structured") &&
      observationIssues.length === 0 };
}

/** Only source-independent labels are admissible as metamorphic ground truth. */
export function referenceSignature(testCase: C1bCase): string {
  validateC1bReference(testCase);
  return testCase.facts.map(item => [item.kind, fold(item.owner ?? "?"),
    fold(item.ingredient ?? ""), item.quantity === null ? "?" : String(item.quantity),
    fold(item.unit ?? ""), (item.ownerAlternatives ?? []).map(fold).sort().join(","),
    fold(item.uncertaintyReason ?? ""), item.requiresAbstention ? "abstain" : "",
    item.packageClaim ? `${item.packageClaim.quantity}:${fold(item.packageClaim.unit)}` : "",
    item.identityClaims ? JSON.stringify(item.identityClaims) : ""].join("|"))
    .sort().join(";");
}

export function summarizeC1b(reports: readonly C1bCaseReport[]) {
  const grades: Record<C1bGrade, number> = {
    structured: 0, "traceable-unresolved": 0, "missing-component-binding": 0,
    "ingredient-quantity-unobserved": 0, "ingredient-quantity-mismatch": 0,
    "owner-alternatives-missing": 0, "unbound-as-food": 0, misbound: 0,
    "unbound-quantity-unobserved": 0, "unbound-quantity-mismatch": 0,
    "shared-quantity-observation": 0,
    "silent-omission": 0, "invalid-provenance": 0, "invalid-evidence": 0, "false-closed": 0,
  };
  const observationIssues: Record<C1bObservationIssue["grade"], number> = {
    "unexpected-observation": 0, "duplicate-observation": 0,
    "invalid-provenance": 0, "invalid-evidence": 0,
  };
  for (const report of reports) {
    for (const fact of report.results) grades[fact.grade] += 1;
    for (const issue of report.observationIssues) observationIssues[issue.grade] += 1;
  }
  return { casesWithObservationIssues: reports.filter(report => report.observationIssues.length > 0).length,
    observationIssues, cases: reports.length, facts: Object.values(grades).reduce((a, b) => a + b, 0),
    casesStructurallyComplete: reports.filter(report => report.structurallyComplete).length,
    grades, S3: "not-evaluated", nutritionalAccuracy: "not-measured",
    costUsd: "not-measured", latencyMs: "not-measured" } as const;
}

/** Reuses the canonical #1299 pre-resolution projection (§4.1.8). */
export function observedProjection(observations: readonly FoodObservation[]) {
  return observations.map(obs => {
    const p = projectObservation(obs);
    return {
      identity: { name: p.identity.foodName === null ? null
        : fold(p.identity.foodName).replace(/^(?:o|a|um|uma)\s+/u, ""),
        brand: p.identity.brand, variant: p.identity.variant,
        preparation: [...p.identity.preparation].map(fold).sort(),
        qualifiers: [...p.identity.qualifierValues].map(fold).sort(),
        barcode: p.identity.barcode },
      quantity: { value: p.quantity.value, unit: p.quantity.unit },
      alternatives: p.alternativeCount, unresolvedReason: p.unresolvedReason,
    };
  }).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

/** Simulated *diagnostic* admission, not a runtime writer or a persistence gate.
 * The caller must propose exact observation IDs; accepting a subset is unsafe
 * whenever even one independently labelled fact is missing or unresolved. */
export function attemptDiagnosticBatchAdmission(
  testCase: C1bCase, observations: readonly FoodObservation[], proposedIds: readonly string[],
) {
  const unique = new Set(proposedIds);
  const selected = observations.filter(obs => unique.has(obs.observationId));
  const report = evaluateC1b(testCase, selected);
  const invalidSelection = unique.size !== proposedIds.length ||
    unique.size !== selected.length || selected.length === 0 ||
    selected.length !== observations.length ||
    new Set(observations.map(obs => obs.observationId)).size !== observations.length;
  const blocked = [
    ...report.results.filter(result => result.grade !== "structured")
      .map(result => ({ factIndex: result.factIndex, reason: result.grade })),
    ...report.observationIssues.map(issue => ({ factIndex: null, reason: issue.grade })),
  ];
  // Semantic extraction and resolution are different stages. A fact may be
  // structurally represented while the candidate still requires clarification.
  const unresolvedObservations = selected.filter(obs => obs.unresolvedReason !== null)
    .map(obs => ({ observationId: obs.observationId, unresolvedReason: obs.unresolvedReason }));
  return {
    admitted: !invalidSelection && blocked.length === 0 && unresolvedObservations.length === 0,
    invalidSelection, proposedIds: [...proposedIds], blocked, unresolvedObservations, report,
    mutationEffect: "simulation-only-not-a-public-write",
  };
}
