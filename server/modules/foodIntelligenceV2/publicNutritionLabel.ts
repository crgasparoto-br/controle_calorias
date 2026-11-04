/** #1308: a later verified nutrition label updates ONE authenticated V2 item. */
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import type { ApplyFoodD1NutritionLabelInput } from "../meals/schemas";
import { foodObservationSchema, type FoodObservation } from "./observationSchemas";
import { isCurrentFoodD1GateApproval, isFoodD1EntrypointCutoverRequested,
  isValidD1OperationId } from "./entrypointRouting";
import { prepareD1VisualMedia } from "./publicVisualSurfaces";
import { readD1PhysicalNutritionLabelTarget, readD1VerifiedNutritionLabelSource,
  type D1PhysicalNutritionLabelTarget, type D1VerifiedLabelSource } from "./publicNutritionLabelEvidence";
import type { FoodD1Request, FoodD1Result } from "./entrypointMigration";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";
import type { runFoodD1Migration } from "./entrypointRunner";
import { createFoodV2KnowledgeRepository } from "./repository";
import { governedLinguisticLexiconStore } from "./linguisticLexiconRepository";

export type PublicD1NutritionLabelDependencies = {
  readAuthorizedContext: () => Promise<AuthorizedD1SimulationContext | null>;
  readTarget: typeof readD1PhysicalNutritionLabelTarget;
  readVerifiedSource: typeof readD1VerifiedNutritionLabelSource;
  run: typeof runFoodD1Migration;
};

function makeLabelObservation(
  target: D1PhysicalNutritionLabelTarget, proof: D1VerifiedLabelSource,
  revision: string,
): FoodObservation {
  const previous = target.decision;
  const sourceRef = "d1-label:" + proof.contentDigest;
  const anchor = { sourceRef, span: null, region: null };
  // The old identity/portion are structured, already authorized facts. Do
  // not round-trip a previous decision through raw text or a vision model.
  const originalIds = new Set([
    ...previous.identity.evidenceIds, ...previous.quantity.evidenceIds,
  ]);
  const retained = previous.evidence.filter(item =>
    originalIds.has(item.evidenceId));
  const numeric = [
    ["nutrition.calories", proof.caloriesKcal, "kcal"],
    ["nutrition.protein", proof.proteinG, "g"],
    ["nutrition.carbs", proof.carbG, "g"],
    ["nutrition.fat", proof.fatG, "g"],
  ] as const;
  const observed: FoodObservation = {
    schemaVersion: 2, observationId: previous.observationIds[0],
    modality: "image", rawInput: null, normalizedInput: null,
    locale: { requested: null, effective: "pt-BR", status: "defaulted" },
    surfaceSpan: anchor,
    identityHints: {
      foodName: previous.identity.canonicalName,
      brand: previous.identity.brand, variant: previous.identity.variant,
      barcode: previous.identity.barcode,
      preparation: [...previous.identity.preparation],
      qualifiers: [...previous.identity.qualifiers],
    },
    quantityHints: {
      value: target.quantity, unit: target.unit,
      servingText: target.quantity + " " + target.unit,
      visiblePackageQuantity: null, visiblePackageUnit: null,
    },
    evidence: [
      ...retained,
      ...numeric.map(([field, value, unit], index) => ({
        evidenceId: "d1-label-" + proof.contentDigest.slice(0,24) + "-" + index,
        field, origin: "nutrition_label" as const, value,
        unit, confidence: null, verified: true,
        anchor, sourceId: proof.sourceId,
      })),
    ],
    normalizationPath: [], alternatives: [],
    unresolvedReason: null, lexiconRevision: revision,
    interpreterVersion: null,
  };
  const parsed = foodObservationSchema.safeParse(observed);
  if (!parsed.success) throw new Error("food-d1-label-structured-evidence-invalid");
  return parsed.data;
}

