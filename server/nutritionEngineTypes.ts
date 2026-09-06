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
  fiber?: number;
  brandName?: string | null;
  productVariant?: string | null;
  variants?: string[];
  researchIdentityKey?: string | null;
  sourceUrls?: string[];
  sourceEvidence?: string | null;
  sourceVerifiedAt?: Date | null;
  sourceConfidence?: number | null;
  isBrandedProduct?: boolean;
};

export type HabitSnapshot = {
  foodName: string;
  typicalTimeLabel?: string | null;
  notes?: string | null;
  occurrenceCount: number;
};

export type FoodProcessingLevelEstimate =
  | "natural_or_minimally_processed"
  | "processed_culinary_ingredient"
  | "processed"
  | "ultra_processed";

export type FoodClassificationEstimate = {
  processingLevel: FoodProcessingLevelEstimate;
  isFruit: boolean;
  isVegetable: boolean;
  fiberGrams: number;
  /** Evidência semântica independente de que o item é água potável pura. */
  isPlainWater?: boolean | null;
};

export type MealSemanticInputType =
  | "text"
  | "audio_transcript"
  | "image"
  | "multimodal";

export type MealSemanticEvidenceOrigin =
  | "text"
  | "transcription"
  | "vision"
  | "catalog"
  | "web_research"
  | "nutrition_label"
  | "ai_estimate"
  | "heuristic"
  | "unavailable";

export type MealSemanticClarificationCode =
  | "brand_variant_unresolved"
  | "commercial_identity_unverified";

export type MealSemanticAlternative = {
  name: string;
  brand: string | null;
  productVariant: string | null;
  servingLabel: string;
  gramsPerServing: number;
};

export type MealItemResolutionMetadata = {
  productVariant?: string | null;
  nutritionOrigin: MealSemanticEvidenceOrigin;
  nutritionVerified: boolean;
  sourceUrls?: string[];
  sourceEvidence?: string | null;
  sourceVerifiedAt?: Date | null;
  sourceConfidence?: number | null;
  ambiguity?: {
    reason: MealSemanticClarificationCode;
    alternatives: MealSemanticAlternative[];
  } | null;
};

export type MealDraftItem = {
  foodId?: number;
  foodCatalogId?: number | null;
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
  classification?: FoodClassificationEstimate | null;
  /**
   * Metadados do resolvedor canônico. O campo é opcional para manter leitura de
   * registros históricos, mas processMealInput sempre o projeta no contrato
   * semântico retornado para novas inclusões.
   */
  resolution?: MealItemResolutionMetadata;
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

export type MealSemanticFieldEvidence<T> = {
  value: T;
  origin: MealSemanticEvidenceOrigin;
  confidence: number;
  verified: boolean;
};

export type MealSemanticItem = {
  itemIndex: number;
  originalText: string;
  normalizedText: string;
  commercialName: string;
  category: FoodProcessingLevelEstimate | null;
  brand: string | null;
  productVariant: string | null;
  barcode: string | null;
  quantity: number;
  unit: string;
  portionText: string;
  estimatedGrams: number;
  confidence: {
    identity: number;
    quantity: number;
    source: number;
  };
  evidence: {
    identity: MealSemanticFieldEvidence<string>;
    brand: MealSemanticFieldEvidence<string | null>;
    variant: MealSemanticFieldEvidence<string | null>;
    quantity: MealSemanticFieldEvidence<number>;
    estimatedGrams: MealSemanticFieldEvidence<number>;
    nutrition: MealSemanticFieldEvidence<{
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      sourceUrls: string[];
      sourceEvidence: string | null;
      sourceVerifiedAt: string | null;
    }>;
  };
  alternatives: MealSemanticAlternative[];
  needsClarification: boolean;
  clarificationReason: {
    code: MealSemanticClarificationCode;
    message: string;
  } | null;
};

export type MealSemanticContract = {
  version: 1;
  originalText: string;
  normalizedText: string;
  inputType: MealSemanticInputType;
  intent: string;
  items: MealSemanticItem[];
  needsClarification: boolean;
  clarifications: Array<{
    itemIndex: number;
    code: MealSemanticClarificationCode;
    message: string;
    alternatives: MealSemanticAlternative[];
  }>;
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
  /**
   * Presente em toda nova execução de processMealInput. É opcional no tipo-base
   * somente para compatibilidade com snapshots persistidos anteriores à #1051.
   */
  semanticContract?: MealSemanticContract;
};

export type CanonicalMealProcessingResult = MealProcessingResult & {
  semanticContract: MealSemanticContract;
};

export type LlmItem = {
  foodName: string;
  brand?: string | null;
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
  foodClassification?: FoodClassificationEstimate | null;
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
  /** Indica que o modelo relatou ter lido valores de uma tabela/rótulo nutricional na imagem. */
  nutritionLabelRead?: boolean;
  /** Texto/transcrição original usado para montar candidatos de busca mais específicos. */
  sourceText?: string;
};
