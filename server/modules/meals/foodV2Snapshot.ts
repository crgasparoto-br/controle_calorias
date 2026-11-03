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

