import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMeals: vi.fn(),
  countableIncrement: vi.fn(),
  updateBatch: vi.fn(),
  requestQuantity: vi.fn(),
  createSelection: vi.fn(),
  compose: vi.fn(),
}));

vi.mock("../meals/service", () => ({ listMeals: mocks.listMeals }));
vi.mock("../foods/countablePortionConversion", () => ({
  getCountableIncrementGrams: mocks.countableIncrement,
}));
vi.mock("./mealBatchMutation", () => ({
  updateMealsWithCompensation: mocks.updateBatch,
  describeMealBatchMutationFailure: () => ({
    userMessage: "falhou",
    detail: "falhou",
    rollbackSucceeded: true,
  }),
}));
vi.mock("./foodQuantityClarification", () => ({
  requestWhatsappMealItemIncrementQuantityClarification: mocks.requestQuantity,
}));
vi.mock("./mealItemSelectionCallback", () => ({
  createPendingMealItemSelection: mocks.createSelection,
}));
vi.mock("./mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReplies: mocks.compose,
}));

import { continueMixedMealItemIncrementPlan } from "./mixedMealItemIncrementPlan";

function item(
  foodName: string,
  grams: number,
  foodId?: number | null,
  overrides: Partial<{
    canonicalName: string;
    brand: string;
    brandName: string;
    productVariant: string;
    foodCatalogId: number | null;
    foodVariantId: number | null;
    nutritionProfileId: number | null;
    foodPortionId: number | null;
    portionId: number | null;
    portionQuantity: number | null;
  }> = {}
) {
  return {
    ...(foodId !== undefined ? { foodId } : {}),
    ...(overrides.foodCatalogId !== undefined
      ? { foodCatalogId: overrides.foodCatalogId }
      : {}),
    ...(overrides.foodVariantId !== undefined
      ? { foodVariantId: overrides.foodVariantId }
      : {}),
    ...(overrides.nutritionProfileId !== undefined
      ? { nutritionProfileId: overrides.nutritionProfileId }
      : {}),
    ...(overrides.foodPortionId !== undefined
      ? { foodPortionId: overrides.foodPortionId }
      : {}),
    ...(overrides.portionId !== undefined
      ? { portionId: overrides.portionId }
      : {}),
    ...(overrides.portionQuantity !== undefined
      ? { portionQuantity: overrides.portionQuantity }
      : {}),
    foodName,
    canonicalName: overrides.canonicalName ?? foodName,
    ...(overrides.brand ? { brand: overrides.brand } : {}),
    ...(overrides.brandName ? { brandName: overrides.brandName } : {}),
    ...(overrides.productVariant
      ? { productVariant: overrides.productVariant }
      : {}),
    quantity: grams,
    unit: "g",
    portionText: `${grams} g`,
    servings: 1,
    estimatedGrams: grams,
    calories: grams,
    protein: 1,
    carbs: 1,
    fat: 1,
    confidence: 0.8,
    source: "catalog" as const,
  };
}

function countableItem(
  foodName: string,
  grams: number,
  quantity: number,
  unit: "fatia" | "unidade",
  foodId?: number,
  overrides: Parameters<typeof item>[3] = {}
) {
  const unitLabel =
    unit === "fatia"
      ? quantity === 1
        ? "fatia"
        : "fatias"
      : quantity === 1
        ? "unidade"
        : "unidades";
  return {
    ...item(foodName, grams, foodId, overrides),
    quantity,
    unit,
    portionText: `${quantity} ${unitLabel}`,
  };
}

function meal(items: ReturnType<typeof item>[]) {
  return {
    id: 10,
    mealLabel: "Café da manhã",
    occurredAt: new Date("2026-08-22T10:00:00.000Z"),
    notes: "",
    items,
  };
}

const basePlan = {
  contractVersion: 1 as const,
  originalText:
    "Adicionar 48g ao requeijão, 1 fatia ao presunto e uma na mussarela",
  mealLabel: null,
  timeZone: "America/Sao_Paulo",
  operations: [
    { targetFood: "requeijao", quantity: 48, unit: "g" as const },
    { targetFood: "presunto", quantity: 1, unit: "fatia" as const },
    {
      targetFood: "mussarela",
      quantity: 1,
      unit: "fatia" as const,
      inheritedUnit: true,
    },
  ],
};

