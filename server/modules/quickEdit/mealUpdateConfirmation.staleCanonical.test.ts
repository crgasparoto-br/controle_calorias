import { beforeEach, describe, expect, it, vi } from "vitest";

const getQuickEditMealMock = vi.fn();
const updateQuickEditMealMock = vi.fn();
const processMealInputMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const limitMock = vi.fn();

vi.mock("./service", () => ({
  getQuickEditMeal: getQuickEditMealMock,
  updateQuickEditMeal: updateQuickEditMealMock,
}));
vi.mock("../../nutritionEngine", () => ({
  processMealInput: processMealInputMock,
}));
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: limitMock }),
      }),
    }),
  })),
  getHabitSnapshots: getHabitSnapshotsMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
}));
vi.mock("../whatsapp/mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(),
}));
vi.mock("../whatsapp/replyTransport", () => ({
  sendWhatsAppLogicalReply: vi.fn(),
}));
vi.mock("../whatsapp/replyContract", () => ({
  textReply: (text: string) => ({ text }),
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("../../../drizzle/schema", () => ({
  quickEditTokens: { userId: {}, tokenHash: {} },
}));

const { updateQuickEditMealWithWhatsappConfirmation } = await import(
  "./mealUpdateConfirmation"
);

const currentItem = {
  foodName: "30G",
  canonicalName: "1 porção",
  portionText: "30 g",
  quantity: 30,
  unit: "g",
  servings: 1,
  estimatedGrams: 30,
  calories: 150,
  protein: 6,
  carbs: 15,
  fat: 5,
  confidence: 0.3,
  source: "heuristic" as const,
};

const currentMeal = {
  id: 874,
  mealLabel: "Lanche",
  occurredAt: "2026-07-22T15:00:00.000Z",
  items: [currentItem],
};

describe("quick edit with stale canonicalName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitMock.mockResolvedValue([{ userId: 123 }]);
    getQuickEditMealMock.mockResolvedValue({
      meal: currentMeal,
      timeZone: "America/Sao_Paulo",
    });
    getHabitSnapshotsMock.mockResolvedValue([]);
    getUserWhatsappConnectionMock.mockResolvedValue(null);
    processMealInputMock.mockResolvedValue({
      items: [
        {
          foodName: "Queijo parmesão Polenghi",
          canonicalName: "Queijo parmesão Polenghi",
          portionText: "30 g",
          quantity: 30,
          unit: "g",
          servings: 1,
          estimatedGrams: 30,
          calories: 126,
          protein: 10,
          carbs: 1,
          fat: 9,
          confidence: 0.95,
          source: "catalog",
        },
      ],
    });
    updateQuickEditMealMock.mockImplementation(async (_token, input) => ({
      ...currentMeal,
      ...input,
    }));
  });

  it("recalcula quando a tela muda foodName e mantém canonicalName antigo", async () => {
    const result = await updateQuickEditMealWithWhatsappConfirmation(
      "x".repeat(32),
      {
        mealLabel: "Lanche",
        dateTimeLocal: "2026-07-22T12:00",
        items: [
          {
            ...currentItem,
            foodName: "Queijo parmesão Polenghi",
            canonicalName: "1 porção",
            calories: 999,
            protein: 999,
            carbs: 999,
            fat: 999,
          },
        ],
      }
    );

    expect(processMealInputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "30 g de Queijo parmesão Polenghi",
        timeZone: "America/Sao_Paulo",
      })
    );
    expect(updateQuickEditMealMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        items: [
          expect.objectContaining({
            foodName: "Queijo parmesão Polenghi",
            canonicalName: "Queijo parmesão Polenghi",
            calories: 126,
            protein: 10,
            carbs: 1,
            fat: 9,
          }),
        ],
      })
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        canonicalName: "Queijo parmesão Polenghi",
        calories: 126,
      })
    );
  });
});
