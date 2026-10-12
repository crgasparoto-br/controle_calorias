import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";

/** ADR §19 gate 18: materiality is governed data, not token lists. */
export function findMaterialityViolations(files: FoodArchitectureFile[]) {
  return findFoodStaticCandidates(files).filter(finding => finding.ruleId === "18");
}
