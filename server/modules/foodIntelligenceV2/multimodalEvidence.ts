/** Merge only matching observations from independent modalities, never food decisions. */
import { createHash } from "node:crypto";
import { parseFoodObservation, type FoodObservation } from "./schemas";

/** A strict, occurrence-preserving comparison; different material facts stay separate. */
function observedAttributes(item: FoodObservation): string | null {
  if (item.identityHints.foodName === null ||
      item.locale.effective === null || item.alternatives.length ||
      item.interpreterVersion !== null) return null;
  return JSON.stringify([
    item.locale.effective, item.lexiconRevision, item.identityHints,
    item.quantityHints, item.unresolvedReason,
  ]);
}

/**
 * One typed item may carry text and transcribed-audio evidence for the same
 * occurrence. Pair across channels only; never dedupe siblings inside a channel.
 * Each evidence retains its original anchor and origin for the canonical V2 resolver.
 */
export function coalesceEquivalentMultimodalEvidence(
  text: readonly FoodObservation[],
  transcript: readonly FoodObservation[],
): FoodObservation[] {
  const usedTranscript = new Set<number>();
  const combined: FoodObservation[] = [];
  for (const primary of text) {
    const key = observedAttributes(primary);
    const match = key === null ? -1 : transcript.findIndex((item, index) =>
      !usedTranscript.has(index) && observedAttributes(item) === key);
    if (match < 0) {
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
      ...primary,
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
