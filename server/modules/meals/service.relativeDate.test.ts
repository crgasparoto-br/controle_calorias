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

describe("processMealDraft relative date suggestions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T20:25:00.000Z"));

    storagePutMock.mockReset();
    transcribeAudioMock.mockReset();
    buildSavedMediaMock.mockReset();
    getHabitSnapshotsMock.mockReset();
    getHabitSnapshotsMock.mockResolvedValue([]);
    processMealInputMock.mockReset();
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Jantar",
      sourceText: "jantar de ontem",
      confidence: 0.8,
      needsConfirmation: true,
      reasoning: "Teste",
      items: [{
        foodName: "canelone",
        canonicalName: "canelone",
        portionText: "1 porção",
        servings: 1,
        estimatedGrams: 100,
        calories: 150,
        protein: 6,
        carbs: 15,
        fat: 5,
        confidence: 0.7,
        source: "heuristic",
      }],
      totals: {
        calories: 150,
        protein: 6,
        carbs: 15,
        fat: 5,
      },
    });
    createPendingMealInferenceMock.mockReset();
    createPendingMealInferenceMock.mockImplementation((userId: number, source: string, processed: unknown, media: unknown[]) => ({
      draftId: `${source}-${userId}-draft`,
      processed,
      media,
    }));
  });

  it("retorna suggestedOccurredAt no dia anterior quando o texto menciona ontem", async () => {
    const result = await processMealDraft(42, {
      source: "whatsapp",
      text: "adicionar ao jantar de ontem, uma porção de canelone",
    });

    expect(result.suggestedOccurredAt).toMatch(/^2026-06-28T/);
  });
});
