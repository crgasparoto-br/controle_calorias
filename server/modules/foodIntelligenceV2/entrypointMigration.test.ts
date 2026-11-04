import { describe, expect, it, vi } from "vitest";
import {
  buildFoodObservationFixture, buildFoodOperationEnvelopeFixture,
  buildFoodResolutionDecisionFixture,
} from "./fixtures";
import {
  buildD1OperationPlan, type FoodD1Dependencies, type FoodD1Request,
} from "./entrypointMigration";
import type { FoodKnowledgeLocalResult, FoodKnowledgeStore, GovernedFoodMatch } from "./knowledgeRead";
import type { FoodOperationEnvelope, FoodObservation } from "./schemas";
import { coalesceEquivalentMultimodalEvidence } from "./multimodalEvidence";

const envelope = () => buildFoodOperationEnvelopeFixture() as FoodOperationEnvelope;
const match: GovernedFoodMatch = {
  kind: "match", matchingEvidence: "exact_variant",
  foodId: 101, variantId: 102, profileId: 103,
  variantName: "Mortadela", sourceId: 104, sourceVersion: "source-1",
  sourceReference: "https://example.org/mortadela",
  nutrition: {
    caloriesKcal: 270, proteinG: 12, carbG: 3, fatG: 23,
    basisQuantity: 100, basisUnit: "g",
  },
  governanceStatus: "verified",
  knowledgeValidity: {
    checkedAt: "2026-01-01T00:00:00Z", validUntil: null,
    userId: 7, resolverVersion: "v2.0.0",
  },
  portions: [{
    portionId: 105, foodEntityId: 101, variantId: 102,
    label: "fatia", unit: "fatia", quantity: 1, grams: 20,
    status: "verified", measureKind: "exact", confidence: null,
    sourceId: 106, sourceVersion: "portion-v1",
    sourceReference: "https://example.org/portions/105", sourcePortionCode: "slice-105",
    evidenceId: 107, validFrom: null, validTo: null,
    updatedAt: "2026-10-20T00:00:00Z",
  }],
};

function deps(): FoodD1Dependencies & { knowledge: FoodKnowledgeStore } {
  return {
    authorizeEvidence: vi.fn(async () => true),
    authorizeExistingItem: vi.fn(async () => true),
    lexicon: { load: vi.fn(async () => []) },
    knowledge: {
      readLocal: vi.fn(async (input): Promise<FoodKnowledgeLocalResult> =>
        input.normalizedName === "mortadela" ? match : { kind: "miss", reason: "not_found" }),
      readPendingEvidence: vi.fn(async () => null),
      stagePendingEvidence: vi.fn(async () => { throw new Error("D1 must not stage evidence"); }),
    },
  };
}

function surface(
  entrypoint: FoodD1Request["entrypoint"],
  modality: "text" | "audio_transcript" | "image",
  sourceRef: string,
  imageRegionRole?: "front_identity" | "caption",
): FoodD1Request {
  return {
    authenticatedUserId: 7, entrypoint, envelope: envelope(),
    evidence: {
      kind: "surface", modality, sourceRef, imageRegionRole,
      rawText: "1,5 fatias de mortadela",
    },
    now: new Date("2026-11-01T12:00:00Z"),
  };
}

