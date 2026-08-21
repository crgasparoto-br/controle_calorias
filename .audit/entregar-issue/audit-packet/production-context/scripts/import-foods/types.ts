export type ImportFoodSource = {
  slug: string;
  name: string;
  version: string;
  countryCode?: string;
  sourceUrl?: string;
  notes?: string;
};

export type ImportFoodPortion = {
  label: string;
  unit?: string;
  quantity?: number;
  grams: number;
  isDefault?: boolean;
  sourcePortionCode?: string;
};

export type ImportFood = {
  sourceFoodCode: string;
  name: string;
  brandName?: string;
  category?: string;
  description?: string;
  caloriesKcalPer100g: number;
  proteinGramsPer100g: number;
  carbsGramsPer100g: number;
  fatGramsPer100g: number;
  fiberGramsPer100g?: number;
  sugarGramsPer100g?: number;
  sodiumMgPer100g?: number;
  nutrients?: Record<string, unknown>;
  aliases?: string[];
  portions?: ImportFoodPortion[];
};

export type ImportPayload = {
  source: ImportFoodSource;
  foods: ImportFood[];
};

export type ImportReport = {
  sourceSlug: string;
  sourceVersion: string;
  inserted: number;
  updated: number;
  ignored: number;
  aliasesInserted: number;
  portionsInserted: number;
  possibleDuplicates: Array<{
    sourceFoodCode: string;
    normalizedName: string;
    existingFoodIds: number[];
  }>;
  errors: Array<{
    sourceFoodCode?: string;
    name?: string;
    reason: string;
  }>;
};
