import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async (input: {
    options?: { actionLines?: string[] };
  }) => input.options?.actionLines?.join("\n") ?? ""),
}));

const {
  createWhatsappCoffeeAdditionClarification,
  PENDING_COFFEE_ADDITION_CLARIFICATION_TTL_MS,
} = await import("./coffeeAdditionClarification");
const { resolvePendingWhatsappFoodClarification } = await import("./foodClarificationGate");
const { createDrizzleWhatsAppPendingOperationRepository } = await import("../../repositories/whatsappPendingOperationRepository");

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => null,
  onWarning: () => {},
});

const start = new Date("2026-08-12T12:00:00.000Z");
const breakfast = {
  id: 970,
  userId: 97001,
  mealLabel: "Café da manhã",
  occurredAt: new Date("2026-08-12T10:00:00.000Z").getTime(),
  notes: "Registro pelo WhatsApp",
  items: [],
};

function mockExistingBreakfast(userId: number) {
  listMealsMock.mockResolvedValue([{ ...breakfast, userId }]);
  updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
    id: 970,
    ...input,
  }));
}

describe("issue #970 - retomada persistente da clarificação parcial de café", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
  });

  it("preserva a refeição e conclui no segundo turno quando faltava somente quantidade", async () => {
    const userId = 97001;
    mockExistingBreakfast(userId);

    const first = await createWhatsappCoffeeAdditionClarification({
      userId,
      originalText: "Adicionar café sem açúcar no café da manhã",
      addition: { cups: 0, unit: null, mealLabel: "café da manhã" },
      receivedAt: start,
    });

    expect(first.action).toBe("clarification_needed");
    expect(first.reply).toContain("Me diga apenas a quantidade");
    expect(first.data).toEqual(expect.objectContaining({
      pendingType: "coffee_addition_clarification",
      preservedMealLabel: "café da manhã",
      preservedQuantity: null,
      missingField: "quantity",
    }));

    const completed = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "3 xícaras",
      receivedAt: new Date(start.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(completed).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_added",
      eventType: "whatsapp.intent.meal_item_added",
    }));
    expect(updateMealMock).toHaveBeenCalledOnce();
    expect(updateMealMock).toHaveBeenCalledWith(userId, expect.objectContaining({
      mealLabel: "Café da manhã",
      items: [expect.objectContaining({
        foodName: "Café sem açúcar",
        quantity: 3,
        unit: "xícara",
      })],
    }));
    expect(completed?.data).toEqual(expect.objectContaining({
      originalTextPreserved: true,
      preservedMealLabel: "café da manhã",
      quantity: 3,
      unit: "xícara",
    }));
    expect(await repository.getActivePendingOperation(userId, new Date(start.getTime() + 1_001))).toBeNull();
  });

  it("preserva quantidade/unidade e conclui no segundo turno quando faltava somente refeição", async () => {
    const userId = 97002;
    mockExistingBreakfast(userId);

    const first = await createWhatsappCoffeeAdditionClarification({
      userId,
      originalText: "Adicionar 3 copos de café sem açúcar",
      addition: { cups: 3, unit: "copo", mealLabel: null },
      receivedAt: start,
    });

    expect(first.reply).toContain("3 copos de café sem açúcar");
    expect(first.reply).toContain("Me diga apenas a refeição");
    expect(first.data).toEqual(expect.objectContaining({
      preservedQuantity: 3,
      preservedUnit: "copo",
      missingField: "meal",
    }));

    const completed = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "café da manhã",
      receivedAt: new Date(start.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(completed?.action).toBe("meal_item_added");
    expect(updateMealMock).toHaveBeenCalledOnce();
    expect(updateMealMock).toHaveBeenCalledWith(userId, expect.objectContaining({
      mealLabel: "Café da manhã",
      items: [expect.objectContaining({ quantity: 3, unit: "copo" })],
    }));
    expect(completed?.reply).toContain("3 copos");
  });


  it("preserva a referência temporal da mensagem original ao completar no turno seguinte", async () => {
    const userId = 97010;
    const temporalStart = new Date("2026-08-12T02:59:00.000Z"); // 11/08 23:59 em São Paulo
    const yesterdayDinner = {
      ...breakfast,
      id: 971,
      userId,
      mealLabel: "Jantar",
      occurredAt: new Date("2026-08-11T01:00:00.000Z").getTime(), // 10/08 22:00 local
    };
    listMealsMock.mockResolvedValue([yesterdayDinner]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 971,
      ...input,
    }));

    await createWhatsappCoffeeAdditionClarification({
      userId,
      originalText: "Adicionar café sem açúcar no jantar de ontem",
      addition: { cups: 0, unit: null, mealLabel: "jantar" },
      receivedAt: temporalStart,
    });

    const completed = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "3 xícaras",
      receivedAt: new Date(temporalStart.getTime() + 2 * 60 * 1000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(completed?.action).toBe("meal_item_added");
    expect(updateMealMock).toHaveBeenCalledWith(userId, expect.objectContaining({
      mealId: 971,
      mealLabel: "Jantar",
      occurredAt: new Date(yesterdayDinner.occurredAt).toISOString(),
    }));
  });

  it("isola a pendência por usuário e não deixa outro usuário consumi-la", async () => {
    const ownerUserId = 97003;
    const otherUserId = 97004;
    await createWhatsappCoffeeAdditionClarification({
      userId: ownerUserId,
      originalText: "Adicionar café sem açúcar no café da manhã",
      addition: { cups: 0, unit: null, mealLabel: "café da manhã" },
      receivedAt: start,
    });

    const other = await resolvePendingWhatsappFoodClarification({
      userId: otherUserId,
      text: "3 xícaras",
      receivedAt: new Date(start.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(other).toBeNull();
    expect(await repository.getActivePendingOperation(ownerUserId, new Date(start.getTime() + 1_001))).not.toBeNull();
    expect(updateMealMock).not.toHaveBeenCalled();
  });


  it("reapresenta a mesma pergunta para resposta inválida sem consumir a pendência", async () => {
    const userId = 97011;
    await createWhatsappCoffeeAdditionClarification({
      userId,
      originalText: "Adicionar café sem açúcar no café da manhã",
      addition: { cups: 0, unit: null, mealLabel: "café da manhã" },
      receivedAt: start,
    });

    const invalid = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "talvez",
      receivedAt: new Date(start.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(invalid).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.interaction.pending_represented",
    }));
    expect(invalid?.reply).toContain("Me diga apenas a quantidade");
    expect(await repository.getActivePendingOperation(userId, new Date(start.getTime() + 1_001))).not.toBeNull();
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("bloqueia resposta repetida depois do consumo e não duplica a mutação", async () => {
    const userId = 97005;
    mockExistingBreakfast(userId);
    await createWhatsappCoffeeAdditionClarification({
      userId,
      originalText: "Adicionar café sem açúcar no café da manhã",
      addition: { cups: 0, unit: null, mealLabel: "café da manhã" },
      receivedAt: start,
    });

    await resolvePendingWhatsappFoodClarification({
      userId,
      text: "3 xícaras",
      receivedAt: new Date(start.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
    });
    const repeated = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "3 xícaras",
      receivedAt: new Date(start.getTime() + 2_000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(repeated).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.coffee_addition_clarification.unavailable",
    }));
    expect(repeated?.data).toEqual(expect.objectContaining({
      fallbackBlocked: true,
      fallbackBlockReason: "stale_coffee_addition_clarification",
    }));
    expect(updateMealMock).toHaveBeenCalledTimes(1);
  });

  it("bloqueia resposta curta após expiração sem mutação", async () => {
    const userId = 97006;
    await createWhatsappCoffeeAdditionClarification({
      userId,
      originalText: "Adicionar café sem açúcar no café da manhã",
      addition: { cups: 0, unit: null, mealLabel: "café da manhã" },
      receivedAt: start,
    });

    const expired = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "3 xícaras",
      receivedAt: new Date(start.getTime() + PENDING_COFFEE_ADDITION_CLARIFICATION_TTL_MS + 1),
      userTimezone: "America/Sao_Paulo",
    });

    expect(expired).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.coffee_addition_clarification.unavailable",
    }));
    expect(updateMealMock).not.toHaveBeenCalled();
  });


  it("consome somente uma vez quando duas respostas chegam concorrentemente", async () => {
    const userId = 97008;
    mockExistingBreakfast(userId);
    await createWhatsappCoffeeAdditionClarification({
      userId,
      originalText: "Adicionar café sem açúcar no café da manhã",
      addition: { cups: 0, unit: null, mealLabel: "café da manhã" },
      receivedAt: start,
    });

    const [first, second] = await Promise.all([
      resolvePendingWhatsappFoodClarification({
        userId,
        text: "3 xícaras",
        receivedAt: new Date(start.getTime() + 1_000),
        userTimezone: "America/Sao_Paulo",
      }),
      resolvePendingWhatsappFoodClarification({
        userId,
        text: "3 xícaras",
        receivedAt: new Date(start.getTime() + 1_000),
        userTimezone: "America/Sao_Paulo",
      }),
    ]);

    expect([first?.action, second?.action]).toContain("meal_item_added");
    expect(updateMealMock).toHaveBeenCalledTimes(1);
  });

  it("cancela a pendência sem alterar refeição", async () => {
    const userId = 97007;
    await createWhatsappCoffeeAdditionClarification({
      userId,
      originalText: "Adicionar 3 xícaras de café sem açúcar",
      addition: { cups: 3, unit: "xícara", mealLabel: null },
      receivedAt: start,
    });

    const cancelled = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "CANCELAR",
      receivedAt: new Date(start.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(cancelled).toEqual(expect.objectContaining({
      eventType: "whatsapp.coffee_addition_clarification.cancelled",
    }));
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(await repository.getActivePendingOperation(userId, new Date(start.getTime() + 1_001))).toBeNull();
  });
});
