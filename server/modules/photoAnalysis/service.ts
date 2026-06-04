import crypto from "node:crypto";
import {
  buildSavedMedia,
  confirmPendingMeal,
  createPendingMealInference,
  getHabitSnapshots,
  logInferenceEvent,
} from "../../db";
import { generateImage } from "../../_core/imageGeneration";
import {
  MealInferenceError,
  processMealInput,
  type MealDraftItem,
} from "../../nutritionEngine";
import { storagePut } from "../../storage";
import { calculateMealTotals } from "../../../shared/mealTotals";
import { decorateMealWithImageUrl, registerMealImageUrl } from "../meals/mealImageAssociations";
import type {
  AnalyzeFoodPhotoInput,
  ConfirmFoodPhotoAnalysisInput,
  FoodPhotoAnalysisStatus,
  FoodPhotoSuggestedItem,
} from "./schemas";

export type FoodPhotoAnalysis = {
  id: string;
  userId: number;
  status: FoodPhotoAnalysisStatus;
  suggestedItems: FoodPhotoSuggestedItem[];
  supportingImageUrl?: string;
  originalImageUrl?: string;
  originalImageMimeType?: string;
  createdAt: number;
  updatedAt: number;
};

const photoAnalysisStore = new Map<string, FoodPhotoAnalysis>();

function sanitizeAnalysis(analysis: FoodPhotoAnalysis) {
  return {
    id: analysis.id,
    status: analysis.status,
    suggestedItems: analysis.suggestedItems,
    supportingImageUrl: analysis.supportingImageUrl,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
  };
}

function toMealItem(item: FoodPhotoSuggestedItem): MealDraftItem {
  return {
    foodName: item.foodName,
    canonicalName: item.foodName,
    portionText: `${item.estimatedQuantity} ${item.unit}`,
    servings: 1,
    estimatedGrams: item.unit.toLowerCase() === "g" ? item.estimatedQuantity : 0,
    calories: item.estimatedCalories,
    protein: item.estimatedMacros.protein,
    carbs: item.estimatedMacros.carbs,
    fat: item.estimatedMacros.fat,
    confidence: item.confidenceScore,
    source: "heuristic",
  };
}

function toSuggestedItem(item: MealDraftItem): FoodPhotoSuggestedItem {
  return {
    foodName: item.canonicalName || item.foodName,
    estimatedQuantity: item.estimatedGrams > 0 ? item.estimatedGrams : 1,
    unit: item.estimatedGrams > 0 ? "g" : item.portionText,
    estimatedCalories: item.calories,
    estimatedMacros: {
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    },
    confidenceScore: item.confidence,
  };
}

function extractBase64Payload(value: string) {
  const match = value.match(/^data:(.+);base64,(.*)$/);
  return Buffer.from(match ? match[2] : value, "base64");
}

function buildInlineImageDataUrl(input: NonNullable<AnalyzeFoodPhotoInput["image"]>) {
  return input.base64.startsWith("data:")
    ? input.base64
    : `data:${input.mimeType};base64,${input.base64}`;
}

async function resolveAnalysisImageUrl(
  userId: number,
  input: NonNullable<AnalyzeFoodPhotoInput["image"]>,
) {
  const extension = input.mimeType.split("/")[1] || "jpg";

  try {
    const upload = await storagePut(
      `${userId}/meal-images/${Date.now()}.${extension}`,
      extractBase64Payload(input.base64),
      input.mimeType,
    );

    return {
      imageUrl: upload.url,
      usedInlineFallback: false,
    };
  } catch {
    return {
      imageUrl: buildInlineImageDataUrl(input),
      usedInlineFallback: true,
    };
  }
}

function buildSupportingImagePrompt(items: FoodPhotoSuggestedItem[]) {
  if (!items.length) {
    return "";
  }

  const itemSummary = items
    .slice(0, 6)
    .map((item) => `${item.foodName} (${item.estimatedQuantity} ${item.unit})`)
    .join(", ");

  return [
    "Crie uma imagem simples de apoio visual para uma refeição já analisada.",
    "Mostre uma foto de prato vista de cima, com aparência realista e fundo neutro.",
    `Itens principais: ${itemSummary}.`,
    "Nao inclua texto, marcas, tabela nutricional nem elementos médicos.",
  ].join(" ");
}

function createPhotoAnalysisMedia(analysis: FoodPhotoAnalysis) {
  const imageUrl = analysis.supportingImageUrl ?? analysis.originalImageUrl;
  if (!imageUrl) return [];

  return [
    buildSavedMedia({
      mediaType: "image",
      storageKey: imageUrl,
      storageUrl: imageUrl,
      mimeType: analysis.originalImageMimeType ?? "image/png",
      originalFileName: "food-photo-analysis",
    }),
  ];
}

