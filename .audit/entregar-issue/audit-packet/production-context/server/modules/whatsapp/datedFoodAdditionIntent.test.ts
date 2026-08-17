import { beforeEach, describe, expect, it, vi } from "vitest";

const createManualMealMock = vi.fn();
const listMealsMock = vi.fn();
const processMealInputMock = vi.fn();
const updateMealMock = vi.fn();

vi.mock("../../nutritionEngine", () => ({
  processMealInput: processMealInputMock,
}));

vi.mock("../meals/service", () => ({
  createManualMeal: createManualMealMock,
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

const { executeWhatsappDatedFoodAdditionIntent } = await import("./datedFoodAdditionIntent");

function buildItem(foodName = "Canelone") {
  return {
    foodName,
    canonicalName: foodName,
    portionText: "1 porção",
    quantity: 1,
    unit: "porção",
    servings: 1,
    estimatedGrams: 100,
    calories: 150,
    protein: 6,
    carbs: 15,
    fat: 5,
    confidence: 0.7,
    source: "heuristic" as const,
  };
}

describe("executeWhatsappDatedFoodAdditionIntent", () => {
  beforeEach(() => {
    createManualMealMock.mockReset();
    listMealsMock.mockReset();
    processMealInputMock.mockReset();
    updateMealMock.mockReset();
    listMealsMock.mockResolvedValue([]);
    processMealInputMock.mockResolvedValue({ items: [buildItem()] });
    createManualMealMock.mockImplementation(async (_userId, input) => ({ id: 99, ...input }));
    updateMealMock.mockImplementation(async (_userId, input) => ({ id: input.mealId, ...input }));
  });

  it("cria nova refeição na data de ontem quando o jantar ainda não existe", async () => {
    const result = await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar ao jantar de ontem, uma porção de canelone, 1 fatia de pão sovado, 20g requeijão catupiry, 1 fatia de peito de perú, 1 fatia de mussarela, 1 água tônica antartica, 15g koala, 110g leite integral",
      receivedAt: new Date("2026-06-30T14:00:00.000Z"),
    });

    expect(processMealInputMock).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("canelone"),
      occurredAt: expect.any(Date),
      timeZone: "America/Sao_Paulo",
    }));
    expect(createManualMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealLabel: "jantar",
      occurredAt: expect.stringMatching(/^2026-06-29T/),
      items: [expect.objectContaining({ foodName: "Canelone" })],
    }));
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_added",
      data: expect.objectContaining({
        mealId: 99,
        mealLabel: "jantar",
        occurredAt: expect.stringMatching(/^2026-06-29T/),
      }),
    }));
    expect(result?.reply).toContain("Refeição registrada:");
    expect(result?.reply).not.toContain("Refeição atualizada:");
    expect(result?.reply).toContain("Canelone");
    expect(result?.reply).toContain("Total da refeição:");
  });

  it("adiciona itens à refeição existente do dia interpretado e responde com a refeição completa", async () => {
    listMealsMock.mockResolvedValue([{
      id: 10,
      mealLabel: "Jantar",
      occurredAt: "2026-06-29T22:00:00.000Z",
      notes: "já existia",
      items: [buildItem("Arroz")],
    }]);
    processMealInputMock.mockResolvedValue({ items: [buildItem("Pão sovado")] });

    const result = await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar ao jantar de ontem, 1 fatia de pão sovado",
      receivedAt: new Date("2026-06-30T14:00:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 10,
      mealLabel: "Jantar",
      occurredAt: "2026-06-29T22:00:00.000Z",
      notes: "já existia",
      items: [
        expect.objectContaining({ foodName: "Arroz" }),
        expect.objectContaining({ foodName: "Pão sovado" }),
      ],
    }));
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_added",
      data: expect.objectContaining({ mealId: 10 }),
    }));
    expect(result?.reply).toContain("Alimento adicionado");
    expect(result?.reply).toContain("Refeição atualizada:");
    expect(result?.reply).toContain("Arroz");
    expect(result?.reply).toContain("Pão sovado");
    expect(result?.reply).toContain("Total da refeição:");
  });
});
