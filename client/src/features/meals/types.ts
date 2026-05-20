export type MealItemState = {
  foodName: string;
  canonicalName: string;
  portionText: string;
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

export type StoredMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number;
  notes?: string;
  source: "web" | "whatsapp";
  items: MealItemState[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
};

export const MEAL_TYPES = ["café da manhã", "almoço", "jantar", "lanche", "outro"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export type ManualMealState = {
  mealId?: number;
  mealLabel: MealType;
  occurredAt: string;
  notes: string;
  items: MealItemState[];
};
