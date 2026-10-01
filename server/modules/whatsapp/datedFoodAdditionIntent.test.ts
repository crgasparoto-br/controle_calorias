import { beforeEach, describe, expect, it, vi } from "vitest";

const handleFoodAdditionIntentMock = vi.fn();
const listMealSchedulesMock = vi.fn();

vi.mock("./intent/foodAdditionHandlers", () => ({
  handleFoodAdditionIntent: handleFoodAdditionIntentMock,
}));

vi.mock("../mealSchedules/service", async () => ({
  ...(await vi.importActual<typeof import("../mealSchedules/service")>("../mealSchedules/service")),
  listMealSchedules: listMealSchedulesMock,
}));

const { executeWhatsappDatedFoodAdditionIntent } = await import("./datedFoodAdditionIntent");

const receivedAt = new Date("2026-10-01T09:20:00.000Z");
const handledResult = {
  handled: true as const,
  action: "meal_item_added" as const,
  reply: "resposta canônica",
  eventType: "whatsapp.intent.meal_item_added",
  detail: "adição canônica",
};

describe("executeWhatsappDatedFoodAdditionIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMealSchedulesMock.mockResolvedValue([]);
    handleFoodAdditionIntentMock.mockResolvedValue(handledResult);
  });

  it("não intercepta comando sem data explícita", async () => {
    const result = await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar ao jantar, 1 porção de canelone",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toBeNull();
    expect(listMealSchedulesMock).not.toHaveBeenCalled();
    expect(handleFoodAdditionIntentMock).not.toHaveBeenCalled();
  });

  it("não intercepta água sem quantidade, preservando o intent especializado", async () => {
    const result = await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar água ontem",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toBeNull();
    expect(handleFoodAdditionIntentMock).not.toHaveBeenCalled();
  });

  it("delega adição alimentar datada completa ao handler canônico", async () => {
    const result = await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar ao jantar de ontem, 1 fatia de pão sovado",
      receivedAt: new Date("2026-06-30T14:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(handleFoodAdditionIntentMock).toHaveBeenCalledWith(
      42,
      {
        mealLabel: "jantar",
        date: new Date("2026-06-29T14:00:00.000Z"),
        items: [{ foodName: "pão sovado", quantity: 1, unit: "fatia", brand: null }],
      },
      "America/Sao_Paulo",
      {
        originalText: "adicionar ao jantar de ontem, 1 fatia de pão sovado",
        receivedAt: new Date("2026-06-30T14:00:00.000Z"),
      },
    );
    expect(result).toBe(handledResult);
  });

  it("passa rótulo livre configurado ao handler canônico", async () => {
    listMealSchedulesMock.mockResolvedValue([{
      mealLabel: "Jantar especial",
      startTime: "09:00",
      endTime: "09:59",
      enabled: true,
    }]);

    await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar ao jantar especial de ontem, 1 banana nanica",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(handleFoodAdditionIntentMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        mealLabel: "Jantar especial",
        items: [{ foodName: "banana nanica", quantity: 1, unit: "unidade", brand: null }],
      }),
      "America/Sao_Paulo",
      expect.objectContaining({ originalText: "adicionar ao jantar especial de ontem, 1 banana nanica" }),
    );
  });

  it("não delega destino livre desconhecido como se fosse refeição configurada", async () => {
    listMealSchedulesMock.mockResolvedValue([{
      mealLabel: "Jantar parcial",
      startTime: "18:30",
      endTime: "22:59",
      enabled: true,
    }]);

    const result = await executeWhatsappDatedFoodAdditionIntent(42, {
      text: "adicionar ao jantar especial de ontem, 1 banana nanica",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toBeNull();
    expect(handleFoodAdditionIntentMock).not.toHaveBeenCalled();
  });
});
