import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storagePutMock = vi.fn();
const transcribeAudioMock = vi.fn();
const processMealInputMock = vi.fn();
const buildSavedMediaMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const getPendingInferenceMock = vi.fn();
const getPendingInferenceFromDbMock = vi.fn();
const confirmPendingMealMock = vi.fn();
const logInferenceEventMock = vi.fn();

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
  confirmPendingMeal: confirmPendingMealMock,
  copyUserMeal: vi.fn(),
  createPendingMealInference: createPendingMealInferenceMock,
  createUserManualMeal: vi.fn(),
  getUserDayMealTotals: vi.fn(),
  getHabitSnapshots: getHabitSnapshotsMock,
  getPendingInference: getPendingInferenceMock,
  getPendingInferenceFromDb: getPendingInferenceFromDbMock,
  listFavoriteMeals: vi.fn(),
  listUserMeals: vi.fn(),
  logInferenceEvent: logInferenceEventMock,
  removeUserMeal: vi.fn(),
  reuseFavoriteMeal: vi.fn(),
  saveFavoriteMeal: vi.fn(),
  updateUserMeal: vi.fn(),
}));

const { MealDraftNotFoundError, confirmMeal, processMealDraft } = await import("./service");

function buildProcessedResult(overrides: Record<string, unknown> = {}) {
  return {
    detectedMealLabel: "Almoco",
    sourceText: "arroz e frango",
    imageUrl: undefined,
    audioUrl: undefined,
    transcript: undefined,
    confidence: 0.88,
    needsConfirmation: true,
    reasoning: "Inferencia simulada para caracterizacao.",
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
    ...overrides,
  };
}