export function createFoodD1PublicNutritionLabel(
  deps: PublicD1NutritionLabelDependencies,
) {
  return async function apply(input: {
    userId: number; request: ApplyFoodD1NutritionLabelInput;
    timeZone: string; source?: "web" | "whatsapp";
  }): Promise<{ mealId: number; itemId: number; replayed: boolean } | null> {
    if (!isFoodD1EntrypointCutoverRequested("nutrition_label")) return null;
    const ctx = await deps.readAuthorizedContext();
    if (!ctx || !isCurrentFoodD1GateApproval(ctx.approval, ctx.expectedAuditedBaseSha) ||
        ctx.revisions.code !== ctx.expectedAuditedBaseSha) {
      throw new Error("food-d1-label-gate-unavailable");
    }
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0 ||
        !isValidD1OperationId(input.request.d1OperationId) || !input.timeZone?.trim()) {
      throw new Error("food-d1-label-invalid-operation");
    }
    const target = await deps.readTarget({
      userId: input.userId, mealId: input.request.mealId,
      mealItemId: input.request.mealItemId,
    });
    if (!target || target.ownerUserId !== input.userId ||
        target.mealId !== input.request.mealId ||
        target.mealItemId !== input.request.mealItemId) {
      throw new Error("food-d1-label-physical-item-not-authorized");
    }
    // Decode and verify media magic/MIME locally before any provider or
    // governed source access; only an exact existing independent proof counts.
    if (!input.request.image) {
      throw new Error("food-d1-label-photo-required");
    }
    const media = prepareD1VisualMedia(input.request.image);
    const proof = await deps.readVerifiedSource({
      ownerUserId: input.userId, variantId: target.variantId,
      imageDigest: media.contentDigest, now: new Date(),
    });
    if (!proof || proof.variantId !== target.variantId ||
        proof.contentDigest !== media.contentDigest ||
        !Number.isSafeInteger(proof.sourceId) || proof.sourceId <= 0 ||
        !Number.isSafeInteger(proof.profileId) || proof.profileId <= 0) {
      throw new Error("food-d1-label-independent-verification-required");
    }
    const observed = makeLabelObservation(target, proof, ctx.revisions.lexicon);
    const evidence = { kind: "structured" as const, observations: [observed] };
    const operationKey = "d1-label-" + input.userId + ":" + input.request.d1OperationId;
    const unavailable = { status: "unavailable" as const,
      reason: "label_context_not_materialized", sourceRef: null };
    const request: FoodD1Request = {
      authenticatedUserId: input.userId, entrypoint: "nutrition_label",
      envelope: {
        schemaVersion: 2, traceId: target.decision.traceId,
        idempotencyKey: operationKey, ownerUserId: input.userId,
        // A reused ID with another label photo is an idempotency conflict.
        conversationRef: "d1-label-image:" + media.contentDigest,
        turnRef: null,
        effectiveTimeZone: input.timeZone,
        mealOperation: { action: "edit", targetMeal: target.mealLabel,
          date: getDateKeyInTimeZone(target.occurredAt, input.timeZone) },
        contextSources: {
          previousMessage: { status: "available", reason: null,
            sourceRef: "food-v2-item:" + target.mealItemId },
          preferences: { ...unavailable }, recentHistory: { ...unavailable },
        },
        revisions: { ...ctx.revisions },
      },
      evidence, targets: [{
        observationId: observed.observationId,
        mealItemId: String(target.mealItemId),
        previousDecision: target.decision,
      }],
      now: new Date(),
    };
    const output = await deps.run({
      request, source: input.source ?? "web", occurredAt: target.occurredAt,
      dependencies: {
        lexicon: governedLinguisticLexiconStore,
        knowledge: createFoodV2KnowledgeRepository(),
        authorizeEvidence: async candidate => candidate.ownerUserId === input.userId &&
          candidate.entrypoint === "nutrition_label" && candidate.evidence === evidence,
        authorizeExistingItem: async candidate => {
          if (candidate.ownerUserId !== input.userId ||
              candidate.mealItemId !== String(target.mealItemId)) return false;
          const fresh = await deps.readTarget({
            userId: input.userId, mealId: target.mealId,
            mealItemId: target.mealItemId,
          });
          return fresh?.snapshotHash === target.snapshotHash &&
            fresh?.variantId === target.variantId;
        },
      },
      legacy: async () => { throw new Error("food-d1-label-cannot-replay-v1"); },
      expectedAuditedBaseSha: ctx.expectedAuditedBaseSha,
      verifyGates: async () => (await deps.readAuthorizedContext())?.approval ?? null,
      beforeCommit: (plan: FoodD1Result) => {
        const item = plan.items[0];
        if (plan.items.length !== 1 || !item || item.disposition !== "ready" ||
            item.mealItemId !== String(target.mealItemId) ||
            item.decision.identity.variantId !== target.variantId ||
            item.decision.identity.foodEntityId !== target.foodId ||
            item.decision.nutrition.sourceId !== proof.sourceId ||
            item.decision.nutrition.profileId !== proof.profileId ||
            !item.decision.nutrition.verified ||
            !item.decision.evidence.some(entry => entry.origin === "nutrition_label" &&
              entry.field.startsWith("nutrition.") && entry.verified &&
              entry.sourceId === proof.sourceId)) {
          throw new Error("food-d1-label-evidence-conflict-or-needs-review");
        }
      },
    });
    if (!output || typeof output !== "object" || !("committed" in output) ||
        output.committed !== true || !("mealId" in output) ||
        output.mealId !== target.mealId ||
        !("recordedItemIds" in output) ||
        !Array.isArray(output.recordedItemIds) ||
        output.recordedItemIds.length !== 1 ||
        output.recordedItemIds[0] !== target.mealItemId ||
        !("skipped" in output) || !Array.isArray(output.skipped) ||
        output.skipped.length !== 0 ||
        !("replayed" in output)) {
      throw new Error("food-d1-label-commit-unavailable");
    }
    return { mealId: target.mealId, itemId: target.mealItemId,
      replayed: output.replayed };
  };
}

/** V2 rollout has no approved Gate A provider until issue #1335. */
export const tryRunFoodD1PublicNutritionLabel = createFoodD1PublicNutritionLabel({
  readAuthorizedContext: async () => null,
  readTarget: readD1PhysicalNutritionLabelTarget,
  readVerifiedSource: readD1VerifiedNutritionLabelSource,
  run: async args => (await import("./entrypointRunner")).runFoodD1Migration(args),
});
