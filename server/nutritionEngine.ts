import { z } from "zod";
import { getAiProvider } from "./_core/aiProvider";
import { ENV } from "./_core/env";
import { getCatalogCache } from "./catalogRuntime";
import { FOOD_CATALOG_REFERENCE } from "./foodCatalogReference";
import { calculateMealTotals, roundNutritionValue } from "../shared/mealTotals";

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
  foodName: string;
  canonicalName: string;
  portionText: string;
  servings: number;
  estimatedGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  source: "catalog" | "hybrid" | "heuristic";
};

export type MealProcessingInput = {
  text?: string;
  transcript?: string;
  imageUrl?: string;
  audioUrl?: string;
  habits?: HabitSnapshot[];
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

const mealExtractionSchema = z.object({
  mealLabel: z.string().trim().min(1).max(80),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().trim().min(1).max(2000),
  items: z.array(z.object({
    foodName: z.string().trim().min(1).max(160),
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
  })).min(1).max(10),
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
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          foodName: { type: "string" },
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

function guessMealLabel(sourceText: string) {
  const normalized = normalizeText(sourceText);
  if (normalized.includes("cafe") || normalized.includes("café") || normalized.includes("manha")) {
    return "Café da manhã";
  }
  if (normalized.includes("almoco") || normalized.includes("almoço")) {
    return "Almoço";
  }
  if (normalized.includes("janta") || normalized.includes("jantar")) {
    return "Jantar";
  }
  if (normalized.includes("lanche")) {
    return "Lanche";
  }
  return "Refeição registrada";
}

function findCatalogFood(foodName: string) {
  const normalized = normalizeText(foodName);
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

function buildItemFromCatalog(food: CatalogFood, llmItem: LlmItem): MealDraftItem {
  const servings = Math.max(llmItem.servings || 1, 0.25);
  const estimatedGrams = llmItem.estimatedGrams > 0
    ? llmItem.estimatedGrams
    : food.gramsPerServing * servings;
  const factor = estimatedGrams / food.gramsPerServing;

  return {
    foodName: llmItem.foodName,
    canonicalName: food.name,
    portionText: llmItem.portionText || food.servingLabel,
    servings,
    estimatedGrams: roundNutritionValue(estimatedGrams),
    calories: roundNutritionValue(food.calories * factor),
    protein: roundNutritionValue(food.protein * factor),
    carbs: roundNutritionValue(food.carbs * factor),
    fat: roundNutritionValue(food.fat * factor),
    confidence: clampConfidence(llmItem.confidence),
    source: "catalog",
  };
}

function buildHybridItem(llmItem: LlmItem): MealDraftItem {
  return {
    foodName: llmItem.foodName,
    canonicalName: llmItem.foodName,
    portionText: llmItem.portionText,
    servings: Math.max(llmItem.servings || 1, 0.25),
    estimatedGrams: roundNutritionValue(Math.max(llmItem.estimatedGrams || 0, 0)),
    calories: roundNutritionValue(llmItem.estimatedCalories),
    protein: roundNutritionValue(llmItem.estimatedMacros.protein),
    carbs: roundNutritionValue(llmItem.estimatedMacros.carbs),
    fat: roundNutritionValue(llmItem.estimatedMacros.fat),
    confidence: clampConfidence(llmItem.confidence),
    source: "hybrid",
  };
}

function buildHeuristicItem(foodName: string): MealDraftItem {
  const catalog = findCatalogFood(foodName);
  if (catalog) {
    return buildItemFromCatalog(catalog, {
      foodName,
      portionText: catalog.servingLabel,
      servings: 1,
      estimatedGrams: catalog.gramsPerServing,
      estimatedCalories: catalog.calories,
      estimatedMacros: {
        protein: catalog.protein,
        carbs: catalog.carbs,
        fat: catalog.fat,
      },
      confidence: 0.45,
    });
  }

  return {
    foodName,
    canonicalName: foodName,
    portionText: "1 porção",
    servings: 1,
    estimatedGrams: 100,
    calories: 150,
    protein: 6,
    carbs: 15,
    fat: 5,
    confidence: 0.35,
    source: "heuristic",
  };
}

function fallbackFromText(sourceText: string): MealDraftItem[] {
  const parts = sourceText
    .split(/,|\be\b|\+|\n/gi)
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 8);

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

async function extractWithAi(input: MealProcessingInput): Promise<z.infer<typeof mealExtractionSchema> | null> {
  const composedText = [input.text?.trim(), input.transcript?.trim()].filter(Boolean).join("\n");
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: [
        "Analise a refeição do usuário e extraia itens alimentares para registro nutricional revisável.",
        `Texto disponível: ${composedText || "não informado"}`,
        `Histórico relevante do usuário:\n${habitsToPrompt(input.habits)}`,
        "Retorne apenas JSON válido no schema solicitado.",
        "Não invente totais agregados; detalhe por item com porção, gramas estimados e macronutrientes por item.",
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

  const response = await getAiProvider().createTextResponse({
    model: ENV.openaiModel,
    instructions: "Você é um nutricionista assistente. Identifique alimentos, estime porções realistas e devolva apenas JSON estruturado para um rascunho revisável. Nunca inclua texto fora do JSON.",
    input: [
      {
        role: "user",
        content,
      },
    ],
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

function buildItemsFromInference(items: LlmItem[]) {
  return items.map(item => {
    const catalog = findCatalogFood(item.foodName);
    if (catalog) {
      return buildItemFromCatalog(catalog, item);
    }
    return buildHybridItem(item);
  });
}

export async function processMealInput(input: MealProcessingInput): Promise<MealProcessingResult> {
  const sourceText = [input.text?.trim(), input.transcript?.trim()].filter(Boolean).join("\n").trim();
  const initialMealLabel = guessMealLabel(sourceText);

  let extraction: Awaited<ReturnType<typeof extractWithAi>> = null;
  try {
    extraction = await extractWithAi(input);
  } catch {
    extraction = null;
  }

  const items = extraction
    ? buildItemsFromInference(extraction.items)
    : fallbackFromText(sourceText);

  if (!items.length) {
    throw new MealInferenceError();
  }

  const totals = sumTotals(items);
  const confidence = extraction ? clampConfidence(extraction.confidence) : items.length ? 0.45 : 0.2;
  const reasoning = extraction?.reasoning || "Foi aplicada uma heurística de catálogo para estruturar a refeição. Recomenda-se confirmar a inferência antes de salvar.";

  return {
    detectedMealLabel: extraction?.mealLabel || initialMealLabel,
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
