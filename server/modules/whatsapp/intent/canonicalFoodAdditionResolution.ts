import { normalizeMeasurementUnit } from "../../../../shared/measurementUnits";
import { inferUnresolvedCommercialIdentityHint } from "../../../catalogMatching";
import { resolveStructuredCommercialIdentity } from "../../../commercialFoodIdentityPreflight";
import {
  isMassOrVolumeUnit,
  resolveCanonicalFoodQuantity,
  type FoodQuantityResolution,
} from "../../../foodItemResolution";
import { isCoffeeOrTeaBeverage } from "../../../foodSemanticCompatibility";
import {
  isApproximateHouseholdMeasureResolutionKind,
  resolveHouseholdMeasure,
  type HouseholdMeasureResolution,
} from "../../../householdMeasureResolution";
import {
  MealInferenceError,
  processMealInput,
  resolveCommercialFoodIdentity,
} from "../../../nutritionEngine";
import { buildItemFromResolvedCommercialFood } from "../../../mealItemBuilders";
import type { MealItemInput } from "../../meals/schemas";
import type { FoodAdditionIntent } from "./types";
import {
  buildUnsweetenedCoffeeItem,
  toMealItemInput,
  toMealItemInputs,
} from "./mealItemHelpers";

export type FoodAdditionQuantityResolution = {
  kind: FoodQuantityResolution["kind"];
  grams: number;
  evidence: string | null;
  sourceUrls: string[];
  referenceCount: number;
};

export type CanonicalFoodAdditionItem = MealItemInput & {
  quantityResolution?: FoodAdditionQuantityResolution;
};

export type CanonicalFoodAdditionResolution =
  | { kind: "items"; items: CanonicalFoodAdditionItem[] }
  | {
      kind: "identity_clarification";
      itemIndex: number;
      item: FoodAdditionIntent["items"][number];
      resolvedItems: CanonicalFoodAdditionItem[];
      message: string;
      context: NonNullable<MealInferenceError["context"]>;
    }
  | {
      kind: "quantity_clarification";
      itemIndex: number;
      item: FoodAdditionIntent["items"][number];
      resolvedItems: CanonicalFoodAdditionItem[];
    };

type ResolverRuntime = {
  processMealInput: typeof processMealInput;
  resolveCommercialFoodIdentity: typeof resolveCommercialFoodIdentity;
  resolveHouseholdMeasure: typeof resolveHouseholdMeasure;
};

const defaultRuntime: ResolverRuntime = {
  processMealInput,
  resolveCommercialFoodIdentity,
  resolveHouseholdMeasure,
};

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2))).replace(".", ",");
}

function normalizeFoodText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isExplicitlyUnsweetenedCoffee(value: string) {
  const normalized = normalizeFoodText(value);
  return /\bcafe\b/.test(normalized)
    && /\bsem\s+(?:adicao\s+de\s+)?acucar\b/.test(normalized);
}

function buildFoodIdentity(
  item: FoodAdditionIntent["items"][number],
  brandOverride?: string | null,
) {
  const brand = brandOverride?.trim() || item.brand?.trim();
  if (!brand) return item.foodName.trim();
  const normalizedFood = item.foodName.toLowerCase();
  return normalizedFood.includes(brand.toLowerCase())
    ? item.foodName.trim()
    : `${item.foodName.trim()} ${brand}`;
}

function buildOriginalFoodText(item: FoodAdditionIntent["items"][number], normalizedUnit: string) {
  return `${item.quantity} ${normalizedUnit} de ${buildFoodIdentity(item)}`;
}

function buildPortionText(
  item: FoodAdditionIntent["items"][number],
  normalizedUnit: string,
  measure: HouseholdMeasureResolution,
) {
  const approx = isApproximateHouseholdMeasureResolutionKind(measure.kind) ? "aprox. " : "";
  return `${formatNumber(item.quantity)} ${normalizedUnit} (${approx}${formatNumber(measure.grams)} g)`;
}

function toAdditionQuantityResolution(
  quantity: FoodQuantityResolution,
): FoodAdditionQuantityResolution {
  return {
    kind: quantity.kind,
    grams: quantity.grams,
    evidence: quantity.evidence,
    sourceUrls: [...quantity.sourceUrls],
    referenceCount: quantity.referenceCount,
  };
}

function findSingleResolvedItem(items: MealItemInput[]) {
  return items.length === 1 ? items[0] : null;
}

