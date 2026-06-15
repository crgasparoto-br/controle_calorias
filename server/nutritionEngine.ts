import { z } from "zod";
import { getAiProvider, type AiProviderTextRequest } from "./_core/aiProvider";
import { ENV } from "./_core/env";
import { getCatalogCache } from "./catalogRuntime";
import { FOOD_CATALOG_REFERENCE } from "./foodCatalogReference";
import { findCatalogFoodSemantic } from "./catalogSemanticSearch";
import { findTacoFood } from "./tacoLookup";
import { applyOnlineNutritionSourcesToMealItems } from "./nutritionOnlineSourceIntegration";
import type { OnlineNutritionSourceCandidate } from "./nutritionOnlineSource";
import {
  selectCatalogNutritionSource,
  selectEstimatedNutritionSource,
  type NutritionSourceMetadata,
} from "./nutritionSourceMetadata";
import { calculateMealTotals, roundNutritionValue } from "../shared/mealTotals";
import { normalizeMeasurementUnit } from "../shared/measurementUnits";

export type CatalogFood = {
  slug: string;
  name: string;
  aliases: string[];
  servingLabel: string;
  gramsPerServing: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type HabitSnapshot = {
  foodName: string;
  typicalTimeLabel?: string | null;
  notes?: string | null;
  occurrenceCount: number;
};

export type MealDraftItem = {
  foodId?: number;
  portionId?: number;
  portionQuantity?: number;
  foodName: string;
  canonicalName: string;
  quantity: number;
  unit: string;
  portionText: string;
  servings: number;
  estimatedGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  source: "catalog" | "hybrid" | "heuristic";
  nutritionSource?: NutritionSourceMetadata;
};

export type MealProcessingInput = {
  text?: string;
  transcript?: string;
  imageUrl?: string;
  audioUrl?: string;
  habits?: HabitSnapshot[];
  occurredAt?: Date | string | number;
  timeZone?: string;
  suggestedMealLabel?: string | null;
  onlineNutritionSourceCandidates?: OnlineNutritionSourceCandidate[];
};

export type MealProcessingResult = {
  detectedMealLabel: string;
  sourceText: string;
  imageUrl?: string;
  audioUrl?: string;
  transcript?: string;
  confidence: number;
  needsConfirmation: boolean;
  reasoning: string;
  items: MealDraftItem[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
};

type LlmItem = {
  foodName: string;
  quantity?: number;
  unit?: string;
  portionText: string;
  servings: number;
  estimatedGrams: number;
  estimatedCalories: number;
  estimatedMacros: {
    protein: number;
    carbs: number;
    fat: number;
  };
  confidence: number;
};

type ParsedFoodText = {
  foodName: string;
  quantity?: number;
  unit?: string;
  portionText?: string;
  estimatedGrams?: number;
};

type ExplicitQuantity = {
  quantity: number;
  unit: string;
  estimatedGrams?: number;
};

type BuildItemsOptions = {
  preferInferredNutrition?: boolean;
};

type AiInputContentItem =
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
      detail: "high";
    };

const mealExtractionSchema = z.object({
  mealLabel: z.string().trim().min(1).max(80),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().trim().min(1).max(2000),
  items: z.array(z.object({
    foodName: z.string().trim().min(1).max(160),
    quantity: z.number().min(0.01).max(5000).optional(),
    unit: z.string().trim().min(1).max(40).optional(),
    portionText: z.string().trim().min(1).max(120),
    servings: z.number().min(0.1).max(20),
    estimatedGrams: z.number().min(0).max(5000),
    estimatedCalories: z.number().min(0).max(10000),
    estimatedMacros: z.object({
      protein: z.number().min(0).max(1000),
      carbs: z.number().min(0).max(1000),
      fat: z.number().min(0).max(1000),
    }),
    confidence: z.number().min(0).max(1),
  })),
});

const mealExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    mealLabel: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reasoning: { type: "string" },
    items: {
      type: "array",
      minItems: 0,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          foodName: { type: "string" },
          quantity: { type: "number", minimum: 0.01, maximum: 5000 },
          unit: { type: "string" },
          portionText: { type: "string" },
          servings: { type: "number", minimum: 0.1, maximum: 20 },
          estimatedGrams: { type: "number", minimum: 0, maximum: 5000 },
          estimatedCalories: { type: "number", minimum: 0, maximum: 10000 },
          estimatedMacros: {
            type: "object",
            additionalProperties: false,
            properties: {
              protein: { type: "number", minimum: 0, maximum: 1000 },
              carbs: { type: "number", minimum: 0, maximum: 1000 },
              fat: { type: "number", minimum: 0, maximum: 1000 },
            },
            required: ["protein", "carbs", "fat"],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: [
          "foodName",
          "quantity",
          "unit",
          "portionText",
          "servings",
          "estimatedGrams",
          "estimatedCalories",
          "estimatedMacros",
          "confidence"
        ],
      },
    },
  },
  required: ["mealLabel", "confidence", "reasoning", "items"],
} as const;

