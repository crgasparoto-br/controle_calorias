import { executeResolvedCapability } from "./_core/ai/capabilityExecutor";
import { resolveCapabilityConfig } from "./_core/ai/configResolver";
import {
  findCatalogFoodSemantic as findCatalogFoodSemanticCore,
  findPackagedSnackByWebSearch as findPackagedSnackByWebSearchCore,
  resetEmbeddingCache as resetEmbeddingCacheCore,
} from "./catalogSemanticSearchCore";
import { findBrandedNutritionByWebSearch } from "./brandedNutritionSearch";
import type { CatalogFood } from "./nutritionEngineTypes";

type NutritionSearchCategory = "chocolate" | "cookie" | "branded_product";
type SemanticSearchOptions = { searchSpecificProduct?: boolean; skipNutritionSearch?: boolean };

const brandedNutritionRuntime = {
  resolveCapabilityConfig,
  executeResolvedCapability,
};

export async function findPackagedSnackByWebSearch(
  foodName: string,
  category: NutritionSearchCategory,
): Promise<CatalogFood | null> {
  if (category === "branded_product") {
    return findBrandedNutritionByWebSearch(foodName, brandedNutritionRuntime);
  }
  return findPackagedSnackByWebSearchCore(foodName, category);
}

export async function findCatalogFoodSemantic(
  foodName: string,
  options: SemanticSearchOptions = {},
): Promise<CatalogFood | null> {
  if (options.searchSpecificProduct && !options.skipNutritionSearch) {
    const specific = await findBrandedNutritionByWebSearch(foodName, brandedNutritionRuntime);
    if (specific) return specific;

    return findCatalogFoodSemanticCore(foodName, {
      searchSpecificProduct: false,
      skipNutritionSearch: true,
    });
  }

  return findCatalogFoodSemanticCore(foodName, options);
}

export function resetEmbeddingCache(): void {
  resetEmbeddingCacheCore();
}
