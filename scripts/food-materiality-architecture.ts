import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { FOOD_WAVE_ONE_RULES } from "./food-architecture-rules";

/** ADR §19 gate 18: materiality is governed data, not token lists. */
export function findMaterialityViolations(files: FoodArchitectureFile[]) {
  const ruleIds = new Set(FOOD_WAVE_ONE_RULES
    .filter(rule => rule.ownerFunction === "attribute-materiality")
    .map(rule => rule.id));
  return findFoodStaticCandidates(files).filter(finding => ruleIds.has(finding.ruleId));
}
