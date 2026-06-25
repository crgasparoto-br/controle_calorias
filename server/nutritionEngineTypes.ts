export type CatalogFood = {
  slug: string;
  name: string;
  aliases: string[];
  servingLabel: string;
  gramsPerServing: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  brandName?: string | null;
  variants?: string[];
  isBrandedProduct?: boolean;
};

export type HabitSnapshot = {
  foodName: string;
  typicalTimeLabel?: string | null;
  notes?: string | null;
  occurrenceCount: number;
};

export type MealDraftItem = {
  foodId?: number;
  portionId?: number;
  portionQuantity?: number;
  foodName: string;
  canonicalName: string;
  brand?: string | null;
  quantity: number;
  unit: string;
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

/**
 * Contexto de intenção derivado do LLM classificador (WhatsApp intent interpreter).
 * Quando presente, permite que o LLM nutricional foque na tarefa correta e
 * evite ambiguidades sem precisar reinterpretar a mensagem do zero.
 */
export type IntentHint = {
  /** Intenção identificada pelo classificador */
  intent: string;
  /** Confiança do classificador (0–1) */
  confidence: number;
  /** Tipo de refeição já resolvido pelo classificador, se houver */
  mealLabel?: string | null;
  /** Data já resolvida pelo classificador ("hoje", "ontem" ou ISO) */
  date?: string | null;
  /** Resumo do raciocínio do classificador para depuração */
  reasoning?: string | null;
};

export type MealProcessingInput = {
  text?: string;
  transcript?: string;
  imageUrl?: string;
  audioUrl?: string;
  habits?: HabitSnapshot[];
  occurredAt?: Date | string | number;
  timeZone?: string;
  suggestedMealLabel?: string | null;
  /** Contexto opcional do LLM classificador para coordenar a extração nutricional */
  intentHint?: IntentHint | null;
};

export type MealProcessingResult = {
  detectedMealLabel: string;
  sourceText: string;
  imageUrl?: string;
  audioUrl?: string;
  transcript?: string;
  confidence: number;
  needsConfirmation: boolean;
  reasoning: string;
  items: MealDraftItem[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
};

export type LlmItem = {
  foodName: string;
  quantity?: number;
  unit?: string;
  portionText: string;
  servings: number;
  estimatedGrams: number;
  estimatedCalories: number;
  estimatedMacros: {
    protein: number;
    carbs: number;
    fat: number;
  };
  confidence: number;
};

export type ParsedFoodText = {
  foodName: string;
  quantity?: number;
  unit?: string;
  portionText?: string;
  estimatedGrams?: number;
};

export type ExplicitQuantity = {
  quantity: number;
  unit: string;
  estimatedGrams?: number;
};

export type BuildItemsOptions = {
  preferInferredNutrition?: boolean;
};
