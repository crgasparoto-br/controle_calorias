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
  const labelled = (source: C1bFact, label: C1bTextClaim, field: string,
    evidence: FoodEvidence): boolean => tools.labelled(source, label, [field], [evidence.evidenceId], true);
  const supports = (evidence: FoodEvidence, candidate: Candidate): boolean => {
    if (candidate.evidenceIds !== null && !candidate.evidenceIds.includes(evidence.evidenceId)) return false;
    const identity = candidate.identity;
    const quantity = candidate.quantity;
    const owner = fact.owner;
    const ownerMatches = owner === null ? fact.kind === "unbound" && identity.foodName === null
      : tools.ownerMatches(identity.foodName, owner);
    if (!ownerMatches) return false;
    const claims = fact.identityClaims;
    switch (evidence.field) {
      case "identity.foodName": {
        if (!owner || !identity.foodName || typeof evidence.value !== "string" ||
            !tools.ownerMatches(evidence.value, owner)) return false;
        const span = evidence.anchor.span!;
        return overlaps([span.start, span.end], manualRange) &&
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
        if (!(["food-quantity", "ingredient-quantity", "unbound"] as string[]).includes(fact.kind) ||
            typeof evidence.value !== "number" || evidence.value !== fact.quantity ||
            quantity.value !== fact.quantity || !same(quantity.unit, fact.unit) ||
            !same(evidence.unit, fact.unit)) return false;
        const span = evidence.anchor.span!;
        return contains([span.start, span.end], manualRange);
      }
      case "quantity.unit": {
        if (fact.quantity === null || !fact.unit || typeof evidence.value !== "string" ||
            quantity.value !== fact.quantity || !same(quantity.unit, fact.unit) ||
            (evidence.unit !== null && !same(evidence.unit, fact.unit))) return false;
        const span = evidence.anchor.span!;
        const source = testCase.text.slice(span.start, span.end);
        return contains([span.start, span.end], manualRange) &&
          (same(evidence.value, fact.unit) ||
            (fold(source).includes(fold(evidence.value)) &&
              fold(fact.surface).includes(fold(evidence.value))));
      }
      case "quantity.grams":
      case "quantity.milliliters": {
        const unit = evidence.field === "quantity.grams" ? "g" : "ml";
        const span = evidence.anchor.span!;
        return same(fact.unit, unit) && same(quantity.unit, unit) &&
          quantity.value === fact.quantity && evidence.value === fact.quantity &&
          same(evidence.unit, unit) && contains([span.start, span.end], manualRange);
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
    // Reject source-backed extras even when the primary hints look correct.
    // An alternative may rely only on IDs actually listed in evidenceIds.
    return candidates.some(candidate => supports(evidence, candidate));
  });
}
