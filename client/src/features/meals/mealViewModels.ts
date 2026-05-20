import { toDateInputValue } from "@/lib/dateTime";
import type { MealItemState, MealType, StoredMeal } from "./types";
import { MEAL_TYPES } from "./types";

export type RegisteredMealItemViewModel = {
  meal: StoredMeal;
  item: MealItemState;
  itemIndex: number;
  registeredAt: number;
  mealLabel: MealType;
  mealNotes?: string;
  imageUrl?: string;
};

export type RegisteredMealGroupViewModel = {
  mealLabel: MealType;
  meals: StoredMeal[];
  items: RegisteredMealItemViewModel[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
};

export function normalizeMealType(mealLabel: string): MealType {
  return MEAL_TYPES.includes(mealLabel as MealType) ? (mealLabel as MealType) : "outro";
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
  const candidate = meal as StoredMeal & {
    imageUrl?: string;
    supportingImageUrl?: string;
    photoUrl?: string;
  };

  return candidate.supportingImageUrl ?? candidate.imageUrl ?? candidate.photoUrl;
}

export function buildRegisteredMealGroups(
  meals: StoredMeal[],
  options: { selectedDay?: string; timeZone?: string } = {},
): RegisteredMealGroupViewModel[] {
  const filteredMeals = options.selectedDay
    ? meals.filter(meal => mealMatchesDate(meal, options.selectedDay!, options.timeZone))
    : meals;

  const groups = new Map<MealType, RegisteredMealGroupViewModel>();

  for (const meal of filteredMeals) {
    const mealLabel = normalizeMealType(meal.mealLabel);
    const imageUrl = getMealImageUrl(meal);
    const group = groups.get(mealLabel) ?? {
      mealLabel,
      meals: [],
      items: [],
      totals: {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    };

    group.meals.push(meal);
    group.totals.calories += meal.totals.calories;
    group.totals.protein += meal.totals.protein;
    group.totals.carbs += meal.totals.carbs;
    group.totals.fat += meal.totals.fat;

    meal.items.forEach((item, itemIndex) => {
      group.items.push({
        meal,
        item,
        itemIndex,
        registeredAt: meal.occurredAt,
        mealLabel,
        mealNotes: meal.notes,
        imageUrl,
      });
    });

    groups.set(mealLabel, group);
  }

  return MEAL_TYPES.map(mealLabel => groups.get(mealLabel)).filter(Boolean) as RegisteredMealGroupViewModel[];
}
