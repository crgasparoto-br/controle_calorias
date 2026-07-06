import type { MealDraftItem } from "../../../nutritionEngine";

export type WhatsappIntentResult = {
  handled: true;
  action: "water_logged" | "meal_item_added" | "meal_item_grams_adjusted" | "meal_item_replaced" | "meal_suggestion" | "period_report" | "clarification_needed";
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
};

export type WhatsappIntentInput = {
  text?: string | null;
  receivedAt?: Date;
};

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export type PeriodRange = {
  label: string;
  start: Date;
  end: Date;
};

export type NutritionTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type CoffeeAdditionIntent = {
  cups: number;
  mealLabel: string | null;
};

export type CoffeeLorCapsuleIntent = {
  quantity: number;
  mealLabel: string | null;
};

export type FoodAdditionIntent = {
  mealLabel: string;
  date: Date;
  items: Array<{
    foodName: string;
    quantity: number;
    unit: string;
    brand: string | null;
  }>;
};

export type FoodReplacementIntent = {
  fromFood: string;
  toFood: string;
};

export type QuantityCorrectionIntent = {
  previousQuantity: number | null;
  previousUnit: string | null;
  nextQuantity: number;
  nextUnit: string;
};

export type ExistingMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string;
  items?: MealDraftItem[];
};

export type GramsAdjustmentItem = {
  gramsDelta: number;
  targetFood: string | null;
};

export type GramsIncrementItem = {
  gramsDelta: number;
  targetFood: string | null;
};
