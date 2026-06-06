export type MealCommandIntent =
  | "add_items_to_meal"
  | "replace_quantity"
  | "correct_quantity"
  | "remove_item"
  | "replace_item"
  | "update_brand"
  | "unknown";

export type ParsedMealCommandItem = {
  foodName: string | null;
  brand: string | null;
  quantity: number | null;
  unit: string | null;
  confidence: number;
  missingFields: string[];
};

export type ParsedMealCommand = {
  intent: MealCommandIntent;
  mealType: string | null;
  date: Date | null;
  items: ParsedMealCommandItem[];
  previousQuantity?: number | null;
  previousUnit?: string | null;
  nextQuantity?: number | null;
  nextUnit?: string | null;
  confidence: number;
  missingFields: string[];
};

export type MealCommandContext = {
  referenceDate?: Date;
  recentMealType?: string | null;
  recentDate?: Date | null;
};

export function parseMealCommandFromWhatsApp(_input: string, _context: MealCommandContext = {}): ParsedMealCommand {
  return {
    intent: "unknown",
    mealType: null,
    date: null,
    items: [],
    confidence: 0,
    missingFields: ["intent"],
  };
}
