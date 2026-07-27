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

describe("substituições contextuais combinadas com outras ações", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      label: "ajuste absoluto de quantidade",
      text: "Não é arroz, é batata\nCorrigir feijão para 150 g",
      expectedAction: "multi_action_confirmation_needed",
      expectedTypes: ["trocar_alimento", "corrigir_alimento"],
    },
    {
      label: "remoção",
      text: "Não é arroz, é batata\nRemover cerveja",
      expectedAction: "multi_action_confirmation_needed",
      expectedTypes: ["trocar_alimento", "excluir_alimento"],
    },
    {
      label: "adição sem quantidade",
      text: "Não é arroz, é batata\nAdicionar banana",
      expectedAction: "multi_action_clarification_needed",
      expectedTypes: ["trocar_alimento", "adicionar_alimento"],
    },
  ])(
    "delega lote misto com $label ao parser multi-ação sem consultar ou alterar refeições",
    async ({ text, expectedAction, expectedTypes }) => {
      const result = await executeWhatsappContextualFoodReplacementIntent(42, {
        text,
        receivedAt: new Date("2026-07-27T11:00:00.000Z"),
      });

      expect(result).toEqual(
        expect.objectContaining({
          handled: true,
          action: expectedAction,
          data: expect.objectContaining({
            actionCount: 2,
            transactionMode: "all_or_nothing",
            partialSuccessAllowed: false,
          }),
        })
      );
      expect(
        (result?.data?.extractedActions as Array<{ actionType: string }>).map(
          action => action.actionType
        )
      ).toEqual(expectedTypes);
      expect(listMealsMock).not.toHaveBeenCalled();
      expect(updateMealsWithCompensationMock).not.toHaveBeenCalled();
      expect(createPendingMealItemSelectionMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    "Não é arroz, é batata\nCorrigir",
    "Não é arroz, é batata\nRemover",
  ])(
    "mantém fail-closed quando a ação companheira está incompleta: %s",
    async text => {
      const result = await executeWhatsappContextualFoodReplacementIntent(42, {
        text,
        receivedAt: new Date("2026-07-27T11:00:00.000Z"),
      });

      expect(result).toEqual(
        expect.objectContaining({
          action: "clarification_needed",
          eventType: "whatsapp.intent.clarification_needed",
          reply: expect.stringContaining("todas as substituições"),
        })
      );
      expect(listMealsMock).not.toHaveBeenCalled();
      expect(updateMealsWithCompensationMock).not.toHaveBeenCalled();
    }
  );
});
