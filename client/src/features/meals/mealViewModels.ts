import { toDateInputValue } from "@/lib/dateTime";
import type { MealItemState, MealType, StoredMeal } from "./types";

export type RegisteredMealItemViewModel = {
  meal: StoredMeal;
  item: MealItemState;
  itemIndex: number;
  registeredAt: number;
  mealLabel: MealType;
  mealNotes?: string;
  imageUrl?: string;
};

export type RegisteredMealRecordViewModel = {
  meal: StoredMeal;
  items: RegisteredMealItemViewModel[];
  registeredAt: number;
  mealLabel: MealType;
  mealNotes?: string;
  imageUrl?: string;
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
};

export type RegisteredMealGroupViewModel = {
  mealLabel: MealType;
  meals: StoredMeal[];
  records: RegisteredMealRecordViewModel[];
  items: RegisteredMealItemViewModel[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
};

export function normalizeMealType(mealLabel: string): MealType {
  return mealLabel.trim() || "outro";
}

export function addDaysToDateInputValue(dateInputValue: string, days: number): string {
  const [year, month, day] = dateInputValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mealMatchesDate(meal: StoredMeal, dateInputValue: string, timeZone?: string): boolean {
  return toDateInputValue(new Date(meal.occurredAt), timeZone) === dateInputValue;
}

export function getMealImageUrl(meal: StoredMeal): string | undefined {
  const mediaImageUrl = meal.media?.find(media => media.mediaType === "image" && media.storageUrl)?.storageUrl;
  return meal.supportingImageUrl ?? meal.imageUrl ?? meal.photoUrl ?? mediaImageUrl;
}

export function buildRegisteredMealGroups(
  meals: StoredMeal[],
  options: { selectedDay?: string; timeZone?: string } = {},
): RegisteredMealGroupViewModel[] {
  const filteredMeals = options.selectedDay
    ? meals.filter(meal => mealMatchesDate(meal, options.selectedDay!, options.timeZone))
    : meals;

  const groups = new Map<MealType, RegisteredMealGroupViewModel>();
  const mealLabelOrder: MealType[] = [];

  for (const meal of filteredMeals) {
    const mealLabel = normalizeMealType(meal.mealLabel);
    const imageUrl = getMealImageUrl(meal);
    const existingGroup = groups.get(mealLabel);
    if (!existingGroup) {
      mealLabelOrder.push(mealLabel);
    }

    const group = existingGroup ?? {
      mealLabel,
      meals: [],
      records: [],
      items: [],
      totals: {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    };

    const mealItems = meal.items.map((item, itemIndex) => ({
      meal,
      item,
      itemIndex,
      registeredAt: meal.occurredAt,
      mealLabel,
      mealNotes: meal.notes,
      imageUrl,
    }));

    group.meals.push(meal);
    group.records.push({
      meal,
      items: mealItems,
      registeredAt: meal.occurredAt,
      mealLabel,
      mealNotes: meal.notes,
      imageUrl,
      totals: {
        calories: meal.totals.calories,
        protein: meal.totals.protein,
        carbs: meal.totals.carbs,
        fat: meal.totals.fat,
      },
    });
    group.items.push(...mealItems);
    group.totals.calories += meal.totals.calories;
    group.totals.protein += meal.totals.protein;
    group.totals.carbs += meal.totals.carbs;
    group.totals.fat += meal.totals.fat;

    groups.set(mealLabel, group);
  }

  return mealLabelOrder
    .map(mealLabel => groups.get(mealLabel))
    .filter(Boolean) as RegisteredMealGroupViewModel[];
}
