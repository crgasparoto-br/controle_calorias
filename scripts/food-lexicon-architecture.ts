import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";

/** ADR §19 gate 11: lexical decisions owned by a channel. */
export function findLexiconViolations(files: FoodArchitectureFile[]) {
  return findFoodStaticCandidates(files).filter(finding => finding.ruleId === "11");
}
