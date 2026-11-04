import { describe, expect, it } from "vitest";
import { buildFoodObservationFixture, buildFoodResolutionDecisionFixture,
  buildFoodOperationEnvelopeFixture } from "./fixtures";
import { mergeD1WhatsAppReply, parseFoodD1WhatsAppPending,
  sanitizeD1WhatsAppObservations } from "./publicWhatsAppPendingContract";

function pending() {
  const env = buildFoodOperationEnvelopeFixture({
    ownerUserId: 7, traceId: "d1-trace-001",
    mealOperation: { action: "add", targetMeal: "almoço", date: "2026-11-04" },
  });
  const observation = buildFoodObservationFixture({
    rawInput: null, normalizedInput: null,
  });
  const decision = buildFoodResolutionDecisionFixture({
    ownerUserId: 7, traceId: env.traceId,
  });
  return { schemaVersion: 2, envelope: env, originEntrypoint: "text",
    occurredAt: "2026-11-04T15:00:00.000Z",
    observations: [observation], decisions: [decision],
    unresolvedIds: ["obs-1"] };
}

describe("#1308 durable V2 WhatsApp pending contract", () => {
  it("preserves owner/trace and the entire original sibling manifest", () => {
    const original = pending();
    const restored = parseFoodD1WhatsAppPending(original);
    expect(restored.observations).toHaveLength(1);
    expect(restored.decisions[0].traceId).toBe("d1-trace-001");
    expect(restored.envelope.ownerUserId).toBe(7);
    expect(restored.unresolvedIds).toEqual(["obs-1"]);
  });

  it("never persists raw initial text, transcription or images", () => {
    const obs = buildFoodObservationFixture({ rawInput: "original private food",
      normalizedInput: "original private food" });
    const stored = sanitizeD1WhatsAppObservations([obs]);
    expect(stored[0].rawInput).toBeNull();
    expect(stored[0].normalizedInput).toBeNull();
    expect(JSON.stringify(stored)).not.toContain("original private food");
    expect(() => parseFoodD1WhatsAppPending({
      ...pending(), observations: [obs],
    })).toThrow("food-d1-whatsapp-pending-state-invalid");
  });

  it("rejects owner, decision trace, duplicate sibling, foreign unresolved ID and missing version", () => {
    const original = pending();
    for (const mutation of [
      { ...original, envelope: { ...original.envelope, ownerUserId: 8 } },
      { ...original, decisions: [{ ...original.decisions[0], traceId: "foreign-trace" }] },
      { ...original, observations: [original.observations[0], original.observations[0]] },
      { ...original, unresolvedIds: ["obs-other"] },
      { ...original, schemaVersion: 1 },
    ]) {
      expect(() => parseFoodD1WhatsAppPending(mutation))
        .toThrow("food-d1-whatsapp-pending-state-invalid");
    }
  });

  it("disallows changing already asserted material identity or quantity via reply", () => {
    const first = buildFoodObservationFixture({
      rawInput: null, normalizedInput: null,
    });
    const newReply = buildFoodObservationFixture({
      identityHints: { foodName: "other food" },
    });
    expect(() => mergeD1WhatsAppReply(first, newReply, "d1-turn-00001"))
      .toThrow("food-d1-whatsapp-continuation-material-conflict");
    const qtyReply = buildFoodObservationFixture({
      quantityHints: { value: 3, unit: "fatia" },
    });
    expect(() => mergeD1WhatsAppReply(first, qtyReply, "d1-turn-00002"))
      .toThrow("food-d1-whatsapp-continuation-material-conflict");
  });

  it("accepts previously missing facts while retaining original observation ID and provenance", () => {
    const first = buildFoodObservationFixture({
      rawInput: null, normalizedInput: null,
      quantityHints: { value: null, unit: null, servingText: null },
      evidence: [buildFoodObservationFixture().evidence[0]],
    });
    const reply = buildFoodObservationFixture({
      identityHints: { foodName: null },
      quantityHints: { value: 100, unit: "g", servingText: "100 g" },
    });
    const merged = mergeD1WhatsAppReply(first, reply, "d1-turn-00003");
    expect(merged.observationId).toBe(first.observationId);
    expect(merged.rawInput).toBeNull();
    expect(merged.quantityHints.value).toBe(100);
    expect(merged.quantityHints.unit).toBe("g");
    expect(merged.evidence.length).toBeGreaterThan(first.evidence.length);
    expect(merged.evidence[0].evidenceId).toBe(first.evidence[0].evidenceId);
  });
});
