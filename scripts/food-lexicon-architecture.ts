import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { FOOD_WAVE_ONE_RULES } from "./food-architecture-rules";

/** ADR §19 gate 11: lexical decisions owned by a channel. */
export function findLexiconViolations(files: FoodArchitectureFile[]) {
  const ruleIds = new Set(FOOD_WAVE_ONE_RULES
    .filter(rule => rule.ownerFunction === "lexical-knowledge")
    .map(rule => rule.id));
  return findFoodStaticCandidates(files).filter(finding => ruleIds.has(finding.ruleId));
}
