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

  it.each(["hoje", "ontem", "anteontem", "amanhã"])(
    "não cria nem altera outra refeição quando a data explícita '%s' não tem o alvo",
    async relativeDate => {
      const result = await executeWhatsappDatedFoodAdditionIntent(42, {
        text: `adicionar ao jantar de ${relativeDate}, 1 porção de canelone`,
        receivedAt: new Date("2026-08-24T18:00:00.000Z"),
        userTimezone: "America/Sao_Paulo",
      });

      expect(result).toEqual(expect.objectContaining({
        handled: true,
        action: "clarification_needed",
        data: expect.objectContaining({ explicitDate: true, mutationBlocked: true }),
      }));
      expect(result?.reply).toContain("Nada foi alterado");
      expect(result?.reply).not.toContain("Refeição registrada:");
      expect(createManualMealMock).not.toHaveBeenCalled();
      expect(updateMealMock).not.toHaveBeenCalled();
      expect(processMealInputMock).not.toHaveBeenCalled();
    },
  );

  it("adiciona itens somente à refeição existente do dia explicitamente interpretado", async () => {
    listMealsMock.mockResolvedValue([{
      id: 10,
      mealLabel: "Jantar",
      occurredAt: "2026-06-29T22:00:00.000Z",
      notes: "já existia",
      items: [buildItem("Arroz")],
    }, {
      id: 9,
      mealLabel: "Jantar",
      occurredAt: "2026-06-28T22:00:00.000Z",
      notes: "mais antigo",
      items: [buildItem("Feijão")],
    }]);
    processMealInputMock.mockResolvedValue({ items: [buildItem("Pão sovado")] });

    const result = await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar ao jantar de ontem, 1 fatia de pão sovado",
      receivedAt: new Date("2026-06-30T14:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 10,
      mealLabel: "Jantar",
      occurredAt: "2026-06-29T22:00:00.000Z",
      items: [
        expect.objectContaining({ foodName: "Arroz" }),
        expect.objectContaining({ foodName: "Pão sovado" }),
      ],
    }));
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_added",
      data: expect.objectContaining({ mealId: 10, explicitDate: true }),
    }));
    expect(result?.reply).toContain("Alimento adicionado");
    expect(result?.reply).toContain("Refeição atualizada:");
    expect(result?.reply).toContain("Arroz");
    expect(result?.reply).toContain("Pão sovado");
  });

  it("não intercepta comando sem data explícita, preservando o fluxo contextual", async () => {
    const result = await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar ao jantar, 1 porção de canelone",
      receivedAt: new Date("2026-08-24T18:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toBeNull();
    expect(listMealsMock).not.toHaveBeenCalled();
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(processMealInputMock).not.toHaveBeenCalled();
  });
});