describe("meals service characterization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T12:30:00.000Z"));

    storagePutMock.mockReset();
    storagePutMock.mockImplementation(async (key: string) => ({
      key,
      url: `https://storage.test/${key}`,
    }));

    transcribeAudioMock.mockReset();
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
    getHabitSnapshotsMock.mockResolvedValue([
      {
        foodName: "Arroz branco cozido",
        typicalTimeLabel: "almoco",
        notes: null,
        occurrenceCount: 3,
      },
    ]);

    getPendingInferenceMock.mockReset();
    getPendingInferenceFromDbMock.mockReset();
    confirmPendingMealMock.mockReset();
    logInferenceEventMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("processa rascunho por texto sem chamar transcricao ou upload de midia", async () => {
    const result = await processMealDraft(42, {
      source: "web",
      text: "arroz e frango",
    });

    expect(storagePutMock).not.toHaveBeenCalled();
    expect(transcribeAudioMock).not.toHaveBeenCalled();
    expect(processMealInputMock).toHaveBeenCalledWith({
      text: "arroz e frango",
      transcript: undefined,
      imageUrl: undefined,
      audioUrl: undefined,
      habits: [
        {
          foodName: "Arroz branco cozido",
          typicalTimeLabel: "almoco",
          notes: null,
          occurrenceCount: 3,
        },
      ],
    });
    expect(createPendingMealInferenceMock).toHaveBeenCalledWith(
      42,
      "web",
      expect.objectContaining({ sourceText: "arroz e frango" }),
      [],
    );
    expect(result).toEqual({
      draftId: "web-42-draft",
      processed: expect.objectContaining({ sourceText: "arroz e frango" }),
      media: [],
    });
  });

  it("processa imagem e audio mockados, reutilizando a transcricao no rascunho", async () => {
    transcribeAudioMock.mockResolvedValue({
      task: "transcribe",
      language: "pt",
      duration: 3.2,
      text: "arroz e frango grelhado",
      segments: [],
    });

    const result = await processMealDraft(42, {
      source: "whatsapp",
      image: {
        base64: "data:image/jpeg;base64,aW1hZ2UtZGUtdGVzdGU=",
        mimeType: "image/jpeg",
        fileName: "prato.jpeg",
      },
      audio: {
        base64: "data:audio/ogg;base64,YXVkaW8tZGUtdGVzdGU=",
        mimeType: "audio/ogg",
        fileName: "refeicao.ogg",
      },
    });

    expect(storagePutMock).toHaveBeenCalledTimes(2);
    expect(transcribeAudioMock).toHaveBeenCalledWith(expect.objectContaining({
      language: "pt",
      audioUrl: expect.stringContaining("/42/meal-audios/"),
      prompt: expect.stringContaining("Transcreva"),
    }));

    const multimodalInput = processMealInputMock.mock.calls[0]?.[0];
    expect(multimodalInput).toEqual(expect.objectContaining({
      text: undefined,
      transcript: "arroz e frango grelhado",
      habits: [
        {
          foodName: "Arroz branco cozido",
          typicalTimeLabel: "almoco",
          notes: null,
          occurrenceCount: 3,
        },
      ],
    }));
    expect(multimodalInput?.imageUrl).toContain("/42/meal-images/");
    expect(multimodalInput?.audioUrl).toContain("/42/meal-audios/");

    expect(result.media).toEqual([
      expect.objectContaining({
        mediaType: "image",
        storageKey: expect.stringContaining("42/meal-images/"),
        mimeType: "image/jpeg",
        originalFileName: "prato.jpeg",
      }),
      expect.objectContaining({
        mediaType: "audio",
        storageKey: expect.stringContaining("42/meal-audios/"),
        mimeType: "audio/ogg",
        originalFileName: "refeicao.ogg",
      }),
    ]);
  });

  it("mantem erro controlado quando a transcricao falha e segue com o rascunho sem transcript", async () => {
    transcribeAudioMock.mockResolvedValue({
      error: "Transcription service request failed",
      code: "TRANSCRIPTION_FAILED",
      details: "503 upstream timeout",
    });

    await processMealDraft(7, {
      source: "whatsapp",
      audio: {
        base64: "data:audio/ogg;base64,YXVkaW8tZGUtdGVzdGU=",
        mimeType: "audio/ogg",
        fileName: "audio.ogg",
      },
    });

    expect(logInferenceEventMock).toHaveBeenCalledWith({
      userId: 7,
      origin: "whatsapp",
      status: "warning",
      eventType: "audio.transcription_warning",
      detail: "503 upstream timeout",
    });

    const warningInput = processMealInputMock.mock.calls[0]?.[0];
    expect(warningInput).toEqual(expect.objectContaining({
      text: undefined,
      transcript: undefined,
      imageUrl: undefined,
      habits: [
        {
          foodName: "Arroz branco cozido",
          typicalTimeLabel: "almoco",
          notes: null,
          occurrenceCount: 3,
        },
      ],
    }));
    expect(warningInput?.audioUrl).toContain("/7/meal-audios/");
  });

  it("confirma a refeicao apenas com dados locais do rascunho, sem provider externo", async () => {
    getPendingInferenceMock.mockReturnValue({
      draftId: "draft-local",
      userId: 42,
    });
    confirmPendingMealMock.mockResolvedValue({
      id: 9001,
      mealLabel: "Almoco",
    });

    const result = await confirmMeal(42, {
      draftId: "draft-local",
      mealLabel: "Almoco",
      occurredAt: "2026-04-25T12:30:00.000Z",
      notes: "Confirmado manualmente",
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
          confidence: 1,
          source: "catalog",
        },
      ],
    });

    expect(getPendingInferenceFromDbMock).not.toHaveBeenCalled();
    expect(confirmPendingMealMock).toHaveBeenCalledWith({
      draftId: "draft-local",
      userId: 42,
      mealLabel: "Almoco",
      occurredAt: "2026-04-25T12:30:00.000Z",
      notes: "Confirmado manualmente",
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
          confidence: 1,
          source: "catalog",
        },
      ],
    });
    expect(result).toEqual({ id: 9001, mealLabel: "Almoco" });
  });

  it("mantem erro de rascunho ausente quando nao encontra dados locais nem persistidos", async () => {
    getPendingInferenceMock.mockReturnValue(undefined);
    getPendingInferenceFromDbMock.mockResolvedValue(undefined);

    await expect(confirmMeal(42, {
      draftId: "draft-inexistente",
      mealLabel: "Almoco",
      occurredAt: "2026-04-25T12:30:00.000Z",
      items: [],
    })).rejects.toBeInstanceOf(MealDraftNotFoundError);
  });
});
