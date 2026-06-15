import type { MealDraftItem } from "./nutritionEngine";
import {
  selectOnlineNutritionSourceCandidate,
  type OnlineNutritionSourceCandidate,
} from "./nutritionOnlineSource";

function normalizeText(value: string | null | undefined) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[\s_-]+/g, " ")
    .trim() ?? "";
}

function normalizeUnit(value: string | null | undefined) {
  return normalizeText(value).replace(/^porcao$/, "porcao");
}

function isSameMeasurementFamily(left: string, right: string) {
  const normalizedLeft = normalizeUnit(left);
  const normalizedRight = normalizeUnit(right);
  const mass = new Set(["g", "kg", "mg"]);
  const volume = new Set(["ml", "l"]);
  return (mass.has(normalizedLeft) && mass.has(normalizedRight)) || (volume.has(normalizedLeft) && volume.has(normalizedRight));
}

function toBaseMeasurement(quantity: number, unit: string) {
  switch (normalizeUnit(unit)) {
    case "kg":
      return quantity * 1000;
    case "mg":
      return quantity / 1000;
    case "g":
      return quantity;
    case "l":
      return quantity * 1000;
    case "ml":
      return quantity;
    default:
      return null;
  }
}

function roundNutritionValue(value: number) {
  return Math.round(value * 10) / 10;
}

function hasExactNutritionSource(item: MealDraftItem) {
  return item.nutritionSource?.quality === "exact"
    && item.nutritionSource.isEstimate === false
    && item.nutritionSource.reviewRequired === false;
}

function inferItemVariation(item: MealDraftItem, candidate: OnlineNutritionSourceCandidate) {
  const itemText = normalizeText(`${item.foodName} ${item.canonicalName}`);
  const candidateVariation = normalizeText(candidate.variation);
  const criticalVariations = ["zero", "sem acucar", "diet", "light", "integral", "desnatado", "tradicional"];
  return criticalVariations.find(variation => itemText.includes(variation)) ?? (candidateVariation || null);
}

function buildItemCandidateQuery(item: MealDraftItem, candidate: OnlineNutritionSourceCandidate) {
  return {
    foodName: item.foodName || item.canonicalName,
    brandName: candidate.brandName ?? null,
    variation: inferItemVariation(item, candidate),
    unit: item.unit,
  };
}

function calculateServingFactor(item: MealDraftItem, candidate: OnlineNutritionSourceCandidate) {
  const itemUnit = normalizeUnit(item.unit);
  const servingUnit = normalizeUnit(candidate.serving.unit);
  const servingQuantity = Number(candidate.serving.quantity);

  if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(servingQuantity) || servingQuantity <= 0) {
    return null;
  }

  if (itemUnit === servingUnit || itemUnit === "porcao") {
    return item.quantity / servingQuantity;
  }

  if (isSameMeasurementFamily(itemUnit, servingUnit)) {
    const itemBase = toBaseMeasurement(item.quantity, item.unit);
    const servingBase = toBaseMeasurement(servingQuantity, candidate.serving.unit);
    if (itemBase !== null && servingBase !== null && servingBase > 0) {
      return itemBase / servingBase;
    }
  }

  return null;
}

function applyCandidateToItem(item: MealDraftItem, candidate: OnlineNutritionSourceCandidate, factor: number): MealDraftItem {
  return {
    ...item,
    canonicalName: candidate.name,
    calories: roundNutritionValue(candidate.nutritionPerServing.calories * factor),
    protein: roundNutritionValue(candidate.nutritionPerServing.protein * factor),
    carbs: roundNutritionValue(candidate.nutritionPerServing.carbs * factor),
    fat: roundNutritionValue(candidate.nutritionPerServing.fat * factor),
    confidence: Math.max(item.confidence, candidate.confidence ?? item.confidence),
    source: "catalog",
    nutritionSource: {
      ...selectOnlineNutritionSourceCandidate(buildItemCandidateQuery(item, candidate), [candidate]).selection!,
      selectedAt: candidate.queriedAt,
    },
  };
}

export function applyOnlineNutritionSourcesToMealItems(
  items: MealDraftItem[],
  candidates: OnlineNutritionSourceCandidate[] = [],
): MealDraftItem[] {
  if (!items.length || !candidates.length) {
    return items;
  }

  return items.map(item => {
    if (hasExactNutritionSource(item)) {
      return item;
    }

    const evaluated = candidates
      .map(candidate => ({
        candidate,
        evaluation: selectOnlineNutritionSourceCandidate(buildItemCandidateQuery(item, candidate), [candidate]),
        factor: calculateServingFactor(item, candidate),
      }))
      .filter(result => result.evaluation.status === "accepted" && result.factor !== null)
      .sort((left, right) => (right.evaluation.selection?.confidence ?? 0) - (left.evaluation.selection?.confidence ?? 0));

    const selected = evaluated[0];
    if (!selected || selected.factor === null) {
      return item;
    }

    return applyCandidateToItem(item, selected.candidate, selected.factor);
  });
}
