/** #1308: native V2 meal write plan; never invent missing nutritional facts. */
import { createHash } from "node:crypto";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import { parseFoodOperationEnvelope, parseFoodResolutionDecision,
  type FoodOperationEnvelope } from "./schemas";
import type { FoodD1Result } from "./entrypointMigration";
import { hashFoodD1OperationScope } from "./entrypointRouting";

export type FoodD1PreparedItem = {
  observationId: string;
  targetItemId: number | null;
  foodEntityId: number;
  variantId: number;
  profileId: number;
  sourceId: number;
  values: {
    foodId: number; foodVariantId: number; nutritionProfileId: number;
    foodCatalogId: null; itemType: "food"; foodName: string; canonicalName: string;
    portionText: string; quantity: number; unit: string; servings: number;
    estimatedGrams: number; grams: number; calories: number; protein: number;
    carbs: number; fat: number; caloriesKcal: number; proteinG: number;
    carbG: number; fatG: number; fiberG: number | null; sodiumMg: number | null;
    source: "catalog"; foodSnapshotJson: string;
  };
};
export type FoodD1PreparedWrite = {
  ownerUserId: number;
  operationKey: string;
  operationScopeHash: string;
  traceId: string;
  entrypoint: FoodD1Result["entrypoint"];
  source: "web" | "whatsapp";
  revisions: FoodOperationEnvelope["revisions"];
  confidence: number | null;
  mealLabel: string;
  occurredAt: Date;
  requestHash: string;
  items: FoodD1PreparedItem[];
  skipped: Array<{ observationId: string; reasonCodes: readonly string[] }>;
};

