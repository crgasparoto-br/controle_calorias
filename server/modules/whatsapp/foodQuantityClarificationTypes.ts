import type {
  CoffeeServingQuantity,
} from "../../coffeeSugarNutrition";
import type { MealDraftItem } from "../../nutritionEngine";
import type { MealSemanticContract } from "../../nutritionEngineTypes";
import type { CanonicalFoodAdditionItem } from "./intent/canonicalFoodAdditionResolution";
import type { FoodAdditionIntent } from "./intent/types";
import type { MixedMealItemIncrementPlan } from "./mixedMealItemIncrementPlanTypes";
import type { ResolvedRegistrationSegment } from "./countableFoodRegistrationGate";
import type { PendingFoodClarificationTarget } from "./foodClarificationContract";

export type { CoffeeServingQuantity } from "../../coffeeSugarNutrition";
export type { MealDraftItem } from "../../nutritionEngine";
export type { MealSemanticContract } from "../../nutritionEngineTypes";
export type { CanonicalFoodAdditionItem } from "./intent/canonicalFoodAdditionResolution";
export type { FoodAdditionIntent } from "./intent/types";
export type { MixedMealItemIncrementPlan } from "./mixedMealItemIncrementPlanTypes";
export type { ResolvedRegistrationSegment } from "./countableFoodRegistrationGate";

export type MealItemCorrectionContext = {
  mode: "replace_latest_item";
  mealId: number;
  itemIndex: number;
  originalFoodName: string;
  replacementFoodName: string;
};

export type ImageMealMediaReference = {
  id: number;
  mediaType: "image" | "audio";
  storageKey: string;
  storageUrl: string;
  mimeType: string;
  originalFileName?: string;
};

export type ImageMealQuantityContext = {
  mode: "complete_image_meal";
  detectedMealLabel: string;
  sourceText: string;
  transcript?: string;
  reasoning: string;
  confidence: number;
  occurredAt: string;
  items: MealDraftItem[];
  media: ImageMealMediaReference[];
  pendingItemIndexes: number[];
  currentItemIndex: number;
};

export type ImageMealIdentityContext = {
  mode: "complete_image_meal_identity";
  detectedMealLabel: string;
  sourceText: string;
  transcript?: string;
  reasoning: string;
  confidence: number;
  occurredAt: string;
  items: MealDraftItem[];
  semanticContract: MealSemanticContract;
  media: ImageMealMediaReference[];
  pendingItemIndexes: number[];
  currentItemIndex: number;
};

export type CaloricComplementCompanionReplacement = {
  fromFood: string;
  toFood: string;
};

export type ResolvedCaloricComplementReplacement = {
  mealId: number;
  itemIndex: number;
  originalFoodName: string;
  resolvedItem: MealDraftItem;
  explicitQuantity: {
    quantity: number;
    unit: string;
  };
};

export type CaloricComplementOperation =
  | {
      kind: "register";
      occurredAt: string;
    }
  | {
      kind: "add_to_meal";
      mealId: number;
      expectedMealLabel: string;
      expectedOccurredAt: string;
    }
  | {
      kind: "replace_item";
      mealId: number;
      itemIndex: number;
      originalFoodName: string;
      companionReplacements?: CaloricComplementCompanionReplacement[];
      resolvedReplacements?: ResolvedCaloricComplementReplacement[];
    };

export type ResolvedCaloricComplement = {
  componentName: "açúcar";
  quantity: number;
  unit: string;
};

export type CaloricComplementQuantityContext = {
  mode: "complete_caloric_complement";
  componentName: "açúcar";
  originalFoodText: string;
  originalText?: string;
  inboundMessageId?: string | null;
  completedComponents?: ResolvedCaloricComplement[];
  coffeeQuantity: CoffeeServingQuantity;
  operation: CaloricComplementOperation;
};

export type MealItemIncrementQuantityContext = {
  mode: "complete_mixed_increment_plan";
  plan: MixedMealItemIncrementPlan;
  operationIndex: number;
};

export type ConfirmedTextMealPendingItem = {
  segmentIndex: number;
  segment: string;
  foodName: string;
  brand?: string | null;
  count: number;
  requestedUnit: string;
};

export type ConfirmedTextMealQuantityContext = {
  mode: "complete_confirmed_text_meal";
  originalText: string;
  registrationSegments: string[];
  pendingItems: ConfirmedTextMealPendingItem[];
  currentPendingIndex: number;
  occurredAt: string;
  receivedAt: string;
  inboundMessageId?: string | null;
  userTimezone: string;
  resolvedSegments?: ResolvedRegistrationSegment[];
};

export type FoodAdditionQuantityContext = {
  mode: "complete_food_addition";
  originalText: string;
  addition: Omit<FoodAdditionIntent, "date"> & { date: string };
  itemIndex: number;
  expectedMealId: number;
  expectedMealLabel: string;
  expectedOccurredAt: string;
  receivedAt: string;
  inboundMessageId?: string | null;
  resolvedItems?: CanonicalFoodAdditionItem[];
};

export type FoodQuantityResolutionContext =
  | MealItemCorrectionContext
  | ImageMealQuantityContext
  | ImageMealIdentityContext
  | CaloricComplementQuantityContext
  | MealItemIncrementQuantityContext
  | ConfirmedTextMealQuantityContext
  | FoodAdditionQuantityContext;

export type FoodQuantityClarificationTarget = PendingFoodClarificationTarget & {
  resolutionContext?: FoodQuantityResolutionContext;
};
