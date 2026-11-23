/** #1308: fail-closed barrier for D1 entrypoints not yet migrated publicly.
 * Checks only server rollout selection; never infers food or invokes a resolver.
 */
import type { ProcessMealDraftInput } from "../meals/schemas";
import {
  D1_TEXT_ENTRYPOINT_IDS,
  type FoodD1Entrypoint,
} from "./entrypointMigration";
import { isFoodD1EntrypointCutoverRequested } from "./entrypointRouting";

// Public boundary error code, never a food/identity knowledge constant.
const D1_PUBLIC_MIGRATION_INCOMPLETE = "food-d1-public-entrypoint-migration-incomplete";
export { D1_PUBLIC_MIGRATION_INCOMPLETE as UNMIGRATED_FOOD_D1_PUBLIC_ENTRYPOINT };

/** A selected but unmigrated channel cannot silently continue through V1. */
export function assertUnmigratedFoodD1EntrypointsOff(
  entrypoints: readonly FoodD1Entrypoint[],
): void {
  if (entrypoints.some(isFoodD1EntrypointCutoverRequested)) {
    throw new Error(D1_PUBLIC_MIGRATION_INCOMPLETE);
  }
}

export function assertUnmigratedFoodD1WhatsAppTextEntrypointsOff(): void {
  assertUnmigratedFoodD1EntrypointsOff(D1_TEXT_ENTRYPOINT_IDS);
}

/**
 * New meal creation has no physical item to which a nutrition label can bind.
 * Even when D1 flags are OFF, do not send an explicitly selected label into
 * legacy meal inference where it could be mistaken for an additional food.
 */
export function assertNewMealLabelHasExistingTarget(
  input: Pick<ProcessMealDraftInput, "image" | "imageKind">,
): void {
  if (input.image && input.imageKind === "nutrition_label") {
    throw new Error("food-d1-new-meal-label-requires-existing-item");
  }
}

/** Web draft has no trusted distinction among plate, packaging and label OCR. */
export function assertUnmigratedFoodD1DraftOff(
  input: Pick<ProcessMealDraftInput, "text" | "audio" | "image">,
): void {
  const entrypoints: FoodD1Entrypoint[] = [];
  if (input.text?.trim() && input.audio) {
    entrypoints.push("text", "audio_transcript", "multimodal");
  } else {
    if (input.text?.trim()) entrypoints.push("text");
    if (input.audio) entrypoints.push("audio_transcript");
  }
  if (input.image) {
    entrypoints.push("plate_image", "packaging", "nutrition_label");
    if (input.text?.trim() || input.audio) entrypoints.push("multimodal");
  }
  assertUnmigratedFoodD1EntrypointsOff(entrypoints);
}
