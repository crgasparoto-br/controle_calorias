import { normalizeFoodName } from "../../../scripts/import-foods/normalize_food_name";

export type TraceableFamily = {
  id: number; name: string; normalizedName: string; brandName: string | null;
  status: string;
  scope: "global" | "user" | null; ownerUserId: number | null;
  sourceId: number | null; sourceFoodCode: string | null; canonicalKey: string | null;
  caloriesKcalPer100g: number; proteinGramsPer100g: number;
  carbsGramsPer100g: number; fatGramsPer100g: number;
};

export type TraceableCatalog = {
  name: string; brandName: string | null; createdByUserId: number | null;
  isUserCreated: number;
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

function catalogCitesSource(raw: string, sourceUrl: string): boolean {
  try {
    const decoded: unknown = JSON.parse(raw);
    const references = Array.isArray(decoded) ? decoded :
      typeof decoded === "string" ? [decoded] : [];
    const primary = new URL(sourceUrl);
    if (primary.protocol !== "https:") return false;
    const prefix = primary.pathname.endsWith("/") ? primary.pathname : primary.pathname + "/";
    return references.some(reference => {
      if (typeof reference !== "string") return false;
      try {
        const exact = new URL(reference);
        return exact.protocol === "https:" && exact.origin === primary.origin &&
          (exact.pathname === primary.pathname || exact.pathname.startsWith(prefix));
      } catch { return false; }
    });
  } catch {
    return false;
  }
}

/** No name-only or generic-source fuzzy link is allowed. A catalog row
 * without an independent legacy source key stays in quarantine. */
export function findTraceableCatalogFamily<T extends TraceableFamily>(
  catalog: TraceableCatalog,
  families: readonly T[],
  sources: ReadonlyMap<number, TraceableSource>,
): T | null {
  if (catalog.status !== "active" || catalog.isUserCreated !== 0 ||
      catalog.createdByUserId !== null ||
      !catalog.researchIdentityKey?.trim() || !catalog.sourceUrls ||
      !catalog.sourceVerifiedAt || !Number.isFinite(catalog.sourceVerifiedAt.getTime())) return null;
  const sourceUrls = catalog.sourceUrls;
  const name = normalizeFoodName(catalog.name);
  const brand = normalizeFoodName(catalog.brandName ?? "");
  const matches = families.filter(family => {
    if (family.status !== "active" || family.scope !== "global" || family.ownerUserId !== null ||
        !family.canonicalKey || !family.sourceId || !family.sourceFoodCode?.trim() ||
        normalizeFoodName(family.name) !== name ||
        normalizeFoodName(family.brandName ?? "") !== brand) return false;
    const source = sources.get(family.sourceId)?.source;
    if (!source?.sourceUrl || catalog.dataSource !== source.slug ||
        !catalogCitesSource(sourceUrls, source.sourceUrl)) return false;
    if (catalog.researchIdentityKey !== family.sourceFoodCode &&
        catalog.researchIdentityKey !== source.slug + ":" + family.sourceFoodCode) return false;
    return sameNutrition(catalog.calories, catalog.gramsPerServing, family.caloriesKcalPer100g) &&
      sameNutrition(catalog.protein, catalog.gramsPerServing, family.proteinGramsPer100g) &&
      sameNutrition(catalog.carbs, catalog.gramsPerServing, family.carbsGramsPer100g) &&
      sameNutrition(catalog.fat, catalog.gramsPerServing, family.fatGramsPer100g);
  });
  return matches.length === 1 ? matches[0] : null;
}
