import type { MealDraftItem } from "../../../nutritionEngine";
import type { MealItemInput } from "../../meals/schemas";
import type { MealItemTargetMatch } from "../mealItemTargetMatcher";
import { endOfZonedDay, startOfZonedDay } from "./dateTime";
import { resolveTargetMealItem, toMealItemInputs } from "./mealItemHelpers";

type MealWithItems = {
  occurredAt: number | string | Date;
  items?: MealDraftItem[];
};

type TargetCandidates = Extract<MealItemTargetMatch<MealItemInput>, { kind: "ambiguous" }>["candidates"];

export type MealTargetScope = "latest_meal" | "same_day_meals";

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
      candidates: TargetCandidates;
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
      candidates: latestTarget.candidates,
      scope: "latest_meal",
      scopeLabel: scopeLabel("latest_meal"),
    };
  }

  const sameDayMatches: Array<Extract<MealItemTargetInMeal<TMeal>, { kind: "matched" }>> = [];

  for (const [mealIndex, meal] of meals.entries()) {
    if (mealIndex === 0 || !meal.items?.length || !sameZonedDay(latestMeal.occurredAt, meal.occurredAt)) {
      continue;
    }

    const target = resolveTargetMealItem(toMealItemInputs(meal.items), targetFood);
    if (target.kind === "ambiguous") {
      return {
        kind: "ambiguous",
        meal,
        mealIndex,
        candidates: target.candidates,
        scope: "same_day_meals",
        scopeLabel: scopeLabel("same_day_meals"),
      };
    }
    if (target.kind === "matched") {
      sameDayMatches.push({
        ...target,
        kind: "matched",
        meal,
        mealIndex,
        scope: "same_day_meals",
        scopeLabel: scopeLabel("same_day_meals"),
      });
    }
  }

  if (sameDayMatches.length === 1) {
    return sameDayMatches[0];
  }

  if (sameDayMatches.length > 1) {
    return {
      kind: "ambiguous",
      meal: sameDayMatches[0].meal,
      mealIndex: sameDayMatches[0].mealIndex,
      candidates: sameDayMatches.slice(0, 5).map(match => ({
        item: match.item,
        index: match.index,
        score: match.score,
        matchedAllTargetTokens: true,
      })),
      scope: "same_day_meals",
      scopeLabel: scopeLabel("same_day_meals"),
    };
  }

  return { kind: "none" };
}
