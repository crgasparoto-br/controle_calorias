import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());
const createPendingMealItemSelectionMock = vi.hoisted(() => vi.fn());

vi.mock("../../meals/service", () => ({ listMeals: listMealsMock, updateMeal: updateMealMock }));
vi.mock("../mealItemSelectionCallback", () => ({ createPendingMealItemSelection: createPendingMealItemSelectionMock }));

import { handleMealItemMultiIncrement } from "./gramsAdjustmentHandlers";

function item(foodName: string, grams: number) {
  return {
    foodName,
    canonicalName: foodName,
    portionText: `${grams} g`,
    quantity: grams,
    unit: "g",
    servings: 1,
    estimatedGrams: grams,
    calories: grams,
    protein: 5,
    carbs: 10,
    fat: 2,
    confidence: 0.9,
    source: "catalog" as const,
  };
}

describe("issue #783 — atomicidade e identidade de candidatos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPendingMealItemSelectionMock.mockResolvedValue({ handled: true, action: "clarification_needed", reply: "selecione", eventType: "whatsapp.intent.meal_item_selection_requested", detail: "pendente", data: {} });
  });

  it("não persiste o ajuste claro quando outro alvo da mesma mensagem é ambíguo", async () => {
    listMealsMock.mockResolvedValue([
      { id: 10, mealLabel: "Jantar", occurredAt: "2026-07-12T22:00:00.000Z", items: [item("Arroz branco", 100)] },
      { id: 20, mealLabel: "Almoço", occurredAt: "2026-07-12T16:00:00.000Z", items: [item("Queijo minas", 50)] },
      { id: 30, mealLabel: "Café da manhã", occurredAt: "2026-07-12T11:00:00.000Z", items: [item("Queijo mussarela", 40)] },
    ]);

    const result = await handleMealItemMultiIncrement(42, [
      { targetFood: "arroz", gramsDelta: 20 },
      { targetFood: "queijo", gramsDelta: 10 },
    ]);

    expect(updateMealMock).not.toHaveBeenCalled();
    expect(createPendingMealItemSelectionMock).toHaveBeenCalledWith(42, expect.objectContaining({
      action: { kind: "grams_delta", delta: 10 },
      candidates: expect.arrayContaining([
        expect.objectContaining({ mealId: 20, mealLabel: "Almoço", itemName: "Queijo minas" }),
        expect.objectContaining({ mealId: 30, mealLabel: "Café da manhã", itemName: "Queijo mussarela" }),
      ]),
      companionActions: [expect.objectContaining({ candidate: expect.objectContaining({ mealId: 10, itemName: "Arroz branco" }), action: { kind: "grams_delta", delta: 20 } })],
    }));
    expect(result.action).toBe("clarification_needed");
  });

  it("encadeia todas as ambiguidades de gramas da mesma mensagem", async () => {
    listMealsMock.mockResolvedValue([
      { id: 10, mealLabel: "Jantar", occurredAt: "2026-07-12T22:00:00.000Z", items: [item("Arroz branco", 100)] },
      { id: 20, mealLabel: "Almoço", occurredAt: "2026-07-12T16:00:00.000Z", items: [item("Queijo minas", 50), item("Pão francês", 60)] },
      { id: 30, mealLabel: "Café da manhã", occurredAt: "2026-07-12T11:00:00.000Z", items: [item("Queijo mussarela", 40), item("Pão integral", 55)] },
    ]);

    const result = await handleMealItemMultiIncrement(42, [
      { targetFood: "queijo", gramsDelta: 10 },
      { targetFood: "pão", gramsDelta: 25 },
    ]);

    expect(updateMealMock).not.toHaveBeenCalled();
    expect(createPendingMealItemSelectionMock).toHaveBeenCalledWith(42, expect.objectContaining({
      targetFood: "queijo",
      action: { kind: "grams_delta", delta: 10 },
      candidates: expect.arrayContaining([
        expect.objectContaining({ mealId: 20, itemName: "Queijo minas" }),
        expect.objectContaining({ mealId: 30, itemName: "Queijo mussarela" }),
      ]),
      remainingSelections: [expect.objectContaining({
        targetFood: "pão",
        action: { kind: "grams_delta", delta: 25 },
        candidates: expect.arrayContaining([
          expect.objectContaining({ mealId: 20, itemName: "Pão francês" }),
          expect.objectContaining({ mealId: 30, itemName: "Pão integral" }),
        ]),
      })],
    }));
    expect(result.action).toBe("clarification_needed");
  });

  it("identifica cada refeição e limita as ações ao bloco correspondente", async () => {
    const meals = [
      { id: 10, mealLabel: "Jantar", occurredAt: "2026-07-12T22:00:00.000Z", items: [item("Arroz branco", 100)] },
      { id: 20, mealLabel: "Almoço", occurredAt: "2026-07-12T16:00:00.000Z", items: [item("Feijão carioca", 80)] },
    ];
    listMealsMock.mockResolvedValue(meals);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await handleMealItemMultiIncrement(42, [
      { targetFood: "arroz", gramsDelta: 20 },
      { targetFood: "feijão", gramsDelta: 10 },
    ]);

    expect(updateMealMock).toHaveBeenCalledTimes(2);
    expect(result.reply.match(/🍽️ \*Jantar\* — \d{2}:\d{2}/g)).toHaveLength(1);
    expect(result.reply.match(/🍽️ \*Almoço\* — \d{2}:\d{2}/g)).toHaveLength(1);
    expect(result.reply.match(/Refeição atualizada:/g)).toHaveLength(2);
    expect(result.reply.match(/\*Total da refeição\*/g)).toHaveLength(2);

    const blockStarts = Array.from(result.reply.matchAll(/\*Alimentos ajustados\*/g), match => match.index ?? 0);
    expect(blockStarts).toHaveLength(2);
    const jantarBlock = result.reply.slice(blockStarts[0], blockStarts[1]);
    const almocoBlock = result.reply.slice(blockStarts[1]);

    expect(jantarBlock).toContain("• Arroz branco: de 100 g para 120 g");
    expect(jantarBlock).not.toContain("Feijão carioca: de 80 g para 90 g");
    expect(jantarBlock).toContain("Arroz branco");
    expect(jantarBlock).not.toContain("Feijão carioca");

    expect(almocoBlock).toContain("• Feijão carioca: de 80 g para 90 g");
    expect(almocoBlock).not.toContain("Arroz branco: de 100 g para 120 g");
    expect(almocoBlock).toContain("Feijão carioca");
    expect(almocoBlock).not.toContain("Arroz branco");
    expect(result.data).toEqual(expect.objectContaining({ affectedMealIds: expect.arrayContaining([10, 20]) }));
  });
});
