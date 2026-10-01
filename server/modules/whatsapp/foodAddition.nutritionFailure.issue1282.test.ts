import { beforeEach, describe, expect, it, vi } from "vitest";

type ProcessedItem = {
  foodName: string;
  canonicalName: string;
  portionText: string;
  servings: number;
  estimatedGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  source: "catalog";
};

function buildItem(grams: number, foodName: string): ProcessedItem {
  return {
    foodName,
    canonicalName: foodName,
    portionText: `${grams} g`,
    servings: 1,
    estimatedGrams: grams,
    calories: grams,
    protein: grams / 100,
    carbs: grams / 10,
    fat: grams / 100,
    confidence: 0.9,
    source: "catalog",
  };
}

/** Motor nutricional controlável: cobre indisponibilidade, vazio e lote ambíguo. */
const processMealInputMock = vi.fn(async () => null as unknown);

vi.mock("../../nutritionEngine", async () => {
  const actual = await vi.importActual<typeof import("../../nutritionEngine")>(
    "../../nutritionEngine",
  );
  return {
    ...actual,
    processMealInput: (input: { text: string }) => processMealInputMock(input),
  };
});

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
vi.mock("../meals/service", () => ({
  listMeals: (...args: unknown[]) => listMealsMock(...args),
  updateMeal: (...args: unknown[]) => updateMealMock(...args),
  createMeal: vi.fn(),
  deleteMeal: vi.fn(),
}));

const { executeWhatsappTextIntent } = await import("./intentActions");
const { upsertUserWhatsappConnection } = await import("../../db");

const USER_ID = 2280219;
const RECEIVED_AT = new Date("2026-10-01T21:46:00.000Z");
const TIME_ZONE = "America/Sao_Paulo";
const PRODUCTION_MESSAGE = "Adicionar ao café da manhã 1,5 fatias de mortadela";

const BREAKFAST_MEAL = {
  id: 92001,
  userId: USER_ID,
  mealLabel: "Café da manhã",
  occurredAt: RECEIVED_AT.toISOString(),
  notes: null,
  items: [
    {
      foodName: "Pão francês",
      canonicalName: "Pão francês",
      portionText: "50 g",
      servings: 1,
      estimatedGrams: 50,
      calories: 135,
      protein: 4.5,
      carbs: 28,
      fat: 1.5,
      confidence: 0.9,
      source: "catalog",
    },
  ],
};

async function run(text: string) {
  return executeWhatsappTextIntent(USER_ID, {
    text,
    receivedAt: RECEIVED_AT,
    userTimezone: TIME_ZONE,
  });
}

describe("issue #1282 — falha do motor nutricional na adição canônica", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await upsertUserWhatsappConnection({
      userId: USER_ID,
      phoneNumber: "5511228021900",
      displayName: "Issue 1282",
    });
    listMealsMock.mockResolvedValue([BREAKFAST_MEAL]);
    updateMealMock.mockImplementation(
      async (_userId: number, input: Record<string, unknown>) => ({
        id: input.mealId,
        userId: USER_ID,
        mealLabel: input.mealLabel,
        occurredAt: input.occurredAt,
        notes: input.notes ?? null,
        items: input.items,
      }),
    );
  });

  it.each([
    ["motor indisponível (null)", () => null],
    ["resposta sem itens", () => ({ items: [] })],
    ["lote ambíguo com dois itens", () => ({
      items: [buildItem(22.5, "mortadela"), buildItem(50, "pão francês")],
    })],
  ])(
    "responde de forma controlada quando o motor retorna %s",
    async (_label, engineResult) => {
      processMealInputMock.mockImplementation(async () => engineResult() as unknown);

      const result = await run(PRODUCTION_MESSAGE);

      // Nunca lança: a mensagem de produção precisa de retorno ao usuário.
      expect(result?.action).toBe("clarification_needed");
      expect(result?.eventType).toBe("whatsapp.food_addition.nutrition_failure");
      expect(String(result?.reply ?? "")).toContain("Não consegui concluir agora");
      expect(String(result?.reply ?? "")).toMatch(/nada foi adicionado à refeição/i);
      // Falha anterior à mutação: a refeição permanece intacta.
      expect(updateMealMock).not.toHaveBeenCalled();
    },
  );

  it("mantém a adição funcionando quando o motor responde com um único item", async () => {
    processMealInputMock.mockImplementation(async () => ({
      items: [buildItem(22.5, "mortadela")],
    }));

    const result = await run(PRODUCTION_MESSAGE);

    expect(result?.action).toBe("meal_item_added");
    expect(result?.data).toEqual(
      expect.objectContaining({
        mealLabel: "Café da manhã",
        foodName: "mortadela",
        quantity: 1.5,
        unit: "fatia",
        estimatedGrams: 22.5,
      }),
    );
    expect(updateMealMock).toHaveBeenCalledTimes(1);
  });

  it("não converte falha do motor em clarificação de quantidade enganosa", async () => {
    processMealInputMock.mockImplementation(async () => null);

    const result = await run(PRODUCTION_MESSAGE);

    expect(String(result?.reply ?? "")).not.toMatch(
      /informe somente o peso|informe o peso|peso ou volume correspondente/i,
    );
  });
});
