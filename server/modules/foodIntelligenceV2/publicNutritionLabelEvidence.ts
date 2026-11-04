/** #1308 authenticated physical-item reader and exact-byte governed label proof. */
import { and, eq } from "drizzle-orm";
import { foodEvidence, foodNutritionProfiles, foodSourceReadGrants } from "../../../drizzle/food-intelligence-v2-schema";
import { mealItems, meals } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { hasBoundFoodV2Snapshot } from "../meals/foodV2Snapshot";
import { parseFoodResolutionDecision, type FoodResolutionDecision } from "./schemas";
import { canReadFoodSource } from "./sourceGrants";

export type D1PhysicalNutritionLabelTarget = {
  ownerUserId: number;
  mealId: number;
  mealItemId: number;
  mealLabel: string;
  occurredAt: Date;
  variantId: number;
  foodId: number;
  profileId: number;
  quantity: number;
  unit: string;
  grams: number;
  decision: FoodResolutionDecision;
  snapshotHash: string;
};
export type D1VerifiedLabelSource = {
  sourceId: number;
  profileId: number;
  variantId: number;
  contentDigest: string;
  basisQuantity: number;
  basisUnit: "g" | "ml" | "serving";
  caloriesKcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
};

/**
 * A public item ID alone authorizes nothing. The physical row must be bound
 * to the same owner, versioned identity and original structured decision.
 * Older V2 snapshots without a stored decision cannot be silently rebuilt.
 */
export async function readD1PhysicalNutritionLabelTarget(
  input: { userId: number; mealId: number; mealItemId: number },
): Promise<D1PhysicalNutritionLabelTarget | null> {
  if (![input.userId, input.mealId, input.mealItemId].every(id =>
    Number.isSafeInteger(id) && id > 0)) {
    throw new Error("food-d1-label-invalid-physical-target");
  }
  const db = await getDb();
  if (!db) throw new Error("food-d1-label-database-unavailable");
  const rows = await db.select({ item: mealItems, meal: meals }).from(mealItems)
    .innerJoin(meals, eq(meals.id, mealItems.mealId))
    .where(and(eq(meals.userId, input.userId),
      eq(meals.id, input.mealId), eq(meals.status, "confirmed"),
      eq(mealItems.id, input.mealItemId))).limit(1);
  const row = rows[0];
  if (!row || !hasBoundFoodV2Snapshot(row.item) ||
      !row.item.foodSnapshotJson) return null;
  let value: unknown;
  try { value = JSON.parse(row.item.foodSnapshotJson); }
  catch { throw new Error("food-d1-label-historical-decision-unavailable"); }
  const snapshot = value as {
    structuredDecision?: unknown; decisionId?: unknown; revision?: unknown;
  };
  const previous = parseFoodResolutionDecision(snapshot.structuredDecision);
  if (!previous.ok || previous.value.ownerUserId !== input.userId ||
      previous.value.decisionId !== snapshot.decisionId ||
      previous.value.revision !== snapshot.revision ||
      previous.value.identity.foodEntityId !== row.item.foodId ||
      previous.value.identity.variantId !== row.item.foodVariantId ||
      previous.value.nutrition.profileId !== row.item.nutritionProfileId ||
      previous.value.observationIds.length !== 1 ||
      previous.value.quantity.value !== Number(row.item.quantity) ||
      previous.value.quantity.unit !== row.item.unit ||
      previous.value.quantity.grams !== Number(row.item.grams)) {
    throw new Error("food-d1-label-historical-decision-unavailable");
  }
  return {
    ownerUserId: input.userId, mealId: row.meal.id, mealItemId: row.item.id,
    mealLabel: row.meal.mealLabel, occurredAt: row.meal.occurredAt,
    variantId: row.item.foodVariantId!, foodId: row.item.foodId!,
    profileId: row.item.nutritionProfileId!,
    quantity: Number(row.item.quantity), unit: row.item.unit,
    grams: Number(row.item.grams), decision: previous.value,
    snapshotHash: row.item.foodSnapshotJson,
  };
}

/**
 * An OCR guess or an unreviewed uploaded label never becomes verified macros.
 * Require this *exact* image's SHA256 already linked to an independently
 * verified profile, with an active source/version grant and scoped evidence.
 */
export async function readD1VerifiedNutritionLabelSource(input: {
  ownerUserId: number; variantId: number; imageDigest: string;
  now: Date;
}): Promise<D1VerifiedLabelSource | null> {
  if (!Number.isSafeInteger(input.ownerUserId) || input.ownerUserId <= 0 ||
      !Number.isSafeInteger(input.variantId) || input.variantId <= 0 ||
      !/^[a-f0-9]{64}$/.test(input.imageDigest) ||
      !Number.isFinite(input.now.getTime())) {
    throw new Error("food-d1-label-invalid-evidence-query");
  }
  const db = await getDb();
  if (!db) throw new Error("food-d1-label-database-unavailable");
  const evidences = await db.select().from(foodEvidence).where(and(
    eq(foodEvidence.foodVariantId, input.variantId),
    eq(foodEvidence.evidenceType, "nutrition_label"),
    eq(foodEvidence.contentHash, input.imageDigest),
  )).limit(20);
  const scoped = evidences.filter(evidence => evidence.sourceId &&
    (evidence.ownerUserId === null || evidence.ownerUserId === input.ownerUserId) &&
    (!evidence.retentionUntil || evidence.retentionUntil.getTime() > input.now.getTime()));
  // Different sources claiming the same image are ambiguous until reviewed.
  if (scoped.length !== 1) return null;
  const proof = scoped[0];
  const profiles = await db.select().from(foodNutritionProfiles).where(and(
    eq(foodNutritionProfiles.foodVariantId, input.variantId),
    eq(foodNutritionProfiles.sourceId, proof.sourceId!),
    eq(foodNutritionProfiles.status, "verified"),
    eq(foodNutritionProfiles.currentSlot, 1),
  )).limit(3);
  if (profiles.length !== 1) return null;
  const profile = profiles[0];
  const [grant] = await db.select().from(foodSourceReadGrants)
    .where(eq(foodSourceReadGrants.sourceId, profile.sourceId)).limit(1);
  if (!profile.sourceVersion ||
      !canReadFoodSource(grant ?? null, profile.sourceVersion, input.now) ||
      (profile.validFrom && profile.validFrom.getTime() > input.now.getTime()) ||
      (profile.validTo && profile.validTo.getTime() <= input.now.getTime()) ||
      !Number.isFinite(profile.basisQuantity) || profile.basisQuantity <= 0 ||
      [profile.caloriesKcal, profile.proteinG, profile.carbG, profile.fatG]
        .some(value => !Number.isFinite(value) || value < 0)) return null;
  return {
    sourceId: profile.sourceId, profileId: profile.id,
    variantId: input.variantId, contentDigest: input.imageDigest,
    basisQuantity: profile.basisQuantity, basisUnit: profile.basisUnit,
    caloriesKcal: profile.caloriesKcal, proteinG: profile.proteinG,
    carbG: profile.carbG, fatG: profile.fatG,
  };
}