const NON_FOOD_TERMS = [
  "prato",
  "talher",
  "garfo",
  "faca",
  "colher",
  "guardanapo",
  "mesa",
  "bandeja",
  "embalagem",
  "rotulo",
  "rótulo",
  "copo",
  "tigela",
  "pote",
  "panela",
  "travessa",
  "marmita vazia",
  "mesa posta",
  "decoracao",
  "decoração",
];

const CONVERSATIONAL_ONLY_TERMS = new Set([
  "oi",
  "ola",
  "olá",
  "hello",
  "hi",
  "bom dia",
  "boa tarde",
  "boa noite",
  "tudo bem",
  "ola tudo bem",
  "olá tudo bem",
  "oi tudo bem",
  "obrigado",
  "obrigada",
  "valeu",
  "teste",
]);

const DEFAULT_MEAL_LABEL_BY_TIME = [
  { mealLabel: "Café da manhã", startTime: "05:00", endTime: "10:59" },
  { mealLabel: "Almoço", startTime: "11:00", endTime: "14:59" },
  { mealLabel: "Lanche da tarde", startTime: "15:00", endTime: "17:29" },
  { mealLabel: "Pré-treino", startTime: "17:30", endTime: "18:29" },
  { mealLabel: "Jantar", startTime: "18:30", endTime: "22:59" },
  { mealLabel: "Ceia", startTime: "23:00", endTime: "04:59" },
] as const;

const KNOWN_NUTRITION_BRANDS = [
  "coca cola",
  "molico",
  "nestle",
  "panco",
  "polenghi",
  "wickbold",
];

const CRITICAL_NUTRITION_VARIATIONS = [
  "zero",
  "sem acucar",
  "diet",
  "light",
  "integral",
  "desnatado",
  "tradicional",
];

const GENERIC_ESTIMATED_FOOD_REFERENCE: CatalogFood = {
  slug: "generic-food-estimate",
  name: "Alimento estimado",
  aliases: [],
  servingLabel: "100 g",
  gramsPerServing: 100,
  calories: 150,
  protein: 6,
  carbs: 15,
  fat: 5,
};

const BAKERY_BREAD_REFERENCE: CatalogFood = {
  slug: "bakery-bread-estimate",
  name: "Pão de padaria",
  aliases: ["pão", "pão caseiro", "pão comum", "pão artesanal", "pão da fazenda"],
  servingLabel: "100 g",
  gramsPerServing: 100,
  calories: 300,
  protein: 8,
  carbs: 56,
  fat: 4,
};

const QUANTITY_UNIT_PATTERN = "g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?|un|unidades?|fatias?|colheres? de sopa|colheres? de ch[aá]|x[ií]caras?|copos?|doses?|scoops?|long\\s*neck|longneck|latas?|garrafas?|por[cç][oõ]es?|por[cç][aã]o";

export class MealInferenceError extends Error {
  constructor(message = "Não foi possível gerar um rascunho revisável para esta refeição agora.") {
    super(message);
    this.name = "MealInferenceError";
  }
}

export { FOOD_CATALOG_REFERENCE } from "./foodCatalogReference";

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeForMatching(value: string) {
  return ` ${normalizeText(value).replace(/-/g, " ").replace(/\s+/g, " ")} `;
}

function inferNutritionBrand(value: string) {
  const normalized = normalizeText(value).replace(/-/g, " ").replace(/\s+/g, " ");
  return KNOWN_NUTRITION_BRANDS.find(brand => normalized.includes(brand)) ?? null;
}

function inferNutritionVariation(value: string) {
  const normalized = normalizeText(value).replace(/-/g, " ").replace(/\s+/g, " ");
  return CRITICAL_NUTRITION_VARIATIONS.find(variation => normalized.includes(variation)) ?? null;
}

function buildNutritionSourceQuery(foodName: string, unit: string) {
  return {
    foodName,
    brandName: inferNutritionBrand(foodName),
    variation: inferNutritionVariation(foodName),
    unit,
  };
}

