import { generateImage, type GenerateImageResponse } from "../../_core/imageGeneration";
import { isOpenAiConfigured } from "../../_core/openaiClient";
import type { MealProcessingResult } from "../../nutritionEngine";

function formatMacro(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatFoodDescription(item: MealProcessingResult["items"][number]) {
  const portionHasGrams = /\d\s*g\b/i.test(item.portionText);
  const gramsLabel = !portionHasGrams && item.estimatedGrams > 0 ? ` (aprox. ${formatMacro(item.estimatedGrams)}g)` : "";
  return `${item.portionText}${gramsLabel} ${item.foodName}`.trim();
}

export function imageDataFromDataUrl(dataUrl?: string) {
  const match = dataUrl?.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], b64Json: match[2] };
}

export function buildAnnotatedMealImagePrompt(processed: MealProcessingResult) {
  const labels = processed.items
    .slice(0, 12)
    .map((item, index) => `${index + 1}. ${item.foodName}: ${formatMacro(item.calories)} kcal, P ${formatMacro(item.protein)}g, C ${formatMacro(item.carbs)}g, G ${formatMacro(item.fat)}g`)
    .join("\n");

  return [
    "Edite a foto original da refeição adicionando legendas visuais sobre os alimentos identificados, no estilo de análise nutricional da imagem de referência.",
    "Use etiquetas verdes translúcidas com texto grande e linhas discretas apontando para cada alimento quando fizer sentido.",
    "Cada legenda deve mostrar nome do alimento, calorias e macronutrientes no formato P/C/G em gramas.",
    "Mantenha a foto realista, preserve o prato original e não adicione alimentos novos.",
    "Use texto em português do Brasil, grande e legível em celular.",
    `Itens detectados:\n${labels || "Alimentos identificados na refeição."}`,
  ].join("\n");
}

export function buildMealCardsImagePrompt(processed: MealProcessingResult) {
  const labels = processed.items
    .slice(0, 12)
    .map((item, index) => `${index + 1}. ${item.foodName}: ${formatFoodDescription(item)}, ${formatMacro(item.calories)} kcal, proteína ${formatMacro(item.protein)}g, carboidratos ${formatMacro(item.carbs)}g, gorduras ${formatMacro(item.fat)}g`)
    .join("\n");

  return [
    "Crie uma imagem quadrada com cards nutricionais limpos e legíveis para celular.",
    "Use fundo claro, cards organizados, ícones simples de comida e texto em português do Brasil.",
    "Cada card deve mostrar alimento, porção, calorias e macronutrientes P/C/G.",
    "Não inclua foto real nem alimentos novos; use apenas os dados abaixo.",
    `Refeição: ${processed.detectedMealLabel || "Refeição"}`,
    `Total: ${formatMacro(processed.totals.calories)} kcal | P ${formatMacro(processed.totals.protein)}g | C ${formatMacro(processed.totals.carbs)}g | G ${formatMacro(processed.totals.fat)}g`,
    `Itens:\n${labels || "Alimentos identificados na refeição."}`,
  ].join("\n");
}

function hasGeneratedImagePayload(image: GenerateImageResponse) {
  return Boolean(image.url || image.buffer);
}

function isLocalFallbackCard(image: GenerateImageResponse) {
  return /fallback local|fallback de classificação|provider de imagem (?:não configurado|falhou)/i.test(image.detail ?? "");
}

export async function generateAnnotatedMealImage(
  processed: MealProcessingResult,
  imageAnalysisUrl?: string,
): Promise<GenerateImageResponse> {
  const sourceImage = imageDataFromDataUrl(imageAnalysisUrl);
  if (!processed.items.length) {
    return { skippedReason: "no_prompt" };
  }

  if (sourceImage) {
    if (!isOpenAiConfigured()) {
      return {
        skippedReason: "not_configured",
        detail: "Provider de imagem não configurado; a foto original não foi anotada.",
      };
    }

    const editedImage = await generateImage({
      prompt: buildAnnotatedMealImagePrompt(processed),
      originalImages: [sourceImage],
    });

    if (hasGeneratedImagePayload(editedImage) && !isLocalFallbackCard(editedImage)) {
      return editedImage;
    }

    return {
      skippedReason: editedImage.skippedReason || "provider_failed",
      detail: editedImage.detail || "A anotação da foto original não gerou uma imagem válida.",
    };
  }

  return generateImage({
    prompt: buildMealCardsImagePrompt(processed),
  });
}
