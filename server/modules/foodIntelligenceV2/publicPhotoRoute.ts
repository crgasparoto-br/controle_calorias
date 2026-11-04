/** #1308: existing authenticated photo-analyze endpoint -> one V2 draft resolver. */
import type { FoodD1WebDraft } from "../../../shared/foodD1WebDraft";
import type { AnalyzeFoodPhotoInput } from "../photoAnalysis/schemas";
import { isFoodD1EntrypointCutoverRequested, isValidD1OperationId } from "./entrypointRouting";
import { assertNewMealLabelHasExistingTarget } from "./publicUnmigratedEntrypoints";
import { tryRunFoodD1PublicWebDraft } from "./publicWebDraft";

type PhotoRequest = {
  userId: number;
  input: AnalyzeFoodPhotoInput;
  /** Existing authenticated timezone provider; never trust the submitted DTO. */
  readTimeZone: () => Promise<string>;
};

/**
 * No additional endpoint or image nutrition engine: when the visual rollout is
 * selected, hand the image to the exact same operation, linguistic resolver,
 * durable review store and confirmation contract as web processDraft.
 */
export function createFoodD1PublicPhotoAnalysis(
  runDraft: typeof tryRunFoodD1PublicWebDraft = tryRunFoodD1PublicWebDraft,
) {
  return async function tryRunPhoto(input: PhotoRequest): Promise<FoodD1WebDraft | null> {
    // A later nutrition label requires the authenticated physical item target.
    // Refuse label-as-new-meal even while the V2 feature flag is OFF.
    assertNewMealLabelHasExistingTarget(input.input);
    const anyVisualSelected = ([
      "plate_image", "packaging", "nutrition_label", "multimodal",
    ] as const).some(isFoodD1EntrypointCutoverRequested);
    const hasStableId = input.input.d1OperationId !== undefined;
    if (!anyVisualSelected && !hasStableId) return null;
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0 ||
        !input.input.image || !input.readTimeZone ||
        (hasStableId && !isValidD1OperationId(input.input.d1OperationId))) {
      throw new Error("food-d1-public-photo-invalid-operation");
    }
    if (anyVisualSelected &&
        (input.input.imageKind !== "plate_image" && input.input.imageKind !== "packaging" ||
        !isFoodD1EntrypointCutoverRequested(input.input.imageKind))) {
      throw new Error("food-d1-public-photo-explicit-kind-required");
    }
    if (anyVisualSelected &&
        (!isValidD1OperationId(input.input.d1OperationId) ||
         !input.input.mealLabel?.trim() || !input.input.occurredAt?.trim())) {
      throw new Error("food-d1-public-photo-operation-required");
    }
    const timeZone = await input.readTimeZone();
    if (!timeZone?.trim()) throw new Error("food-d1-public-photo-timezone-unavailable");
    const draft = await runDraft({
      userId: input.userId, timeZone,
      request: {
        source: "web",
        image: input.input.image,
        imageKind: input.input.imageKind,
        d1OperationId: input.input.d1OperationId,
        mealLabel: input.input.mealLabel,
        occurredAt: input.input.occurredAt,
      },
    });
    if (!anyVisualSelected) return null;
    if (!draft || draft.entrypoint !== input.input.imageKind) {
      // A selected V2 photo must never return to the legacy photo writer.
      throw new Error("food-d1-public-photo-draft-unavailable");
    }
    return draft;
  };
}

export const tryRunPublicFoodD1PhotoAnalysis = createFoodD1PublicPhotoAnalysis();
