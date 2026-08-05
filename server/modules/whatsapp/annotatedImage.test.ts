import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MealProcessingResult } from "../../nutritionEngine";

const generateExternalImageAnnotationMock = vi.fn();
const resolveImageAnnotationRuntimeConfigMock = vi.fn();
const createLocalMealPhotoOverlayMock = vi.fn();

vi.mock("../../_core/imageAnnotation", () => ({
  generateExternalImageAnnotation: generateExternalImageAnnotationMock,
  resolveImageAnnotationRuntimeConfig: resolveImageAnnotationRuntimeConfigMock,
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

const originalPhoto = "data:image/jpeg;base64,ZmFrZS1pbWFnZQ==";

describe("generateAnnotatedMealImage", () => {
  beforeEach(() => {
    generateExternalImageAnnotationMock.mockReset();
    resolveImageAnnotationRuntimeConfigMock.mockReset();
    createLocalMealPhotoOverlayMock.mockReset();
    resolveImageAnnotationRuntimeConfigMock.mockReturnValue({
      mode: "local",
      externalFailureMode: "off",
      diagnostics: [],
    });
    createLocalMealPhotoOverlayMock.mockResolvedValue({
      buffer: Buffer.from("local-derived"),
      mimeType: "image/png",
      mode: "local",
      degradation: "none",
      artifactKind: "photo_annotation",
      detail: "local",
    });
  });

  it("uses local mode by default without any external call", async () => {
    const { generateAnnotatedMealImage } = await import("./annotatedImage");

    const result = await generateAnnotatedMealImage(
      processedMeal,
      originalPhoto,
      { AI_VISION_PROVIDER: "gemini" },
    );

    expect(createLocalMealPhotoOverlayMock).toHaveBeenCalledTimes(1);
    expect(generateExternalImageAnnotationMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mode: "local", degradation: "none" });
  });

  it("forwards hermetic local dependencies used by the controlled smoke", async () => {
    const { generateAnnotatedMealImage } = await import("./annotatedImage");
    const localDependencies = { storagePutFn: vi.fn() };

    await generateAnnotatedMealImage(
      processedMeal,
      originalPhoto,
      { AI_IMAGE_ANNOTATION_MODE: "local" },
      { local: localDependencies },
    );

    expect(createLocalMealPhotoOverlayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        image: { mimeType: "image/jpeg", b64Json: "ZmFrZS1pbWFnZQ==" },
        processed: processedMeal,
      }),
      localDependencies,
    );
    expect(generateExternalImageAnnotationMock).not.toHaveBeenCalled();
  });

  it("does nothing in off mode", async () => {
    const { generateAnnotatedMealImage } = await import("./annotatedImage");
    resolveImageAnnotationRuntimeConfigMock.mockReturnValue({
      mode: "off",
      externalFailureMode: "off",
      diagnostics: [],
    });

    const result = await generateAnnotatedMealImage(processedMeal, originalPhoto);

    expect(createLocalMealPhotoOverlayMock).not.toHaveBeenCalled();
    expect(generateExternalImageAnnotationMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ skippedReason: "disabled", mode: "off" });
  });

  it("uses the external capability only when external mode is explicit", async () => {
    const { generateAnnotatedMealImage } = await import("./annotatedImage");
    resolveImageAnnotationRuntimeConfigMock.mockReturnValue({
      mode: "external",
      externalFailureMode: "off",
      diagnostics: [],
    });
    generateExternalImageAnnotationMock.mockResolvedValue({
      mode: "external",
      artifactKind: "photo_annotation",
      buffer: Buffer.from("external-derived"),
    });

    const result = await generateAnnotatedMealImage(processedMeal, originalPhoto);

    expect(generateExternalImageAnnotationMock).toHaveBeenCalledTimes(1);
    expect(createLocalMealPhotoOverlayMock).not.toHaveBeenCalled();
    expect(result.mode).toBe("external");
  });

  it("degrades external to local only when explicitly configured", async () => {
    const { generateAnnotatedMealImage } = await import("./annotatedImage");
    resolveImageAnnotationRuntimeConfigMock.mockReturnValue({
      mode: "external",
      externalFailureMode: "local",
      diagnostics: [],
    });
    generateExternalImageAnnotationMock.mockResolvedValue({
      mode: "external",
      skippedReason: "provider_failed",
    });

    const result = await generateAnnotatedMealImage(processedMeal, originalPhoto);

    expect(generateExternalImageAnnotationMock).toHaveBeenCalledTimes(1);
    expect(createLocalMealPhotoOverlayMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      mode: "local",
      degradation: "external_to_local",
    });
  });

  it("does not silently replace a missing original with a generic card", async () => {
    const { generateAnnotatedMealImage } = await import("./annotatedImage");

    const result = await generateAnnotatedMealImage(processedMeal);

    expect(createLocalMealPhotoOverlayMock).not.toHaveBeenCalled();
    expect(generateExternalImageAnnotationMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      skippedReason: "no_original_image",
      mode: "local",
    });
    expect(result.detail).toContain("nenhum cartão genérico");
  });

  it("keeps local failures non-blocking and sanitized", async () => {
    const { generateAnnotatedMealImage } = await import("./annotatedImage");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    createLocalMealPhotoOverlayMock.mockRejectedValueOnce(
      new Error("source payload contained private meal data"),
    );

    const result = await generateAnnotatedMealImage(processedMeal, originalPhoto);

    expect(result).toMatchObject({ skippedReason: "local_failed", mode: "local" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private meal data");
    expect(result.detail).not.toContain("private meal data");
  });
});
