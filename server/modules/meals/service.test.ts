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

  it("processa texto, imagem e audio juntos usando imagem e audio inline na inferencia", async () => {
    transcribeAudioMock.mockResolvedValue({
      task: "transcribe",
      language: "pt",
      duration: 3.2,
      text: "arroz e frango grelhado",
      segments: [],
    });

    const result = await processMealDraft(42, {
      source: "whatsapp",
      text: "almoco com arroz",
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
      audioBase64: "data:audio/ogg;base64,YXVkaW8tZGUtdGVzdGU=",
      mimeType: "audio/ogg",
      language: "pt",
      prompt: expect.stringContaining("Transcreva"),
    }));

    const multimodalInput = processMealInputMock.mock.calls[0]?.[0];
    expect(multimodalInput).toEqual(expect.objectContaining({
      text: "almoco com arroz",
      transcript: "arroz e frango grelhado",
      imageUrl: "data:image/jpeg;base64,aW1hZ2UtZGUtdGVzdGU=",
      habits: [
        {
          foodName: "Arroz branco cozido",
          typicalTimeLabel: "almoco",
          notes: null,
          occurrenceCount: 3,
        },
      ],
    }));
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

  it("segue com transcricao inline quando o upload do audio falha", async () => {
    storagePutMock.mockImplementation(async (key: string) => {
      if (String(key).includes("meal-audios")) {
        throw new Error("upload indisponivel");
      }

      return {
        key,
        url: `https://storage.test/${key}`,
      };
    });
    transcribeAudioMock.mockResolvedValue({
      task: "transcribe",
      language: "pt",
      duration: 2.1,
      text: "omelete com queijo",
      segments: [],
    });

    await processMealDraft(9, {
      source: "web",
      audio: {
        base64: "data:audio/ogg;base64,YXVkaW8tZGUtdGVzdGU=",
        mimeType: "audio/ogg",
        fileName: "audio.ogg",
      },
    });

    expect(logInferenceEventMock).toHaveBeenCalledWith({
      userId: 9,
      origin: "web",
      status: "warning",
      eventType: "meal_draft.inline_audio_used",
      detail: "O draft usou o áudio inline porque o upload para storage falhou durante o processamento.",
    });
    expect(transcribeAudioMock).toHaveBeenCalledWith(expect.objectContaining({
      audioBase64: "data:audio/ogg;base64,YXVkaW8tZGUtdGVzdGU=",
      mimeType: "audio/ogg",
    }));

    const multimodalInput = processMealInputMock.mock.calls[0]?.[0];
    expect(multimodalInput?.audioUrl).toBeUndefined();
    expect(multimodalInput?.transcript).toBe("omelete com queijo");
  });

  it("não persiste rascunho quando a inferência falha antes da validação final", async () => {
    processMealInputMock.mockRejectedValue(new Error("Não foi possível gerar um rascunho revisável para esta refeição agora."));

    await expect(processMealDraft(15, {
      source: "web",
      image: {
        base64: "data:image/jpeg;base64,aW1hZ2UtZGUtdGVzdGU=",
        mimeType: "image/jpeg",
        fileName: "foto.jpeg",
      },
    })).rejects.toThrow("Não foi possível gerar um rascunho revisável para esta refeição agora.");

    expect(createPendingMealInferenceMock).not.toHaveBeenCalled();
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
