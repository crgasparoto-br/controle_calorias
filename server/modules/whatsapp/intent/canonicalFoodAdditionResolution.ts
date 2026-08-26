import { normalizeMeasurementUnit } from "../../../../shared/measurementUnits";
import { getHabitSnapshots } from "../../../db";
import { isCoffeeOrTeaBeverage } from "../../../foodSemanticCompatibility";
import { resolveHouseholdMeasure, type HouseholdMeasureResolution } from "../../../householdMeasureResolution";
import { processMealInput } from "../../../nutritionEngine";
import type { MealItemInput } from "../../meals/schemas";
import type { FoodAdditionIntent } from "./types";
import { buildUnsweetenedCoffeeItem, toMealItemInputs } from "./mealItemHelpers";

const MASS_VOLUME_UNITS = new Set(["mg", "g", "kg", "ml", "l"]);

export type FoodAdditionQuantityResolution = {
  kind: "explicit_mass_or_volume" | HouseholdMeasureResolution["kind"];
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
      kind: "quantity_clarification";
      itemIndex: number;
      item: FoodAdditionIntent["items"][number];
      resolvedItems: CanonicalFoodAdditionItem[];
    };

type ResolverRuntime = {
  getHabitSnapshots: typeof getHabitSnapshots;
  processMealInput: typeof processMealInput;
  resolveHouseholdMeasure: typeof resolveHouseholdMeasure;
};

const defaultRuntime: ResolverRuntime = {
  getHabitSnapshots,
  processMealInput,
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

function buildFoodIdentity(item: FoodAdditionIntent["items"][number]) {
  const brand = item.brand?.trim();
  if (!brand) return item.foodName.trim();
  const normalizedFood = item.foodName.toLowerCase();
  return normalizedFood.includes(brand.toLowerCase())
    ? item.foodName.trim()
    : `${item.foodName.trim()} ${brand}`;
}

function buildOriginalFoodText(item: FoodAdditionIntent["items"][number], normalizedUnit: string) {
  return `${item.quantity} ${normalizedUnit} de ${buildFoodIdentity(item)}`;
}

function isMassOrVolume(unit: string) {
  return MASS_VOLUME_UNITS.has(unit);
}

function explicitEstimatedGrams(quantity: number, unit: string) {
  switch (unit) {
    case "kg": return quantity * 1000;
    case "mg": return quantity / 1000;
    case "l": return quantity * 1000;
    default: return quantity;
  }
}

function buildPortionText(
  item: FoodAdditionIntent["items"][number],
  normalizedUnit: string,
  measure: HouseholdMeasureResolution,
) {
  const approx = measure.kind === "usual_average" ? "aprox. " : "";
  return `${formatNumber(item.quantity)} ${normalizedUnit} (${approx}${formatNumber(measure.grams)} g)`;
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
  },
  runtime: ResolverRuntime = defaultRuntime,
): Promise<CanonicalFoodAdditionResolution> {
  const habits = await runtime.getHabitSnapshots(input.userId);
  const resolvedItems: CanonicalFoodAdditionItem[] = [];

  for (const [itemIndex, item] of input.addition.items.entries()) {
    const normalizedUnit = normalizeMeasurementUnit(item.unit);
    const originalFoodText = buildOriginalFoodText(item, normalizedUnit);
    const beverage = isCoffeeOrTeaBeverage(item.foodName);

    if (
      !isMassOrVolume(normalizedUnit)
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

    if (isMassOrVolume(normalizedUnit)) {
      quantityResolution = {
        kind: "explicit_mass_or_volume",
        grams: explicitEstimatedGrams(item.quantity, normalizedUnit),
        evidence: null,
        sourceUrls: [],
        referenceCount: 0,
      };
    } else if (!beverage) {
      householdMeasure = await runtime.resolveHouseholdMeasure({
        userId: input.userId,
        foodName: item.foodName,
        brand: item.brand,
        quantity: item.quantity,
        unit: normalizedUnit,
      });
      if (!householdMeasure) {
        return { kind: "quantity_clarification", itemIndex, item, resolvedItems };
      }
      processingText = `${householdMeasure.grams} g de ${buildFoodIdentity(item)}`;
      quantityResolution = {
        kind: householdMeasure.kind,
        grams: householdMeasure.grams,
        evidence: householdMeasure.evidence,
        sourceUrls: [...householdMeasure.sourceUrls],
        referenceCount: householdMeasure.referenceCount,
      };
    }

    const processed = await runtime.processMealInput({
      text: processingText,
      habits,
      occurredAt: input.occurredAt,
      timeZone: input.timeZone,
    });
    const resolved = findSingleResolvedItem(toMealItemInputs(processed.items));
    if (!resolved) {
      throw new Error(`A resolução canônica não produziu um único alimento para: ${originalFoodText}`);
    }

    const finalItem: CanonicalFoodAdditionItem = householdMeasure
      ? {
          ...resolved,
          foodName: item.foodName.trim(),
          brand: item.brand ?? resolved.brand ?? null,
          quantity: item.quantity,
          unit: normalizedUnit,
          portionText: buildPortionText(item, normalizedUnit, householdMeasure),
          estimatedGrams: householdMeasure.grams,
          quantityResolution,
        }
      : {
          ...resolved,
          brand: item.brand ?? resolved.brand ?? null,
          quantityResolution,
        };
    resolvedItems.push(finalItem);
  }

  return { kind: "items", items: resolvedItems };
}
