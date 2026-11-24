/** Diagnostic-only projector. The original R2 oracle and its reference stay unchanged. */
import type { FoodMaterialLanguageResult } from "../linguisticComprehension";
import {
  parseFoodMaterialObservationBatch,
  type FoodMaterialObservation,
  type FoodObservation,
} from "../schemas";
import { foldLabelledFoodName as fold } from "./semanticConservation1341.evidence.fixture";
import type { C1bCase } from "./semanticConservation1341.test.fixture";
import {
  evaluateC1b,
  validateC1bReference,
} from "./semanticConservation1341.test.support.fixture";

type Range = [number, number];
type Anchor = FoodObservation["surfaceSpan"];
type Status = "verified" | "abstained" | "semantic-mismatch" | "missing";
type Proof =
  | "typed-ingredient"
  | "existing-observation-field"
  | "explicit-source-abstention"
  | null;
interface Finding {
  factIndex: number;
  kind: C1bCase["facts"][number]["kind"];
  sourceRange: Range;
  status: Status;
  proof: Proof;
  reason: string;
}
const contains = (outer: Range, inner: Range) =>
  outer[0] <= inner[0] && inner[1] <= outer[1];
const overlaps = (left: Range, right: Range) =>
  left[0] < right[1] && right[0] < left[1];

function sourceRange(test: C1bCase, anchor: Anchor): Range | null {
  const span = anchor.span;
  return anchor.sourceRef === "c1b:" + test.id &&
    anchor.region === null &&
    span &&
    Number.isSafeInteger(span.start) &&
    Number.isSafeInteger(span.end) &&
    span.start >= 0 &&
    span.start < span.end &&
    span.end <= test.text.length
    ? [span.start, span.end]
    : null;
}

// The frozen R3 comparison covers this amount-before-name fixture shape.
// Delimit the authored measure span; do not parse number words, units or food.
function labelledMeasureEnd(text: string, start: number, ingredient: number) {
  return (
    start + text.slice(start, ingredient).replace(/\s+(?:de\s+)?$/iu, "").length
  );
}

function hasLabelledOwner(
  text: string,
  surfaceStart: number,
  claimStart: number,
  owner: string
) {
  if (!owner) return false;
  const beforeClaim = text.slice(surfaceStart, claimStart);
  const lexicalEnd = /[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}'’]$/u;
  const lexicalStart = /^[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}'’]/u;
  for (
    let at = beforeClaim.indexOf(owner);
    at >= 0;
    at = beforeClaim.indexOf(owner, at + owner.length)
  ) {
    const start = surfaceStart + at;
    if (
      !lexicalEnd.test(text.slice(0, start)) &&
      !lexicalStart.test(text.slice(start + owner.length))
    )
      return true;
  }
  return false;
}

const foldOwner = (value: string) =>
  fold(value).replace(/^(?:o|a|um|uma)\s+/u, "");

function originalObservation(
  test: C1bCase,
  observation: FoodMaterialObservation
): boolean {
  const surface = sourceRange(test, observation.surfaceSpan);
  return (
    surface !== null &&
    observation.rawInput === test.text &&
    observation.modality === test.modality &&
    [...observation.evidence, ...observation.normalizationPath].every(item => {
      const span = sourceRange(test, item.anchor);
      return span !== null && contains(surface, span);
    })
  );
}

function sharedFields(observation: FoodMaterialObservation): FoodObservation {
  const { materialClaims: _material, evidence, ...other } = observation;
  return {
    ...other,
    schemaVersion: 2,
    evidence: evidence.filter(item => !item.field.startsWith("material.")),
  };
}

