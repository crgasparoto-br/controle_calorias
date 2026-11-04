/** #1308: fail-closed barrier for D1 entrypoints not yet migrated publicly.
 * Checks only server rollout selection; never infers food or invokes a resolver.
 */
import type { ProcessMealDraftInput } from "../meals/schemas";
import type { FoodD1Entrypoint } from "./entrypointMigration";
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

/** Web draft has no trusted distinction among plate, packaging and label OCR. */
export function assertUnmigratedFoodD1DraftOff(
  input: Pick<ProcessMealDraftInput, "text" | "audio" | "image">,
): void {
  const entrypoints: FoodD1Entrypoint[] = [];
  if (input.text?.trim()) entrypoints.push("text");
  if (input.audio) entrypoints.push("audio_transcript");
  if (input.image) entrypoints.push("plate_image", "packaging", "nutrition_label");
  assertUnmigratedFoodD1EntrypointsOff(entrypoints);
}