function sourceMentionsFood(sourceText: string, foodName: string) {
  const source = normalizeForMatching(sourceText);
  const candidates = new Set<string>();
  const cleanedFoodName = cleanFoodName(foodName);

  const catalogFood = findCatalogFood(cleanedFoodName) ?? findTacoFood(cleanedFoodName);
  candidates.add(cleanedFoodName);
  if (catalogFood) {
    candidates.add(catalogFood.name);
    catalogFood.aliases.forEach(alias => candidates.add(alias));
  }

  const phraseMatch = Array.from(candidates).some(candidate => {
    const normalizedCandidate = normalizeForMatching(candidate).trim();
    return normalizedCandidate.length >= 2 && source.includes(` ${normalizedCandidate} `);
  });
  if (phraseMatch) return true;

  const keywords = normalizeText(cleanedFoodName).split(/\s+/).filter(w => w.length >= 3);
  if (keywords.length > 0 && keywords.every(word => source.includes(word))) {
    return true;
  }

  return false;
}

function cleanFoodName(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDecimalNumber(value: string) {
  return Number(value.replace(",", "."));
}

function normalizeUnit(value: string) {
  if (!value) return "porção";
  return normalizeMeasurementUnit(value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

function formatQuantityForPortion(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function buildPortionText(quantity: number, unit: string) {
  return `${formatQuantityForPortion(quantity)} ${unit}`;
}

function estimateGramsFromQuantity(quantity: number, unit: string) {
  switch (normalizeUnit(unit)) {
    case "kg":
      return quantity * 1000;
    case "mg":
      return quantity / 1000;
    case "g":
    case "ml":
      return quantity;
    case "l":
      return quantity * 1000;
    default:
      return undefined;
  }
}

function parseFoodText(value: string): ParsedFoodText {
  const cleaned = cleanFoodName(value);
  const quantityPattern = `(\\d+(?:[,.]\\d+)?)\\s*(${QUANTITY_UNIT_PATTERN})`;
  const leadingMatch = cleaned.match(new RegExp(`^${quantityPattern}\\s+(?:de\\s+)?(.+)$`, "i"));
  const trailingMatch = cleaned.match(new RegExp(`^(.+?)\\s+${quantityPattern}$`, "i"));
  const match = leadingMatch || trailingMatch;

  if (!match) {
    return { foodName: cleaned };
  }

  const quantity = parseDecimalNumber(leadingMatch ? match[1] : match[2]);
  const unit = normalizeUnit(leadingMatch ? match[2] : match[3]);
  const foodName = cleanFoodName(leadingMatch ? match[3] : match[1]);

  if (!foodName || Number.isNaN(quantity) || quantity <= 0) {
    return { foodName: cleaned };
  }

  const estimatedGrams = estimateGramsFromQuantity(quantity, unit);

  return {
    foodName,
    quantity: roundNutritionValue(quantity),
    unit,
    portionText: buildPortionText(roundNutritionValue(quantity), unit),
    estimatedGrams: estimatedGrams === undefined ? undefined : roundNutritionValue(estimatedGrams),
  };
}

function extractExplicitQuantities(sourceText: string): ExplicitQuantity[] {
  const matches = Array.from(sourceText.matchAll(new RegExp(`(\\d+(?:[,.]\\d+)?)\\s*(${QUANTITY_UNIT_PATTERN})\\b`, "gi")));
  return matches
    .map(match => {
      const quantity = parseDecimalNumber(match[1]);
      const unit = normalizeUnit(match[2]);
      const estimatedGrams = estimateGramsFromQuantity(quantity, unit);
      return {
        quantity: roundNutritionValue(quantity),
        unit,
        estimatedGrams: estimatedGrams === undefined ? undefined : roundNutritionValue(estimatedGrams),
      };
    })
    .filter(item => Number.isFinite(item.quantity) && item.quantity > 0);
}

function normalizeLlmItem(item: LlmItem): LlmItem {
  const parsed = parseFoodText(item.foodName);
  const quantityFromItem = Number(item.quantity);
  const quantity = parsed.quantity
    ?? (Number.isFinite(quantityFromItem) && quantityFromItem > 0 ? quantityFromItem : 1);
  const unit = normalizeUnit(parsed.unit ?? item.unit ?? "porção");
  const estimatedFromQuantity = estimateGramsFromQuantity(quantity, unit);
  const estimatedGrams = parsed.estimatedGrams ?? (item.estimatedGrams > 0 ? item.estimatedGrams : (estimatedFromQuantity ?? 0));

  return {
    ...item,
    foodName: parsed.foodName || cleanFoodName(item.foodName),
    quantity,
    unit,
    portionText: parsed.portionText ?? item.portionText ?? buildPortionText(quantity, unit),
    servings: parsed.estimatedGrams ? Math.max(parsed.estimatedGrams / 100, 0.25) : item.servings,
    estimatedGrams,
  };
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours * 60) + minutes;
}

function isTimeWithinRange(timeMinutes: number, startTime: string, endTime: string) {
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  if (start <= end) {
    return timeMinutes >= start && timeMinutes <= end;
  }

  return timeMinutes >= start || timeMinutes <= end;
}

function parseDateInput(value: MealProcessingInput["occurredAt"]) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  return new Date();
}

function getLocalTimeMinutes(date: Date, timeZone = "America/Sao_Paulo") {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? "0");
  return (hour * 60) + minute;
}

function inferMealLabelByTime(occurredAt: MealProcessingInput["occurredAt"], timeZone?: string) {
  const timeMinutes = getLocalTimeMinutes(parseDateInput(occurredAt), timeZone);
  return DEFAULT_MEAL_LABEL_BY_TIME.find(schedule =>
    isTimeWithinRange(timeMinutes, schedule.startTime, schedule.endTime),
  )?.mealLabel ?? "Refeição registrada";
}

function findExplicitMealLabel(sourceText: string) {
  const normalized = normalizeText(sourceText).replace(/-/g, " ").replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if (/\b(pre treino|pretreino)\b/.test(normalized)) {
    return "Pré-treino";
  }
  if (/\b(pos treino|postreino)\b/.test(normalized)) {
    return "Pós-treino";
  }
  if (/\b(cafe da manha|cafe de manha|desjejum)\b/.test(normalized)) {
    return "Café da manhã";
  }
  if (/\balmoco\b/.test(normalized)) {
    return "Almoço";
  }
  if (/\b(jantar|janta)\b/.test(normalized)) {
    return "Jantar";
  }
  if (normalized === "lanche da tarde") {
    return "Lanche da tarde";
  }
  if (/\blanche\b/.test(normalized)) {
    return "Lanche";
  }
  if (/\bceia\b/.test(normalized)) {
    return "Ceia";
  }

  return null;
}

function resolveMealLabel(input: MealProcessingInput, sourceText: string) {
  const explicitMealLabel = findExplicitMealLabel(sourceText);
  if (explicitMealLabel) {
    return explicitMealLabel;
  }

  return input.suggestedMealLabel?.trim() || inferMealLabelByTime(input.occurredAt, input.timeZone);
}

function findCatalogFood(foodName: string) {
  const normalized = normalizeText(cleanFoodName(foodName));
  const catalogSource = getCatalogCache();
  return (
    catalogSource.find(item =>
      [item.name, ...item.aliases].some(alias => normalizeText(alias) === normalized),
    ) ||
    catalogSource.find(item =>
      [item.name, ...item.aliases].some(alias => normalized.includes(normalizeText(alias)) || normalizeText(alias).includes(normalized)),
    )
  );
}

function clampConfidence(value: number) {
  return Math.min(Math.max(value || 0.6, 0.1), 0.99);
}

function parseQuantityUnitFromPortionText(portionText: string) {
  const match = portionText.trim().match(/^(\d+(?:[,.]\d+)?)(?:\s+(.+))?$/u);
  if (!match) {
    return null;
  }

  const quantity = Number(match[1].replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  return {
    quantity,
    unit: match[2]?.trim() || "porção",
  };
}

function buildItemFromCatalog(food: CatalogFood, llmItem: LlmItem): MealDraftItem {
  const servings = Math.max(llmItem.servings || 1, 0.25);
  const estimatedGrams = llmItem.estimatedGrams > 0
    ? llmItem.estimatedGrams
    : food.gramsPerServing * servings;
  const factor = estimatedGrams / food.gramsPerServing;
  const portionText = llmItem.portionText || food.servingLabel;
  const quantityUnit = parseQuantityUnitFromPortionText(portionText) ?? {
    quantity: roundNutritionValue(estimatedGrams),
    unit: "g",
  };
  const llmQuantity = Number(llmItem.quantity);
  const quantity = Number.isFinite(llmQuantity) && llmQuantity > 0
    ? roundNutritionValue(llmQuantity)
    : quantityUnit.quantity;
  const unit = normalizeUnit(llmItem.unit || quantityUnit.unit);

  return {
    foodName: llmItem.foodName,
    canonicalName: food.name,
    portionText,
    quantity,
    unit,
    servings,
    estimatedGrams: roundNutritionValue(estimatedGrams),
    calories: roundNutritionValue(food.calories * factor),
    protein: roundNutritionValue(food.protein * factor),
    carbs: roundNutritionValue(food.carbs * factor),
    fat: roundNutritionValue(food.fat * factor),
    confidence: clampConfidence(llmItem.confidence),
    source: "catalog",
    nutritionSource: selectCatalogNutritionSource({
      query: buildNutritionSourceQuery(llmItem.foodName, unit),
      food,
    }),
  };
}

function buildHybridItem(llmItem: LlmItem): MealDraftItem {
  const quantityUnit = parseQuantityUnitFromPortionText(llmItem.portionText) ?? {
    quantity: Math.max(llmItem.servings || 1, 0.25),
    unit: "porção",
  };
  const llmQuantity = Number(llmItem.quantity);
  const quantity = Number.isFinite(llmQuantity) && llmQuantity > 0
    ? roundNutritionValue(llmQuantity)
    : quantityUnit.quantity;
  const unit = normalizeUnit(llmItem.unit || quantityUnit.unit);

  return {
    foodName: llmItem.foodName,
    canonicalName: llmItem.foodName,
    portionText: llmItem.portionText,
    quantity,
    unit,
    servings: Math.max(llmItem.servings || 1, 0.25),
    estimatedGrams: roundNutritionValue(Math.max(llmItem.estimatedGrams || 0, 0)),
    calories: roundNutritionValue(llmItem.estimatedCalories),
    protein: roundNutritionValue(llmItem.estimatedMacros.protein),
    carbs: roundNutritionValue(llmItem.estimatedMacros.carbs),
    fat: roundNutritionValue(llmItem.estimatedMacros.fat),
    confidence: clampConfidence(llmItem.confidence),
    source: "hybrid",
    nutritionSource: selectEstimatedNutritionSource({
      query: buildNutritionSourceQuery(llmItem.foodName, unit),
      foodName: llmItem.foodName,
      sourceType: "llm_estimate",
    }),
  };
}

function hasUsableNutrition(item: LlmItem) {
  return item.estimatedCalories > 0
    || item.estimatedMacros.protein > 0
    || item.estimatedMacros.carbs > 0
    || item.estimatedMacros.fat > 0;
}

function isLikelyBakeryBreadProduct(foodName: string) {
  const normalized = normalizeText(cleanFoodName(foodName)).replace(/-/g, " ").replace(/\s+/g, " ");
  if (!/\bpao\b/.test(normalized)) {
    return false;
  }

  return !/\bpao de queijo\b/.test(normalized);
}

function resolveEstimatedNutritionReference(
  item: LlmItem,
  similarFood?: CatalogFood,
): { reference: CatalogFood; confidenceCap: number } {
  if (isLikelyBakeryBreadProduct(item.foodName)) {
    return { reference: BAKERY_BREAD_REFERENCE, confidenceCap: 0.72 };
  }
  if (similarFood) {
    return { reference: similarFood, confidenceCap: 0.65 };
  }
  return { reference: { ...GENERIC_ESTIMATED_FOOD_REFERENCE, name: item.foodName }, confidenceCap: 0.55 };
}

function buildEstimatedNutritionFallbackItem(llmItem: LlmItem, similarFood?: CatalogFood): MealDraftItem {
  const { reference, confidenceCap } = resolveEstimatedNutritionReference(llmItem, similarFood);
  const item = buildItemFromCatalog(reference, {
    ...llmItem,
    estimatedCalories: reference.calories,
    estimatedMacros: {
      protein: reference.protein,
      carbs: reference.carbs,
      fat: reference.fat,
    },
    confidence: Math.min(clampConfidence(llmItem.confidence), confidenceCap),
  });

  return {
    ...item,
    source: "heuristic",
    nutritionSource: selectEstimatedNutritionSource({
      query: buildNutritionSourceQuery(llmItem.foodName, item.unit),
      foodName: reference.name,
      sourceType: "generic_estimate",
    }),
  };
}

function applyExplicitSingleGramQuantity(items: MealDraftItem[], sourceText: string) {
  const explicitQuantities = extractExplicitQuantities(sourceText);
  if (items.length !== 1 || explicitQuantities.length !== 1) {
    return items;
  }

  const [item] = items;
  const [explicit] = explicitQuantities;
  const nextEstimatedGrams = explicit.estimatedGrams ?? item.estimatedGrams;
  const currentGrams = item.estimatedGrams > 0 ? item.estimatedGrams : nextEstimatedGrams;
  const factor = nextEstimatedGrams && currentGrams > 0 ? nextEstimatedGrams / currentGrams : 1;

  return [{
    ...item,
    quantity: explicit.quantity,
    unit: explicit.unit,
    portionText: buildPortionText(explicit.quantity, explicit.unit),
    estimatedGrams: nextEstimatedGrams,
    servings: nextEstimatedGrams ? Math.max(nextEstimatedGrams / 100, 0.25) : item.servings,
    calories: roundNutritionValue(item.calories * factor),
    protein: roundNutritionValue(item.protein * factor),
    carbs: roundNutritionValue(item.carbs * factor),
    fat: roundNutritionValue(item.fat * factor),
  }];
}

function buildHeuristicItem(foodName: string): MealDraftItem {
  const parsed = parseFoodText(foodName);
  const catalog = findCatalogFood(parsed.foodName)
    ?? findTacoFood(parsed.foodName);
  const quantity = parsed.quantity ?? 1;
  const unit = parsed.unit ?? "porção";
  const estimatedGrams = parsed.estimatedGrams ?? 100;

  if (catalog) {
    return buildItemFromCatalog(catalog, {
      foodName: parsed.foodName,
      quantity,
      unit,
      portionText: parsed.portionText ?? catalog.servingLabel,
      servings: parsed.estimatedGrams ? parsed.estimatedGrams / catalog.gramsPerServing : 1,
      estimatedGrams: parsed.estimatedGrams ?? catalog.gramsPerServing,
      estimatedCalories: catalog.calories,
      estimatedMacros: {
        protein: catalog.protein,
        carbs: catalog.carbs,
        fat: catalog.fat,
      },
      confidence: parsed.estimatedGrams ? 0.55 : 0.45,
    });
  }

  const factor = estimatedGrams / 100;

  return {
    foodName: parsed.foodName,
    canonicalName: parsed.foodName,
    quantity,
    unit,
    portionText: parsed.portionText ?? "1 porção",
    servings: Math.max(factor, 0.25),
    estimatedGrams: roundNutritionValue(estimatedGrams),
    calories: roundNutritionValue(150 * factor),
    protein: roundNutritionValue(6 * factor),
    carbs: roundNutritionValue(15 * factor),
    fat: roundNutritionValue(5 * factor),
    confidence: parsed.estimatedGrams ? 0.45 : 0.35,
    source: "heuristic",
    nutritionSource: selectEstimatedNutritionSource({
      query: buildNutritionSourceQuery(parsed.foodName, unit),
      foodName: parsed.foodName,
      sourceType: "generic_estimate",
    }),
  };
}

function isConversationalOnlyText(value: string) {
  const normalized = normalizeText(value).replace(/-/g, " ").replace(/\s+/g, " ");
  return !normalized || CONVERSATIONAL_ONLY_TERMS.has(normalized);
}

function fallbackFromText(sourceText: string): MealDraftItem[] {
  const parts = sourceText
    .split(/,|\be\b|\+|\n/gi)
    .map(value => value.trim())
    .filter(value => value && !isConversationalOnlyText(value));

  if (parts.length === 0) {
    return [];
  }

  return parts.map(buildHeuristicItem);
}

function sumTotals(items: MealDraftItem[]) {
  return calculateMealTotals(items);
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function habitsToPrompt(habits: HabitSnapshot[] = []) {
  if (!habits.length) {
    return "Sem histórico prévio relevante do usuário.";
  }

  return habits
    .slice(0, 8)
    .map(habit => `${habit.foodName} | frequência: ${habit.occurrenceCount} | horário típico: ${habit.typicalTimeLabel ?? "não informado"} | observações: ${habit.notes ?? "-"}`)
    .join("\n");
}

function isLikelyNonFoodNoise(item: MealDraftItem) {
  const normalizedName = normalizeText(`${item.foodName} ${item.canonicalName}`);
  if (isConversationalOnlyText(item.foodName) || isConversationalOnlyText(item.canonicalName)) {
    return true;
  }

  return NON_FOOD_TERMS.some(term => {
    const normalizedTerm = normalizeText(term);
    return normalizedName === normalizedTerm || normalizedName.includes(normalizedTerm);
  });
}

function cleanMealItems(items: MealDraftItem[]) {
  const deduplicated = new Map<string, MealDraftItem>();

  for (const item of items) {
    if (item.confidence < 0.25 || isLikelyNonFoodNoise(item)) {
      continue;
    }

    const key = normalizeText(`${item.canonicalName || item.foodName} ${item.foodName}`);
    const current = deduplicated.get(key);
    if (!current || item.confidence > current.confidence) {
      deduplicated.set(key, item);
    }
  }

  return Array.from(deduplicated.values());
}

async function extractWithAi(input: MealProcessingInput): Promise<z.infer<typeof mealExtractionSchema> | null> {
  const composedText = [input.text?.trim(), input.transcript?.trim()].filter(Boolean).join("\n");
  const suggestedMealLabel = input.suggestedMealLabel?.trim() || inferMealLabelByTime(input.occurredAt, input.timeZone);
  const content: AiInputContentItem[] = [
    {
      type: "input_text",
      text: [
        "Analise a refeição do usuário e extraia itens alimentares para registro nutricional revisável.",
        `Texto disponível: ${composedText || "não informado"}`,
        `Rótulo sugerido pelo horário: ${suggestedMealLabel}`,
        `Histórico relevante do usuário:\n${habitsToPrompt(input.habits)}`,
        "Retorne apenas JSON válido no schema solicitado.",
        "Inclua somente alimentos ou bebidas explicitamente mencionados, fotografados ou claramente visíveis.",
        "Se a mensagem tiver apenas saudação, conversa genérica ou texto sem alimento, retorne items como lista vazia e confidence baixo.",
        "Se a imagem não mostrar alimento ou bebida consumível com segurança suficiente, retorne items como lista vazia, confidence baixo e explique a incerteza no reasoning.",
        "Use o histórico apenas para calibrar porções de alimentos já mencionados ou claramente visíveis; nunca inclua alimentos apenas porque aparecem nos hábitos do usuário.",
        "Em fotos de embalagem, pote, rótulo, etiqueta ou balança, identifique no máximo os alimentos consumíveis claramente visíveis ou rotulados; não transforme a cena em uma refeição completa.",
        "Separe quantidade, unidade e alimento quando o usuário escrever algo como '140g Carne moída suína': quantity deve ser 140, unit deve ser 'g', foodName deve ser apenas 'Carne moída suína' e portionText deve ser derivado como '140 g'.",
        "Para exemplos como '300g amendoim japonês', '330ml cerveja', '2 fatias pão' e '1 long neck', nunca coloque a quantidade ou unidade em foodName; preserve marcas no nome do produto quando forem parte da identidade.",
        "Normalize unidades comuns: grama/gramas/gr como g, mililitro/mililitros como ml, litro/litros como l, fatias como fatia e longneck como long neck.",
        "Não inclua prato, talheres, mesa, embalagem, rótulo, marca isolada, decoração ou itens inferidos apenas por hábito.",
        "Quando houver foto de rótulo ou tabela nutricional, use os valores da tabela para calorias, proteína, carboidratos e gorduras; não substitua por valores genéricos de catálogo.",
        "Quando usar tabela nutricional visível, cite isso no campo reasoning.",
        "Se o usuário informar quantidade junto da foto, registre exatamente essa quantidade em quantity, unit, portionText e estimatedGrams quando a unidade permitir conversão; ajuste os macronutrientes proporcionalmente à tabela nutricional.",
        "Quando houver texto legível em embalagem, rótulo, etiqueta de preço ou etiqueta de balança com nome de alimento, use esse texto como identidade principal do item em foodName.",
        "Exemplo obrigatório: se o rótulo legível indicar 'PÃO DE CENOURA', trate o item como 'pão de cenoura' e não substitua por água ou por outro alimento genérico.",
        "Use o rótulo apenas para identificar o alimento real e a porção consumida; não crie itens extras a partir de ingredientes da embalagem.",
        "Nunca transforme lista de ingredientes em itens separados da refeição; ingredientes no rótulo servem apenas como contexto do produto principal.",
        "Se houver peso líquido, peso drenado, peso na etiqueta da balança ou porção declarada visível (ex.: 200 g, 500 ml), use esse valor como porção estimada quando fizer sentido para o item identificado.",
        "Quando reconhecer alimento consumível com segurança, mas sem tabela nutricional visível nem macros confiáveis, não deixe calorias nem macronutrientes zerados; use uma estimativa média proporcional à porção informada e explique que é estimado.",
        "Em foto com embalagem, rótulo ou alimento visível, não use água como fallback apenas por transparência, brilho, reflexo ou plástico translúcido.",
        "Só classifique como água quando houver evidência explícita de água consumida (texto legível contendo 'água' ou recipiente claramente de água sem rótulo de outro alimento).",
        "Não invente totais agregados; detalhe por item com quantidade, unidade, porção, gramas estimados e macronutrientes por item.",
        "Não use nomes de alimentos para inferir o tipo de refeição: café como bebida não significa café da manhã.",
        "Use elementos de referência visual na imagem (como o tamanho do prato, talheres, copos ou as mãos do usuário) para calibrar e estimar com maior precisão o peso em gramas de cada alimento.",
        "Alimentos ricos em amido (arroz, batata, massa, pão) costumam ter maior volume e peso no prato; calibre sua estimativa de gramas levando em conta a densidade típica desses alimentos.",
        "Ao estimar porções, prefira valores em gramas (estimatedGrams) a descrições vagas como '1 porção'; use referências visuais de escala para chegar a um número realista.",
        "Se houver tabela nutricional visível no rótulo, extraia os valores textuais com precisão de OCR — leia cada número individualmente e use-os diretamente em estimatedCalories e estimatedMacros sem arredondamentos desnecessários.",
      ].join("\n"),
    },
  ];

  if (input.imageUrl) {
    content.push({
      type: "input_image",
      image_url: input.imageUrl,
      detail: "high",
    });
  }

  const aiInput: AiProviderTextRequest["input"] = [
    {
      role: "user",
      content,
    },
  ];

  const response = await getAiProvider().createTextResponse({
    model: ENV.openaiModel,
    instructions: "Você é um nutricionista assistente especializado em análise visual de refeições. Identifique apenas alimentos e bebidas consumíveis presentes na entrada, estime porções realistas usando referências visuais de escala (talheres, pratos, copos) e devolva apenas JSON estruturado para um rascunho revisável. Nunca inclua texto fora do JSON. Quando a entrada não mencionar nem mostrar alimento ou bebida com segurança, devolva items como lista vazia em vez de chutar. Priorize quantity e unit separados, mantendo portionText apenas como rótulo derivado.",
    input: aiInput,
    format: {
      type: "json_schema",
      name: "meal_extraction",
      schema: mealExtractionJsonSchema,
      strict: true,
    },
  });

  const parsed = safeJsonParse<unknown>(response.outputText);
  if (!parsed) {
    return null;
  }

  const validation = mealExtractionSchema.safeParse(parsed);
  if (!validation.success) {
    return null;
  }

  return validation.data;
}

async function buildItemsFromInference(items: LlmItem[], options: BuildItemsOptions = {}): Promise<MealDraftItem[]> {
  const results: MealDraftItem[] = [];
  for (const item of items) {
    const normalizedItem = normalizeLlmItem(item);
    let catalog = findCatalogFood(normalizedItem.foodName);
    if (!catalog) {
      catalog = findTacoFood(normalizedItem.foodName) ?? undefined;
    }
    if (!catalog) {
      catalog = await findCatalogFoodSemantic(normalizedItem.foodName) ?? undefined;
    }
    if (catalog && !options.preferInferredNutrition) {
      results.push(buildItemFromCatalog(catalog, normalizedItem));
    } else if (!hasUsableNutrition(normalizedItem)) {
      results.push(buildEstimatedNutritionFallbackItem(normalizedItem, catalog));
    } else {
      results.push(buildHybridItem(normalizedItem));
    }
  }
  return results;
}

function shouldConstrainAiItemsToText(input: MealProcessingInput, sourceText: string) {
  return Boolean(sourceText) && !input.imageUrl && !input.audioUrl;
}

function reasoningMentionsNutritionLabel(reasoning?: string) {
  return reasoning ? /\b(tabela nutricional|informacao nutricional|informacoes nutricionais|r[oó]tulo|rotulo|label)\b/i.test(reasoning.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) : false;
}

function shouldFallbackToSourceText(extraction: Awaited<ReturnType<typeof extractWithAi>>, sourceText: string) {
  return Boolean(sourceText && extraction && extraction.items.length === 0);
}

export async function processMealInput(input: MealProcessingInput): Promise<MealProcessingResult> {
  const sourceText = [input.text?.trim(), input.transcript?.trim()].filter(Boolean).join("\n").trim();
  const detectedMealLabel = resolveMealLabel(input, sourceText);

  let extraction: Awaited<ReturnType<typeof extractWithAi>> = null;
  try {
    extraction = await extractWithAi(input);
  } catch {
    extraction = null;
  }

  const rawItems = !extraction || shouldFallbackToSourceText(extraction, sourceText)
    ? fallbackFromText(sourceText)
    : applyExplicitSingleGramQuantity(await buildItemsFromInference(
      shouldConstrainAiItemsToText(input, sourceText)
        ? extraction.items.filter(item => sourceMentionsFood(sourceText, normalizeLlmItem(item).foodName))
        : extraction.items,
      {
        preferInferredNutrition: Boolean(
          input.imageUrl
          && (extractExplicitQuantities(sourceText).length || reasoningMentionsNutritionLabel(extraction.reasoning))
        ),
      },
    ), sourceText);
  const items = applyOnlineNutritionSourcesToMealItems(
    cleanMealItems(rawItems),
    input.onlineNutritionSourceCandidates,
  );

  if (!items.length) {
    throw new MealInferenceError();
  }

  const totals = sumTotals(items);
  const confidence = extraction && !shouldFallbackToSourceText(extraction, sourceText) ? clampConfidence(extraction.confidence) : items.length ? 0.45 : 0.2;
  const reasoning = shouldFallbackToSourceText(extraction, sourceText)
    ? "A análise visual não identificou itens com segurança; foi aplicada uma heurística a partir do texto informado pelo usuário. Recomenda-se confirmar a inferência antes de salvar."
    : extraction?.reasoning || "Foi aplicada uma heurística de catálogo para estruturar a refeição. Recomenda-se confirmar a inferência antes de salvar.";

  return {
    detectedMealLabel,
    sourceText,
    imageUrl: input.imageUrl,
    audioUrl: input.audioUrl,
    transcript: input.transcript,
    confidence,
    needsConfirmation: true,
    reasoning,
    items,
    totals,
  };
}

export function suggestHabitsFromMeals(items: MealDraftItem[]) {
  return items.map(item => ({
    foodName: item.canonicalName,
    preferredPortionGrams: item.estimatedGrams,
    notes: `Porção confirmada recentemente: ${item.portionText}`,
  }));
}
