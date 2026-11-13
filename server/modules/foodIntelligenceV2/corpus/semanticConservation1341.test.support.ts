/**
 * #1341 experimental fact-conservation oracle, not a second parser or a writer.
 * References are authored without inspecting V1/V2 outputs. Only actual
 * FoodObservation fields may establish structured semantic coverage.
 */
import type { FoodObservation } from "../schemas";
import { projectObservation } from "./projection";
import type { C1bCase, C1bFact } from "./semanticConservation1341.test.fixture";

export type C1bGrade =
  | "structured" | "traceable-unresolved" | "missing-component-binding"
  | "ingredient-quantity-unobserved" | "ingredient-quantity-mismatch"
  | "owner-alternatives-missing" | "unbound-as-food" | "misbound"
  | "silent-omission" | "invalid-provenance" | "invalid-evidence" | "false-closed";
export type C1bResult = {
  caseId: string;
  factIndex: number;
  kind: C1bFact["kind"];
  grade: C1bGrade;
  sourceRange: [number, number];
  scopeRange: [number, number];
  expected: { owner: string | null; ownerAlternatives: readonly string[]; requiresAbstention: boolean;
    ingredient: string | null; quantity: number | null; unit: string | null; uncertaintyReason: string | null };
  observed: { foodNames: (string | null)[]; quantityHints: { value: number | null; unit: string | null }[];
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
/** C1b uses the independent fact spans in BOTH directions: a parser cannot
 * invent an extra food or duplicate an observed food and still pass coverage. */
function observationClaimsFact(testCase: C1bCase, observation: FoodObservation, fact: C1bFact): boolean {
  const span = spanOf(observation);
  if (span === null || !contains(span, uniqueSpan(testCase.text, fact.surface))) return false;
  if (fact.owner === null) return true;
  const scope = uniqueSpan(testCase.text, fact.scope);
  const owner = ownerRange(testCase, fact, scope);
  return owner !== null && contains(span, owner) &&
    ownerMatchesIdentity(observation.identityHints.foodName, fact.owner);
}

/** SourceRef/offset validity alone is insufficient: a text anchor and the
 * evidence values must substantiate the identity, quantity and qualifiers.
 * No new text parser or lexical oracle is introduced. */
function hasMaterialEvidence(testCase: C1bCase, observation: FoodObservation, fact: C1bFact): boolean {
  const claimRange = uniqueSpan(testCase.text, fact.surface);
  const scopeRange = uniqueSpan(testCase.text, fact.scope);
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

  // A local negation can be supported by the lexical identity evidence even
  // when the S1 parser does not emit a separate qualifier evidence record.
  for (const qualifier of observation.identityHints.qualifiers) {
    if (!observation.evidence.some(item =>
      (item.field === "identity.foodName" || item.field === "identity.qualifiers") &&
      typeof item.value === "string" && fold(item.value).includes(fold(qualifier.value)) &&
      rawAt(item.anchor).includes(fold(qualifier.value)))) return false;
  }
  return true;
}

function equalQuantity(observation: FoodObservation, fact: C1bFact): boolean {
  return observation.quantityHints.value === fact.quantity &&
    fold(observation.quantityHints.unit ?? "") === fold(fact.unit ?? "");
}
function ownerRange(testCase: C1bCase, fact: C1bFact, scope: [number, number]): [number, number] | null {
  if (fact.owner === null) return null;
  const at = testCase.text.slice(scope[0], scope[1]).indexOf(fact.owner);
  if (at < 0) throw new Error("c1b-reference-owner-not-in-scope");
  return [scope[0] + at, scope[0] + at + fact.owner.length];
}

/** Fails on an invalid human reference before observing either parser. */
export function validateC1bReference(testCase: C1bCase): void {
  if (!testCase.id || !testCase.semanticGroup || !testCase.facts.length) {
    throw new Error("c1b-reference-incomplete");
  }
  for (const fact of testCase.facts) {
    const scope = uniqueSpan(testCase.text, fact.scope);
    const source = uniqueSpan(testCase.text, fact.surface);
    if (!contains(scope, source)) throw new Error("c1b-reference-claim-outside-scope");
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
  const sourceRange = uniqueSpan(testCase.text, fact.surface);
  const scopeRange = uniqueSpan(testCase.text, fact.scope);
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
        : alternativesComplete ? "traceable-unresolved" : "owner-alternatives-missing";
  }
  if (grade === "structured" && attached.some(obs =>
    observationClaimsFact(testCase, obs, fact) &&
    !hasMaterialEvidence(testCase, obs, fact))) grade = "invalid-evidence";
  return { caseId: testCase.id, factIndex, kind: fact.kind, grade, sourceRange, scopeRange,
    expected: { owner: fact.owner, ownerAlternatives: fact.ownerAlternatives ?? [],
      requiresAbstention: fact.requiresAbstention ?? false,
      ingredient: fact.ingredient, quantity: fact.quantity, unit: fact.unit,
      uncertaintyReason: fact.uncertaintyReason ?? null },
    observed: { foodNames: attached.map(obs => obs.identityHints.foodName),
      quantityHints: attached.map(obs => ({ value: obs.quantityHints.value, unit: obs.quantityHints.unit })),
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
    fold(item.uncertaintyReason ?? ""), item.requiresAbstention ? "abstain" : ""].join("|"))
    .sort().join(";");
}

export function summarizeC1b(reports: readonly C1bCaseReport[]) {
  const grades: Record<C1bGrade, number> = {
    structured: 0, "traceable-unresolved": 0, "missing-component-binding": 0,
    "ingredient-quantity-unobserved": 0, "ingredient-quantity-mismatch": 0,
    "owner-alternatives-missing": 0, "unbound-as-food": 0, misbound: 0,
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
