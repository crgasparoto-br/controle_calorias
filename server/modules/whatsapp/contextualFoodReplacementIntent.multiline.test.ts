import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const updateMealsWithCompensationMock = vi.hoisted(() => vi.fn());
const createPendingMealItemSelectionMock = vi.hoisted(() => vi.fn());
const composeWhatsAppMealActionRepliesMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({ listMeals: listMealsMock }));
vi.mock("./mealBatchMutation", () => ({
  updateMealsWithCompensation: updateMealsWithCompensationMock,
  describeMealBatchMutationFailure: vi.fn(),
}));
vi.mock("./mealItemSelectionCallback", () => ({
  createPendingMealItemSelection: createPendingMealItemSelectionMock,
}));
vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReplies: composeWhatsAppMealActionRepliesMock,
}));
vi.mock("../../db", () => ({ getHabitSnapshots: vi.fn() }));
vi.mock("../../nutritionEngine", () => ({ processMealInput: vi.fn() }));
vi.mock("./foodQuantityClarification", () => ({
  requestWhatsappLatestFoodCorrectionQuantity: vi.fn(),
}));

import { executeWhatsappContextualFoodReplacementIntent } from "./contextualFoodReplacementIntent";

function item(foodName: string) {
  return {
    foodName,
    canonicalName: foodName,
    portionText: "50 g",
    servings: 1,
    estimatedGrams: 50,
    calories: 100,
    protein: 5,
    carbs: 10,
    fat: 4,
    confidence: 0.9,
    source: "catalog" as const,
  };
}

function meal(id: number, items: ReturnType<typeof item>[]) {
  return {
    id,
    userId: 42,
    source: "whatsapp",
    mealLabel: "Lanche",
    occurredAt: new Date("2026-07-26T12:00:00.000Z").getTime(),
    items,
  };
}

describe("substituições contextuais separadas por linhas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMealsMock.mockResolvedValue([
      meal(1, [item("Requeijão"), item("Presunto")]),
    ]);
    updateMealsWithCompensationMock.mockImplementation(
      async (_userId: number, changes: Array<{ after: Record<string, unknown> }>) =>
        changes.map(change => change.after)
    );
    composeWhatsAppMealActionRepliesMock.mockResolvedValue("resumo atualizado");
    createPendingMealItemSelectionMock.mockResolvedValue({
      handled: true,
      action: "clarification_needed",
      reply: "selecione",
      eventType: "whatsapp.intent.meal_item_selection_requested",
      detail: "pendente",
    });
  });

  it.each([
    [
      "LF",
      "Não é requeijão, é maionese.\nNão é presunto, é mortadela defumada",
    ],
    [
      "CRLF",
      "Não é requeijão, é maionese.\r\nNão é presunto, é mortadela defumada",
    ],
    [
      "linhas em branco e espaços",
      "  Não é requeijão, é maionese.  \n\n   Não é presunto, é mortadela defumada  ",
    ],
    [
      "ponto e vírgula sem espaço entre comandos 'trocar'",
      "Trocar requeijão por maionese;Trocar presunto por mortadela defumada",
    ],
    [
      "vírgula sem espaço entre comandos 'substituir'",
      "Substituir requeijão por maionese,Substituir presunto por mortadela defumada",
    ],
    [
      "ponto e vírgula sem espaço entre correções 'não é'",
      "Não é requeijão, é maionese;Não é presunto, é mortadela defumada",
    ],
  ])("aplica todas as correções com %s em um único lote", async (_label, text) => {
    const result = await executeWhatsappContextualFoodReplacementIntent(42, {
      text,
      receivedAt: new Date("2026-07-26T12:05:00.000Z"),
    });

    expect(updateMealsWithCompensationMock).toHaveBeenCalledOnce();
    expect(updateMealsWithCompensationMock).toHaveBeenCalledWith(42, [
      expect.objectContaining({
        after: expect.objectContaining({
          id: 1,
          items: [
            expect.objectContaining({ foodName: "maionese" }),
            expect.objectContaining({ foodName: "mortadela defumada" }),
          ],
        }),
      }),
    ]);
    expect(composeWhatsAppMealActionRepliesMock).toHaveBeenCalledWith({
      userId: 42,
      entries: [
        expect.objectContaining({
          options: expect.objectContaining({
            title: "Alimentos substituídos",
            actionLines: [
              "Requeijão → maionese",
              "Presunto → mortadela defumada",
            ],
          }),
        }),
      ],
    });
    expect(result).toEqual(
      expect.objectContaining({
        action: "meal_item_replaced",
        reply: "resumo atualizado",
        data: expect.objectContaining({ mealIds: [1] }),
      })
    );
  });

  it("aceita as sintaxes de troca existentes em linhas separadas", async () => {
    await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "Trocar requeijão por maionese\nSubstituir presunto por mortadela defumada",
      receivedAt: new Date("2026-07-26T12:05:00.000Z"),
    });

    expect(updateMealsWithCompensationMock).toHaveBeenCalledOnce();
    expect(composeWhatsAppMealActionRepliesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            options: expect.objectContaining({
              actionLines: [
                "Requeijão → maionese",
                "Presunto → mortadela defumada",
              ],
            }),
          }),
        ],
      })
    );
  });

  it("mantém o separador existente 'e não'", async () => {
    await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "não é requeijão, é maionese e não é presunto, é mortadela defumada",
      receivedAt: new Date("2026-07-26T12:05:00.000Z"),
    });

    expect(updateMealsWithCompensationMock).toHaveBeenCalledOnce();
    expect(composeWhatsAppMealActionRepliesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            options: expect.objectContaining({
              actionLines: [
                "Requeijão → maionese",
                "Presunto → mortadela defumada",
              ],
            }),
          }),
        ],
      })
    );
  });

  it("bloqueia o lote inteiro quando uma linha de substituição está incompleta", async () => {
    const result = await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "Não é requeijão, é maionese.\nNão é presunto",
      receivedAt: new Date("2026-07-26T12:05:00.000Z"),
    });

    expect(listMealsMock).not.toHaveBeenCalled();
    expect(updateMealsWithCompensationMock).not.toHaveBeenCalled();
    expect(createPendingMealItemSelectionMock).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: "clarification_needed",
        eventType: "whatsapp.intent.clarification_needed",
        reply: expect.stringContaining("todas as substituições"),
      })
    );
  });

  it("preserva destinos e não grava quando uma correção em outra linha é ambígua", async () => {
    listMealsMock.mockResolvedValue([
      meal(1, [item("Queijo minas"), item("Pão francês")]),
      {
        ...meal(2, [item("Queijo mussarela"), item("Pão integral")]),
        mealLabel: "Jantar",
        occurredAt: new Date("2026-07-26T11:55:00.000Z").getTime(),
      },
    ]);

    const result = await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "não é queijo, é ricota\nnão é pão, é tapioca",
      receivedAt: new Date("2026-07-26T12:05:00.000Z"),
    });

    expect(updateMealsWithCompensationMock).not.toHaveBeenCalled();
    expect(createPendingMealItemSelectionMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        targetFood: "queijo",
        action: { kind: "replace_food", targetFood: "ricota" },
        remainingSelections: [
          expect.objectContaining({
            targetFood: "pão",
            action: { kind: "replace_food", targetFood: "tapioca" },
          }),
        ],
      })
    );
    expect(result?.action).toBe("clarification_needed");
  });
});
