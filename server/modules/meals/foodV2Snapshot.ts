import { mealItems } from "../../../drizzle/schema";

/**
 * Never infer V2 ownership from a substring in serialized legacy metadata.
 * The snapshot must match the physical row that is about to be edited.
 */
export function hasBoundFoodV2Snapshot(item: typeof mealItems.$inferSelect): boolean {
  if (typeof item.foodSnapshotJson !== "string" || !item.foodSnapshotJson) return false;
  let decoded: unknown;
  try { decoded = JSON.parse(item.foodSnapshotJson); }
  catch { return false; }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return false;
  const snapshot = decoded as {
    format?: unknown;
    schemaVersion?: unknown;
    identity?: { foodEntityId?: unknown; variantId?: unknown } | null;
    nutrition?: { profileId?: unknown; verified?: unknown } | null;
  };
  return snapshot.format === "food-v2" && snapshot.schemaVersion === 2 &&
    !!snapshot.identity && !!snapshot.nutrition &&
    Number.isSafeInteger(snapshot.identity.foodEntityId) &&
    Number.isSafeInteger(snapshot.identity.variantId) &&
    Number.isSafeInteger(snapshot.nutrition.profileId) &&
    snapshot.identity.foodEntityId === item.foodId &&
    snapshot.identity.variantId === item.foodVariantId &&
    snapshot.nutrition.profileId === item.nutritionProfileId &&
    snapshot.nutrition.verified === true;
}

/**
 * V1 mutation handlers cannot faithfully re-serialize a V2 decision.  Do not
 * silently replace its pinned nutrition/identity with legacy catalog lookups.
 * A malformed top-level V2 marker is also protected: only an explicit V2
 * migration/repair is allowed to operate on it.
 */
export function assertLegacyMealItemMutationSafe(
  rows: readonly Pick<typeof mealItems.$inferSelect, "foodSnapshotJson">[],
): void {
  for (const row of rows) {
    if (typeof row.foodSnapshotJson !== "string") continue;
    let snapshot: unknown;
    try { snapshot = JSON.parse(row.foodSnapshotJson); }
    catch { continue; }
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) &&
        (snapshot as { format?: unknown }).format === "food-v2") {
      throw new Error("food-v2-legacy-item-mutation-not-supported");
    }
  }
}

