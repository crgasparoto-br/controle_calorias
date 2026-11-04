import { describe, expect, it } from "vitest";
import { buildFoodObservationFixture } from "./fixtures";
import { coalesceEquivalentMultimodalEvidence } from "./multimodalEvidence";
import { parseFoodObservation, type FoodObservation } from "./schemas";

function observed(
  modality: "text" | "audio_transcript",
  id: string,
  overrides: { foodName?: string; quantity?: number } = {},
): FoodObservation {
  const item = buildFoodObservationFixture({
    observationId: id, modality,
    surfaceSpan: { sourceRef: "source:" + id },
    identityHints: { foodName: overrides.foodName ?? "mortadela" },
    quantityHints: { value: overrides.quantity ?? 1.5 },
  });
  return {
    ...item,
    evidence: item.evidence.map(evidence => ({
      ...evidence,
      origin: modality === "text" ? "text" as const : "transcription" as const,
      anchor: { ...evidence.anchor, sourceRef: "source:" + id },
    })),
    normalizationPath: item.normalizationPath.map(step => ({
      ...step, anchor: { ...step.anchor, sourceRef: "source:" + id },
    })),
  };
}

describe("multimodal evidence coalescing at the web public boundary", () => {
  it("pairs equivalent text and transcript without duplicating the meal item", () => {
    const result = coalesceEquivalentMultimodalEvidence(
      [observed("text", "typed")], [observed("audio_transcript", "spoken")],
    );
    expect(result).toHaveLength(1);
    expect(result[0].modality).toBe("multimodal");
    expect(result[0].observationId).toBe("typed");
    expect(new Set(result[0].evidence.map(item => item.origin)))
      .toEqual(new Set(["text", "transcription"]));
    expect(new Set(result[0].evidence.map(item => item.anchor.sourceRef)))
      .toEqual(new Set(["source:typed", "source:spoken"]));
    expect(new Set(result[0].evidence.map(item => item.evidenceId)).size)
      .toBe(result[0].evidence.length);
    expect(parseFoodObservation(result[0]).ok).toBe(true);
  });

  it("never conflates repeated siblings within the same channel", () => {
    const result = coalesceEquivalentMultimodalEvidence(
      [observed("text", "typed-1"), observed("text", "typed-2")],
      [observed("audio_transcript", "spoken-1"), observed("audio_transcript", "spoken-2")],
    );
    expect(result).toHaveLength(2);
    expect(result.map(item => item.observationId)).toEqual(["typed-1", "typed-2"]);
    expect(result.every(item => item.modality === "multimodal")).toBe(true);
  });

  it("enriches missing visual or voice quantity without inventing a second serving", () => {
    const primary = observed("text", "typed");
    const second = observed("audio_transcript", "spoken");
    const missingQuantity: FoodObservation = {
      ...second,
      quantityHints: {
        ...second.quantityHints,
        value: null, unit: null, servingText: null,
      },
      evidence: second.evidence.filter(item => !item.field.startsWith("quantity.")),
    };
    const result = coalesceEquivalentMultimodalEvidence([primary], [missingQuantity]);
    expect(result).toHaveLength(1);
    expect(result[0].modality).toBe("multimodal");
    expect(result[0].quantityHints.value).toBe(1.5);
    expect(result[0].quantityHints.unit).toBe("fatia");
    expect(result[0].evidence.some(item => item.origin === "transcription")).toBe(true);
    expect(parseFoodObservation(result[0]).ok).toBe(true);
  });

  it("rejects unmatched repeated photo/text count instead of silently registering a duplicate", () => {
    const typed = [observed("text", "typed-1"), observed("text", "typed-2")];
    const visual = [observed("audio_transcript", "image-1")];
    expect(() => coalesceEquivalentMultimodalEvidence(typed, visual))
      .toThrow("food-d1-multimodal-sibling-cardinality-conflict");
    expect(() => coalesceEquivalentMultimodalEvidence(
      [typed[0]], [visual[0], observed("audio_transcript", "image-2")],
    )).toThrow("food-d1-multimodal-sibling-cardinality-conflict");
    const allowed = coalesceEquivalentMultimodalEvidence(
      typed, [visual[0], observed("audio_transcript", "image-2")],
    );
    expect(allowed).toHaveLength(2);
    expect(allowed.map(item => item.observationId)).toEqual(["typed-1", "typed-2"]);
  });

  it("rejects ambiguous pairing of materially distinct repeated servings", () => {
    const typed = [
      observed("text", "first", { quantity: 1 }),
      observed("text", "second", { quantity: 2 }),
    ];
    const visual = [
      observed("audio_transcript", "photo-1"),
      observed("audio_transcript", "photo-2"),
    ].map(item => ({
      ...item,
      quantityHints: { ...item.quantityHints,
        value: null, unit: null, servingText: null,
      },
    }));
    expect(() => coalesceEquivalentMultimodalEvidence(typed, visual))
      .toThrow("food-d1-multimodal-ambiguous-sibling-match");
    // Explicitly observed quantities remove the ambiguity without merging
    // siblings from a single channel or inventing more registrations.
    const grounded = coalesceEquivalentMultimodalEvidence(typed, [
      observed("audio_transcript", "voice-first", { quantity: 1 }),
      observed("audio_transcript", "voice-second", { quantity: 2 }),
    ]);
    expect(grounded).toHaveLength(2);
    expect(grounded.map(item => item.quantityHints.value)).toEqual([1, 2]);
  });

  it("keeps separate foods but rejects conflicting claims for the same food", () => {
    const unrelated = coalesceEquivalentMultimodalEvidence(
      [observed("text", "typed")],
      [observed("audio_transcript", "spoken", { foodName: "queijo" })],
    );
    expect(unrelated).toHaveLength(2);
    expect(unrelated.map(item => item.modality)).toEqual(["text", "audio_transcript"]);
    expect(() => coalesceEquivalentMultimodalEvidence(
      [observed("text", "typed")],
      [observed("audio_transcript", "spoken", { quantity: 2 })],
    )).toThrow("food-d1-multimodal-material-evidence-conflict");
  });
});
