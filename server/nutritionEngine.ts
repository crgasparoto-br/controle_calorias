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
import { extractExplicitQuantities, normalizeLlmItem } from "./mealTextParsing";
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
  const items = cleanMealItems(rawItems);

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
