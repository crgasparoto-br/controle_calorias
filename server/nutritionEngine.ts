import { invokeLLM } from "./_core/llm";
import { getCatalogCache } from "./catalogRuntime";
import { FOOD_CATALOG_REFERENCE } from "./foodCatalogReference";

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
  estimatedGrams?: number;
  confidence: number;
};

const round = (value: number) => Math.round(value * 10) / 10;

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

function buildItemFromCatalog(food: CatalogFood, llmItem: LlmItem): MealDraftItem {
  const servings = Math.max(llmItem.servings || 1, 0.25);
  const estimatedGrams = llmItem.estimatedGrams && llmItem.estimatedGrams > 0
    ? llmItem.estimatedGrams
    : food.gramsPerServing * servings;
  const factor = estimatedGrams / food.gramsPerServing;

  return {
    foodName: llmItem.foodName,
    canonicalName: food.name,
    portionText: llmItem.portionText || food.servingLabel,
    servings,
    estimatedGrams: round(estimatedGrams),
    calories: round(food.calories * factor),
    protein: round(food.protein * factor),
    carbs: round(food.carbs * factor),
    fat: round(food.fat * factor),
    confidence: Math.min(Math.max(llmItem.confidence || 0.6, 0.1), 0.99),
    source: "catalog",
  };
}

function buildHeuristicItem(foodName: string): MealDraftItem {
  const catalog = findCatalogFood(foodName);
  if (catalog) {
    return buildItemFromCatalog(catalog, {
      foodName,
      portionText: catalog.servingLabel,
      servings: 1,
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
  return items.reduce(
    (acc, item) => {
      acc.calories = round(acc.calories + item.calories);
      acc.protein = round(acc.protein + item.protein);
      acc.carbs = round(acc.carbs + item.carbs);
      acc.fat = round(acc.fat + item.fat);
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
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

async function extractWithLlm(input: MealProcessingInput): Promise<{ items: LlmItem[]; reasoning: string; confidence: number; mealLabel: string } | null> {
  const composedText = [input.text?.trim(), input.transcript?.trim()].filter(Boolean).join("\n");
  const userContent: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }> = [
    {
      type: "text",
      text: [
        "Extraia alimentos e porções de uma refeição para rastreamento nutricional.",
        `Texto disponível: ${composedText || "não informado"}`,
        `Histórico relevante do usuário: ${habitsToPrompt(input.habits)}`,
        "Responda apenas com JSON válido seguindo o schema.",
      ].join("\n"),
    },
  ];

  if (input.imageUrl) {
    userContent.push({
      type: "image_url",
      image_url: {
        url: input.imageUrl,
        detail: "high",
      },
    });
  }

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: "Você é um nutricionista assistente especializado em identificar alimentos, estimar porções realistas e preparar dados estruturados para cálculo determinístico de calorias e macronutrientes.",
      },
      {
        role: "user",
        content: userContent,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meal_extraction",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            mealLabel: { type: "string" },
            confidence: { type: "number" },
            reasoning: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  foodName: { type: "string" },
                  portionText: { type: "string" },
                  servings: { type: "number" },
                  estimatedGrams: { type: "number" },
                  confidence: { type: "number" },
                },
                required: ["foodName", "portionText", "servings", "confidence"],
              },
            },
          },
          required: ["mealLabel", "confidence", "reasoning", "items"],
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (typeof content !== "string") {
    return null;
  }

  const parsed = safeJsonParse<{
    mealLabel: string;
    confidence: number;
    reasoning: string;
    items: LlmItem[];
  }>(content);

  if (!parsed) {
    return null;
  }

  return {
    items: parsed.items || [],
    reasoning: parsed.reasoning || "Inferência gerada pela IA.",
    confidence: parsed.confidence || 0.6,
    mealLabel: parsed.mealLabel || guessMealLabel(composedText),
  };
}

export async function processMealInput(input: MealProcessingInput): Promise<MealProcessingResult> {
  const sourceText = [input.text?.trim(), input.transcript?.trim()].filter(Boolean).join("\n").trim();
  const initialMealLabel = guessMealLabel(sourceText);

  let llmExtraction: Awaited<ReturnType<typeof extractWithLlm>> = null;
  try {
    llmExtraction = await extractWithLlm(input);
  } catch {
    llmExtraction = null;
  }

  const items = (llmExtraction?.items?.length
    ? llmExtraction.items.map(item => {
        const catalog = findCatalogFood(item.foodName);
        if (catalog) {
          return buildItemFromCatalog(catalog, item);
        }
        return buildHeuristicItem(item.foodName);
      })
    : fallbackFromText(sourceText))
    .slice(0, 10);

  const totals = sumTotals(items);
  const confidence = llmExtraction ? Math.min(Math.max(llmExtraction.confidence, 0.1), 0.99) : items.length ? 0.45 : 0.2;
  const reasoning = llmExtraction?.reasoning || "Foi aplicada uma heurística de catálogo para estruturar a refeição. Recomenda-se confirmar a inferência antes de salvar.";

  return {
    detectedMealLabel: llmExtraction?.mealLabel || initialMealLabel,
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
