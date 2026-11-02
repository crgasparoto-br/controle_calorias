/** #1308: native V2 item effects in a transaction, never projected through V1 DTOs. */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { foodD1OperationEffects, foodD1OperationRoutes, foodNutritionProfiles,
  foodSourceReadGrants, foodVariants, foodVariantSources } from "../../../drizzle/food-intelligence-v2-schema";
import { foods, mealItems, meals } from "../../../drizzle/schema";
import { isGovernedFamilyVisible } from "./knowledgeEligibility";
import { getDb } from "../../db";
import { canReadFoodSource } from "./sourceGrants";
import { isFoodD1CutoverRequested, isFoodD1EntrypointCutoverRequested } from "./entrypointRouting";
import type { FoodD1PreparedItem, FoodD1PreparedWrite } from "./entrypointPersistence";

export type FoodD1CommitResult = {
  committed: boolean;
  operationKey: string;
  mealId: number | null;
  recordedItemIds: number[];
  skipped: FoodD1PreparedWrite["skipped"];
};
type ItemEffect = { mealId: number; itemId: number };

function itemFingerprint(item: FoodD1PreparedItem): string {
  const v = item.values;
  return createHash("sha256").update(JSON.stringify({
    observationId: item.observationId, targetItemId: item.targetItemId,
    foodEntityId: item.foodEntityId, variantId: item.variantId,
    profileId: item.profileId, sourceId: item.sourceId,
    quantity: v.quantity, unit: v.unit, grams: v.grams,
    calories: v.calories, protein: v.protein, carbs: v.carbs,
    fat: v.fat, fiberG: v.fiberG, sodiumMg: v.sodiumMg,
  })).digest("hex");
}

function requireInsertId(result: unknown): number {
  const value = result as { insertId?: unknown } | [{ insertId?: unknown }];
  const numeric = Number(Array.isArray(value) ? value[0]?.insertId : value?.insertId);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error("food-d1-native-insert-id-unavailable");
  }
  return numeric;
}

function decodeEffect(value: string): ItemEffect {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error("food-d1-native-corrupt-item-receipt"); }
  const data = parsed as ItemEffect;
  if (!data || !Number.isSafeInteger(data.mealId) || data.mealId <= 0 ||
      !Number.isSafeInteger(data.itemId) || data.itemId <= 0) {
    throw new Error("food-d1-native-corrupt-item-receipt");
  }
  return data;
}

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
 * Lock the pinned route BEFORE reading receipts and writing meal items.
 * This serializes retries across instances while leaving unresolved sibling
 * observations eligible for a later, independent effect in the same operation.
 */
