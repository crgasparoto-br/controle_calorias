import crypto from "node:crypto";
import {
  createUserManualMeal,
  getHabitSnapshots,
  logInferenceEvent,
} from "../../db";
import { MealInferenceError, processMealInput, type MealDraftItem } from "../../nutritionEngine";
import { storagePut } from "../../storage";
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
  createdAt: number;
  updatedAt: number;
};

const photoAnalysisStore = new Map<string, FoodPhotoAnalysis>();

function mockAnalyzeImage(): FoodPhotoSuggestedItem[] {
  return [
    {
      foodName: "Arroz cozido",
      estimatedQuantity: 100,
      unit: "g",
      estimatedCalories: 128,
      estimatedMacros: { protein: 2.5, carbs: 28, fat: 0.2 },
      confidenceScore: 0.72,
    },
    {
      foodName: "Feijão cozido",
      estimatedQuantity: 120,
      unit: "g",
      estimatedCalories: 91,
      estimatedMacros: { protein: 6, carbs: 16, fat: 1 },
      confidenceScore: 0.68,
    },
    {
      foodName: "Frango grelhado",
      estimatedQuantity: 110,
      unit: "g",
      estimatedCalories: 182,
      estimatedMacros: { protein: 34, carbs: 0, fat: 4 },
      confidenceScore: 0.64,
    },
  ];
}

function sanitizeAnalysis(analysis: FoodPhotoAnalysis) {
  return {
    id: analysis.id,
    status: analysis.status,
    suggestedItems: analysis.suggestedItems,
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

async function uploadAnalysisImage(userId: number, input: NonNullable<AnalyzeFoodPhotoInput["image"]>) {
  const extension = input.mimeType.split("/")[1] || "jpg";
  const upload = await storagePut(
    `${userId}/meal-images/${Date.now()}.${extension}`,
    extractBase64Payload(input.base64),
    input.mimeType,
  );

  return upload.url;
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

  const imageUrl = await uploadAnalysisImage(userId, input.image);

  let suggestedItems: FoodPhotoSuggestedItem[];
  let usedFallback = false;

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

    suggestedItems = mockAnalyzeImage();
    usedFallback = true;
    logInferenceEvent({
      userId,
      origin: "web",
      status: "warning",
      eventType: "food_photo.fallback_used",
      detail: "A análise de foto usou um fallback seguro após falha controlada da inferência principal.",
    });
  }

  const analyzed: FoodPhotoAnalysis = {
    ...pending,
    status: "analyzed",
    suggestedItems,
    updatedAt: Date.now(),
  };
  photoAnalysisStore.set(analyzed.id, analyzed);

  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "food_photo.analyzed",
    detail: usedFallback
      ? `Foto analisada com ${analyzed.suggestedItems.length} sugestões após fallback seguro.`
      : `Foto analisada com ${analyzed.suggestedItems.length} sugestões estruturadas pelo núcleo compartilhado.`,
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

  const rejected = { ...analysis, status: "rejected" as const, updatedAt: Date.now() };
  photoAnalysisStore.set(analysisId, rejected);
  return sanitizeAnalysis(rejected);
}

export async function confirmFoodPhotoAnalysis(userId: number, input: ConfirmFoodPhotoAnalysisInput) {
  const analysis = photoAnalysisStore.get(input.analysisId);
  if (!analysis || analysis.userId !== userId) {
    throw new Error("Análise de foto não encontrada.");
  }
  if (analysis.status !== "analyzed") {
    throw new Error("A análise precisa estar pronta antes de confirmar a refeição.");
  }

  const meal = await createUserManualMeal({
    userId,
    mealLabel: input.mealLabel,
    occurredAt: input.occurredAt,
    notes: input.notes,
    items: input.items,
  });

  photoAnalysisStore.set(input.analysisId, {
    ...analysis,
    status: "confirmed",
    updatedAt: Date.now(),
  });

  return meal;
}

export function mapPhotoSuggestionsToMealItems(items: FoodPhotoSuggestedItem[]) {
  return items.map(toMealItem);
}
