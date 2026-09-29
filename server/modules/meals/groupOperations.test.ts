import { beforeEach, describe, expect, it, vi } from "vitest";

type TestMealItem = {
  foodName: string;
  canonicalName: string;
  portionText: string;
  servings: number;
  estimatedGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  source: "catalog" | "hybrid" | "heuristic";
};

type TestStoredMeal = {
  id: number;
  mealLabel: string;
  occurredAt: number;
  notes?: string;
  source: "web" | "whatsapp";
  items: TestMealItem[];
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
};

const createManualMealMock = vi.fn();
const getDbMock = vi.fn();
const listMealsMock = vi.fn();
const logInferenceEventMock = vi.fn();
const moveMealItemMock = vi.fn();
const removeMealMock = vi.fn();
const updateMealMock = vi.fn();
const updateMealItemServiceMock = vi.fn();

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((left: unknown, right: unknown) => [left, right]),
}));

vi.mock("../../../drizzle/schema", () => ({
  mealFavorites: {
    userId: "userId",
    name: "name",
  },
}));

vi.mock("../../db", () => ({
  getDb: getDbMock,
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("./service", () => ({
  createManualMeal: createManualMealMock,
  listMeals: listMealsMock,
  moveMealItem: moveMealItemMock,
  removeMeal: removeMealMock,
  updateMeal: updateMealMock,
  updateMealItem: updateMealItemServiceMock,
}));

const { copyMealGroup, removeMealGroup, updateMealGroup, updateMealItem } = await import("./groupOperations");

function buildMeal(overrides: Partial<TestStoredMeal>): TestStoredMeal {
  return {
    id: overrides.id ?? 1,
    mealLabel: overrides.mealLabel ?? "almoço",
    occurredAt: overrides.occurredAt ?? new Date("2026-05-21T12:00:00.000Z").getTime(),
    notes: overrides.notes,
    source: overrides.source ?? "web",
    items: overrides.items ?? [
      {
        foodName: "Arroz",
        canonicalName: "Arroz",
        portionText: "100 g",
        servings: 1,
        estimatedGrams: 100,
        calories: 130,
        protein: 3,
        carbs: 28,
        fat: 0,
        confidence: 1,
        source: "catalog",
      },
    ],
    totals: overrides.totals ?? { calories: 130, protein: 3, carbs: 28, fat: 0 },
  };
}

describe("meal group operations", () => {
  beforeEach(() => {
    createManualMealMock.mockReset();
    getDbMock.mockReset();
    listMealsMock.mockReset();
    logInferenceEventMock.mockReset();
    moveMealItemMock.mockReset();
    removeMealMock.mockReset();
    updateMealMock.mockReset();
    updateMealItemServiceMock.mockReset();
  });

  it("atualiza somente o item selecionado quando a refeição não muda", async () => {
    const rice = buildMeal({}).items[0];
    const beans = { ...rice, foodName: "Feijão", canonicalName: "Feijão" };
    const meal = buildMeal({ id: 10, items: [rice, beans] });
    listMealsMock.mockResolvedValue([meal]);
    updateMealItemServiceMock.mockResolvedValue(buildMeal({ id: 10, items: [{ ...rice, portionText: "120 g", estimatedGrams: 120 }, beans] }));

    await updateMealItem(42, {
      mealId: 10,
      itemIndex: 0,
      mealLabel: "almoço",
      item: { ...rice, portionText: "120 g", estimatedGrams: 120 },
    });

    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(updateMealItemServiceMock).toHaveBeenCalledWith(42, expect.objectContaining({
      sourceMeal: meal,
      itemIndex: 0,
      targetMealLabel: "almoço",
      item: expect.objectContaining({ foodName: "Arroz", portionText: "120 g" }),
    }));
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("move somente o item selecionado para outra refeição", async () => {
    const rice = buildMeal({}).items[0];
    const beans = { ...rice, foodName: "Feijão", canonicalName: "Feijão" };
    const meal = buildMeal({ id: 10, mealLabel: "almoço", items: [rice, beans], notes: "observação do almoço" });
    listMealsMock.mockResolvedValue([meal]);
    moveMealItemMock.mockResolvedValue({
      moved: true,
      meal: buildMeal({
        id: 99,
        mealLabel: "jantar",
        items: [{ ...rice, portionText: "120 g", estimatedGrams: 120 }],
      }),
      sourceMeal: buildMeal({ id: 10, mealLabel: "almoço", items: [beans] }),
    });

    const result = await updateMealItem(42, {
      mealId: 10,
      itemIndex: 0,
      mealLabel: "jantar",
      item: { ...rice, portionText: "120 g", estimatedGrams: 120 },
    });

    expect(moveMealItemMock).toHaveBeenCalledWith(42, {
      sourceMeal: meal,
      itemIndex: 0,
      targetMealLabel: "jantar",
      occurredAt: "2026-05-21T12:00:00.000Z",
      item: expect.objectContaining({ foodName: "Arroz", portionText: "120 g" }),
    });
    expect(result).toEqual(expect.objectContaining({ moved: true }));
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it.each([-1, 2, 99])("rejeita itemIndex inválido (%s) antes de qualquer mutação", async itemIndex => {
    const rice = buildMeal({}).items[0];
    const beans = { ...rice, foodName: "Feijão", canonicalName: "Feijão" };
    const meal = buildMeal({ id: 10, items: [rice, beans] });
    listMealsMock.mockResolvedValue([meal]);

    await expect(updateMealItem(42, {
      mealId: 10,
      itemIndex,
      mealLabel: "jantar",
      item: rice,
    })).rejects.toThrow("Alimento não encontrado na refeição.");

    expect(moveMealItemMock).not.toHaveBeenCalled();
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("reclassifica o mesmo registro quando o item é o único da refeição", async () => {
    const meal = buildMeal({ id: 10, mealLabel: "almoço" });
    listMealsMock.mockResolvedValue([meal]);
    updateMealItemServiceMock.mockResolvedValue(buildMeal({ id: 10, mealLabel: "jantar" }));

    await updateMealItem(42, {
      mealId: 10,
      itemIndex: 0,
      mealLabel: "jantar",
      item: meal.items[0],
    });

    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(updateMealItemServiceMock).toHaveBeenCalledWith(42, expect.objectContaining({
      sourceMeal: meal,
      itemIndex: 0,
      targetMealLabel: "jantar",
      item: expect.objectContaining({ foodName: "Arroz" }),
    }));
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("propaga falha da movimentação atômica sem iniciar mutações paralelas", async () => {
    const rice = buildMeal({}).items[0];
    const beans = { ...rice, foodName: "Feijão", canonicalName: "Feijão" };
    const meal = buildMeal({ id: 10, mealLabel: "almoço", items: [rice, beans] });
    listMealsMock.mockResolvedValue([meal]);
    moveMealItemMock.mockRejectedValue(new Error("falha ao atualizar origem"));

    await expect(updateMealItem(42, {
      mealId: 10,
      itemIndex: 0,
      mealLabel: "jantar",
      item: rice,
    })).rejects.toThrow("falha ao atualizar origem");

    expect(moveMealItemMock).toHaveBeenCalledOnce();
    expect(createManualMealMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(removeMealMock).not.toHaveBeenCalled();
  });

  it("copia todos os itens do grupo em uma nova refeição", async () => {
    const meals = [
      buildMeal({ id: 10, mealLabel: "almoço", notes: "primeiro" }),
      buildMeal({
        id: 11,
        mealLabel: "almoço",
        notes: "segundo",
        items: [
          {
            foodName: "Feijão",
            canonicalName: "Feijão",
            portionText: "90 g",
            servings: 1,
            estimatedGrams: 90,
            calories: 77,
            protein: 5,
            carbs: 14,
            fat: 1,
            confidence: 1,
            source: "catalog",
          },
        ],
        totals: { calories: 77, protein: 5, carbs: 14, fat: 1 },
      }),
    ];
    listMealsMock.mockResolvedValue(meals);
    createManualMealMock.mockResolvedValue({ id: 99, items: meals.flatMap(meal => meal.items) });

    await copyMealGroup(42, {
      mealIds: [10, 11],
      mealLabel: "jantar",
      occurredAt: "2026-05-22T12:00:00.000Z",
    });

    expect(createManualMealMock).toHaveBeenCalledWith(42, {
      mealLabel: "jantar",
      occurredAt: "2026-05-22T12:00:00.000Z",
      notes: "primeiro\n\nsegundo",
      items: [
        expect.objectContaining({ foodName: "Arroz" }),
        expect.objectContaining({ foodName: "Feijão" }),
      ],
    });
  });

  it("preserva horários originais ao atualizar o rótulo e itens do grupo", async () => {
    listMealsMock.mockResolvedValue([
      buildMeal({ id: 10, occurredAt: new Date("2026-05-21T12:00:00.000Z").getTime(), notes: "a" }),
      buildMeal({ id: 11, occurredAt: new Date("2026-05-21T14:00:00.000Z").getTime(), notes: "b" }),
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: unknown) => input);

    await updateMealGroup(42, {
      mealLabel: "jantar",
      meals: [
        { mealId: 10, items: [buildMeal({ id: 10 }).items[0]] },
        { mealId: 11, items: [buildMeal({ id: 11 }).items[0]] },
      ],
    });

    expect(updateMealMock).toHaveBeenNthCalledWith(1, 42, expect.objectContaining({
      mealId: 10,
      mealLabel: "jantar",
      occurredAt: "2026-05-21T12:00:00.000Z",
      notes: "a",
    }));
    expect(updateMealMock).toHaveBeenNthCalledWith(2, 42, expect.objectContaining({
      mealId: 11,
      mealLabel: "jantar",
      occurredAt: "2026-05-21T14:00:00.000Z",
      notes: "b",
    }));
  });

  it("atualiza a data enviada para cada refeição do grupo", async () => {
    listMealsMock.mockResolvedValue([
      buildMeal({ id: 10, occurredAt: new Date("2026-05-21T12:00:00.000Z").getTime(), notes: "a" }),
      buildMeal({ id: 11, occurredAt: new Date("2026-05-21T14:00:00.000Z").getTime(), notes: "b" }),
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: unknown) => input);

    await updateMealGroup(42, {
      mealLabel: "jantar",
      meals: [
        { mealId: 10, occurredAt: "2026-05-20T12:00:00.000Z", items: [buildMeal({ id: 10 }).items[0]] },
        { mealId: 11, occurredAt: "2026-05-20T14:00:00.000Z", items: [buildMeal({ id: 11 }).items[0]] },
      ],
    });

    expect(updateMealMock).toHaveBeenNthCalledWith(1, 42, expect.objectContaining({
      mealId: 10,
      mealLabel: "jantar",
      occurredAt: "2026-05-20T12:00:00.000Z",
      notes: "a",
    }));
    expect(updateMealMock).toHaveBeenNthCalledWith(2, 42, expect.objectContaining({
      mealId: 11,
      mealLabel: "jantar",
      occurredAt: "2026-05-20T14:00:00.000Z",
      notes: "b",
    }));
  });

  it("remove todos os registros do grupo validado", async () => {
    listMealsMock.mockResolvedValue([
      buildMeal({ id: 10 }),
      buildMeal({ id: 11 }),
    ]);

    await expect(removeMealGroup(42, { mealIds: [10, 11] })).resolves.toEqual({
      success: true,
      removedMealIds: [10, 11],
    });
    expect(removeMealMock).toHaveBeenCalledWith(42, 10);
    expect(removeMealMock).toHaveBeenCalledWith(42, 11);
  });

  it("rejeita grupos com refeição inexistente para o usuário", async () => {
    listMealsMock.mockResolvedValue([buildMeal({ id: 10 })]);

    await expect(removeMealGroup(42, { mealIds: [10, 999] })).rejects.toThrow("Uma ou mais refeições do grupo não foram encontradas.");
    expect(removeMealMock).not.toHaveBeenCalled();
  });
});