describe("issue #997 atomic mixed increment plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countableIncrement.mockResolvedValue(null);
    mocks.compose.mockResolvedValue("ok");
    mocks.requestQuantity.mockResolvedValue({
      handled: true,
      action: "food_clarification_requested",
      reply: "informe peso",
      eventType: "whatsapp.food_clarification.requested",
      detail: "pendente",
      data: { pendingOperationId: 901 },
    });
    mocks.createSelection.mockResolvedValue({
      handled: true,
      action: "clarification_needed",
      reply: "selecione",
      eventType: "whatsapp.intent.meal_item_selection_requested",
      detail: "pendente",
      data: { pendingOperationId: 902 },
    });
  });

  it("não persiste os 48 g enquanto uma fatia ainda precisa de clarificação", async () => {
    mocks.listMeals.mockResolvedValue([
      meal([
        item("Requeijão Catupiry Light", 45, 1),
        item("Presunto", 20, undefined, { brand: "Sadia" }),
        item("Mussarela", 20),
      ]),
    ]);

    const result = await continueMixedMealItemIncrementPlan(42, basePlan);

    expect(result.action).toBe("food_clarification_requested");
    expect(mocks.updateBatch).not.toHaveBeenCalled();
    const persistedPlan = mocks.requestQuantity.mock.calls[0][0].plan;
    expect(persistedPlan.operations[0].gramsDelta).toBe(48);
    expect(persistedPlan.operations[1].gramsDelta).toBeUndefined();
  });

  it("bloqueia antes da primeira escrita quando um plano composto cruza refeições", async () => {
    const breakfast = meal([item("Arroz branco", 100)]);
    const dinner = {
      ...meal([item("Feijão carioca", 80)]),
      id: 20,
      mealLabel: "Jantar",
    };
    mocks.listMeals.mockResolvedValue([breakfast, dinner]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [
        { targetFood: "Arroz branco", quantity: 10, unit: "g" },
        { targetFood: "Feijão carioca", quantity: 15, unit: "g" },
      ],
    });

    expect(result.eventType).toBe(
      "whatsapp.intent.meal_item_increment_plan_multi_meal_blocked"
    );
    expect(result.data).toEqual({ affectedMealIds: [10, 20] });
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("usa a porção persistida do alimento e o conversor canônico antes do lote", async () => {
    const initial = meal([
      item("Requeijão Catupiry Light", 45, 1),
      countableItem("Presunto", 20, 1, "fatia", 2),
      countableItem("Mussarela", 20, 1, "fatia", 3),
    ]);
    mocks.listMeals.mockResolvedValue([initial]);
    mocks.countableIncrement
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(30);
    mocks.updateBatch.mockResolvedValue([initial]);

    const result = await continueMixedMealItemIncrementPlan(42, basePlan);

    expect(result.action).toBe("meal_item_grams_adjusted");
    expect(mocks.countableIncrement).toHaveBeenCalledTimes(2);
    expect(mocks.countableIncrement).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: 42,
        quantity: 1,
        unit: "fatia",
        item: expect.objectContaining({ foodId: 2 }),
      })
    );
    expect(mocks.countableIncrement).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: 42,
        quantity: 1,
        unit: "fatia",
        item: expect.objectContaining({ foodId: 3 }),
      })
    );
    expect(mocks.updateBatch).toHaveBeenCalledTimes(1);
    expect(mocks.requestQuantity).not.toHaveBeenCalled();
    const updatedItems = mocks.updateBatch.mock.calls[0][1][0].after.items;
    expect(updatedItems[0].estimatedGrams).toBe(93);
    expect(updatedItems[1]).toMatchObject({
      quantity: 2,
      unit: "fatia",
      portionText: "2 fatias",
      estimatedGrams: 40,
    });
    expect(updatedItems[2]).toMatchObject({
      quantity: 2,
      unit: "fatia",
      portionText: "2 fatias",
      estimatedGrams: 50,
    });
  });

  it("reutiliza a porção local canônica após releitura quando o item não possui foodId", async () => {
    const initial = meal([countableItem("Presunto", 18, 1, "fatia")]);
    mocks.listMeals.mockResolvedValue([initial]);
    mocks.countableIncrement.mockResolvedValue(18);
    mocks.updateBatch.mockResolvedValue([initial]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 1, unit: "fatia" }],
    });

    expect(result.action).toBe("meal_item_grams_adjusted");
    expect(mocks.countableIncrement).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        item: expect.objectContaining({ foodName: "Presunto" }),
        quantity: 1,
        unit: "fatia",
      })
    );
    expect(mocks.countableIncrement.mock.calls[0][0].item).not.toHaveProperty(
      "foodId"
    );
    const updated = mocks.updateBatch.mock.calls[0][1][0].after.items[0];
    expect(updated).toMatchObject({
      quantity: 2,
      unit: "fatia",
      portionText: "2 fatias",
      estimatedGrams: 36,
    });
  });

  it.each([
    { foodCatalogId: 2 },
    { foodVariantId: 4 },
    { nutritionProfileId: 5 },
    { foodPortionId: 6 },
    { portionId: 3 },
    { portionQuantity: 1 },
  ])(
    "falha fechado sem fallback local quando existe identidade parcial: %o",
    async identity => {
      const initial = meal([
        countableItem("Presunto", 18, 1, "fatia", undefined, identity),
      ]);
      mocks.listMeals.mockResolvedValue([initial]);

      const result = await continueMixedMealItemIncrementPlan(42, {
        ...basePlan,
        operations: [{ targetFood: "presunto", quantity: 1, unit: "fatia" }],
      });

      expect(result.action).toBe("food_clarification_requested");
      expect(mocks.countableIncrement).toHaveBeenCalledWith(
        expect.objectContaining({
          item: expect.objectContaining(identity),
        })
      );
      expect(mocks.updateBatch).not.toHaveBeenCalled();
    }
  );

  it("não trata um foodId zero como identidade local recuperável", async () => {
    const initial = meal([countableItem("Presunto", 18, 1, "fatia", 0)]);
    mocks.listMeals.mockResolvedValue([initial]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 1, unit: "fatia" }],
    });

    expect(result.action).toBe("food_clarification_requested");
    expect(mocks.countableIncrement).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({ foodId: 0 }),
      })
    );
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("não rebaixa item com marca a porção local genérica e preserva correlação na clarificação", async () => {
    const initial = meal([
      countableItem("Presunto", 20, 1, "fatia", undefined, { brand: "Sadia" }),
    ]);
    const receivedAt = new Date("2026-08-22T20:00:00.000Z");
    const responseAt = new Date(receivedAt.getTime() + 9 * 60 * 1000);
    const messageId = "wamid.issue997.branded-increment";
    mocks.listMeals.mockResolvedValue([initial]);

    const result = await continueMixedMealItemIncrementPlan(
      42,
      {
        ...basePlan,
        receivedAt: receivedAt.toISOString(),
        inboundMessageId: messageId,
        operations: [{ targetFood: "presunto", quantity: 1, unit: "fatia" }],
      },
      { receivedAt: responseAt }
    );

    expect(result.action).toBe("food_clarification_requested");
    expect(mocks.countableIncrement).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({ brand: "Sadia" }),
      })
    );
    expect(mocks.updateBatch).not.toHaveBeenCalled();
    expect(mocks.requestQuantity).toHaveBeenCalledWith(
      expect.objectContaining({
        receivedAt: responseAt,
        messageId,
        plan: expect.objectContaining({
          receivedAt: receivedAt.toISOString(),
          inboundMessageId: messageId,
        }),
      })
    );
  });

  it("revalida o alvo imediatamente antes da escrita e bloqueia plano stale", async () => {
    const initial = meal([item("Requeijão Catupiry Light", 45)]);
    const changed = meal([item("Outro alimento", 45)]);
    mocks.listMeals
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([changed]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "requeijao", quantity: 48, unit: "g" }],
    });

    expect(result.eventType).toBe(
      "whatsapp.intent.meal_item_increment_plan_stale"
    );
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("bloqueia substituição no mesmo índice quando o nome permanece igual mas o foodId mudou", async () => {
    const initial = meal([item("Presunto", 20, 101)]);
    const changed = meal([item("Presunto", 20, 202)]);
    mocks.listMeals
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([changed]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 10, unit: "g" }],
    });

    expect(result.eventType).toBe(
      "whatsapp.intent.meal_item_increment_plan_stale"
    );
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("reidentifica o item selecionado quando homônimos com foodId distintos trocam de posição", async () => {
    const initial = meal([
      item("Presunto", 20, 101),
      item("Presunto", 20, 202),
    ]);
    mocks.listMeals.mockResolvedValue([initial]);
    const receivedAt = "2026-08-22T20:00:00.000Z";
    const inboundMessageId = "wamid.issue997.selection";

    await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      receivedAt,
      inboundMessageId,
      operations: [{ targetFood: "presunto", quantity: 1, unit: "fatia" }],
    });

    const pendingSelection = mocks.createSelection.mock.calls[0][1];
    const selected = pendingSelection.candidates[0];
    expect(selected.itemFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(pendingSelection.continuation.plan).toMatchObject({
      receivedAt,
      inboundMessageId,
    });

    const changed = meal([
      item("Presunto", 20, 202),
      item("Presunto", 20, 101),
    ]);
    mocks.listMeals.mockReset();
    mocks.listMeals.mockResolvedValue([changed]);
    mocks.updateBatch.mockResolvedValue([changed]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [
        {
          targetFood: "presunto",
          quantity: 10,
          unit: "g",
          target: selected,
          gramsDelta: 10,
          resolvedBy: "explicit_mass_or_volume",
        },
      ],
    });

    expect(result.action).toBe("meal_item_grams_adjusted");
    const changes = mocks.updateBatch.mock.calls[0][1];
    expect(changes[0].after.items[0].foodId).toBe(202);
    expect(changes[0].after.items[0].estimatedGrams).toBe(20);
    expect(changes[0].after.items[1].foodId).toBe(101);
    expect(changes[0].after.items[1].estimatedGrams).toBe(30);
  });

  it("usa identidade semântica para itens sem foodId e bloqueia troca de marca com o mesmo nome", async () => {
    const initial = meal([item("Presunto", 20, undefined, { brand: "Sadia" })]);
    const changed = meal([
      item("Presunto", 20, undefined, { brand: "Perdigão" }),
    ]);
    mocks.listMeals
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([changed]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 10, unit: "g" }],
    });

    expect(result.eventType).toBe(
      "whatsapp.intent.meal_item_increment_plan_stale"
    );
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("permite que um item sem foodId mude de índice quando a identidade permanece inequívoca", async () => {
    const initial = meal([
      item("Presunto", 20, undefined, { brand: "Sadia" }),
      item("Queijo minas", 30, undefined, { brand: "Marca B" }),
    ]);
    const changed = meal([
      item("Queijo minas", 30, undefined, { brand: "Marca B" }),
      item("Presunto", 20, undefined, { brand: "Sadia" }),
    ]);
    mocks.listMeals
      .mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([changed]);
    mocks.updateBatch.mockResolvedValue([changed]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 10, unit: "g" }],
    });

    expect(result.action).toBe("meal_item_grams_adjusted");
    const changes = mocks.updateBatch.mock.calls[0][1];
    expect(changes[0].after.items[0].foodName).toBe("Queijo minas");
    expect(changes[0].after.items[0].estimatedGrams).toBe(30);
    expect(changes[0].after.items[1].foodName).toBe("Presunto");
    expect(changes[0].after.items[1].estimatedGrams).toBe(30);
  });

  it("falha fechado quando dois itens sem identificador possuem fingerprint indistinguível", async () => {
    const initial = meal([item("Presunto", 20), item("Presunto", 20)]);
    mocks.listMeals.mockResolvedValue([initial]);

    await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 10, unit: "g" }],
    });

    const selected = mocks.createSelection.mock.calls[0][1].candidates[0];
    mocks.listMeals.mockReset();
    mocks.listMeals.mockResolvedValue([initial]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [
        {
          targetFood: "presunto",
          quantity: 10,
          unit: "g",
          target: selected,
          gramsDelta: 10,
          resolvedBy: "explicit_mass_or_volume",
        },
      ],
    });

    expect(result.eventType).toBe(
      "whatsapp.intent.meal_item_increment_plan_stale"
    );
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("rejects a physical V2 target before V1 portion lookup or batch mutation", async () => {
    const protectedItem = {
      ...item("Presunto", 20, 101),
      v2SnapshotVerified: true as const,
      historicalRef: "variant:201",
    };
    mocks.listMeals.mockResolvedValue([meal([protectedItem])]);
    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 1, unit: "fatia" }],
    });
    expect(result.eventType).toBe("whatsapp.intent.meal_item_increment_requires_v2");
    expect(mocks.countableIncrement).not.toHaveBeenCalled();
    expect(mocks.updateBatch).not.toHaveBeenCalled();
    expect(mocks.requestQuantity).not.toHaveBeenCalled();
  });

  it("blocks V2 ownership appearing between plan selection and final readback", async () => {
    const legacyItem = item("Presunto", 20, 101);
    const protectedItem = {
      ...legacyItem, v2SnapshotVerified: true as const,
      historicalRef: "variant:201",
    };
    const initial = meal([legacyItem]);
    mocks.listMeals.mockResolvedValueOnce([initial])
      .mockResolvedValueOnce([meal([protectedItem])]);
    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 10, unit: "g" }],
    });
    expect(result.eventType).toBe("whatsapp.intent.meal_item_increment_requires_v2");
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("pré-valida todos os alvos antes de aplicar duas operações ao mesmo item", async () => {
    const initial = meal([item("Requeijão Catupiry Light", 45, 1)]);
    mocks.listMeals.mockResolvedValue([initial]);
    mocks.updateBatch.mockResolvedValue([initial]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [
        { targetFood: "requeijao", quantity: 10, unit: "g" },
        { targetFood: "requeijao", quantity: 5, unit: "g" },
      ],
    });

    expect(result.action).toBe("meal_item_grams_adjusted");
    const changes = mocks.updateBatch.mock.calls[0][1];
    expect(changes[0].after.items[0].estimatedGrams).toBe(60);
  });
});
