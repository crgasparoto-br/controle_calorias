import type { MealDraftItem, MealProcessingResult } from "../../nutritionEngine";

export type MealDraftValidationIssueCode =
  | "empty_items"
  | "invalid_food_identity"
  | "invalid_quantity"
  | "invalid_unit"
  | "invalid_estimated_grams"
  | "invalid_nutrition_values"
  | "low_item_confidence"
  | "missing_nutrition_source"
  | "low_nutrition_source_confidence"
  | "estimated_source_without_review";

export type MealDraftValidationIssue = {
  code: MealDraftValidationIssueCode;
  itemIndex?: number;
  message: string;
};

export type MealDraftValidationResult = {
  valid: boolean;
  issues: MealDraftValidationIssue[];
};

export class MealDraftValidationError extends Error {
  readonly issues: MealDraftValidationIssue[];

  constructor(issues: MealDraftValidationIssue[]) {
    super("Rascunho alimentar bloqueado pela validação antes de salvar.");
    this.name = "MealDraftValidationError";
    this.issues = issues;
  }
}

function isPositiveFinite(value: number | undefined | null) {
  return Number.isFinite(value) && Number(value) > 0;
}

function isNonNegativeFinite(value: number | undefined | null) {
  return Number.isFinite(value) && Number(value) >= 0;
}

function hasAnyNutrition(item: MealDraftItem) {
  return item.calories > 0 || item.protein > 0 || item.carbs > 0 || item.fat > 0;
}

function validateItem(item: MealDraftItem, itemIndex: number): MealDraftValidationIssue[] {
  const issues: MealDraftValidationIssue[] = [];

  if (!item.foodName.trim() || !item.canonicalName.trim()) {
    issues.push({
      code: "invalid_food_identity",
      itemIndex,
      message: "O item precisa ter alimento e nome canônico antes de salvar.",
    });
  }

  if (!isPositiveFinite(item.quantity) || !isPositiveFinite(item.servings)) {
    issues.push({
      code: "invalid_quantity",
      itemIndex,
      message: "O item precisa ter quantidade positiva antes de salvar.",
    });
  }

  if (!item.unit.trim() || !item.portionText.trim()) {
    issues.push({
      code: "invalid_unit",
      itemIndex,
      message: "O item precisa ter unidade e porção textual antes de salvar.",
    });
  }

  if (!isPositiveFinite(item.estimatedGrams)) {
    issues.push({
      code: "invalid_estimated_grams",
      itemIndex,
      message: "O item precisa ter gramas estimados positivos antes de salvar.",
    });
  }

  if (![item.calories, item.protein, item.carbs, item.fat].every(isNonNegativeFinite) || !hasAnyNutrition(item)) {
    issues.push({
      code: "invalid_nutrition_values",
      itemIndex,
      message: "O item precisa ter calorias ou macronutrientes válidos antes de salvar.",
    });
  }

  if (item.confidence < 0.25) {
    issues.push({
      code: "low_item_confidence",
      itemIndex,
      message: "A confiança do item está baixa demais para gerar rascunho persistente.",
    });
  }

  if (!item.nutritionSource) {
    issues.push({
      code: "missing_nutrition_source",
      itemIndex,
      message: "O item precisa ter fonte nutricional rastreável antes de salvar.",
    });
    return issues;
  }

  if (item.nutritionSource.confidence < 0.25) {
    issues.push({
      code: "low_nutrition_source_confidence",
      itemIndex,
      message: "A confiança da fonte nutricional está baixa demais para gerar rascunho persistente.",
    });
  }

  if (item.nutritionSource.isEstimate && !item.nutritionSource.reviewRequired) {
    issues.push({
      code: "estimated_source_without_review",
      itemIndex,
      message: "Estimativas precisam ficar marcadas para revisão antes de salvar.",
    });
  }

  return issues;
}

export function validateMealDraftForPersistence(processed: Pick<MealProcessingResult, "items">): MealDraftValidationResult {
  const issues: MealDraftValidationIssue[] = [];

  if (!processed.items.length) {
    issues.push({
      code: "empty_items",
      message: "O rascunho precisa ter ao menos um item alimentar estruturado.",
    });
  }

  processed.items.forEach((item, index) => {
    issues.push(...validateItem(item, index));
  });

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function assertMealDraftValidForPersistence(processed: Pick<MealProcessingResult, "items">) {
  const validation = validateMealDraftForPersistence(processed);
  if (!validation.valid) {
    throw new MealDraftValidationError(validation.issues);
  }
  return validation;
}