/** Validate every sibling before opening any mutation transaction. */
export function prepareFoodD1NativeWrite(input: {
  envelope: FoodOperationEnvelope;
  result: FoodD1Result;
  authenticatedUserId: number;
  source: "web" | "whatsapp";
  occurredAt: Date;
}): FoodD1PreparedWrite {
  const parsed = parseFoodOperationEnvelope(input.envelope);
  if (!parsed.ok || parsed.value.ownerUserId !== input.authenticatedUserId ||
      !parsed.value.mealOperation ||
      !(input.occurredAt instanceof Date) || !Number.isFinite(input.occurredAt.getTime()) ||
      getDateKeyInTimeZone(input.occurredAt, parsed.value.effectiveTimeZone) !== parsed.value.mealOperation.date ||
      (input.source !== "web" && input.source !== "whatsapp")) {
    throw new Error("food-d1-invalid-native-meal-operation");
  }
  const envelope = parsed.value, result = input.result;
  if (!result || result.schemaVersion !== 2 || result.committed !== false ||
      result.registeredCount !== 0 || result.operationKey !== envelope.idempotencyKey ||
      result.traceId !== envelope.traceId || result.entrypoint === "simulator" ||
      !Array.isArray(result.items) || !result.items.length ||
      result.readyCount !== result.items.filter(item => item.disposition === "ready").length ||
      result.skippedCount !== result.items.filter(item => item.disposition !== "ready").length) {
    throw new Error("food-d1-invalid-native-decision-batch");
  }
  const seen = new Set<string>(), physical = new Set<number>();
  const items: FoodD1PreparedItem[] = [], skipped: FoodD1PreparedWrite["skipped"] = [];
  const confidences: number[] = [];
  for (const item of result.items) {
    if (!item.observationId || seen.has(item.observationId)) {
      throw new Error("food-d1-duplicate-native-observation");
    }
    seen.add(item.observationId);
    const parsedDecision = parseFoodResolutionDecision(item.decision);
    if (!parsedDecision.ok || item.decision.ownerUserId !== envelope.ownerUserId ||
        item.decision.traceId !== envelope.traceId ||
        !item.decision.observationIds.includes(item.observationId) ||
        item.decision.knowledgeRevision !== envelope.revisions.knowledge ||
        item.decision.policyVersion !== envelope.revisions.policy) {
      throw new Error("food-d1-native-decision-scope-mismatch");
    }
    if (item.disposition !== "ready") {
      if (!item.reasonCodes.length) throw new Error("food-d1-missing-defer-reason");
      skipped.push({ observationId: item.observationId, reasonCodes: item.reasonCodes });
      continue;
    }
    const { identity, quantity, nutrition } = item.decision;
    if (identity.confidence !== null) confidences.push(identity.confidence);
    if (item.decision.status !== "resolved" || nutrition.provisional || !nutrition.verified ||
        !nutrition.consumed || !nutrition.basis || nutrition.sourceId === null ||
        nutrition.profileId === null || identity.foodEntityId === null ||
        identity.variantId === null || !identity.canonicalName ||
        quantity.grams === null || quantity.grams <= 0 ||
        quantity.milliliters !== null || nutrition.evidenceIds.length === 0 ||
        typeof nutrition.snapshotHash !== "string" || !nutrition.snapshotHash.trim()) {
      throw new Error("food-d1-native-write-requires-grounded-grams-and-nutrition");
    }
    if (result.entrypoint === "nutrition_label" &&
        !item.decision.evidence.some(evidence => evidence.origin === "nutrition_label" &&
          evidence.field.startsWith("nutrition.") && evidence.verified &&
          evidence.sourceId === nutrition.sourceId)) {
      throw new Error("food-d1-native-label-not-verified");
    }
    const targetItemId = item.mealItemId === null ? null : Number(item.mealItemId);
    if (item.mealItemId !== null &&
        (!/^[1-9]\d*$/.test(item.mealItemId) || !Number.isSafeInteger(targetItemId) ||
          physical.has(targetItemId!))) {
      throw new Error("food-d1-invalid-physical-item-id");
    }
    if (targetItemId !== null) physical.add(targetItemId);
    const requiresPhysical = result.entrypoint === "edit" ||
      result.entrypoint === "nutrition_label";
    if ((requiresPhysical && targetItemId === null) ||
        (!requiresPhysical && result.entrypoint !== "continuation" && targetItemId !== null)) {
      throw new Error("food-d1-native-item-action-mismatch");
    }
    // A not-yet-persisted sibling is an existing pending observation, not a
    // new addition. The original manifest is checked again in the DB.
    if (result.entrypoint === "continuation" && targetItemId === null &&
        item.decision.revision < 2) {
      throw new Error("food-d1-native-uncontinued-deferred-sibling");
    }
    const units = quantity.unit && quantity.value !== null ?
      { value: quantity.value, unit: quantity.unit } :
      { value: quantity.grams, unit: "g" };
    const consumed = nutrition.consumed;
    // Snapshot contains no raw media, prompt, transcript or evidence payload.
    const snapshot = JSON.stringify({ format: "food-v2", schemaVersion: 2,
      decisionId: item.decision.decisionId, revision: item.decision.revision,
      identity: { foodEntityId: identity.foodEntityId, variantId: identity.variantId,
        canonicalName: identity.canonicalName },
      nutrition: { profileId: nutrition.profileId, sourceId: nutrition.sourceId,
        snapshotHash: nutrition.snapshotHash, verified: true, consumed },
      quantity: { value: units.value, unit: units.unit, grams: quantity.grams } });
    items.push({ observationId: item.observationId, targetItemId,
      foodEntityId: identity.foodEntityId, variantId: identity.variantId,
      profileId: nutrition.profileId, sourceId: nutrition.sourceId,
      values: { foodId: identity.foodEntityId, foodVariantId: identity.variantId,
        nutritionProfileId: nutrition.profileId, foodCatalogId: null,
        itemType: "food", foodName: identity.canonicalName,
        canonicalName: identity.canonicalName,
        portionText: String(units.value) + " " + units.unit,
        quantity: units.value, unit: units.unit, servings: 1,
        estimatedGrams: quantity.grams, grams: quantity.grams,
        calories: consumed.calories, protein: consumed.protein, carbs: consumed.carbs,
        fat: consumed.fat, caloriesKcal: consumed.calories, proteinG: consumed.protein,
        carbG: consumed.carbs, fatG: consumed.fat, fiberG: consumed.fiber,
        sodiumMg: consumed.sodiumMg, source: "catalog", foodSnapshotJson: snapshot },
    });
  }
  const requestHash = createHash("sha256").update(JSON.stringify({
    envelope, entrypoint: result.entrypoint, source: input.source,
    occurredAt: input.occurredAt.toISOString(),
    items: items.map(item => [item.observationId, item.targetItemId,
      item.variantId, item.profileId, item.values.quantity, item.values.unit,
      item.values.calories, item.values.protein, item.values.carbs, item.values.fat]),
    skipped,
  })).digest("hex");
  return { ownerUserId: envelope.ownerUserId, operationKey: envelope.idempotencyKey,
    operationScopeHash: hashFoodD1OperationScope(envelope, input.source),
    traceId: envelope.traceId, entrypoint: result.entrypoint, source: input.source,
    revisions: { ...envelope.revisions },
    confidence: confidences.length ? Math.min(...confidences) : null,
    mealLabel: envelope.mealOperation!.targetMeal, occurredAt: input.occurredAt,
    requestHash, items, skipped };
}
