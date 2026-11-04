/** #1308 D1 web correction provenance and bounded source identities. */
import { createHash } from "node:crypto";
import { parseFoodObservation, type FoodObservation } from "./schemas";

/** Fixed-size source reference: nested operation and observation IDs can be long. */
export function foodD1WebCorrectionSourceRef(operationKey: string, observationId: string): string {
  return "d1-review:" + createHash("sha256")
    .update(JSON.stringify([operationKey, observationId]))
    .digest("hex");
}

/**
 * A user's text correction changes a visual/voice observation, not its original
 * evidence channel. Keep the old (unverified) source claims with distinct IDs
 * so the canonical resolver can reconcile rather than silently losing them.
 */
export function preserveFoodD1ReviewProvenance(
  corrected: FoodObservation, original: FoodObservation,
): FoodObservation {
  if (original.modality === "text") return corrected;
  const oldEvidence = original.evidence.filter(item =>
    !corrected.evidence.some(previous => previous === item));
  const evidence = oldEvidence.map((item, index) => ({
    ...item,
    evidenceId: "prior-" + createHash("sha256").update(JSON.stringify([
      corrected.observationId, original.observationId,
      item.evidenceId, item.anchor.sourceRef, index,
    ])).digest("hex").slice(0, 32),
  }));
  const combined: FoodObservation = {
    ...corrected,
    modality: "multimodal",
    evidence: [...corrected.evidence, ...evidence],
  };
  const parsed = parseFoodObservation(combined);
  if (!parsed.ok) throw new Error("food-d1-public-web-draft-invalid-correction-provenance");
  return parsed.value;
}


