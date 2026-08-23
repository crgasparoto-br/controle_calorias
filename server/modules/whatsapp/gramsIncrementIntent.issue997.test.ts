import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ legacyIncrement: vi.fn(), continuePlan: vi.fn() }));
vi.mock("./intent/gramsAdjustmentHandlers", () => ({ handleMealItemMultiIncrement: mocks.legacyIncrement }));
vi.mock("./mixedMealItemIncrementPlan", () => ({ continueMixedMealItemIncrementPlan: mocks.continuePlan }));

import { executeWhatsappGramsIncrementIntent } from "./gramsIncrementIntent";

describe("issue #997 grams increment public intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("encaminha as três operações do comando misto para um único plano", async () => {
    mocks.continuePlan.mockResolvedValueOnce({
      handled: true,
      action: "food_clarification_requested",
      reply: "informe peso",
      eventType: "whatsapp.food_clarification.requested",
      detail: "plano pendente",
    });
    const result = await executeWhatsappGramsIncrementIntent(42, {
      text: "Adicionar 48g ao requeijão, 1 fatia ao presunto e uma na mussarela",
      userTimezone: "America/Sao_Paulo",
    });
    expect(result?.action).toBe("food_clarification_requested");
    expect(mocks.legacyIncrement).not.toHaveBeenCalled();
    expect(mocks.continuePlan.mock.calls[0][1].operations).toEqual([
      expect.objectContaining({ targetFood: "requeijao", quantity: 48, unit: "g" }),
      expect.objectContaining({ targetFood: "presunto", quantity: 1, unit: "fatia" }),
      expect.objectContaining({ targetFood: "mussarela", quantity: 1, unit: "fatia", inheritedUnit: true }),
    ]);
  });

  it("mantém o caminho existente para comandos somente em gramas", async () => {
    mocks.legacyIncrement.mockResolvedValueOnce({
      handled: true,
      action: "meal_item_grams_adjusted",
      reply: "recalculei os macros",
      eventType: "whatsapp.intent.meal_item_grams_adjusted",
      detail: "ok",
      data: { adjustments: [] },
    });
    await executeWhatsappGramsIncrementIntent(42, { text: "Adicionar 20g ao arroz" });
    expect(mocks.legacyIncrement).toHaveBeenCalled();
    expect(mocks.continuePlan).not.toHaveBeenCalled();
  });

  it("deixa adições por medidas domésticas fora do parser seguirem para o fluxo canônico", async () => {
    const coffee = await executeWhatsappGramsIncrementIntent(42, {
      text: "Adicionar 3 xícaras de café sem açúcar no café da manhã",
    });
    const milk = await executeWhatsappGramsIncrementIntent(42, {
      text: "Adicionar 1 copo de leite no café da manhã",
    });

    expect(coffee).toBeNull();
    expect(milk).toBeNull();
    expect(mocks.legacyIncrement).not.toHaveBeenCalled();
    expect(mocks.continuePlan).not.toHaveBeenCalled();
  });

  it("continua bloqueando sucesso parcial quando há operação suportada e segmento desconhecido", async () => {
    const result = await executeWhatsappGramsIncrementIntent(42, {
      text: "Adicionar 48g ao requeijão, 1 xícara de café e 1 fatia ao presunto",
    });

    expect(result).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.intent.meal_item_increment_parse_incomplete",
      data: expect.objectContaining({
        parsedOperationCount: 2,
        unparsedSegmentCount: 1,
      }),
    }));
    expect(mocks.legacyIncrement).not.toHaveBeenCalled();
    expect(mocks.continuePlan).not.toHaveBeenCalled();
  });
});
