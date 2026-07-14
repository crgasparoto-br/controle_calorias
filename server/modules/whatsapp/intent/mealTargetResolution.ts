import type { MealDraftItem } from "../../../nutritionEngine";
import type { MealItemInput } from "../../meals/schemas";
import { endOfZonedDay, startOfZonedDay } from "./dateTime";
import { resolveTargetMealItem, toMealItemInputs } from "./mealItemHelpers";

type MealWithItems = {
  occurredAt: number | string | Date;
  items?: MealDraftItem[];
};

export type MealTargetScope = "latest_meal" | "same_day_meals";

export type MealItemTargetCandidate<TMeal extends MealWithItems> = {
  meal: TMeal;
  mealIndex: number;
  item: MealItemInput;
  index: number;
  score: number;
  matchedAllTargetTokens: boolean;
};

export type MealItemTargetInMeal<TMeal extends MealWithItems> =
  | { kind: "none" }
  | {
      kind: "matched";
      meal: TMeal;
      mealIndex: number;
      item: MealItemInput;
      index: number;
      score: number;
      scope: MealTargetScope;
      scopeLabel: string;
    }
  | {
      kind: "ambiguous";
      meal: TMeal;
      mealIndex: number;
      candidates: MealItemTargetCandidate<TMeal>[];
      scope: MealTargetScope;
      scopeLabel: string;
    };

function sameZonedDay(reference: number | string | Date, candidate: number | string | Date) {
  const referenceDate = new Date(reference);
  const candidateTime = new Date(candidate).getTime();
  return candidateTime >= startOfZonedDay(referenceDate).getTime() && candidateTime <= endOfZonedDay(referenceDate).getTime();
}

function scopeLabel(scope: MealTargetScope) {
  return scope === "latest_meal" ? "última refeição" : "refeições do dia";
}

function candidatesForMeal<TMeal extends MealWithItems>(
  meal: TMeal,
  mealIndex: number,
  candidates: Array<{ item: MealItemInput; index: number; score: number; matchedAllTargetTokens: boolean }>,
): MealItemTargetCandidate<TMeal>[] {
  return candidates.map(candidate => ({ ...candidate, meal, mealIndex }));
}

export function resolveTargetMealItemInMeals<TMeal extends MealWithItems>(
  meals: TMeal[],
  targetFood: string | null,
): MealItemTargetInMeal<TMeal> {
  const latestMeal = meals[0];
  if (!latestMeal) {
    return { kind: "none" };
  }

  const latestTarget = resolveTargetMealItem(toMealItemInputs(latestMeal.items), targetFood);
  if (latestTarget.kind === "matched") {
    return {
      ...latestTarget,
      kind: "matched",
      meal: latestMeal,
      mealIndex: 0,
      scope: "latest_meal",
      scopeLabel: scopeLabel("latest_meal"),
    };
  }
  if (latestTarget.kind === "ambiguous") {
    return {
      kind: "ambiguous",
      meal: latestMeal,
      mealIndex: 0,
      candidates: candidatesForMeal(latestMeal, 0, latestTarget.candidates),
      scope: "latest_meal",
      scopeLabel: scopeLabel("latest_meal"),
    };
  }

  const sameDayMatches: MealItemTargetCandidate<TMeal>[] = [];

  for (const [mealIndex, meal] of meals.entries()) {
    if (mealIndex === 0 || !meal.items?.length || !sameZonedDay(latestMeal.occurredAt, meal.occurredAt)) {
      continue;
    }

    const target = resolveTargetMealItem(toMealItemInputs(meal.items), targetFood);
    if (target.kind === "ambiguous") {
      sameDayMatches.push(...candidatesForMeal(meal, mealIndex, target.candidates));
      continue;
    }
    if (target.kind === "matched") {
      sameDayMatches.push({
        item: target.item,
        index: target.index,
        score: target.score,
        matchedAllTargetTokens: true,
        meal,
        mealIndex,
      });
    }
  }

  if (sameDayMatches.length === 1) {
    const match = sameDayMatches[0];
    return {
      kind: "matched",
      meal: match.meal,
      mealIndex: match.mealIndex,
      item: match.item,
      index: match.index,
      score: match.score,
      scope: "same_day_meals",
      scopeLabel: scopeLabel("same_day_meals"),
    };
  }

  if (sameDayMatches.length > 1) {
    const candidates = sameDayMatches.slice(0, 10);
    return {
      kind: "ambiguous",
      meal: candidates[0].meal,
      mealIndex: candidates[0].mealIndex,
      candidates,
      scope: "same_day_meals",
      scopeLabel: scopeLabel("same_day_meals"),
    };
  }

  return { kind: "none" };
}
