/**
 * #1341: reverse inspection of C1b observation evidence. This is an oracle
 * over independently labelled claims, not a language parser or a writer.
 */
import type { FoodEvidence, FoodObservation } from "../schemas";
import type { C1bCase, C1bFact, C1bTextClaim } from "./semanticConservation1341.test.fixture";

type Span = [number, number];
type Candidate = {
  identity: FoodObservation["identityHints"];
  quantity: FoodObservation["quantityHints"];
  evidenceIds: readonly string[] | null;
};
export type EvidenceLabelTools = {
  factRange: (fact: C1bFact) => Span;
  scopeRange: (fact: C1bFact) => Span;
  ownerRange: (fact: C1bFact) => Span | null;
  ownerMatches: (name: string | null, owner: string | null) => boolean;
  labelled: (fact: C1bFact, label: C1bTextClaim, fields: readonly string[],
    evidenceIds: readonly string[], exact: boolean) => boolean;
};
const fold = (value: string): string => value.normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/gu, " ").trim();
const same = (left: string | null, right: string | null): boolean =>
  fold(left ?? "") === fold(right ?? "");
const contains = (outer: Span, inner: Span): boolean => outer[0] <= inner[0] && outer[1] >= inner[1];
const overlaps = (left: Span, right: Span): boolean => left[0] < right[1] && right[0] < left[1];

