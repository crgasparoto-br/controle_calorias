import {
  foodD1WebDraftSchema,
  type FoodD1WebDraft,
  type FoodD1WebDraftItem,
} from "@shared/foodD1WebDraft";

export type MealItemState = {
  foodId?: number;
  portionId?: number;
  portionQuantity?: number;
  foodName: string;
  canonicalName: string;
  portionText: string;
  quantity?: number;
  unit?: string;
  servings: number;
  estimatedGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  source: "catalog" | "hybrid" | "heuristic";
  sourceMediaStorageKey?: string;
};

export type LegacyDraftState = {
  draftId: string;
  suggestedOccurredAt?: string;
  processed: {
    detectedMealLabel: string;
    sourceText: string;
    transcript?: string;
    confidence: number;
    reasoning: string;
    items: MealItemState[];
    totals: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    };
  };
};

export type DraftState = LegacyDraftState | FoodD1WebDraft;

export type FoodD1EditableItemState = Omit<FoodD1WebDraftItem, "quantity"> & {
  quantityInput: string;
};

export function isFoodD1WebDraft(value: unknown): value is FoodD1WebDraft {
  return foodD1WebDraftSchema.safeParse(value).success;
}

export type FoodPhotoCatalogCandidateState = {
  foodId: number;
  name: string;
  scope: "global" | "user";
  confidenceScore: number;
  caloriesKcalPer100g: number;
  proteinGramsPer100g: number;
  carbsGramsPer100g: number;
  fatGramsPer100g: number;
};

export type FoodPhotoAnalysisState = {
  id: string;
  status: "pending" | "analyzed" | "confirmed" | "rejected";
  suggestedItems: Array<{
    foodName: string;
    estimatedQuantity: number;
    unit: string;
    estimatedCalories: number;
    estimatedMacros: {
      protein: number;
      carbs: number;
      fat: number;
    };
    confidenceScore: number;
    catalogCandidates: FoodPhotoCatalogCandidateState[];
  }>;
  editableItems: MealItemState[];
  supportingImageUrl?: string;
};

export type StoredMealMedia = {
  id?: number;
  mediaType?: "image" | "audio" | string;
  storageKey?: string;
  storageUrl?: string;
  mimeType?: string;
  originalFileName?: string;
};

export type StoredMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number;
  notes?: string;
  source: "web" | "whatsapp";
  items: MealItemState[];
  media?: StoredMealMedia[];
  imageUrl?: string;
  supportingImageUrl?: string;
  photoUrl?: string;
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
};

export const MEAL_TYPES = [
  "café da manhã",
  "almoço",
  "lanche da tarde",
  "pré-treino",
  "pós-treino",
  "jantar",
  "ceia",
  "lanche",
  "bebida",
  "outro",
] as const;
export type MealType = string;

export type ManualMealState = {
  mealId?: number;
  mealLabel: string;
  occurredAt: string;
  notes: string;
  items: MealItemState[];
};