describe("#1308 D1 - one linguistic and food resolver contract", () => {
  it("uses the same governed identity, quantity and nutrition for equivalent text, transcript and OCR evidence", async () => {
    const connections = deps();
    const outputs = await Promise.all([
      buildD1OperationPlan(surface("text", "text", "source:text"), connections),
      buildD1OperationPlan(surface("audio_transcript", "audio_transcript", "source:audio"), connections),
      buildD1OperationPlan(surface("packaging", "image", "source:ocr", "front_identity"), connections),
    ]);
    expect(outputs.every(out => out.items.length === 1)).toBe(true);
    const decisions = outputs.map(out => out.items[0].decision);
    expect(decisions.map(item => item.identity.foodEntityId)).toEqual([101, 101, 101]);
    expect(decisions.map(item => item.identity.variantId)).toEqual([102, 102, 102]);
    expect(decisions.map(item => item.quantity.grams)).toEqual([30, 30, 30]);
    expect(decisions.map(item => item.nutrition.consumed?.calories)).toEqual([81, 81, 81]);
    expect(outputs.map(out => out.items[0].disposition)).toEqual(["ready", "ready", "ready"]);
    expect(outputs.map(out => out.registeredCount)).toEqual([0, 0, 0]);
    expect(outputs.map(out => out.committed)).toEqual([false, false, false]);
    expect(decisions[0].evidence.some(e => e.origin === "text")).toBe(true);
    expect(decisions[1].evidence.some(e => e.origin === "transcription")).toBe(true);
    expect(decisions[2].evidence.some(e => e.origin === "ocr")).toBe(true);
    expect(connections.knowledge.stagePendingEvidence).not.toHaveBeenCalled();
  });

  it("accepts provenance-backed fused text/audio evidence and rejects a forged single source", async () => {
    const original = buildFoodObservationFixture({
      observationId: "obs-typed",
      surfaceSpan: { sourceRef: "source:typed" },
    });
    const audio = buildFoodObservationFixture({
      observationId: "obs-spoken",
      modality: "audio_transcript",
      surfaceSpan: { sourceRef: "source:spoken" },
    });
    const transcript = {
      ...audio,
      evidence: audio.evidence.map(item => ({
        ...item,
        origin: "transcription" as const,
        anchor: { ...item.anchor, sourceRef: "source:spoken" },
      })),
    };
    const fused = coalesceEquivalentMultimodalEvidence([original], [transcript]);
    expect(fused).toHaveLength(1);
    const request: FoodD1Request = {
      authenticatedUserId: 7, entrypoint: "multimodal", envelope: envelope(),
      evidence: { kind: "structured", observations: fused },
      now: new Date("2026-11-01T12:00:00Z"),
    };
    const accepted = await buildD1OperationPlan(request, deps());
    expect(accepted.items).toHaveLength(1);
    expect(accepted.items[0].decision.evidence.some(item =>
      item.origin === "transcription")).toBe(true);
    const untrusted = {
      ...fused[0],
      evidence: fused[0].evidence.filter(item => item.origin !== "transcription"),
    };
    const deniedProviders = deps();
    await expect(buildD1OperationPlan({
      ...request, evidence: { kind: "structured", observations: [untrusted] },
    }, deniedProviders)).rejects.toThrow("multimodal-evidence-required");
    expect(deniedProviders.knowledge.readLocal).not.toHaveBeenCalled();
  });

  it("preserves an unresolved sibling as deferred without writing the resolved item", async () => {
    const connections = deps();
    const known = buildFoodObservationFixture({ observationId: "obs-known" });
    const missing = buildFoodObservationFixture({
      observationId: "obs-missing",
      identityHints: { foodName: "item não encontrado" },
      evidence: [{ value: "item não encontrado" }, {}],
    });
    const output = await buildD1OperationPlan({
      authenticatedUserId: 7, entrypoint: "addition", envelope: envelope(),
      evidence: { kind: "structured", observations: [known, missing] },
      now: new Date("2026-11-01T12:00:00Z"),
    }, connections);
    expect(output.items).toHaveLength(2);
    expect(output.items[0].disposition).toBe("ready");
    expect(output.items[1].disposition).toBe("deferred");
    expect(output.items[1].reasonCodes.length).toBeGreaterThan(0);
    expect(output.readyCount).toBe(1);
    expect(output.skippedCount).toBe(1);
    expect(output.registeredCount).toBe(0);
    expect(output.committed).toBe(false);
  });

  it("continues only the authorised physical item and the same structured observation", async () => {
    const previous = buildFoodResolutionDecisionFixture({
      ownerUserId: 7, traceId: "trace-1", observationIds: ["obs-1"],
    });
    const output = await buildD1OperationPlan({
      authenticatedUserId: 7, entrypoint: "continuation", envelope: envelope(),
      evidence: { kind: "structured", observations: [buildFoodObservationFixture()] },
      targets: [{
        observationId: "obs-1", mealItemId: "item-100", previousDecision: previous,
      }],
      now: new Date("2026-11-01T12:00:00Z"),
    }, deps());
    expect(output.items[0].mealItemId).toBe("item-100");
    expect(output.items[0].decision.ownerUserId).toBe(7);
    expect(output.items[0].decision.revision).toBeGreaterThanOrEqual(1);
    expect(output.registeredCount).toBe(0);
  });

  it("finishes an original deferred sibling without inventing a physical target", async () => {
    const previous = buildFoodResolutionDecisionFixture({
      ownerUserId: 7, traceId: "trace-1", observationIds: ["obs-1"],
    });
    const request: FoodD1Request = {
      authenticatedUserId: 7, entrypoint: "continuation", envelope: envelope(),
      evidence: { kind: "structured", observations: [buildFoodObservationFixture()] },
      targets: [{ observationId: "obs-1", mealItemId: null, previousDecision: previous }],
    };
    const authorized = deps();
    const result = await buildD1OperationPlan(request, authorized);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].mealItemId).toBeNull();
    expect(result.items[0].decision.revision).toBeGreaterThan(previous.revision);
    expect(authorized.authorizeExistingItem).not.toHaveBeenCalled();
    await expect(buildD1OperationPlan({
      ...request,
      targets: [{ observationId: "obs-1", mealItemId: null, previousDecision: null }],
    }, deps())).rejects.toThrow("previous-structured-decision-required");
    await expect(buildD1OperationPlan({
      ...request, entrypoint: "nutrition_label",
    }, deps())).rejects.toThrow("ambiguous-item-target");
  });

  it("rejects label/continuation round-trips, invented targets and cross-user history", async () => {
    const previous = buildFoodResolutionDecisionFixture({
      ownerUserId: 8, traceId: "trace-1", observationIds: ["obs-1"],
    });
    await expect(buildD1OperationPlan({
      ...surface("nutrition_label", "image", "source:label", "front_identity"),
      targets: [{ observationId: "obs-1", mealItemId: "item-100", previousDecision: previous }],
    }, deps())).rejects.toThrow("continuation-requires-structured-evidence");

    const partial: FoodD1Request = {
      authenticatedUserId: 7, entrypoint: "nutrition_label", envelope: envelope(),
      evidence: { kind: "structured", observations: [buildFoodObservationFixture()] },
      targets: [{ observationId: "obs-1", mealItemId: "item-100", previousDecision: previous }],
    };
    await expect(buildD1OperationPlan(partial, deps())).rejects.toThrow("previous-decision-scope-mismatch");
    await expect(buildD1OperationPlan({
      ...partial, targets: [],
    }, deps())).rejects.toThrow("existing-item-target-required");
    await expect(buildD1OperationPlan({
      ...partial, targets: [
        { observationId: "obs-1", mealItemId: "item-100", previousDecision: null },
      ],
    }, deps())).rejects.toThrow("previous-structured-decision-required");
  });

  it("fails closed on ungrounded images, duplicated targets, untrusted owner and version drift", async () => {
    await expect(buildD1OperationPlan({
      ...surface("plate_image", "image", "source:unverified"),
    }, deps())).rejects.toThrow("image-requires-authorised-ocr-role");

    const obs = [
      buildFoodObservationFixture({ observationId: "obs-1" }),
      buildFoodObservationFixture({ observationId: "obs-2" }),
    ];
    const invalid: FoodD1Request = {
      authenticatedUserId: 7, entrypoint: "edit", envelope: envelope(),
      evidence: { kind: "structured", observations: obs },
      targets: [
        { observationId: "obs-1", mealItemId: "same-row", previousDecision: null },
        { observationId: "obs-2", mealItemId: "same-row", previousDecision: null },
      ],
    };
    await expect(buildD1OperationPlan(invalid, deps())).rejects.toThrow("ambiguous-item-target");
    await expect(buildD1OperationPlan({
      ...surface("text", "text", "source:text"), authenticatedUserId: 8,
    }, deps())).rejects.toThrow("owner-mismatch");
    await expect(buildD1OperationPlan({
      ...invalid, entrypoint: "addition", targets: [],
      evidence: { kind: "structured",
        observations: [buildFoodObservationFixture({lexiconRevision:"older-revision"})] },
    }, deps())).rejects.toThrow("lexicon-version-mismatch");
  });

  it("denies untrusted media/structured evidence and physical items before the resolver runs", async () => {
    const untrusted = deps();
    untrusted.authorizeEvidence = vi.fn(async () => false);
    await expect(buildD1OperationPlan(
      surface("packaging", "image", "media:untrusted", "front_identity"), untrusted,
    )).rejects.toThrow("evidence-not-authorized");
    expect(untrusted.knowledge.readLocal).not.toHaveBeenCalled();

    const foreignTarget = deps();
    foreignTarget.authorizeExistingItem = vi.fn(async () => false);
    await expect(buildD1OperationPlan({
      authenticatedUserId: 7, entrypoint: "edit", envelope: envelope(),
      evidence: { kind: "structured", observations: [buildFoodObservationFixture()] },
      targets: [{ observationId: "obs-1", mealItemId: "other-owner-row", previousDecision: null }],
    }, foreignTarget)).rejects.toThrow("item-not-authorized");
    expect(foreignTarget.knowledge.readLocal).not.toHaveBeenCalled();
  });

  it("does not treat a pre-existing nutrition fact as a newly verified label update", async () => {
    const previous = buildFoodResolutionDecisionFixture({
      ownerUserId: 7, traceId: "trace-1", observationIds: ["obs-1"],
    });
    const result = await buildD1OperationPlan({
      authenticatedUserId: 7, entrypoint: "nutrition_label", envelope: envelope(),
      evidence: { kind: "structured", observations: [buildFoodObservationFixture()] },
      targets: [{ observationId: "obs-1", mealItemId: "same-existing-item", previousDecision: previous }],
    }, deps());
    expect(result.items[0].mealItemId).toBe("same-existing-item");
    expect(result.items[0].disposition).toBe("deferred");
    expect(result.items[0].reasonCodes).toContain("label_evidence_unverified");
    expect(result.committed).toBe(false);
  });

  it("replay delegates to the same V2 resolver without a separate nutrition engine", async () => {
    const output = await buildD1OperationPlan(surface("simulator", "text", "replay:1"), deps());
    expect(output.entrypoint).toBe("simulator");
    expect(output.items).toHaveLength(1);
    expect(output.committed).toBe(false);
    expect(output.items[0].decision.schemaVersion).toBe(2);
  });
});