export async function commitFoodD1NativeWrite(input: {
  plan: FoodD1PreparedWrite;
  verifyCurrentGate: () => Promise<boolean>;
  /** Isolated tests only; production requires the server flag. */
  testEnabled?: boolean;
}): Promise<FoodD1CommitResult> {
  const { plan } = input;
  const enabled = isFoodD1CutoverRequested() ||
    (process.env.NODE_ENV === "test" && input.testEnabled === true);
  if (!enabled || !plan || !Number.isSafeInteger(plan.ownerUserId) || plan.ownerUserId <= 0) {
    throw new Error("food-d1-native-write-disabled");
  }
  let approved = false;
  try { approved = await input.verifyCurrentGate(); }
  catch { /* Inaccessible approval source is a hard stop. */ }
  if (!approved) throw new Error("food-d1-native-rollout-gate-revoked");
  const db = await getDb();
  if (!db || typeof db.transaction !== "function") {
    throw new Error("food-d1-native-transaction-unavailable");
  }
  return db.transaction(async tx => {
    const pins = await tx.select().from(foodD1OperationRoutes)
      .where(and(eq(foodD1OperationRoutes.ownerUserId, plan.ownerUserId),
        eq(foodD1OperationRoutes.operationKey, plan.operationKey)))
      .for("update").limit(1);
    if (pins.length !== 1 || pins[0].resolver !== "v2" ||
        (pins[0].originEntrypoint !== plan.entrypoint &&
          plan.entrypoint !== "continuation" && plan.entrypoint !== "nutrition_label")) {
      throw new Error("food-d1-native-route-not-pinned-to-v2");
    }
    // Direct write adapters cannot bypass the original entrypoint rollout
    // selection. Only explicit synthetic test injection may bypass this gate.
    if (!(process.env.NODE_ENV === "test" && input.testEnabled === true) &&
        !isFoodD1EntrypointCutoverRequested(
          pins[0].originEntrypoint as FoodD1PreparedWrite["entrypoint"])) {
      throw new Error("food-d1-native-entrypoint-not-enabled");
    }
    let revisions: unknown;
    try { revisions = JSON.parse(pins[0].revisionsJson); }
    catch { throw new Error("food-d1-native-corrupt-pinned-revisions"); }
    if (!revisions || (revisions as Record<string, unknown>).operationScopeHash !== plan.operationScopeHash) {
      throw new Error("food-d1-native-operation-scope-changed");
    }
    if (["code", "knowledge", "lexicon", "policy", "resolver"].some(key =>
        (revisions as Record<string, string>)[key] !==
          plan.revisions[key as keyof typeof plan.revisions])) {
      throw new Error("food-d1-native-pinned-revisions-mismatch");
    }
    const rows = await tx.select().from(foodD1OperationEffects)
      .where(and(eq(foodD1OperationEffects.ownerUserId, plan.ownerUserId),
        eq(foodD1OperationEffects.operationKey, plan.operationKey)))
      .for("update");
    // Pin all original sibling IDs under the same route lock as receipts.
    // A later turn may complete an unresolved sibling but may not inject
    // a new observation into a previously bound operation.
    const observedIds = [
      ...plan.items.map(item => item.observationId),
      ...plan.skipped.map(item => item.observationId),
    ];
    if (!observedIds.length || observedIds.some(id => typeof id !== "string" ||
        !id.trim() || id.length > 200) ||
        new Set(observedIds).size !== observedIds.length) {
      throw new Error("food-d1-native-invalid-observation-manifest");
    }
    const previousManifest = (revisions as Record<string, unknown>).observationIds;
    // A missing physical target is valid only for a deferred sibling of an
    // original creation operation. An editing/labeling operation has existing
    // physical targets and must never create a new meal on continuation.
    if (plan.entrypoint === "continuation" &&
        plan.items.some(item => item.targetItemId === null) &&
        previousManifest !== undefined &&
        !["text", "audio_transcript", "addition", "plate_image", "packaging"]
          .includes(pins[0].originEntrypoint)) {
      throw new Error("food-d1-native-deferred-sibling-origin-not-addition");
    }
    if (previousManifest === undefined) {
      // A continuation cannot bootstrap a new operation from a caller-supplied
      // prior decision: an original, pinned batch must already exist.
      if (plan.entrypoint === "continuation") {
        throw new Error("food-d1-native-continuation-original-operation-missing");
      }
      if (rows.length !== 0) {
        throw new Error("food-d1-native-missing-original-observation-manifest");
      }
      await tx.update(foodD1OperationRoutes).set({
        revisionsJson: JSON.stringify({
          ...(revisions as Record<string, unknown>),
          observationIds: [...observedIds].sort(),
        }),
      }).where(and(eq(foodD1OperationRoutes.ownerUserId, plan.ownerUserId),
        eq(foodD1OperationRoutes.operationKey, plan.operationKey)));
    } else {
      if (!Array.isArray(previousManifest) || !previousManifest.length ||
          previousManifest.some(id => typeof id !== "string" ||
            !id.trim() || id.length > 200) ||
          new Set(previousManifest).size !== previousManifest.length) {
        throw new Error("food-d1-native-corrupt-observation-manifest");
      }
      const allowedIds = new Set<string>(previousManifest as string[]);
      if (observedIds.some(id => !allowedIds.has(id))) {
        throw new Error("food-d1-native-observation-not-in-original-operation");
      }
    }
    const previous = new Map(rows.map(row => [row.observationId, row]));
    let mealId: number | null = null;
    const previouslyAffected = new Set<number>();
    for (const row of rows) {
      const effect = decodeEffect(row.outcomeJson);
      if (mealId !== null && mealId !== effect.mealId) {
        throw new Error("food-d1-native-cross-meal-receipt");
      }
      mealId = effect.mealId;
      previouslyAffected.add(effect.itemId);
    }
    const recordedItemIds: number[] = [];
    const newItems: FoodD1PreparedItem[] = [];
    for (const item of plan.items) {
      const persisted = previous.get(item.observationId);
      if (persisted) {
        if (persisted.decisionHash !== itemFingerprint(item)) {
          throw new Error("food-d1-native-idempotency-payload-conflict");
        }
        recordedItemIds.push(decodeEffect(persisted.outcomeJson).itemId);
      } else {
        if (item.targetItemId !== null && previouslyAffected.has(item.targetItemId)) {
          throw new Error("food-d1-native-repeated-physical-target");
        }
        newItems.push(item);
      }
    }
    const additions = newItems.filter(item => item.targetItemId === null);
    const edits = newItems.filter(item => item.targetItemId !== null);
    if (additions.length && edits.length) {
      throw new Error("food-d1-native-mixed-add-edit-not-supported");
    }
    const now = new Date();
    // Before any new effect, recheck mutable eligibility and source grants.
    for (const item of newItems) {
      const [profile] = await tx.select().from(foodNutritionProfiles)
        .where(eq(foodNutritionProfiles.id, item.profileId)).for("update").limit(1);
      if (!profile || profile.status !== "verified" ||
          profile.foodVariantId !== item.variantId ||
          profile.sourceId !== item.sourceId || !profile.sourceVersion ||
          (profile.validFrom && profile.validFrom.getTime() > now.getTime()) ||
          (profile.validTo && profile.validTo.getTime() <= now.getTime())) {
        throw new Error("food-d1-native-profile-ineligible");
      }
      const [variant] = await tx.select().from(foodVariants)
        .where(eq(foodVariants.id, item.variantId)).for("update").limit(1);
      if (!variant || variant.foodId !== item.foodEntityId ||
          variant.status !== "active" || variant.governanceStatus !== "verified") {
        throw new Error("food-d1-native-variant-ineligible");
      }
      const [family] = await tx.select({
        status: foods.status, scope: foods.scope, ownerUserId: foods.ownerUserId,
      }).from(foods).where(eq(foods.id, item.foodEntityId)).for("update").limit(1);
      if (!family || family.status !== "active" ||
          !isGovernedFamilyVisible(family.scope, family.ownerUserId, plan.ownerUserId)) {
        throw new Error("food-d1-native-family-ineligible");
      }
      if (profile.foodVariantSourceId !== null) {
        const [mapping] = await tx.select().from(foodVariantSources)
          .where(eq(foodVariantSources.id, profile.foodVariantSourceId)).for("update").limit(1);
        if (!mapping || mapping.status !== "active" ||
            mapping.foodVariantId !== item.variantId || mapping.sourceId !== item.sourceId) {
          throw new Error("food-d1-native-source-mapping-ineligible");
        }
      }
      const [grant] = await tx.select().from(foodSourceReadGrants)
        .where(eq(foodSourceReadGrants.sourceId, item.sourceId)).for("update").limit(1);
      if (!canReadFoodSource(grant ?? null, profile.sourceVersion, now)) {
        throw new Error("food-d1-native-source-revoked-or-unlicensed");
      }
    }
    if (additions.length) {
      if (mealId === null) {
        if (plan.confidence === null || !Number.isFinite(plan.confidence)) {
          throw new Error("food-d1-native-confidence-unavailable");
        }
        const created = await tx.insert(meals).values({
          userId: plan.ownerUserId, source: plan.source, status: "draft",
          mealLabel: plan.mealLabel, sourceText: null,
          confidence: plan.confidence, occurredAt: plan.occurredAt,
        });
        mealId = requireInsertId(created);
      } else {
        const [existingMeal] = await tx.select().from(meals)
          .where(and(eq(meals.id, mealId), eq(meals.userId, plan.ownerUserId),
            eq(meals.status, "confirmed"))).for("update").limit(1);
        if (!existingMeal || existingMeal.mealLabel !== plan.mealLabel ||
            existingMeal.occurredAt.getTime() !== plan.occurredAt.getTime()) {
          throw new Error("food-d1-native-prior-meal-changed");
        }
      }
      for (const item of additions) {
        const persisted = await tx.insert(mealItems)
          .values({ mealId: mealId!, ...item.values });
        const itemId = requireInsertId(persisted);
        recordedItemIds.push(itemId);
        await tx.insert(foodD1OperationEffects).values({
          ownerUserId: plan.ownerUserId, operationKey: plan.operationKey,
          observationId: item.observationId,
          decisionHash: itemFingerprint(item),
          outcomeJson: JSON.stringify({ mealId, itemId }),
        });
      }
      await tx.update(meals).set({ status: "confirmed" })
        .where(and(eq(meals.id, mealId!), eq(meals.userId, plan.ownerUserId)));
    }
    for (const item of edits) {
      const itemId = item.targetItemId!;
      const [existing] = await tx.select({ item: mealItems, mealId: meals.id })
        .from(mealItems).innerJoin(meals, eq(meals.id, mealItems.mealId))
        .where(and(eq(mealItems.id, itemId), eq(meals.userId, plan.ownerUserId),
          eq(meals.status, "confirmed"))).for("update").limit(1);
      // A JSON substring can be forged inside a legacy note. Require a
      // structurally valid V2 snapshot bound to this exact physical row.
      // An explicit edit may substitute another verified variant; labels and
      // continuing clarifications must retain the existing food identity.
      if (!existing ||
          ((plan.entrypoint === "nutrition_label" || plan.entrypoint === "continuation") &&
           existing.item.foodVariantId !== item.variantId) ||
          !hasBoundFoodV2Snapshot(existing.item) ||
          (mealId !== null && mealId !== existing.mealId)) {
        throw new Error("food-d1-native-target-stale-or-foreign");
      }
      mealId = existing.mealId;
      await tx.update(mealItems).set(item.values)
        .where(and(eq(mealItems.id, itemId), eq(mealItems.mealId, mealId)));
      recordedItemIds.push(itemId);
      await tx.insert(foodD1OperationEffects).values({
        ownerUserId: plan.ownerUserId, operationKey: plan.operationKey,
        observationId: item.observationId,
        decisionHash: itemFingerprint(item),
        outcomeJson: JSON.stringify({ mealId, itemId }),
      });
    }
    return { committed: recordedItemIds.length > 0, operationKey: plan.operationKey,
      mealId, recordedItemIds, skipped: plan.skipped };
  });
}
