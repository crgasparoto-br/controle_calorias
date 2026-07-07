import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const removeMealMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  removeMeal: removeMealMock,
  updateMeal: updateMealMock,
}));

const { __resetWhatsappDeleteIntentsForTests, executeWhatsappDeleteIntent } = await import("./deleteIntent");

const latestMeal = {
  id: 10,
  mealLabel: "Almoço",
  occurredAt: "2026-06-23T15:00:00.000Z",
  notes: "foto",
  items: [
    { foodName: "Arroz", portionText: "100 g", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
    { foodName: "Frango", portionText: "120 g", calories: 190, protein: 35, carbs: 0, fat: 4 },
  ],
};

const namedMeal = {
  ...latestMeal,
  items: [
    { foodName: "Bife entrecote", portionText: "150 g", calories: 330, protein: 32, carbs: 0, fat: 22 },
    { foodName: "Banana prata", portionText: "1 unidade", calories: 80, protein: 1, carbs: 20, fat: 0.2 },
    { foodName: "Queijo Minas Padrão Fatiado", portionText: "30 g", calories: 90, protein: 6, carbs: 1, fat: 7 },
  ],
};

describe("executeWhatsappDeleteIntent confirmation by WhatsApp message", () => {
  beforeEach(() => {
    __resetWhatsappDeleteIntentsForTests();
    listMealsMock.mockReset();
    removeMealMock.mockReset();
    updateMealMock.mockReset();
  });

  it("solicita confirmacao e exclui refeicao quando usuario responde sim", async () => {
    listMealsMock.mockResolvedValue([latestMeal]);
    removeMealMock.mockResolvedValue(undefined);

    const request = await executeWhatsappDeleteIntent(42, { text: "exclua refeição fotografada" });
    const confirmation = await executeWhatsappDeleteIntent(42, { text: "SIM" });

    expect(request).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.intent.delete_meal_confirmation_requested",
    }));
    expect(request?.reply).toContain("Responda SIM");
    expect(removeMealMock).toHaveBeenCalledWith(42, 10);
    expect(confirmation).toEqual(expect.objectContaining({
      action: "meal_deleted",
      eventType: "whatsapp.intent.meal_deleted",
    }));
  });

  it("cancela exclusao pendente quando usuario responde cancelar", async () => {
    listMealsMock.mockResolvedValue([latestMeal]);

    await executeWhatsappDeleteIntent(42, { text: "remover refeição" });
    const cancellation = await executeWhatsappDeleteIntent(42, { text: "cancelar" });

    expect(removeMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(cancellation).toEqual(expect.objectContaining({
      action: "delete_cancelled",
      eventType: "whatsapp.intent.delete_cancelled",
    }));
  });

  it("remove ultimo alimento apos confirmacao por mensagem", async () => {
    listMealsMock.mockResolvedValue([latestMeal]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ ...latestMeal, ...input }));

    const request = await executeWhatsappDeleteIntent(42, { text: "apagar o último alimento" });
    const confirmation = await executeWhatsappDeleteIntent(42, { text: "autorizo" });

    expect(request).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.intent.delete_food_confirmation_requested",
    }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 10,
      items: [latestMeal.items[0]],
    }));
    expect(confirmation).toEqual(expect.objectContaining({
      action: "meal_item_deleted",
      eventType: "whatsapp.intent.meal_item_deleted",
    }));
  });

  it("encontra alimento por nome exato e nao pede quantidade", async () => {
    listMealsMock.mockResolvedValue([namedMeal]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ ...namedMeal, ...input }));

    const request = await executeWhatsappDeleteIntent(42, { text: "Exclua o bife entrecote" });
    const confirmation = await executeWhatsappDeleteIntent(42, { text: "sim" });

    expect(request?.reply).toContain("Encontrei o item Bife entrecote");
    expect(request?.reply).not.toContain("quantidade");
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 10,
      items: [namedMeal.items[1], namedMeal.items[2]],
    }));
    expect(confirmation).toEqual(expect.objectContaining({
      action: "meal_item_deleted",
      data: expect.objectContaining({ removedFoodName: "Bife entrecote" }),
    }));
  });

  it("encontra alimento por nome parcial quando ha um unico candidato", async () => {
    listMealsMock.mockResolvedValue([namedMeal]);

    const request = await executeWhatsappDeleteIntent(42, { text: "Remova a banana" });

    expect(request?.reply).toContain("Encontrei o item Banana prata");
    expect(request?.reply).not.toContain("quantidade");
  });

  it("encontra alimento por duas palavras parciais", async () => {
    listMealsMock.mockResolvedValue([namedMeal]);

    const request = await executeWhatsappDeleteIntent(42, { text: "Tire o queijo Minas" });

    expect(request?.reply).toContain("Encontrei o item Queijo Minas Padrão Fatiado");
    expect(request?.reply).not.toContain("quantidade");
  });

  it("pede esclarecimento quando o nome combina com multiplos candidatos", async () => {
    listMealsMock.mockResolvedValue([{
      ...latestMeal,
      items: [
        { foodName: "Queijo Minas", portionText: "30 g", calories: 80, protein: 5, carbs: 1, fat: 6 },
        { foodName: "Queijo prato", portionText: "30 g", calories: 100, protein: 6, carbs: 1, fat: 8 },
      ],
    }]);

    const request = await executeWhatsappDeleteIntent(42, { text: "Remova o queijo" });

    expect(request).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.intent.delete_food_clarification_needed",
    }));
    expect(request?.reply).toContain("mais de um alimento parecido");
    expect(request?.reply).toContain("1. Queijo Minas");
    expect(request?.reply).toContain("2. Queijo prato");
  });

  it("mantem ajuste de quantidade fora do fluxo de remocao inteira", async () => {
    listMealsMock.mockResolvedValue([namedMeal]);

    const request = await executeWhatsappDeleteIntent(42, { text: "Remova 20g do bife entrecote" });

    expect(request).toBeNull();
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(removeMealMock).not.toHaveBeenCalled();
  });

  it("exclui refeicao quando o ultimo alimento removido era o unico item", async () => {
    const singleItemMeal = { ...latestMeal, items: [latestMeal.items[0]] };
    listMealsMock.mockResolvedValue([singleItemMeal]);
    removeMealMock.mockResolvedValue(undefined);

    await executeWhatsappDeleteIntent(42, { text: "remover esse alimento" });
    const confirmation = await executeWhatsappDeleteIntent(42, { text: "pode remover" });

    expect(removeMealMock).toHaveBeenCalledWith(42, 10);
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(confirmation).toEqual(expect.objectContaining({
      action: "meal_deleted",
      eventType: "whatsapp.intent.meal_deleted_after_last_item_removed",
    }));
  });
});
