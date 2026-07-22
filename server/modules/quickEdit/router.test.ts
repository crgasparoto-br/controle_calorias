import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateQuickEditMealMock = vi.fn();
const logInferenceEventMock = vi.fn();

vi.mock("../../db", () => ({
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("./mealUpdateConfirmation", () => ({
  updateQuickEditMealWithWhatsappConfirmation: updateQuickEditMealMock,
}));

vi.mock("./service", () => ({
  deleteQuickEditMeal: vi.fn(),
  getQuickEditExercise: vi.fn(),
  getQuickEditMeal: vi.fn(),
  QuickEditTemporalInputError: class QuickEditTemporalInputError extends Error {},
  QuickEditTokenError: class QuickEditTokenError extends Error {},
  updateQuickEditExercise: vi.fn(),
  updateQuickEditMeal: updateQuickEditMealMock,
}));

const { quickEditRouter } = await import("./router");

describe("quickEdit router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("não expõe erro técnico do banco ao salvar edição rápida", async () => {
    updateQuickEditMealMock.mockRejectedValueOnce(
      new Error("Failed query: UPDATE mealItems SET foodSnapshotJson = ?")
    );
    const caller = quickEditRouter.createCaller({ user: null } as never);

    await expect(
      caller.updateMeal({
        token: "x".repeat(32),
        meal: {
          mealLabel: "Jantar",
          dateTimeLocal: "2026-07-22T12:00",
          items: [
            {
              foodName: "Queijo parmesão polenghi",
              canonicalName: "Queijo parmesão polenghi",
              portionText: "30 g",
              quantity: 30,
              unit: "g",
              servings: 1,
              estimatedGrams: 30,
              calories: 120,
              protein: 10,
              carbs: 1,
              fat: 8,
              confidence: 0.8,
              source: "heuristic",
            },
          ],
        },
      })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Não foi possível salvar a edição agora. Tente novamente em instantes.",
    } satisfies Partial<TRPCError>);

    expect(logInferenceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "quick_edit.public_error_sanitized",
      })
    );
  });
});
