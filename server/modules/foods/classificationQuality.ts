export type FoodClassificationQualityStatus = "complete" | "partial" | "pending";

export type FoodClassificationQualityReason =
  | "missing_category"
  | "missing_nutrition_source"
  | "missing_processing_classification"
  | "estimated_or_generic_source"
  | "branded_product_without_specific_source";

export type FoodClassificationFlag =
  | "beverage"
  | "branded"
  | "fruit"
  | "generic"
  | "low_calorie_drink"
  | "protein"
  | "ultra_processed"
  | "vegetable";

export type FoodClassificationQualityInput = {
  name: string;
  brandName?: string | null;
  category?: string | null;
  source?: {
    id?: number | null;
    slug?: string | null;
    name?: string | null;
    version?: string | null;
    foodCode?: string | null;
  } | null;
};

export type FoodClassificationQuality = {
  status: FoodClassificationQualityStatus;
  reviewRequired: boolean;
  confidence: number;
  reasons: FoodClassificationQualityReason[];
  flags: FoodClassificationFlag[];
};

const LOW_CALORIE_DRINK_TERMS = [
  "agua",
  "agua com gas",
  "cafe sem acucar",
  "cha sem acucar",
  "zero",
  "sem acucar",
  "diet",
  "light",
];

const ULTRA_PROCESSED_TERMS = [
  "biscoito",
  "bolacha",
  "refrigerante",
  "salgadinho",
  "sorvete",
  "wafer",
];

const PROTEIN_TERMS = ["carne", "frango", "ovo", "peixe", "proteina"];
const FRUIT_TERMS = ["abacaxi", "banana", "laranja", "maca", "mamao", "manga", "morango", "uva"];
const VEGETABLE_TERMS = ["alface", "brocolis", "cenoura", "legume", "tomate", "verdura"];
const BEVERAGE_TERMS = ["agua", "bebida", "cafe", "cha", "refrigerante", "suco"];

function normalizeText(value: string | null | undefined) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[\s_-]+/g, " ")
    .trim() ?? "";
}

function includesAny(value: string, terms: string[]) {
  return terms.some(term => value.includes(term));
}

function addFlag(flags: Set<FoodClassificationFlag>, condition: boolean, flag: FoodClassificationFlag) {
  if (condition) flags.add(flag);
}

export function evaluateFoodClassificationQuality(input: FoodClassificationQualityInput): FoodClassificationQuality {
  const normalizedName = normalizeText(input.name);
  const normalizedBrand = normalizeText(input.brandName);
  const normalizedCategory = normalizeText(input.category);
  const normalizedSourceSlug = normalizeText(input.source?.slug);
  const normalizedSourceName = normalizeText(input.source?.name);
  const sourceLabel = `${normalizedSourceSlug} ${normalizedSourceName}`.trim();

  const hasBrand = Boolean(normalizedBrand);
  const hasCategory = Boolean(normalizedCategory);
  const hasSource = Boolean(input.source?.id || input.source?.slug || input.source?.name || input.source?.foodCode);
  const isEstimatedOrGenericSource = !hasSource || includesAny(sourceLabel, ["estim", "generic", "manual"]);

  const flags = new Set<FoodClassificationFlag>();
  addFlag(flags, hasBrand, "branded");
  addFlag(flags, !hasBrand, "generic");
  addFlag(flags, includesAny(`${normalizedCategory} ${normalizedName}`, BEVERAGE_TERMS), "beverage");
  addFlag(flags, includesAny(`${normalizedCategory} ${normalizedName}`, LOW_CALORIE_DRINK_TERMS), "low_calorie_drink");
  addFlag(flags, includesAny(`${normalizedCategory} ${normalizedName}`, FRUIT_TERMS), "fruit");
  addFlag(flags, includesAny(`${normalizedCategory} ${normalizedName}`, VEGETABLE_TERMS), "vegetable");
  addFlag(flags, includesAny(`${normalizedCategory} ${normalizedName}`, PROTEIN_TERMS), "protein");
  addFlag(flags, hasBrand || includesAny(`${normalizedCategory} ${normalizedName}`, ULTRA_PROCESSED_TERMS), "ultra_processed");

  const reasons: FoodClassificationQualityReason[] = [];
  if (!hasCategory) reasons.push("missing_category");
  if (!hasSource) reasons.push("missing_nutrition_source");
  if (!Array.from(flags).some(flag => flag !== "branded" && flag !== "generic")) {
    reasons.push("missing_processing_classification");
  }
  if (isEstimatedOrGenericSource) reasons.push("estimated_or_generic_source");
  if (hasBrand && isEstimatedOrGenericSource) reasons.push("branded_product_without_specific_source");

  const status: FoodClassificationQualityStatus = reasons.length === 0
    ? "complete"
    : reasons.length <= 2
      ? "partial"
      : "pending";

  return {
    status,
    reviewRequired: status !== "complete",
    confidence: Math.max(0.2, Math.round((1 - (reasons.length * 0.16)) * 100) / 100),
    reasons,
    flags: Array.from(flags).sort(),
  };
}
