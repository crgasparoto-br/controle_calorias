import { z } from "zod";
import { getAiProvider, type AiProviderTextRequest } from "./_core/aiProvider";
import { ENV } from "./_core/env";
import { getCatalogCache } from "./catalogRuntime";
import { FOOD_CATALOG_REFERENCE } from "./foodCatalogReference";
import { findCatalogFoodSemantic } from "./catalogSemanticSearch";
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
  occurredAt?: Date | string | number;
  timeZone?: string;
  suggestedMealLabel?: string | null;
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

type ParsedFoodText = {
  foodName: string;
  portionText?: string;
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

const DEFAULT_MEAL_LABEL_BY_TIME = [
  { mealLabel: "Café da manhã", startTime: "05:00", endTime: "10:59" },
  { mealLabel: "Almoço", startTime: "11:00", endTime: "14:59" },
  { mealLabel: "Lanche da tarde", startTime: "15:00", endTime: "17:29" },
  { mealLabel: "Pré-treino", startTime: "17:30", endTime: "18:29" },
  { mealLabel: "Jantar", startTime: "18:30", endTime: "22:59" },
  { mealLabel: "Ceia", startTime: "23:00", endTime: "04:59" },
] as const;

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

function sourceMentionsFood(sourceText: string, foodName: string) {
  const source = normalizeForMatching(sourceText);
  const candidates = new Set<string>();
  const cleanedFoodName = cleanFoodName(foodName);
  const catalogFood = findCatalogFood(cleanedFoodName);

  candidates.add(cleanedFoodName);
  if (catalogFood) {
    candidates.add(catalogFood.name);
    catalogFood.aliases.forEach(alias => candidates.add(alias));
  }

  return Array.from(candidates).some(candidate => {
    const normalizedCandidate = normalizeForMatching(candidate).trim();
    return normalizedCandidate.length >= 2 && source.includes(` ${normalizedCandidate} `);
  });
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

function parseFoodText(value: string): ParsedFoodText {
  const cleaned = cleanFoodName(value);
  const leadingGramsMatch = cleaned.match(/^(\d+(?:[,.]\d+)?)\s*(?:g|gr|grama|gramas)\b\s+(.+)$/i);
  const trailingGramsMatch = cleaned.match(/^(.+?)\s+(\d+(?:[,.]\d+)?)\s*(?:g|gr|grama|gramas)\b$/i);
  const match = leadingGramsMatch || trailingGramsMatch;

  if (!match) {
    return { foodName: cleaned };
  }

  const grams = parseDecimalNumber(leadingGramsMatch ? match[1] : match[2]);
  const foodName = cleanFoodName(leadingGramsMatch ? match[2] : match[1]);

  if (!foodName || Number.isNaN(grams) || grams <= 0) {
    return { foodName: cleaned };
  }

  return {
    foodName,
    portionText: `${roundNutritionValue(grams)} g`,
    estimatedGrams: roundNutritionValue(grams),
  };
}

function extractExplicitGramAmounts(sourceText: string) {
  const matches = Array.from(sourceText.matchAll(/(\d+(?:[,.]\d+)?)\s*(?:g|gr|grama|gramas)\b/gi));
  return matches
    .map(match => parseDecimalNumber(match[1]))
    .filter(value => Number.isFinite(value) && value > 0)
    .map(roundNutritionValue);
}

function normalizeLlmItem(item: LlmItem): LlmItem {
  const parsed = parseFoodText(item.foodName);
  const estimatedGrams = parsed.estimatedGrams ?? item.estimatedGrams;

  return {
    ...item,
    foodName: parsed.foodName || cleanFoodName(item.foodName),
    portionText: parsed.portionText ?? item.portionText,
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
  if (/\blanche da tarde\b/.test(normalized)) {
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

function applyExplicitSingleGramQuantity(items: MealDraftItem[], sourceText: string) {
  const explicitGrams = extractExplicitGramAmounts(sourceText);
  if (items.length !== 1 || explicitGrams.length !== 1) {
    return items;
  }

  const [item] = items;
  const [estimatedGrams] = explicitGrams;
  const currentGrams = item.estimatedGrams > 0 ? item.estimatedGrams : estimatedGrams;
  const factor = currentGrams > 0 ? estimatedGrams / currentGrams : 1;

  return [{
    ...item,
    portionText: `${formatQuantityForPortion(estimatedGrams)} g`,
    estimatedGrams,
    servings: Math.max(estimatedGrams / 100, 0.25),
    calories: roundNutritionValue(item.calories * factor),
    protein: roundNutritionValue(item.protein * factor),
    carbs: roundNutritionValue(item.carbs * factor),
    fat: roundNutritionValue(item.fat * factor),
  }];
}

function formatQuantityForPortion(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function buildHeuristicItem(foodName: string): MealDraftItem {
  const parsed = parseFoodText(foodName);
  const catalog = findCatalogFood(parsed.foodName);
  if (catalog) {
    return buildItemFromCatalog(catalog, {
      foodName: parsed.foodName,
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

  const estimatedGrams = parsed.estimatedGrams ?? 100;
  const factor = estimatedGrams / 100;

  return {
    foodName: parsed.foodName,
    canonicalName: parsed.foodName,
    portionText: parsed.portionText ?? "1 porção",
    servings: Math.max(factor, 0.25),
    estimatedGrams: roundNutritionValue(estimatedGrams),
    calories: roundNutritionValue(150 * factor),
    protein: roundNutritionValue(6 * factor),
    carbs: roundNutritionValue(15 * factor),
    fat: roundNutritionValue(5 * factor),
    confidence: parsed.estimatedGrams ? 0.45 : 0.35,
    source: "heuristic",
  };
}

function fallbackFromText(sourceText: string): MealDraftItem[] {
  const parts = sourceText
    .split(/,|\be\b|\+|\n/gi)
    .map(value => value.trim())
    .filter(Boolean);

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

    const key = normalizeText(item.canonicalName || item.foodName);
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
        "Se a imagem não mostrar alimento ou bebida consumível com segurança suficiente, retorne items como lista vazia, confidence baixo e explique a incerteza no reasoning.",
        "Use o histórico apenas para calibrar porções de alimentos já mencionados ou claramente visíveis; nunca inclua alimentos apenas porque aparecem nos hábitos do usuário.",
        "Em fotos de embalagem, pote, rótulo, etiqueta ou balança, identifique no máximo os alimentos consumíveis claramente visíveis ou rotulados; não transforme a cena em uma refeição completa.",
        "Separe quantidade, unidade e alimento quando o usuário escrever algo como '140g Carne moída suína': foodName deve ser apenas o alimento, portionText deve conter '140 g' e estimatedGrams deve ser 140.",
        "Não inclua prato, talheres, mesa, embalagem, rótulo, marca isolada, decoração ou itens inferidos apenas por hábito.",
        "Quando houver foto de rótulo ou tabela nutricional, use os valores da tabela para calorias, proteína, carboidratos e gorduras; não substitua por valores genéricos de catálogo.",
        "Quando usar tabela nutricional visível, cite isso no campo reasoning.",
        "Se o usuário informar quantidade junto da foto, registre exatamente essa quantidade em portionText e estimatedGrams e ajuste os macronutrientes proporcionalmente à tabela nutricional.",
        "Use o rótulo apenas para identificar o alimento real e a porção consumida; não crie itens extras a partir de ingredientes da embalagem.",
        "Não invente totais agregados; detalhe por item com porção, gramas estimados e macronutrientes por item.",
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
    instructions: "Você é um nutricionista assistente especializado em análise visual de refeições. Identifique apenas alimentos e bebidas consumíveis presentes na entrada, estime porções realistas usando referências visuais de escala (talheres, pratos, copos) e devolva apenas JSON estruturado para um rascunho revisável. Nunca inclua texto fora do JSON. Quando a foto não permitir identificar alimento ou bebida com segurança, devolva items como lista vazia em vez de chutar. Priorize precisão em gramas sobre descrições vagas de porção.",
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
    // 1st pass: fast exact/substring text match (synchronous, zero cost)
    let catalog = findCatalogFood(normalizedItem.foodName);
    // 2nd pass: semantic embedding match when text match misses (async, best-effort)
    if (!catalog) {
      catalog = await findCatalogFoodSemantic(normalizedItem.foodName) ?? undefined;
    }
    if (catalog && !options.preferInferredNutrition) {
      results.push(buildItemFromCatalog(catalog, normalizedItem));
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

export async function processMealInput(input: MealProcessingInput): Promise<MealProcessingResult> {
  const sourceText = [input.text?.trim(), input.transcript?.trim()].filter(Boolean).join("\n").trim();
  const detectedMealLabel = resolveMealLabel(input, sourceText);

  let extraction: Awaited<ReturnType<typeof extractWithAi>> = null;
  try {
    extraction = await extractWithAi(input);
  } catch {
    extraction = null;
  }

  const rawItems = extraction
    ? applyExplicitSingleGramQuantity(await buildItemsFromInference(
      shouldConstrainAiItemsToText(input, sourceText)
        ? extraction.items.filter(item => sourceMentionsFood(sourceText, normalizeLlmItem(item).foodName))
        : extraction.items,
      {
        preferInferredNutrition: Boolean(
          input.imageUrl
          && (extractExplicitGramAmounts(sourceText).length || reasoningMentionsNutritionLabel(extraction.reasoning))
        ),
      },
    ), sourceText)
    : fallbackFromText(sourceText);
  const items = cleanMealItems(rawItems);

  if (!items.length) {
    throw new MealInferenceError();
  }

  const totals = sumTotals(items);
  const confidence = extraction ? clampConfidence(extraction.confidence) : items.length ? 0.45 : 0.2;
  const reasoning = extraction?.reasoning || "Foi aplicada uma heurística de catálogo para estruturar a refeição. Recomenda-se confirmar a inferência antes de salvar.";

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