export function compareC1bR3(
  test: C1bCase,
  result: FoodMaterialLanguageResult
) {
  validateC1bReference(test);
  const input = "observations" in result ? result.observations : [];
  const affected =
    !result.ok && result.reason === "unproven-material" ? result.affected : [];
  const checked = parseFoodMaterialObservationBatch(input);
  const issues: string[] = [];
  if (!checked.ok) issues.push("invalid-r3-wire");
  const proven = (checked.ok ? checked.value : []).filter(observation => {
    const valid = originalObservation(test, observation);
    if (!valid) issues.push("invalid-observation-provenance");
    return valid;
  });
  const legacy = evaluateC1b(test, proven.map(sharedFields));
  const claims = proven.flatMap(observation =>
    observation.materialClaims.map(claim => ({ observation, claim }))
  );
  const usedClaims = new Set<string>();
  const usedAffected = new Set<string>();
  const seenObs = new Set(input.map(row => row.observationId));
  const seenAffected = new Set<string>();
  const validAffected = affected.flatMap(row => {
    const span = sourceRange(test, row.surfaceSpan);
    if (
      !span ||
      !row.observationId.trim() ||
      seenObs.has(row.observationId) ||
      seenAffected.has(row.observationId)
    ) {
      issues.push("invalid-abstention-anchor-or-identity");
      return [];
    }
    seenAffected.add(row.observationId);
    return [{ id: row.observationId, span }];
  });
  const findings = legacy.results.map((old, factIndex): Finding => {
    const fact = test.facts[factIndex];
    const row = (status: Status, proof: Proof, reason: string): Finding => ({
      factIndex,
      kind: fact.kind,
      sourceRange: old.sourceRange,
      status,
      proof,
      reason,
    });
    if (!checked.ok) return row("semantic-mismatch", null, "invalid-r3-wire");

    let relevantIngredientClaim = false;
    if (fact.kind === "ingredient-quantity") {
      const exact = claims.filter(({ observation, claim }) => {
        if (claim.kind !== "ingredient") return false;
        const amount = observation.evidence.find(
          item => item.evidenceId === claim.amount?.evidenceId
        );
        const ingredient = observation.evidence.find(
          item => item.evidenceId === claim.ingredient.evidenceId
        );
        const a = amount && sourceRange(test, amount.anchor);
        const i = ingredient && sourceRange(test, ingredient.anchor);
        const surface = sourceRange(test, observation.surfaceSpan)!;
        if (
          !(a && overlaps(a, old.sourceRange)) &&
          !(i && overlaps(i, old.sourceRange))
        )
          return false;
        relevantIngredientClaim = true;
        const expectedOrigin =
          test.modality === "audio_transcript" ? "transcription" : "text";
        const expectedOwner = fact.owner ?? "";
        const ownerEvidence = observation.evidence.filter(
          item => item.field === "identity.foodName"
        );
        const ownerProven =
          ownerEvidence.length > 0 &&
          ownerEvidence.every(item => {
            if (
              item.origin !== expectedOrigin ||
              typeof item.value !== "string" ||
              foldOwner(item.value) !== fold(expectedOwner)
            )
              return false;
            const anchor = sourceRange(test, item.anchor);
            return (
              anchor !== null &&
              anchor[1] <= old.sourceRange[0] &&
              hasLabelledOwner(test.text, anchor[0], anchor[1], expectedOwner)
            );
          });
        return (
          claim.binding.status === "bound" &&
          claim.binding.ownerObservationId === observation.observationId &&
          foldOwner(observation.identityHints.foodName ?? "") ===
            fold(expectedOwner) &&
          ownerProven &&
          contains(old.scopeRange, surface) &&
          contains(surface, old.sourceRange) &&
          claim.amount?.value === fact.quantity &&
          fold(claim.amount?.unit ?? "") === fold(fact.unit ?? "") &&
          fold(claim.ingredient.name) === fold(fact.ingredient ?? "") &&
          ingredient?.field === "material.ingredient" &&
          ingredient.origin === expectedOrigin &&
          amount?.field === "material.amount" &&
          amount.origin === expectedOrigin &&
          amount.ingredientEvidenceId === claim.ingredient.evidenceId &&
          !!a &&
          !!i &&
          a[0] === old.sourceRange[0] &&
          a[1] < i[0] &&
          a[1] === labelledMeasureEnd(test.text, a[0], i[0]) &&
          i[1] === old.sourceRange[1] &&
          fold(test.text.slice(i[0], i[1])) === fold(fact.ingredient ?? "")
        );
      });
      if (exact.length === 1 && !usedClaims.has(exact[0].claim.claimId)) {
        usedClaims.add(exact[0].claim.claimId);
        return row(
          "verified",
          "typed-ingredient",
          "exact-origin-owner-and-measure"
        );
      }
      if (relevantIngredientClaim)
        return row("semantic-mismatch", null, "typed-claim-not-proven");
    } else if (old.grade === "structured") {
      return row(
        "verified",
        "existing-observation-field",
        "same-independent-r2-field-oracle"
      );
    }

    const abstention = validAffected.find(
      item =>
        contains(old.scopeRange, item.span) &&
        contains(item.span, old.sourceRange)
    );
    if (abstention) {
      // A claimed fact in the very occurrence rejected by the producer must
      // not masquerade as abstention. Siblings may still have their own proof.
      if (
        proven.some(obs =>
          overlaps(sourceRange(test, obs.surfaceSpan)!, old.sourceRange)
        )
      ) {
        return row(
          "semantic-mismatch",
          null,
          "abstention-conflicts-with-emitted-observation"
        );
      }
      usedAffected.add(abstention.id);
      return row(
        "abstained",
        "explicit-source-abstention",
        "producer-reported-unproven-material"
      );
    }
    if (
      old.grade === "silent-omission" ||
      (fact.kind === "ingredient-quantity" && !relevantIngredientClaim)
    ) {
      return row("missing", null, "no-matching-fact-or-explicit-abstention");
    }
    return row("semantic-mismatch", null, "existing-observation:" + old.grade);
  });
  for (const { claim } of claims) {
    if (!usedClaims.has(claim.claimId))
      issues.push("unexpected-or-mismatched-typed-claim");
  }
  for (const item of validAffected) {
    if (!usedAffected.has(item.id)) issues.push("unmatched-abstention");
  }
  for (const item of legacy.observationIssues) {
    if (
      item.grade === "unexpected-observation" ||
      item.grade === "duplicate-observation"
    )
      issues.push(item.grade);
  }
  return {
    caseId: test.id,
    split: test.split,
    modality: test.modality,
    producer: result.ok ? "ok" : result.reason,
    findings,
    issues,
    // Report legacy-field observation warnings separately; e.g. R2 has no
    // nested material representation and cannot grade it as established R3.
    legacyFieldWarnings: legacy.observationIssues.map(item => item.grade),
    diagnosticBatchComplete:
      result.ok &&
      issues.length === 0 &&
      findings.length > 0 &&
      findings.every(fact => fact.status === "verified"),
    authority: "diagnostic-only" as const,
  };
}
