import { beforeEach, describe, expect, it, vi } from "vitest";

const storagePutMock = vi.fn();
const processMealInputMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const logInferenceEventMock = vi.fn();
const generateImageMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const confirmMealMock = vi.fn();
const registerMealImageUrlMock = vi.fn();

vi.mock("../../storage", () => ({
  storagePut: storagePutMock,
}));

vi.mock("../../db", () => ({
  buildSavedMedia: vi.fn(input => input),
  confirmPendingMeal: vi.fn(),
  createPendingMealInference: createPendingMealInferenceMock,
  createUserManualMeal: vi.fn(),
  getDb: vi.fn(),
  getHabitSnapshots: getHabitSnapshotsMock,
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("../../_core/imageGeneration", () => ({
  generateImage: generateImageMock,
}));

vi.mock("../meals/service", () => ({
  confirmMeal: confirmMealMock,
}));

vi.mock("../meals/mealImageAssociations", () => ({
  decorateMealWithImageUrl: (meal: unknown) => meal,
  registerMealImageUrl: registerMealImageUrlMock,
}));

vi.mock("../../nutritionEngine", () => ({ resolveCommercialFoodIdentity: vi.fn(),
  MealInferenceError: class MealInferenceError extends Error {},
  processMealInput: processMealInputMock,
}));

describe("photoAnalysis service", () => {
  beforeEach(() => {
    storagePutMock.mockReset();
    storagePutMock.mockResolvedValue({
      key: "42/meal-images/foto.jpg",
      url: "https://storage.test/42/meal-images/foto.jpg",
    });

    processMealInputMock.mockReset();
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "",
      confidence: 0.84,
      needsConfirmation: true,
      reasoning: "Foto analisada com sucesso.",
      items: [
        {
          foodName: "arroz",
          canonicalName: "Arroz branco cozido",
          quantity: 100,
          unit: "g",
          portionText: "100 g",
          servings: 1,
          estimatedGrams: 100,
          calories: 128,
          protein: 2.5,
          carbs: 28,
          fat: 0.2,
          confidence: 0.91,
          source: "catalog" as const,
        },
      ],
      totals: {
        calories: 128,
        protein: 2.5,
        carbs: 28,
        fat: 0.2,
      },
    });

    generateImageMock.mockReset();
    generateImageMock.mockResolvedValue({
      url: "https://storage.test/generated/meal-support/foto.png",
      mimeType: "image/png",
    });

    getHabitSnapshotsMock.mockReset();
    getHabitSnapshotsMock.mockResolvedValue([
      {
        foodName: "Arroz branco cozido",
        typicalTimeLabel: "almoco",
        notes: null,
        occurrenceCount: 2,
      },
    ]);

    logInferenceEventMock.mockReset();

    createPendingMealInferenceMock.mockReset();
    createPendingMealInferenceMock.mockImplementation((_userId, _source, _processed, media) => ({
      draftId: "photo-draft",
      media,
    }));

    confirmMealMock.mockReset();
    confirmMealMock.mockResolvedValue({ id: 99, media: [] });

    registerMealImageUrlMock.mockReset();
  });

  it("usa mídia inline na inferência e mantém a URL persistida quando o upload funciona", async () => {
    const { analyzeFoodPhoto } = await import("./service");

    const result = await analyzeFoodPhoto(42, {
      image: {
        base64: "data:image/jpeg;base64,aW1hZ2UtZGUtdGVzdGU=",
        mimeType: "image/jpeg",
        fileName: "foto.jpg",
      },
    });

    expect(storagePutMock).toHaveBeenCalledTimes(1);
    expect(processMealInputMock).toHaveBeenCalledWith({
      imageUrl: "data:image/jpeg;base64,aW1hZ2UtZGUtdGVzdGU=",
      habits: [
        {
          foodName: "Arroz branco cozido",
          typicalTimeLabel: "almoco",
          notes: null,
          occurrenceCount: 2,
        },
      ],
    });
    expect(generateImageMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Arroz branco cozido"),
      originalImages: [
        expect.objectContaining({
          url: "https://storage.test/42/meal-images/foto.jpg",
          mimeType: "image/jpeg",
        }),
      ],
    }));
    expect(logInferenceEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "food_photo.inline_image_used",
      }),
    );
    expect(result.suggestedItems).toEqual([
      {
        foodName: "Arroz branco cozido",
        quantity: 100,
        estimatedQuantity: 100,
        unit: "g",
        estimatedCalories: 128,
        estimatedMacros: {
          protein: 2.5,
          carbs: 28,
          fat: 0.2,
        },
        confidenceScore: 0.91,
        catalogCandidates: [],
      },
    ]);
    expect(result.supportingImageUrl).toBe(
      "https://storage.test/generated/meal-support/foto.png",
    );
  });

  it("propaga falha controlada quando a inferência não identifica alimento com segurança", async () => {
    const { MealInferenceError } = await import("../../nutritionEngine");
    processMealInputMock.mockRejectedValue(new MealInferenceError("falha controlada"));

    const { analyzeFoodPhoto } = await import("./service");

    await expect(analyzeFoodPhoto(42, {
      image: {
        base64: "data:image/jpeg;base64,aW1hZ2UtZGUtdGVzdGU=",
        mimeType: "image/jpeg",
        fileName: "foto.jpg",
      },
    })).rejects.toBeInstanceOf(MealInferenceError);

    expect(generateImageMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        eventType: "food_photo.inference_failed",
      }),
    );
  });

  it("não bloqueia a análise quando a geração visual auxiliar falha", async () => {
    generateImageMock.mockResolvedValue({
      skippedReason: "provider_failed",
    });

    const { analyzeFoodPhoto } = await import("./service");
    const result = await analyzeFoodPhoto(42, {
      image: {
        base64: "data:image/jpeg;base64,aW1hZ2UtZGUtdGVzdGU=",
        mimeType: "image/jpeg",
        fileName: "foto.jpg",
      },
    });

    expect(result.suggestedItems).toHaveLength(1);
    expect(result.supportingImageUrl).toBeUndefined();
    expect(logInferenceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "warning",
        eventType: "food_photo.visual_generation_warning",
      }),
    );
    expect(logInferenceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "success",
        eventType: "food_photo.analyzed",
      }),
    );
  });

  it("associa itens confirmados à foto original persistida, sem usar a imagem de apoio como proveniência", async () => {
    const { analyzeFoodPhoto, confirmFoodPhotoAnalysis } = await import("./service");
    const analysis = await analyzeFoodPhoto(42, {
      image: {
        base64: "data:image/jpeg;base64,aW1hZ2UtZGUtdGVzdGU=",
        mimeType: "image/jpeg",
        fileName: "foto.jpg",
      },
    });

    const confirmedItem = {
      foodName: "Arroz branco cozido",
      canonicalName: "Arroz branco cozido",
      quantity: 100,
      unit: "g",
      portionText: "100 g",
      servings: 1,
      estimatedGrams: 100,
      calories: 128,
      protein: 2.5,
      carbs: 28,
      fat: 0.2,
      confidence: 0.91,
      source: "catalog" as const,
    };

    await confirmFoodPhotoAnalysis(42, {
      analysisId: analysis.id,
      mealLabel: "Almoço",
      occurredAt: "2026-09-29T12:00:00.000Z",
      items: [confirmedItem],
    });

    const pendingCall = createPendingMealInferenceMock.mock.calls.at(-1);
    expect(pendingCall?.[2].items[0].sourceMediaStorageKey).toBe("42/meal-images/foto.jpg");
    expect(pendingCall?.[3]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mediaType: "image",
        storageKey: "42/meal-images/foto.jpg",
        storageUrl: "https://storage.test/42/meal-images/foto.jpg",
        originalFileName: "food-photo-original",
      }),
      expect.objectContaining({
        mediaType: "image",
        storageUrl: "https://storage.test/generated/meal-support/foto.png",
        originalFileName: "food-photo-supporting",
      }),
    ]));
    expect(confirmMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      items: [
        expect.objectContaining({
          sourceMediaStorageKey: "42/meal-images/foto.jpg",
        }),
      ],
    }));
  });

  it("usa a imagem inline quando o upload falha e segue com a análise", async () => {
    storagePutMock.mockRejectedValueOnce(new Error("storage down"));

    const { analyzeFoodPhoto } = await import("./service");
    await analyzeFoodPhoto(42, {
      image: {
        base64: "aW1hZ2UtZGUtdGVzdGU=",
        mimeType: "image/jpeg",
        fileName: "foto.jpg",
      },
    });

    expect(processMealInputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: "data:image/jpeg;base64,aW1hZ2UtZGUtdGVzdGU=",
      }),
    );
    expect(generateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        originalImages: [
          expect.objectContaining({
            url: "data:image/jpeg;base64,aW1hZ2UtZGUtdGVzdGU=",
          }),
        ],
      }),
    );
    expect(logInferenceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "warning",
        eventType: "food_photo.inline_image_used",
      }),
    );
  });
});