export async function analyzeFoodPhoto(userId: number, input: AnalyzeFoodPhotoInput) {
  if (!input.image) {
    throw new MealInferenceError("Envie uma foto para análise.");
  }

  const now = Date.now();
  const pending: FoodPhotoAnalysis = {
    id: crypto.randomUUID(),
    userId,
    status: "pending",
    suggestedItems: [],
    createdAt: now,
    updatedAt: now,
  };
  photoAnalysisStore.set(pending.id, pending);

  const { imageUrl, usedInlineFallback } = await resolveAnalysisImageUrl(
    userId,
    input.image,
  );

  let suggestedItems: FoodPhotoSuggestedItem[];

  try {
    const processed = await processMealInput({
      imageUrl,
      habits: await getHabitSnapshots(userId),
    });
    suggestedItems = processed.items.map(toSuggestedItem);
  } catch (error) {
    if (!(error instanceof MealInferenceError)) {
      throw error;
    }

    logInferenceEvent({
      userId,
      origin: "web",
      status: "error",
      eventType: "food_photo.inference_failed",
      detail:
        "A análise de foto não identificou alimentos com segurança suficiente para sugerir uma refeição.",
    });
    throw new MealInferenceError(
      "Não consegui identificar alimentos com segurança nessa foto. Tente enviar novamente ou descreva os alimentos em texto para registrar.",
    );
  }

  if (usedInlineFallback) {
    logInferenceEvent({
      userId,
      origin: "web",
      status: "warning",
      eventType: "food_photo.inline_image_used",
      detail:
        "A análise de foto usou a imagem inline porque o upload para storage não estava disponível.",
    });
  }

  const supportingImage = await generateImage({
    prompt: buildSupportingImagePrompt(suggestedItems),
    originalImages: [{ url: imageUrl, mimeType: input.image.mimeType }],
  });

  if (supportingImage.skippedReason === "provider_failed") {
    logInferenceEvent({
      userId,
      origin: "web",
      status: "warning",
      eventType: "food_photo.visual_generation_warning",
      detail:
        "A geração visual auxiliar falhou, mas a análise da refeição seguiu sem bloquear confirmação.",
    });
  }

  const analyzed: FoodPhotoAnalysis = {
    ...pending,
    status: "analyzed",
    suggestedItems,
    supportingImageUrl: supportingImage.url,
    originalImageUrl: imageUrl,
    originalImageMimeType: input.image.mimeType,
    updatedAt: Date.now(),
  };
  photoAnalysisStore.set(analyzed.id, analyzed);

  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "food_photo.analyzed",
    detail: `Foto analisada com ${analyzed.suggestedItems.length} sugestões estruturadas pelo núcleo compartilhado.`,
  });

  return sanitizeAnalysis(analyzed);
}

export async function getFoodPhotoAnalysis(userId: number, analysisId: string) {
  const analysis = photoAnalysisStore.get(analysisId);
  if (!analysis || analysis.userId !== userId) return null;
  return sanitizeAnalysis(analysis);
}

export async function rejectFoodPhotoAnalysis(userId: number, analysisId: string) {
  const analysis = photoAnalysisStore.get(analysisId);
  if (!analysis || analysis.userId !== userId) {
    throw new Error("Análise de foto não encontrada.");
  }

  const rejected = {
    ...analysis,
    status: "rejected" as const,
    updatedAt: Date.now(),
  };
  photoAnalysisStore.set(analysisId, rejected);
  return sanitizeAnalysis(rejected);
}

export async function confirmFoodPhotoAnalysis(
  userId: number,
  input: ConfirmFoodPhotoAnalysisInput,
) {
  const analysis = photoAnalysisStore.get(input.analysisId);
  if (!analysis || analysis.userId !== userId) {
    throw new Error("Análise de foto não encontrada.");
  }
  if (analysis.status !== "analyzed") {
    throw new Error("A análise precisa estar pronta antes de confirmar a refeição.");
  }

  const processedItems = input.items;
  const draft = createPendingMealInference(
    userId,
    "web",
    {
      sourceText: input.notes ?? "Registro criado a partir de foto.",
      reasoning: "Refeição confirmada a partir da análise de foto.",
      confidence: processedItems.length
        ? processedItems.reduce((sum, item) => sum + item.confidence, 0) / processedItems.length
        : 1,
      detectedMealLabel: input.mealLabel,
      needsConfirmation: false,
      items: processedItems,
      totals: calculateMealTotals(processedItems),
    },
    createPhotoAnalysisMedia(analysis),
  );

  const meal = await confirmPendingMeal({
    draftId: draft.draftId,
    userId,
    mealLabel: input.mealLabel,
    occurredAt: input.occurredAt,
    notes: input.notes,
    items: processedItems,
  });

  registerMealImageUrl(meal.id, analysis.supportingImageUrl ?? analysis.originalImageUrl);

  photoAnalysisStore.set(input.analysisId, {
    ...analysis,
    status: "confirmed",
    updatedAt: Date.now(),
  });

  return decorateMealWithImageUrl(meal);
}

export function mapPhotoSuggestionsToMealItems(items: FoodPhotoSuggestedItem[]) {
  return items.map(toMealItem);
}
