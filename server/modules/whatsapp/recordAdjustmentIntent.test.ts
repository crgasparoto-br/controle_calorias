import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
}));

import { executeWhatsappRecordAdjustmentIntent } from "./recordAdjustmentIntent";

function meal(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    mealLabel: "Almoço",
    occurredAt: "2026-06-14T14:00:00.000Z",
    notes: null,
    items: [{
      foodName: "Arroz branco",
      canonicalName: "Arroz branco",
      portionText: "100 g",
      servings: 1,
      estimatedGrams: 100,
      calories: 130,
      protein: 2.7,
      carbs: 28,
      fat: 0.3,
      confidence: 0.9,
      source: "catalog",
    }],
    ...overrides,
  };
}

describe("executeWhatsappRecordAdjustmentIntent", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
  });

  it("pede confirmacao para corrigir quantidade do unico item da ultima refeicao", async () => {
    listMealsMock.mockResolvedValue([meal()]);

    const result = await executeWhatsappRecordAdjustmentIntent(42, {
      text: "era 150g",
      receivedAt: new Date("2026-06-14T15:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "record_adjustment_confirmation_needed",
      eventType: "whatsapp.records.adjustment_confirmation_needed",
      data: expect.objectContaining({
        adjustmentKind: "quantity",
        mealId: 10,
        itemName: "Arroz branco",
        quantity: 150,
        unit: "g",
      }),
    }));
    expect(result?.reply).toContain("Confirme antes de eu alterar");
  });

  it("pede confirmacao para trocar item com alvo claro em refeicao recente", async () => {
    listMealsMock.mockResolvedValue([meal()]);

    const result = await executeWhatsappRecordAdjustmentIntent(42, {
      text: "troca arroz branco por arroz integral",
      receivedAt: new Date("2026-06-14T15:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "record_adjustment_confirmation_needed",
      data: expect.objectContaining({
        adjustmentKind: "replace_item",
        sourceFood: "Arroz branco",
        targetFood: "arroz integral",
      }),
    }));
    expect(result?.reply).toContain("trocar Arroz branco por arroz integral");
  });

  it("mostra opcoes quando remocao encontra mais de um alvo possivel", async () => {
    listMealsMock.mockResolvedValue([meal({
      items: [
        { foodName: "Frango grelhado", canonicalName: "Frango grelhado", portionText: "100 g", servings: 1, estimatedGrams: 100, calories: 165, protein: 31, carbs: 0, fat: 3.6, confidence: 0.9, source: "catalog" },
        { foodName: "Frango desfiado", canonicalName: "Frango desfiado", portionText: "80 g", servings: 0.8, estimatedGrams: 80, calories: 132, protein: 25, carbs: 0, fat: 2.9, confidence: 0.9, source: "catalog" },
      ],
    })]);

    const result = await executeWhatsappRecordAdjustmentIntent(42, {
      text: "remove frango",
      receivedAt: new Date("2026-06-14T15:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "record_adjustment_selection_needed",
      eventType: "whatsapp.records.adjustment_selection_needed",
      data: expect.objectContaining({
        adjustmentKind: "remove_item",
        optionCount: 2,
        options: expect.arrayContaining([
          expect.objectContaining({ id: "10:0", label: expect.stringContaining("Frango grelhado") }),
          expect.objectContaining({ id: "10:1", label: expect.stringContaining("Frango desfiado") }),
        ]),
      }),
    }));
    expect(result?.reply).toContain("1. Frango grelhado");
    expect(result?.reply).toContain("2. Frango desfiado");
    expect(result?.reply).toContain("Responda com o número");
  });

  it("nao aplica ajuste quando nao existe refeicao recente segura", async () => {
    listMealsMock.mockResolvedValue([meal({ occurredAt: "2026-06-12T14:00:00.000Z" })]);

    const result = await executeWhatsappRecordAdjustmentIntent(42, {
      text: "apaga o último",
      receivedAt: new Date("2026-06-14T15:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "record_adjustment_clarification_needed",
      data: expect.objectContaining({ adjustmentKind: "remove_last_meal", recentWindowHours: 24 }),
    }));
    expect(result?.reply).toContain("Nao encontrei uma refeicao recente segura");
  });
});
