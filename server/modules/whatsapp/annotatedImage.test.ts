import { describe, expect, it, vi } from "vitest";
import type { MealProcessingResult } from "../../nutritionEngine";

const generateImageMock = vi.fn();
const createLocalMealPhotoOverlayMock = vi.fn();

vi.mock("../../_core/imageGeneration", () => ({
  generateImage: generateImageMock,
}));

vi.mock("./localMealPhotoOverlay", () => ({
  createLocalMealPhotoOverlay: createLocalMealPhotoOverlayMock,
}));

const processedMeal: MealProcessingResult = {
  detectedMealLabel: "Almoço",
  sourceText: "",
  confidence: 0.9,
  needsConfirmation: false,
  reasoning: "Teste",
  items: [
    {
      foodName: "Arroz",
      canonicalName: "Arroz cozido",
      quantity: 100,
      unit: "g",
      portionText: "100 g",
      servings: 1,
      estimatedGrams: 100,
      calories: 130,
      protein: 2.5,
      carbs: 28,
      fat: 0.3,
      confidence: 0.9,
      source: "heuristic",
    },
  ],
  totals: {
    calories: 130,
    protein: 2.5,
    carbs: 28,
    fat: 0.3,
  },
};

describe("generateAnnotatedMealImage", () => {
  it("does not call the image generation provider when local overlay fails for an original meal photo", async () => {
    const { generateAnnotatedMealImage } = await import("./annotatedImage");
    createLocalMealPhotoOverlayMock.mockRejectedValueOnce(new Error("sharp unavailable"));

    const result = await generateAnnotatedMealImage(
      processedMeal,
      "data:image/jpeg;base64,ZmFrZS1pbWFnZQ==",
    );

    expect(createLocalMealPhotoOverlayMock).toHaveBeenCalledTimes(1);
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      skippedReason: "local_overlay_failed",
    });
    expect(result.detail).toContain("foto original");
  });

  it("can still generate meal cards when there is no original image", async () => {
    const { generateAnnotatedMealImage } = await import("./annotatedImage");
    generateImageMock.mockResolvedValueOnce({ url: "https://example.test/cards.png" });

    const result = await generateAnnotatedMealImage(processedMeal);

    expect(createLocalMealPhotoOverlayMock).not.toHaveBeenCalled();
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ url: "https://example.test/cards.png" });
  });
});
