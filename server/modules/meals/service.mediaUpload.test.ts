import { beforeEach, describe, expect, it, vi } from "vitest";

const storagePutMock = vi.fn();
const transcribeAudioMock = vi.fn();
const processMealInputMock = vi.fn();
const buildSavedMediaMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();

vi.mock("../../storage", () => ({
  storagePut: storagePutMock,
}));

vi.mock("../../_core/voiceTranscription", () => ({
  transcribeAudio: transcribeAudioMock,
}));

vi.mock("../../nutritionEngine", () => ({
  processMealInput: processMealInputMock,
}));

vi.mock("../../db", () => ({
  buildSavedMedia: buildSavedMediaMock,
  confirmPendingMeal: vi.fn(),
  copyUserMeal: vi.fn(),
  createPendingMealInference: createPendingMealInferenceMock,
  createUserManualMeal: vi.fn(),
  getUserDayMealTotals: vi.fn(),
  getHabitSnapshots: getHabitSnapshotsMock,
  getPendingInference: vi.fn(),
  getPendingInferenceFromDb: vi.fn(),
  listFavoriteMeals: vi.fn(),
  listUserMeals: vi.fn(),
  logInferenceEvent: vi.fn(),
  removeUserMeal: vi.fn(),
  reuseFavoriteMeal: vi.fn(),
  saveFavoriteMeal: vi.fn(),
  updateUserMeal: vi.fn(),
}));

const { processMealDraft } = await import("./service");

function buildProcessedResult() {
  return {
    detectedMealLabel: "Almoço",
    sourceText: "arroz e frango",
    confidence: 0.88,
    needsConfirmation: true,
    reasoning: "Inferência simulada.",
    items: [
      {
        foodName: "arroz",
        canonicalName: "Arroz branco cozido",
        portionText: "100 g",
        servings: 1,
        estimatedGrams: 100,
        calories: 130,
        protein: 2.7,
        carbs: 28,
        fat: 0.3,
        confidence: 0.92,
        source: "catalog" as const,
      },
    ],
    totals: {
      calories: 130,
      protein: 2.7,
      carbs: 28,
      fat: 0.3,
    },
  };
}

describe("processMealDraft media uploads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T18:30:00.000Z"));

    storagePutMock.mockReset();
    storagePutMock.mockImplementation(async (key: string) => ({
      key,
      url: `https://storage.test/${key}`,
    }));

    transcribeAudioMock.mockReset();
    transcribeAudioMock.mockResolvedValue({
      task: "transcribe",
      language: "pt",
      duration: 2,
      text: "arroz e frango",
      segments: [],
    });

    processMealInputMock.mockReset();
    processMealInputMock.mockResolvedValue(buildProcessedResult());

    buildSavedMediaMock.mockReset();
    buildSavedMediaMock.mockImplementation((media: Record<string, unknown>) => media);

    createPendingMealInferenceMock.mockReset();
    createPendingMealInferenceMock.mockImplementation((userId: number, source: string, processed: unknown, media: unknown[]) => ({
      draftId: `${source}-${userId}-draft`,
      processed,
      media,
    }));

    getHabitSnapshotsMock.mockReset();
    getHabitSnapshotsMock.mockResolvedValue([]);
  });

  it("salva imagem de refeição como pública para gerar URL carregável no sistema", async () => {
    await processMealDraft(42, {
      source: "whatsapp",
      text: "almoço",
      image: {
        base64: "data:image/jpeg;base64,aW1hZ2U=",
        mimeType: "image/jpeg",
        fileName: "prato.jpeg",
      },
      audio: {
        base64: "data:audio/ogg;base64,YXVkaW8=",
        mimeType: "audio/ogg",
        fileName: "audio.ogg",
      },
    });

    expect(storagePutMock).toHaveBeenCalledWith(
      expect.stringContaining("42/meal-images/"),
      expect.any(Buffer),
      "image/jpeg",
      { publicRead: true },
    );
    expect(storagePutMock).toHaveBeenCalledWith(
      expect.stringContaining("42/meal-audios/"),
      expect.any(Buffer),
      "audio/ogg",
      { publicRead: false },
    );
    expect(buildSavedMediaMock).toHaveBeenCalledWith(expect.objectContaining({
      mediaType: "image",
      storageUrl: expect.stringContaining("https://storage.test/42/meal-images/"),
    }));
  });
});