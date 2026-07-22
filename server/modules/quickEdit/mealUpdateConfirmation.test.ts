import { beforeEach, describe, expect, it, vi } from "vitest";

const getQuickEditMealMock = vi.fn();
const updateQuickEditMealMock = vi.fn();
const processMealInputMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const composeReplyMock = vi.fn();
const sendReplyMock = vi.fn();
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
  composeWhatsAppMealActionReply: composeReplyMock,
}));
vi.mock("../whatsapp/replyTransport", () => ({
  sendWhatsAppLogicalReply: sendReplyMock,
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

const currentMeal = {
  id: 456,
  mealLabel: "Lanche",
  occurredAt: "2026-07-22T15:00:00.000Z",
  items: [
    {
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
    },
  ],
};

describe("quick edit meal update confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitMock.mockResolvedValue([{ userId: 123 }]);
    getQuickEditMealMock.mockResolvedValue({
      meal: currentMeal,
      timeZone: "America/Sao_Paulo",
    });
    getHabitSnapshotsMock.mockResolvedValue([]);
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
          confidence: 0.9,
          source: "catalog",
        },
      ],
    });
    updateQuickEditMealMock.mockImplementation(async (_token, input) => ({
      ...currentMeal,
      ...input,
    }));
    getUserWhatsappConnectionMock.mockResolvedValue({
      phoneNumber: "5511999999999",
      status: "active",
    });
    composeReplyMock.mockResolvedValue("Refeição atualizada com 126 kcal.");
    sendReplyMock.mockResolvedValue({ primaryOk: true, sends: [{ ok: true }] });
  });

  it("recalcula alimento alterado no backend e envia confirmação pelo WhatsApp", async () => {
    const result = await updateQuickEditMealWithWhatsappConfirmation(
      "x".repeat(32),
      {
        mealLabel: "Lanche",
        dateTimeLocal: "2026-07-22T12:00",
        items: [
          {
            ...currentMeal.items[0],
            foodName: "Queijo parmesão Polenghi",
            canonicalName: "Queijo parmesão Polenghi",
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
            calories: 126,
            protein: 10,
            carbs: 1,
            fat: 9,
          }),
        ],
      })
    );
    expect(composeReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        meal: expect.objectContaining({
          items: [expect.objectContaining({ calories: 126 })],
        }),
      })
    );
    expect(sendReplyMock).toHaveBeenCalledWith("5511999999999", {
      text: "Refeição atualizada com 126 kcal.",
    });
    expect(result.items[0].calories).toBe(126);
  });

  it("recalcula no backend quando apenas a quantidade heurística muda", async () => {
    processMealInputMock.mockResolvedValueOnce({
      items: [
        {
          ...currentMeal.items[0],
          quantity: 60,
          estimatedGrams: 60,
          portionText: "60 g",
          calories: 252,
          protein: 20,
          carbs: 2,
          fat: 18,
        },
      ],
    });

    const result = await updateQuickEditMealWithWhatsappConfirmation(
      "x".repeat(32),
      {
        mealLabel: "Lanche",
        dateTimeLocal: "2026-07-22T12:00",
        items: [
          {
            ...currentMeal.items[0],
            quantity: 60,
            estimatedGrams: 60,
            portionText: "60 g",
            calories: 999,
          },
        ],
      }
    );

    expect(processMealInputMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: "60 g de 30G" })
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({ calories: 252, estimatedGrams: 60 })
    );
  });

  it("preserva a edição quando a entrega da confirmação falha", async () => {
    sendReplyMock.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(
      updateQuickEditMealWithWhatsappConfirmation("x".repeat(32), {
        mealLabel: "Lanche",
        dateTimeLocal: "2026-07-22T12:00",
        items: currentMeal.items,
      })
    ).resolves.toEqual(expect.objectContaining({ id: 456 }));
    expect(logInferenceEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "quick_edit.whatsapp_confirmation_failed",
      })
    );
  });
});
