import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  legacyIncrement: vi.fn(),
  continuePlan: vi.fn(),
}));
vi.mock("./intent/gramsAdjustmentHandlers", () => ({
  handleMealItemMultiIncrement: mocks.legacyIncrement,
}));
vi.mock("./mixedMealItemIncrementPlan", () => ({
  continueMixedMealItemIncrementPlan: mocks.continuePlan,
}));

import { executeWhatsappGramsIncrementIntent } from "./gramsIncrementIntent";

describe("issue #997 grams increment public intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("encaminha as três operações do comando misto para um único plano", async () => {
    const receivedAt = new Date("2026-08-22T20:00:00.000Z");
    const messageId = "wamid.issue997.public-intent";
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
      receivedAt,
      messageId,
    });
    expect(result?.action).toBe("food_clarification_requested");
    expect(mocks.legacyIncrement).not.toHaveBeenCalled();
    expect(mocks.continuePlan.mock.calls[0][1].operations).toEqual([
      expect.objectContaining({
        targetFood: "requeijao",
        quantity: 48,
        unit: "g",
      }),
      expect.objectContaining({
        targetFood: "presunto",
        quantity: 1,
        unit: "fatia",
      }),
      expect.objectContaining({
        targetFood: "mussarela",
        quantity: 1,
        unit: "fatia",
        inheritedUnit: true,
      }),
    ]);
    expect(mocks.continuePlan.mock.calls[0][1]).toMatchObject({
      receivedAt: receivedAt.toISOString(),
      inboundMessageId: messageId,
    });
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
    await executeWhatsappGramsIncrementIntent(42, {
      text: "Adicionar 20g ao arroz",
    });
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

    expect(result).toEqual(
      expect.objectContaining({
        action: "clarification_needed",
        eventType: "whatsapp.intent.meal_item_increment_parse_incomplete",
        data: expect.objectContaining({
          parsedOperationCount: 2,
          unparsedSegmentCount: 1,
        }),
      })
    );
    expect(mocks.legacyIncrement).not.toHaveBeenCalled();
    expect(mocks.continuePlan).not.toHaveBeenCalled();
  });

  it.each([
    "Adicionar 1 fatia ao presunto, texto estranho",
    "Adicionar 1 fatia ao presunto e",
    "Adicionar 1 fatia ao presunto, e",
    "Adicionar 1 fatia ao presunto e 1 unidade",
    "Adicionar 1 fatia ao presunto e texto estranho e uma na mussarela",
  ])("falha fechado no boundary público diante de residual: %s", async text => {
    const result = await executeWhatsappGramsIncrementIntent(42, { text });

    expect(result).toEqual(
      expect.objectContaining({
        action: "clarification_needed",
        eventType: "whatsapp.intent.meal_item_increment_parse_incomplete",
        data: expect.objectContaining({
          unparsedSegmentCount: expect.any(Number),
        }),
      })
    );
    expect(result?.data?.unparsedSegmentCount as number).toBeGreaterThan(0);
    expect(mocks.legacyIncrement).not.toHaveBeenCalled();
    expect(mocks.continuePlan).not.toHaveBeenCalled();
  });

  it("encaminha integralmente operações separadas por vírgula mais e e por unidade compacta", async () => {
    await executeWhatsappGramsIncrementIntent(42, {
      text: "Adicionar 1 fatia ao presunto, e 1 unidade ao ovo",
    });
    expect(mocks.continuePlan.mock.calls[0][1].operations).toEqual([
      expect.objectContaining({
        targetFood: "presunto",
        quantity: 1,
        unit: "fatia",
      }),
      expect.objectContaining({
        targetFood: "ovo",
        quantity: 1,
        unit: "unidade",
      }),
    ]);

    vi.clearAllMocks();
    await executeWhatsappGramsIncrementIntent(42, {
      text: "Adicionar 1 fatia ao presunto e 1ml ao leite",
    });
    expect(mocks.continuePlan.mock.calls[0][1].operations).toEqual([
      expect.objectContaining({ targetFood: "presunto", unit: "fatia" }),
      expect.objectContaining({ targetFood: "leite", quantity: 1, unit: "ml" }),
    ]);
    expect(mocks.legacyIncrement).not.toHaveBeenCalled();
  });

  it("encaminha decimais, números por extenso e aliases compartilhados sem truncar o plano", async () => {
    await executeWhatsappGramsIncrementIntent(42, {
      text: "Adicionar 1,5 fatias ao presunto e três unidades ao ovo",
    });
    expect(mocks.continuePlan.mock.calls[0][1].operations).toEqual([
      expect.objectContaining({
        targetFood: "presunto",
        quantity: 1.5,
        unit: "fatia",
      }),
      expect.objectContaining({
        targetFood: "ovo",
        quantity: 3,
        unit: "unidade",
      }),
    ]);

    vi.clearAllMocks();
    await executeWhatsappGramsIncrementIntent(42, {
      text: "Adicionar 12grs ao presunto e 2und ao ovo",
    });
    expect(mocks.continuePlan.mock.calls[0][1].operations).toEqual([
      expect.objectContaining({
        targetFood: "presunto",
        quantity: 12,
        unit: "g",
      }),
      expect.objectContaining({
        targetFood: "ovo",
        quantity: 2,
        unit: "unidade",
      }),
    ]);
    expect(mocks.legacyIncrement).not.toHaveBeenCalled();
  });
});
