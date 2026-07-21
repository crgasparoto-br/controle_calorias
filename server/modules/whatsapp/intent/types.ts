import type { MealDraftItem } from "../../../nutritionEngine";

export type WhatsappIntentResult = {
  handled: true;
  action:
    | "water_logged"
    | "meal_item_added"
    | "meal_item_grams_adjusted"
    | "meal_item_replaced"
    | "meal_suggestion"
    | "period_report"
    | "clarification_needed"
    | "meal_deleted"
    | "meal_item_deleted"
    | "delete_cancelled"
    | "food_clarification_requested"
    | "food_clarification_completed"
    | "food_clarification_reprompted"
    | "food_clarification_cancelled"
    | "food_clarification_unavailable"
    | "food_clarification_retryable_failure"
    | "food_clarification_blocked"
    | "food_clarification_standalone_command_blocked";
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  /** Quando presente, o transporte central deve enviar botões/lista (issue #782) em vez do texto simples de `reply`. */
  interactiveReply?: import("../replyContract").WhatsAppLogicalReply;
};

export type WhatsappIntentInput = {
  text?: string | null;
  receivedAt?: Date;
  userTimezone?: string | null;
  /** ID externo do inbound, quando disponível, usado no vínculo idempotente da pendência. */
  messageId?: string | null;
  /** Identificador sanitizado do wrapper que iniciou o roteamento. */
  entrypoint?: string;
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
