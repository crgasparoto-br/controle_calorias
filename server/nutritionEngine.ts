import { findCatalogFoodSemantic } from "./catalogSemanticSearch";
import { findCatalogFood, sourceMentionsFood } from "./catalogMatching";
import { extractWithAi } from "./mealAiExtraction";
import { resolveMealLabel } from "./mealLabelResolver";
import {
  applyExplicitSingleGramQuantity,
  buildEstimatedNutritionFallbackItem,
  buildHybridItem,
  buildItemFromCatalog,
  hasUsableNutrition,
} from "./mealItemBuilders";
import { cleanMealItems, fallbackFromText, sumTotals } from "./mealItemCleanup";
import { extractExplicitQuantities, normalizeForMatching, normalizeLlmItem } from "./mealTextParsing";
import { findTacoFood } from "./tacoLookup";
import type {
  BuildItemsOptions,
  LlmItem,
  MealDraftItem,
  MealProcessingInput,
  MealProcessingResult,
} from "./nutritionEngineTypes";

export type {
  BuildItemsOptions,
  CatalogFood,
  ExplicitQuantity,
  HabitSnapshot,
  IntentHint,
  LlmItem,
  MealDraftItem,
  MealProcessingInput,
  MealProcessingResult,
  ParsedFoodText,
} from "./nutritionEngineTypes";

export { FOOD_CATALOG_REFERENCE } from "./foodCatalogReference";

export class MealInferenceError extends Error {
  constructor(message = "Não foi possível gerar um rascunho revisável para esta refeição agora.") {
    super(message);
    this.name = "MealInferenceError";
  }
}

function clampConfidence(value: number) {
  return Math.min(Math.max(value || 0.6, 0.1), 0.99);
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

function splitSourceFoodSegments(sourceText: string) {
  return sourceText
    .split(/\s*[;,]\s*|\s*\+\s*|\n+|\s+\be\s+/gi)
    .map(segment => segment.trim())
    .filter(Boolean);
}

function includesNormalizedPhrase(haystack: string, needle: string) {
  const normalizedNeedle = normalizeForMatching(needle).trim();
  if (!normalizedNeedle) return false;
  return normalizeForMatching(haystack).includes(` ${normalizedNeedle} `);
}

function isLikelyPreparationIngredientReduction(sourceText: string, foodName: string) {
  const normalizedFood = normalizeForMatching(foodName).trim();
  if (!normalizedFood) return false;

  return splitSourceFoodSegments(sourceText).some(segment => {
    const normalizedSegment = normalizeForMatching(segment).trim();
    if (!normalizedSegment || normalizedSegment === normalizedFood) return false;
    if (!includesNormalizedPhrase(segment, foodName)) return false;

    const connectorIndex = normalizedSegment.indexOf(" com ");
    if (connectorIndex < 0) return false;

    const beforeConnector = normalizedSegment.slice(0, connectorIndex).trim();
    const afterConnector = normalizedSegment.slice(connectorIndex + " com ".length).trim();
    return Boolean(beforeConnector)
      && afterConnector.includes(normalizedFood)
      && !beforeConnector.includes(normalizedFood);
  });
}

function filterAiItemsBySourceText(items: LlmItem[], sourceText: string) {
  return items.filter(item => {
    const normalizedItem = normalizeLlmItem(item);
    return sourceMentionsFood(sourceText, normalizedItem.foodName)
      && !isLikelyPreparationIngredientReduction(sourceText, normalizedItem.foodName);
  });
}

function reasoningMentionsNutritionLabel(reasoning?: string) {
  if (!reasoning) {
    return false;
  }

  const normalized = reasoning
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/\b(sem|nao|não|ausente|indisponivel|ilegivel|ilegível)\b[^.]{0,60}\b(tabela nutricional|informacao nutricional|informacoes nutricionais|rotulo|label)\b/.test(normalized)) {
    return false;
  }
  if (/\b(tabela nutricional|informacao nutricional|informacoes nutricionais|rotulo|label)\b[^.]{0,60}\b(nao|não|ausente|indisponivel|ilegivel|ilegível)\b/.test(normalized)) {
    return false;
  }

  return /\b(tabela nutricional|informacao nutricional|informacoes nutricionais|rotulo|label)\b/i.test(normalized);
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

  let usedSourceTextFallback = !extraction || shouldFallbackToSourceText(extraction, sourceText);
  let rejectedAllAiItems = false;
  let rawItems: MealDraftItem[];

  if (usedSourceTextFallback || !extraction) {
    rawItems = fallbackFromText(sourceText);
  } else {
    const confirmedExtraction = extraction;
    const inferenceItems = shouldConstrainAiItemsToText(input, sourceText)
      ? filterAiItemsBySourceText(confirmedExtraction.items, sourceText)
      : confirmedExtraction.items;

    if (sourceText && confirmedExtraction.items.length > 0 && inferenceItems.length === 0) {
      rejectedAllAiItems = true;
      usedSourceTextFallback = true;
      rawItems = fallbackFromText(sourceText);
    } else {
      rawItems = applyExplicitSingleGramQuantity(await buildItemsFromInference(
        inferenceItems,
        {
          preferInferredNutrition: Boolean(
            input.imageUrl
            && (extractExplicitQuantities(sourceText).length || reasoningMentionsNutritionLabel(confirmedExtraction.reasoning))
          ),
        },
      ), sourceText);
    }
  }

  const items = cleanMealItems(rawItems);

  if (!items.length) {
    throw new MealInferenceError();
  }

  const totals = sumTotals(items);
  const confidence = extraction && !usedSourceTextFallback ? clampConfidence(extraction.confidence) : items.length ? 0.45 : 0.2;
  const reasoning = usedSourceTextFallback
    ? rejectedAllAiItems
      ? "A IA retornou itens incompatíveis com o texto informado; foi aplicada uma heurística a partir da descrição completa para preservar o alimento e sua preparação. Recomenda-se confirmar a inferência antes de salvar."
      : "A análise visual não identificou itens com segurança; foi aplicada uma heurística a partir do texto informado pelo usuário. Recomenda-se confirmar a inferência antes de salvar."
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