/** A checked assertion must be attributable to its own source, fact and owner. */
export function onlyLabelledMaterialEvidence(testCase: C1bCase, observation: FoodObservation,
  fact: C1bFact, tools: EvidenceLabelTools): boolean {
  const originalSource = testCase.modality === "audio_transcript" ? "transcription" : "text";
  const observedSpan = observation.surfaceSpan.span;
  if (!observedSpan) return false;
  const candidates: Candidate[] = [
    { identity: observation.identityHints, quantity: observation.quantityHints, evidenceIds: null },
    ...observation.alternatives.map(alt => ({ identity: alt.identityHints,
      quantity: alt.quantityHints, evidenceIds: alt.evidenceIds })),
  ];
  const manualRange = tools.factRange(fact);
  const scope = tools.scopeRange(fact);
  // An observation can substantiate a quantity and a local negation for the
  // SAME owner. A source-backed claim is checked against every authored fact
  // covered by this observation; the forward facts remain independently graded.
  const quantityReferences = testCase.facts.filter(reference =>
    (reference.kind === "food-quantity" || reference.kind === "ingredient-quantity" ||
      reference.kind === "unbound") &&
    same(reference.owner, fact.owner) && reference.quantity !== null &&
    contains([observedSpan.start, observedSpan.end], tools.factRange(reference)));
  const matchingQuantity = (evidence: FoodEvidence, candidate: Candidate,
    unit: string | null): boolean => {
    const anchor = evidence.anchor.span!;
    return quantityReferences.some(reference =>
      reference.quantity === evidence.value && reference.quantity === candidate.quantity.value &&
      same(reference.unit, unit) && same(candidate.quantity.unit, unit) &&
      contains([anchor.start, anchor.end], tools.factRange(reference)));
  };
  const labelled = (source: C1bFact, label: C1bTextClaim, field: string,
    evidence: FoodEvidence): boolean => tools.labelled(source, label, [field], [evidence.evidenceId], true);
  const supports = (evidence: FoodEvidence, candidate: Candidate): boolean => {
    if (candidate.evidenceIds !== null && !candidate.evidenceIds.includes(evidence.evidenceId)) return false;
    const identity = candidate.identity;
    const quantity = candidate.quantity;
    const owner = fact.owner;
    const ownerMatches = owner === null ? fact.kind === "unbound" &&
      (identity.foodName === null || (fact.ownerAlternatives ?? []).some(name =>
        tools.ownerMatches(identity.foodName, name)))
      : tools.ownerMatches(identity.foodName, owner);
    if (!ownerMatches) return false;
    const claims = fact.identityClaims;
    switch (evidence.field) {
      case "identity.foodName": {
        if (!owner || !identity.foodName || typeof evidence.value !== "string" ||
            !tools.ownerMatches(evidence.value, owner)) return false;
        const span = evidence.anchor.span!;
        const ownerRange = tools.ownerRange(fact);
        return ownerRange !== null && overlaps([span.start, span.end], ownerRange) &&
          fold(testCase.text.slice(span.start, span.end)).includes(fold(evidence.value));
      }
      case "identity.brand":
      case "identity.variant":
      case "identity.barcode": {
        const field = evidence.field.split(".")[1] as "brand" | "variant" | "barcode";
        const claim = claims?.[field];
        return Boolean(claim && typeof evidence.value === "string" &&
          same(identity[field], claim.value) && same(evidence.value, claim.value) &&
          labelled(fact, claim, evidence.field, evidence));
      }
      case "identity.preparation":
        return typeof evidence.value === "string" && identity.preparation.some(value =>
          same(value, evidence.value as string) && (claims?.preparation ?? []).some(claim =>
            same(claim.value, value) && labelled(fact, claim, evidence.field, evidence)));
      case "identity.qualifiers": {
        if (typeof evidence.value !== "string") return false;
        return identity.qualifiers.some(qualifier => same(qualifier.value, evidence.value as string) &&
          ((claims?.qualifiers ?? []).some(claim => same(claim.value, qualifier.value) &&
            claim.role === qualifier.role && claim.attributeCode === qualifier.attributeCode &&
            labelled(fact, claim, evidence.field, evidence)) ||
          testCase.facts.some(reference => reference.kind === "negation" &&
            qualifier.role === "sweetening" && qualifier.attributeCode === null &&
            reference.owner !== null && tools.ownerMatches(identity.foodName, reference.owner) &&
            same(reference.surface, qualifier.value) && labelled(reference,
              { value: reference.surface, surface: reference.surface,
                surfaceStart: reference.surfaceStart }, evidence.field, evidence))));
      }
      case "quantity.value": {
        return typeof evidence.value === "number" && same(evidence.unit, quantity.unit) &&
          matchingQuantity(evidence, candidate, evidence.unit);
      }
      case "quantity.unit": {
        if (typeof evidence.value !== "string") return false;
        const span = evidence.anchor.span!;
        const source = testCase.text.slice(span.start, span.end);
        return quantityReferences.some(reference =>
          reference.quantity === quantity.value && reference.unit !== null &&
          same(quantity.unit, reference.unit) &&
          (evidence.unit === null || same(evidence.unit, reference.unit)) &&
          contains([span.start, span.end], tools.factRange(reference)) &&
          (same(evidence.value as string, reference.unit) ||
            (fold(source).includes(fold(evidence.value as string)) &&
              fold(reference.surface).includes(fold(evidence.value as string)))));
      }
      case "quantity.grams":
      case "quantity.milliliters": {
        const unit = evidence.field === "quantity.grams" ? "g" : "ml";
        return typeof evidence.value === "number" && same(evidence.unit, unit) &&
          matchingQuantity(evidence, candidate, unit);
      }
      // These claims belong to later resolution/knowledge stages; C1b has no
      // independent label that could prove them from the input surface.
      default:
        return false;
    }
  };
  return observation.evidence.every(evidence => {
    const anchor = evidence.anchor.span;
    if (!anchor || !contains(scope, [anchor.start, anchor.end]) ||
        !contains([observedSpan.start, observedSpan.end], [anchor.start, anchor.end])) return false;
    const grounded = evidence.origin === originalSource ||
      (evidence.origin === "catalog" && observation.normalizationPath.some(step => step.stage === "S2"));
    if (!grounded) return false;
    // A hypothesis cannot cite primary evidence that contradicts its own
    // material claims, even if the primary observation independently supports
    // the same ID. This closes the reverse owner/hypothesis evidence escape.
    const claimingAlternatives = candidates.slice(1).filter(candidate =>
      candidate.evidenceIds?.includes(evidence.evidenceId));
    if (claimingAlternatives.some(candidate => !supports(evidence, candidate))) return false;
    // Orphaned evidence still fails: each field needs a valid primary or
    // explicitly evidence-linked alternative, never just a governed field name.
    return supports(evidence, candidates[0]) ||
      claimingAlternatives.some(candidate => supports(evidence, candidate));
  });
}
