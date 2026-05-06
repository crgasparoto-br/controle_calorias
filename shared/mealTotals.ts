export type MealTotalItem = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type MealTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

function round(value: number) {
  return Math.round(value * 10) / 10;
}

export function calculateMealTotals(items: MealTotalItem[]): MealTotals {
  return items.reduce(
    (acc, item) => ({
      calories: round(acc.calories + Number(item.calories || 0)),
      protein: round(acc.protein + Number(item.protein || 0)),
      carbs: round(acc.carbs + Number(item.carbs || 0)),
      fat: round(acc.fat + Number(item.fat || 0)),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export function calculateDayTotals<T extends { items: MealTotalItem[] }>(meals: T[]): MealTotals {
  return calculateMealTotals(meals.flatMap(meal => meal.items));
}