export async function resolveCanonicalFoodAdditionItems(
  input: {
    userId: number;
    addition: FoodAdditionIntent;
    occurredAt: Date;
    timeZone: string;
    resolvedItems?: CanonicalFoodAdditionItem[];
  },
  runtime: ResolverRuntime = defaultRuntime,
): Promise<CanonicalFoodAdditionResolution> {
  const resolvedItems: CanonicalFoodAdditionItem[] = [...(input.resolvedItems ?? [])];

  for (const [itemIndex, item] of input.addition.items.entries()) {
    if (itemIndex < resolvedItems.length) continue;
    const normalizedUnit = normalizeMeasurementUnit(item.unit);
    const originalFoodText = buildOriginalFoodText(item, normalizedUnit);
    const beverage = isCoffeeOrTeaBeverage(item.foodName);

    if (
      !isMassOrVolumeUnit(normalizedUnit)
      && isExplicitlyUnsweetenedCoffee(item.foodName)
    ) {
      resolvedItems.push({
        ...buildUnsweetenedCoffeeItem(item.quantity, normalizedUnit),
        brand: item.brand ?? null,
      });
      continue;
    }

    let processingText = originalFoodText;
    let quantityResolution: FoodAdditionQuantityResolution | undefined;
    let householdMeasure: HouseholdMeasureResolution | null = null;
    let commercialFood: Awaited<ReturnType<typeof resolveCommercialFoodIdentity>> | undefined;
    let resolvedBrand = item.brand?.trim() || null;

    if (isMassOrVolumeUnit(normalizedUnit)) {
      // Massa/volume explícitos resolvem a quantidade na fronteira canônica e
      // nunca são reabertos por medida caseira.
      const explicit = await resolveCanonicalFoodQuantity({
        userId: input.userId,
        foodName: item.foodName,
        quantity: item.quantity,
        unit: normalizedUnit,
      }, runtime);
      if (explicit) quantityResolution = toAdditionQuantityResolution(explicit);
    } else if (!beverage) {
      const commercialHint = inferUnresolvedCommercialIdentityHint(item.foodName);
      if (resolvedBrand || commercialHint) {
        const identity = resolveStructuredCommercialIdentity({
          segment: originalFoodText,
          foodName: item.foodName,
          brand: resolvedBrand,
        });
        resolvedBrand = identity.brand ?? resolvedBrand;
        if (identity.identityClarification) {
          return {
            kind: "identity_clarification",
            itemIndex,
            item,
            resolvedItems,
            message: identity.identityClarification.message,
            context: identity.identityClarification.context,
          };
        }
      }

      if (resolvedBrand) {
        try {
          commercialFood = await runtime.resolveCommercialFoodIdentity(
            item.foodName,
            resolvedBrand,
          );
        } catch (error) {
          if (
            error instanceof MealInferenceError
            && error.code === "food_identity_clarification_required"
            && error.context?.clarificationReason
          ) {
            return {
              kind: "identity_clarification",
              itemIndex,
              item,
              resolvedItems,
              message: error.message,
              context: error.context,
            };
          }
          throw error;
        }
      }
      // Mesma precedência do registro normal: porção canônica local (por
      // exemplo `1 ovo frito` -> 50 g) antes de medida caseira/pesquisa.
      const quantity = await resolveCanonicalFoodQuantity({
        userId: input.userId,
        foodName: item.foodName,
        brand: resolvedBrand,
        variant: commercialFood?.productVariant ?? null,
        portionLabel: commercialFood?.servingLabel ?? null,
        quantity: item.quantity,
        unit: normalizedUnit,
        ...(commercialFood ? { commercialFood } : {}),
      }, runtime);
      householdMeasure = quantity?.householdMeasure ?? null;
      if (!quantity || !householdMeasure) {
        return { kind: "quantity_clarification", itemIndex, item, resolvedItems };
      }
      processingText = `${householdMeasure.grams} g de ${buildFoodIdentity(item, resolvedBrand)}`;
      quantityResolution = toAdditionQuantityResolution(quantity);
    }

    let resolved: MealItemInput | null = null;
    if (commercialFood && householdMeasure) {
      // The accepted CatalogFood is already the canonical identity. Build the
      // persistible item directly instead of turning it back into text and
      // asking processMealInput to rediscover the same product/variant.
      resolved = toMealItemInput(buildItemFromResolvedCommercialFood({
        food: commercialFood,
        foodName: item.foodName.trim(),
        brand: resolvedBrand ?? commercialFood.brandName ?? "",
        quantity: item.quantity,
        unit: normalizedUnit,
        grams: householdMeasure.grams,
        measureResolution: {
          kind: householdMeasure.kind,
          requestedQuantity: householdMeasure.requestedQuantity,
          requestedUnit: householdMeasure.requestedUnit,
          sourceUrls: householdMeasure.sourceUrls,
          evidence: householdMeasure.evidence,
          referenceCount: householdMeasure.referenceCount,
        },
      }));
    } else {
      const processed = await runtime.processMealInput({
        text: processingText,
        occurredAt: input.occurredAt,
        timeZone: input.timeZone,
      });
      resolved = findSingleResolvedItem(toMealItemInputs(processed.items));
    }
    if (!resolved) {
      throw new Error(`A resolução canônica não produziu um único alimento para: ${originalFoodText}`);
    }

    const finalItem: CanonicalFoodAdditionItem = householdMeasure
      ? {
          ...resolved,
          foodName: item.foodName.trim(),
          brand: resolvedBrand ?? resolved.brand ?? null,
          quantity: item.quantity,
          unit: normalizedUnit,
          portionText: buildPortionText(item, normalizedUnit, householdMeasure),
          estimatedGrams: householdMeasure.grams,
          quantityResolution,
        }
      : {
          ...resolved,
          foodName: item.foodName.trim(),
          brand: resolvedBrand ?? resolved.brand ?? null,
          quantityResolution,
        };
    resolvedItems.push(finalItem);
  }

  return { kind: "items", items: resolvedItems };
}
