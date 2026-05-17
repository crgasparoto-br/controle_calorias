import { beforeEach, describe, expect, it, vi } from "vitest";

const storagePutMock = vi.fn();
const processMealInputMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const logInferenceEventMock = vi.fn();

vi.mock("../../storage", () => ({
  storagePut: storagePutMock,
}));

vi.mock("../../db", () => ({
  createUserManualMeal: vi.fn(),
  getHabitSnapshots: getHabitSnapshotsMock,
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("../../nutritionEngine", () => ({
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
  });

  it("usa o núcleo compartilhado de inferência para analisar foto", async () => {
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
      imageUrl: "https://storage.test/42/meal-images/foto.jpg",
      habits: [
        {
          foodName: "Arroz branco cozido",
          typicalTimeLabel: "almoco",
          notes: null,
          occurrenceCount: 2,
        },
      ],
    });
    expect(result.suggestedItems).toEqual([
      {
        foodName: "Arroz branco cozido",
        estimatedQuantity: 100,
        unit: "g",
        estimatedCalories: 128,
        estimatedMacros: {
          protein: 2.5,
          carbs: 28,
          fat: 0.2,
        },
        confidenceScore: 0.91,
      },
    ]);
  });

  it("mantém fallback seguro quando a inferência principal falha de forma controlada", async () => {
    const { MealInferenceError } = await import("../../nutritionEngine");
    processMealInputMock.mockRejectedValue(new MealInferenceError("falha controlada"));

    const { analyzeFoodPhoto } = await import("./service");
    const result = await analyzeFoodPhoto(42, {
      image: {
        base64: "data:image/jpeg;base64,aW1hZ2UtZGUtdGVzdGU=",
        mimeType: "image/jpeg",
        fileName: "foto.jpg",
      },
    });

    expect(result.suggestedItems).toHaveLength(3);
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      status: "warning",
      eventType: "food_photo.fallback_used",
    }));
  });
});
