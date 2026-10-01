import { beforeEach, describe, expect, it, vi } from "vitest";

const createManualMealMock = vi.fn();
const listMealsMock = vi.fn();
const processMealInputMock = vi.fn();
const updateMealMock = vi.fn();
const listMealSchedulesMock = vi.fn();

vi.mock("../../nutritionEngine", () => ({ resolveCommercialFoodIdentity: vi.fn(),
  processMealInput: processMealInputMock,
}));

vi.mock("../meals/service", () => ({
  createManualMeal: createManualMealMock,
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

vi.mock("../mealSchedules/service", async () => ({
  ...(await vi.importActual<typeof import("../mealSchedules/service")>("../mealSchedules/service")),
  listMealSchedules: listMealSchedulesMock,
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
    listMealSchedulesMock.mockReset();
    listMealsMock.mockResolvedValue([]);
    listMealSchedulesMock.mockResolvedValue([]);
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

  it("mantém registros existentes editáveis quando a agenda habitual foi desativada", async () => {
    listMealSchedulesMock.mockResolvedValue([{
      mealLabel: "jantar",
      startTime: "18:30",
      endTime: "22:59",
      enabled: false,
    }]);
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
      userTimezone: "America/Sao_Paulo",
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({ mealId: 10 }));
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(result?.action).toBe("meal_item_added");
  });

  it("cria a refeição configurada quando o dia ainda não tem um registro", async () => {
    const configuredSchedule = {
      mealLabel: "lanche da tarde",
      startTime: "15:00",
      endTime: "17:29",
      enabled: true,
    };
    listMealSchedulesMock.mockResolvedValue([configuredSchedule]);
    processMealInputMock.mockResolvedValue({ items: [buildItem("Pêra Packans"), buildItem("Banana nanica")] });
    createManualMealMock.mockResolvedValue({
      id: 77,
      mealLabel: configuredSchedule.mealLabel,
      occurredAt: "2026-09-30T18:00:00.000Z",
      items: [buildItem("Pêra Packans"), buildItem("Banana nanica")],
    });

    const result = await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar ao lanche da tarde de ontem, 1 pêra packans e 1 banana nanica",
      receivedAt: new Date("2026-10-01T09:20:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    const processInput = processMealInputMock.mock.calls[0]?.[0];
    expect(processInput).toEqual(expect.objectContaining({
      occurredAt: new Date("2026-09-30T18:00:00.000Z"),
      timeZone: "America/Sao_Paulo",
    }));
    expect(processInput.text).toContain("pêra packans");
    expect(processInput.text).toContain("banana nanica");
    expect(createManualMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealLabel: "lanche da tarde",
      occurredAt: "2026-09-30T18:00:00.000Z",
      items: [
        expect.objectContaining({ foodName: "Pêra Packans" }),
        expect.objectContaining({ foodName: "Banana nanica" }),
      ],
    }));
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_added",
      data: expect.objectContaining({
        mealId: 77,
        mealLabel: "lanche da tarde",
        explicitDate: true,
        createdFromConfiguredSchedule: true,
      }),
    }));
    expect(result?.reply).toContain("Criei a refeição configurada");
  });

  it("reconhece uma refeição habitual com nome livre configurada pelo usuário", async () => {
    const configuredSchedule = {
      mealLabel: "Jantar especial",
      startTime: "09:00",
      endTime: "09:59",
      enabled: true,
    };
    listMealSchedulesMock.mockResolvedValue([configuredSchedule]);

    const result = await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar ao jantar especial de ontem, 1 banana nanica",
      receivedAt: new Date("2026-10-01T09:20:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(createManualMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealLabel: "Jantar especial",
      occurredAt: "2026-09-30T12:00:00.000Z",
    }));
    expect(result).toEqual(expect.objectContaining({
      action: "meal_item_added",
      data: expect.objectContaining({ mealLabel: "Jantar especial", createdFromConfiguredSchedule: true }),
    }));
  });

  it("bloqueia rótulo livre que não está configurado sem acionar o motor nutricional", async () => {
    const result = await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar à colação de ontem, 1 banana nanica",
      receivedAt: new Date("2026-10-01T09:20:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "clarification_needed",
      data: expect.objectContaining({ explicitDate: true, mutationBlocked: true }),
    }));
    expect(result?.reply).toContain("Nada foi alterado");
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("não reduz rótulo composto desconhecido a um schedule canônico parcial", async () => {
    listMealSchedulesMock.mockResolvedValue([{
      mealLabel: "Jantar parcial",
      startTime: "18:30",
      endTime: "22:59",
      enabled: true,
    }]);

    const result = await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar ao jantar especial de ontem, 1 banana nanica",
      receivedAt: new Date("2026-10-01T09:20:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "clarification_needed",
      data: expect.objectContaining({ explicitDate: true, mutationBlocked: true }),
    }));
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
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
