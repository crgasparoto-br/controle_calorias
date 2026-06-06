export type MealItemState = {
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
};

export type DraftState = {
  draftId: string;
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
