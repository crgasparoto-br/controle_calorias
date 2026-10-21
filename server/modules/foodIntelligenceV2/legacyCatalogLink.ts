import { normalizeFoodName } from "../../../scripts/import-foods/normalize_food_name";

export type TraceableFamily = {
  id: number; name: string; normalizedName: string; brandName: string | null;
  scope: "global" | "user" | null; ownerUserId: number | null;
  sourceId: number | null; sourceFoodCode: string | null; canonicalKey: string | null;
  caloriesKcalPer100g: number; proteinGramsPer100g: number;
  carbsGramsPer100g: number; fatGramsPer100g: number;
};

export type TraceableCatalog = {
  name: string; brandName: string | null; createdByUserId: number | null;
  status: string; dataSource: string; researchIdentityKey: string | null;
  sourceUrls: string | null; sourceVerifiedAt: Date | null; gramsPerServing: number;
  calories: number; protein: number; carbs: number; fat: number;
};
export type TraceableSource = { source: {
  id: number; slug: string; version: string; sourceUrl: string | null;
} };

function sameNutrition(value: number, grams: number, per100: number): boolean {
  return Number.isFinite(value) && Number.isFinite(per100) &&
    Number.isFinite(grams) && grams > 0 &&
    Math.abs(value * 100 / grams - per100) <= 0.05;
}

/** No name-only or generic-source fuzzy link is allowed. A catalog row
 * without an independent legacy source key stays in quarantine. */
export function findTraceableCatalogFamily<T extends TraceableFamily>(
  catalog: TraceableCatalog,
  families: readonly T[],
  sources: ReadonlyMap<number, TraceableSource>,
): T | null {
  if (catalog.status !== "active" || catalog.createdByUserId !== null ||
      !catalog.researchIdentityKey?.trim() || !catalog.sourceUrls ||
      !catalog.sourceVerifiedAt || !Number.isFinite(catalog.sourceVerifiedAt.getTime())) return null;
  const name = normalizeFoodName(catalog.name);
  const brand = normalizeFoodName(catalog.brandName ?? "");
  const matches = families.filter(family => {
    if (family.scope !== "global" || family.ownerUserId !== null ||
        !family.canonicalKey || !family.sourceId || !family.sourceFoodCode?.trim() ||
        normalizeFoodName(family.name) !== name ||
        normalizeFoodName(family.brandName ?? "") !== brand) return false;
    const source = sources.get(family.sourceId)?.source;
    if (!source?.sourceUrl || catalog.dataSource !== source.slug ||
        !catalog.sourceUrls?.includes(source.sourceUrl)) return false;
    if (catalog.researchIdentityKey !== family.sourceFoodCode &&
        catalog.researchIdentityKey !== source.slug + ":" + family.sourceFoodCode) return false;
    return sameNutrition(catalog.calories, catalog.gramsPerServing, family.caloriesKcalPer100g) &&
      sameNutrition(catalog.protein, catalog.gramsPerServing, family.proteinGramsPer100g) &&
      sameNutrition(catalog.carbs, catalog.gramsPerServing, family.carbsGramsPer100g) &&
      sameNutrition(catalog.fat, catalog.gramsPerServing, family.fatGramsPer100g);
  });
  return matches.length === 1 ? matches[0] : null;
}
