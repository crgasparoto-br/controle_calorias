import {
  generateExternalImageAnnotation,
  resolveImageAnnotationRuntimeConfig,
  type GenerateExternalImageAnnotationDependencies,
  type ImageAnnotationResponse,
} from "../../_core/imageAnnotation";
import type { MealProcessingResult } from "../../nutritionEngine";
import {
  createLocalMealPhotoOverlay,
  type LocalMealPhotoOverlayDependencies,
} from "./localMealPhotoOverlay";

export type GenerateAnnotatedMealImageDependencies = {
  external?: Omit<GenerateExternalImageAnnotationDependencies, "env">;
  local?: LocalMealPhotoOverlayDependencies;
};

function formatMacro(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatFoodDescription(item: MealProcessingResult["items"][number]) {
  const portionHasGrams = /\d\s*g\b/i.test(item.portionText);
  const gramsLabel = !portionHasGrams && item.estimatedGrams > 0
    ? ` (aprox. ${formatMacro(item.estimatedGrams)}g)`
    : "";
  return `${item.portionText}${gramsLabel} ${item.foodName}`.trim();
}

export function imageDataFromDataUrl(dataUrl?: string) {
  const match = dataUrl?.match(/^data:([^;]+);base64,(.+)$/u);
  if (!match) return null;
  return { mimeType: match[1], b64Json: match[2] };
}

export function buildAnnotatedMealImagePrompt(processed: MealProcessingResult) {
  const labels = processed.items
    .slice(0, 12)
    .map((item, index) => `${index + 1}. ${item.foodName}: ${formatMacro(item.calories)} kcal, P ${formatMacro(item.protein)}g, C ${formatMacro(item.carbs)}g, G ${formatMacro(item.fat)}g`)
    .join("\n");

  return [
    "Mantenha a foto original da refeição como base visual principal e preserve o prato, os alimentos, a iluminação, as cores, o enquadramento e o fundo.",
    "Não recrie, não redesenhe, não substitua e não adicione alimentos. Não transforme a foto em ilustração, renderização, montagem ou imagem nova.",
    "Apenas sobreponha cards/etiquetas nutricionais em português do Brasil sobre a foto original, como uma camada visual de anotação.",
    "Use cards verdes translúcidos, legíveis em celular, com cantos discretos e linhas finas apontando para cada alimento quando fizer sentido.",
    "Cada card deve mostrar nome do alimento, calorias e macronutrientes no formato P/C/G em gramas.",
    "Posicione os cards sem esconder excessivamente os alimentos; priorize leitura clara e preservação da foto real.",
    `Itens detectados:\n${labels || "Alimentos identificados na refeição."}`,
  ].join("\n");
}

export function buildMealCardsImagePrompt(processed: MealProcessingResult) {
  const labels = processed.items
    .slice(0, 12)
    .map((item, index) => `${index + 1}. ${item.foodName}: ${formatFoodDescription(item)}, ${formatMacro(item.calories)} kcal, proteína ${formatMacro(item.protein)}g, carboidratos ${formatMacro(item.carbs)}g, gorduras ${formatMacro(item.fat)}g`)
    .join("\n");

  return [
    "Crie um resumo visual quadrado com cards nutricionais limpos e legíveis para celular.",
    "Use fundo claro, cards organizados, ícones simples de comida e texto em português do Brasil.",
    "Cada card deve mostrar alimento, porção, calorias e macronutrientes P/C/G.",
    "Este artefato é um resumo visual separado e não é uma anotação da foto original.",
    `Refeição: ${processed.detectedMealLabel || "Refeição"}`,
    `Total: ${formatMacro(processed.totals.calories)} kcal | P ${formatMacro(processed.totals.protein)}g | C ${formatMacro(processed.totals.carbs)}g | G ${formatMacro(processed.totals.fat)}g`,
    `Itens:\n${labels || "Alimentos identificados na refeição."}`,
  ].join("\n");
}

async function applyLocalOverlay(
  processed: MealProcessingResult,
  sourceImage: NonNullable<ReturnType<typeof imageDataFromDataUrl>>,
  degradation: "none" | "external_to_local",
  dependencies: LocalMealPhotoOverlayDependencies = {},
): Promise<ImageAnnotationResponse> {
  try {
    const input = {
      image: sourceImage,
      processed,
    };
    const result = Object.keys(dependencies).length > 0
      ? await createLocalMealPhotoOverlay(input, dependencies)
      : await createLocalMealPhotoOverlay(input);
    return { ...result, degradation };
  } catch {
    console.warn(
      "[WhatsAppAnnotatedImage] Local annotation failed without blocking the meal flow.",
      { code: "local_annotation_failed" },
    );
    return {
      skippedReason: "local_failed",
      mode: "local",
      degradation,
      detail: "Não foi possível criar o derivado local; a foto original e a refeição foram preservadas.",
    };
  }
}

export async function generateAnnotatedMealImage(
  processed: MealProcessingResult,
  imageAnalysisUrl?: string,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: GenerateAnnotatedMealImageDependencies = {},
): Promise<ImageAnnotationResponse> {
  if (!processed.items.length) {
    return { skippedReason: "no_prompt" };
  }

  const runtime = resolveImageAnnotationRuntimeConfig(env);
  if (runtime.mode === "off") {
    return {
      skippedReason: "disabled",
      mode: "off",
      detail: "A anotação de foto está desabilitada.",
    };
  }

  const sourceImage = imageDataFromDataUrl(imageAnalysisUrl);
  if (!sourceImage) {
    return {
      skippedReason: "no_original_image",
      mode: runtime.mode,
      detail: "A anotação exige a foto original; nenhum cartão genérico foi usado como substituto.",
    };
  }

  if (runtime.mode === "local") {
    return applyLocalOverlay(processed, sourceImage, "none", dependencies.local);
  }

  const external = await generateExternalImageAnnotation(
    {
      prompt: buildAnnotatedMealImagePrompt(processed),
      originalImages: [sourceImage],
    },
    { ...dependencies.external, env },
  );

  const shouldDegradeLocally = runtime.externalFailureMode === "local"
    && (external.skippedReason === "provider_failed"
      || external.skippedReason === "not_configured");
  if (!shouldDegradeLocally) return external;

  return applyLocalOverlay(
    processed,
    sourceImage,
    "external_to_local",
    dependencies.local,
  );
}
