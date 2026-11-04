/** Merge only matching observations from independent modalities, never food decisions. */
import { createHash } from "node:crypto";
import { parseFoodObservation, type FoodObservation } from "./schemas";

/** A strict, occurrence-preserving comparison; different material facts stay separate. */
function observedIdentity(item: FoodObservation): string | null {
  return item.identityHints.foodName === null || item.locale.effective === null
    ? null : JSON.stringify([
      item.locale.effective, item.lexiconRevision, item.identityHints.foodName,
    ]);
}

function observedAttributes(item: FoodObservation): string | null {
  if (item.identityHints.foodName === null ||
      item.locale.effective === null || item.alternatives.length ||
      item.interpreterVersion !== null) return null;
  return JSON.stringify([
    item.locale.effective, item.lexiconRevision, item.identityHints,
    item.quantityHints, item.unresolvedReason,
  ]);
}

function compatibleMaterialFacts(
  left: FoodObservation, right: FoodObservation,
): boolean {
  if (observedIdentity(left) === null ||
      observedIdentity(left) !== observedIdentity(right) ||
      left.interpreterVersion !== null || right.interpreterVersion !== null ||
      left.alternatives.length > 0 || right.alternatives.length > 0 ||
      left.unresolvedReason !== right.unresolvedReason) return false;
  const equivalent = (a: string | number | null, b: string | number | null) =>
    a === null || b === null || a === b;
  const a = left.identityHints;
  const b = right.identityHints;
  const q = left.quantityHints;
  const p = right.quantityHints;
  return equivalent(a.brand, b.brand) &&
    equivalent(a.variant, b.variant) &&
    equivalent(a.barcode, b.barcode) &&
    JSON.stringify(a.preparation) === JSON.stringify(b.preparation) &&
    JSON.stringify(a.qualifiers) === JSON.stringify(b.qualifiers) &&
    equivalent(q.value, p.value) &&
    equivalent(q.unit, p.unit) &&
    equivalent(q.servingText, p.servingText) &&
    equivalent(q.visiblePackageQuantity, p.visiblePackageQuantity) &&
    equivalent(q.visiblePackageUnit, p.visiblePackageUnit);
}

function enrichEquivalentObservation(
  primary: FoodObservation, secondary: FoodObservation,
): FoodObservation {
  const mergeNullables = <T extends Record<string, unknown>>(a: T, b: T): T =>
    Object.fromEntries(Object.entries(a).map(([key, value]) =>
      [key, value === null ? b[key] : value])) as T;
  return {
    ...primary,
    identityHints: mergeNullables(primary.identityHints, secondary.identityHints),
    quantityHints: mergeNullables(primary.quantityHints, secondary.quantityHints),
  };
}

/**
 * Pair equivalent evidence across channels, never dedupe siblings inside one.
 * Missing image quantity may enrich a typed amount but conflicting non-null
 * claims always fail closed. All anchors remain tied to their original source.
 */
export function coalesceEquivalentMultimodalEvidence(
  text: readonly FoodObservation[],
  transcript: readonly FoodObservation[],
): FoodObservation[] {
  const usedTranscript = new Set<number>();
  const combined: FoodObservation[] = [];
  for (const primary of text) {
    const key = observedAttributes(primary);
    const exactMatch = key === null ? -1 : transcript.findIndex((item, index) =>
      !usedTranscript.has(index) && observedAttributes(item) === key);
    const match = exactMatch >= 0 ? exactMatch : transcript.findIndex((item, index) =>
      !usedTranscript.has(index) && compatibleMaterialFacts(primary, item));
    if (match < 0) {
      // A repeated food with conflicting quantity, brand or qualification
      // must not become two registered servings merely because it was voiced.
      const identity = observedIdentity(primary);
      if (identity !== null && transcript.some((item, index) =>
        !usedTranscript.has(index) && observedIdentity(item) === identity)) {
        throw new Error("food-d1-multimodal-material-evidence-conflict");
      }
      combined.push(primary);
      continue;
    }
    const secondary = transcript[match];
    const evidence = secondary.evidence.map((item, index) => ({
      ...item,
      evidenceId: "mm-" + createHash("sha256").update(JSON.stringify([
        primary.observationId, secondary.observationId, item.evidenceId, index,
      ])).digest("hex").slice(0,32),
    }));
    const merged: FoodObservation = {
      ...enrichEquivalentObservation(primary, secondary),
      modality: "multimodal",
      evidence: [...primary.evidence, ...evidence],
      normalizationPath: [...primary.normalizationPath, ...secondary.normalizationPath],
    };
    const validated = parseFoodObservation(merged);
    if (!validated.ok) throw new Error("food-d1-multimodal-evidence-invalid");
    usedTranscript.add(match);
    combined.push(validated.value);
  }
  transcript.forEach((item, index) => {
    if (!usedTranscript.has(index)) combined.push(item);
  });
  return combined;
}
