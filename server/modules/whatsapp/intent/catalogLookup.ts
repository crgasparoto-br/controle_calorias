import { getCatalogCache } from "../../../catalogRuntime";
import { fuzzyMatchesWords } from "../../../fuzzyTextMatch";
import { cleanCatalogFoodName, normalizeCatalogText } from "./textUtils";

function getCatalogFoodNames(food: ReturnType<typeof getCatalogCache>[number]) {
  return [food.name, ...food.aliases]
    .map(alias => normalizeCatalogText(alias))
    .filter(Boolean);
}

export function findCatalogFood(foodName: string) {
  const normalized = normalizeCatalogText(cleanCatalogFoodName(foodName));
  if (!normalized) {
    return null;
  }

  const catalogSource = getCatalogCache();
  return catalogSource.find(food => getCatalogFoodNames(food).some(alias => alias === normalized))
    ?? catalogSource.find(food => getCatalogFoodNames(food).some(alias => normalized.includes(alias) || alias.includes(normalized)))
    ?? catalogSource.find(food => getCatalogFoodNames(food).some(alias => fuzzyMatchesWords(normalized, alias)))
    ?? null;
}
