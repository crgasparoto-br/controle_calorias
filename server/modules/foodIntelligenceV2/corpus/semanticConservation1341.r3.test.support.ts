/** Diagnostic-only projector. The original R2 oracle and its reference stay unchanged. */
import type { FoodMaterialLanguageResult } from "../linguisticComprehension";
import {
  parseFoodMaterialObservationBatch,
  type FoodMaterialObservation,
  type FoodObservation,
} from "../schemas";
import { foldLabelledFoodName as fold } from "./semanticConservation1341.evidence.fixture";
import type { C1bCase, C1bFact } from "./semanticConservation1341.test.fixture";
import {
  evaluateC1b,
  factSourceRange,
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

function labelledOwnerRanges(
  text: string,
  surfaceStart: number,
  claimStart: number,
  owner: string
) {
  if (!owner) return [];
  const ranges: Range[] = [];
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
      ranges.push([start, start + owner.length]);
  }
  return ranges;
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

/**
 * Verify reverse ownership of the shared claims on an R3 ingredient owner.
 * The original R2 audit expects S1 to cover the ingredient phrase; R3's
 * existing-field S1 path covers the food owner instead. Reuse the unmodified
 * R2 material oracle on that owner and on any separately authored local food
 * facts. The ingredient label supplies a name, never a whole-food amount.
 */
function sharedIngredientOwnerEvidence(
  test: C1bCase,
  observation: FoodMaterialObservation,
  reference: C1bFact,
  scope: Range,
  ingredient: Range
) {
  const owner = reference.owner;
  if (!owner) return null;
  const names = labelledOwnerRanges(test.text, scope[0], ingredient[0], owner);
  if (names.length !== 1) return null;
  const [start, end] = names[0];
  const local: { fact: C1bFact; index: number | null }[] = [];
  for (const [index, fact] of test.facts.entries()) {
    if (
      fact.owner !== owner ||
      (fact.kind !== "food-quantity" &&
        fact.kind !== "food-mention" &&
        fact.kind !== "negation")
    )
      continue;
    const span = factSourceRange(test, fact);
    const from = fact.scopeStart ?? test.text.indexOf(fact.scope);
    const ownScope: Range = [from, from + fact.scope.length];
    if (
      !contains(scope, ownScope) ||
      !contains(scope, span) ||
      (fact.kind !== "negation" && !contains(span, [start, end]))
    )
      continue;
    // The R3 surface can also include the typed ingredient. An independently
    // labelled whole-food occurrence may have its own narrower scope there.
    // The probe reuses the enclosing authored scope but not the observed one:
    // the food claim, its position, amount and proof anchors do not change.
    local.push({
      index:
        fact.kind !== "negation" &&
        (ownScope[0] !== scope[0] || ownScope[1] !== scope[1])
          ? index
          : null,
      fact: {
        ...fact,
        scope: reference.scope,
        scopeStart: scope[0],
      },
    });
  }
  if (
    !local.some(
      ({ fact }) =>
        fact.kind === "food-quantity" || fact.kind === "food-mention"
    )
  ) {
    local.push({
      index: null,
      fact: {
        kind: "food-mention",
        owner,
        scope: reference.scope,
        scopeStart: scope[0],
        surface: test.text.slice(start, end),
        surfaceStart: start,
        ingredient: null,
        quantity: null,
        unit: null,
        ...(reference.identityClaims
          ? { identityClaims: reference.identityClaims }
          : {}),
      },
    });
  }
  const check = evaluateC1b({ ...test, facts: local.map(item => item.fact) }, [
    sharedFields(observation),
  ]);
  return check.observationIssues.length === 0
    ? check.results.flatMap((item, index) => {
        const original = local[index].index;
        return original !== null && item.grade === "structured"
          ? [original]
          : [];
      })
    : null;
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
  const sharedFieldIssues = new Set<string>();
  const sharedMatches = new Map<number, Set<string>>();
  const typedOwnerIds = new Set<string>();
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
              labelledOwnerRanges(
                test.text,
                anchor[0],
                anchor[1],
                expectedOwner
              ).length > 0
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
        const { observation, claim } = exact[0];
        usedClaims.add(claim.claimId);
        typedOwnerIds.add(observation.observationId);
        const local = sharedIngredientOwnerEvidence(
          test,
          observation,
          fact,
          old.scopeRange,
          old.sourceRange
        );
        if (local === null) sharedFieldIssues.add(observation.observationId);
        else
          for (const index of local) {
            const owners = sharedMatches.get(index) ?? new Set<string>();
            owners.add(observation.observationId);
            sharedMatches.set(index, owners);
          }
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
  for (const [index, owners] of sharedMatches) {
    // No partial path, alternate producer or broadened offset supplies a
    // fact: exactly one matched observation must have passed both proofs.
    if (owners.size !== 1 || [...owners].some(id => sharedFieldIssues.has(id)))
      continue;
    const item = findings[index];
    if (
      item.reason !== "existing-observation:invalid-evidence" ||
      validAffected.some(affected => overlaps(affected.span, item.sourceRange))
    )
      continue;
    findings[index] = {
      ...item,
      status: "verified",
      proof: "existing-observation-field",
      reason: "independent-local-existing-field-oracle",
    };
  }
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
      item.grade === "duplicate-observation" ||
      item.grade === "invalid-provenance"
    )
      issues.push(item.grade);
    else if (
      item.grade === "invalid-evidence" &&
      !typedOwnerIds.has(item.observationId)
    )
      sharedFieldIssues.add(item.observationId);
  }
  const sharedMaterialIssues = [...sharedFieldIssues].map(observationId => ({
    observationId,
    reason: "unexpected-or-contradictory-shared-material",
  }));
  for (const item of sharedMaterialIssues) issues.push(item.reason);
  return {
    caseId: test.id,
    split: test.split,
    modality: test.modality,
    producer: result.ok ? "ok" : result.reason,
    findings,
    issues,
    sharedMaterialIssues,
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
