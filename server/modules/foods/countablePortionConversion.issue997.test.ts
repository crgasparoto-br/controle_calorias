import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFood: vi.fn(),
  convert: vi.fn(),
  resolveLocal: vi.fn(),
}));

vi.mock("./service", () => ({
  getGlobalFoodCatalogItem: mocks.getFood,
  convertFoodPortionToGrams: mocks.convert,
}));

vi.mock("../../countableFoodQuantity", () => ({
  resolveSafeCountableCatalogGrams: mocks.resolveLocal,
}));

import { getCountableIncrementGrams } from "./countablePortionConversion";

function portion(id: number, foodVariantId: number | null, label = "1 fatia") {
  return {
    id,
    foodVariantId,
    label,
    unit: "fatia",
    quantity: 1,
    grams: id,
  };
}

describe("foods-domain countable portion conversion for issue #997", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFood.mockResolvedValue({
      id: 41,
      portions: [portion(91, 3), portion(92, 4)],
    });
    mocks.convert.mockImplementation(
      async (_userId: number, input: { portionId: number }) => ({
        grams: input.portionId === 92 ? 60 : 30,
      })
    );
    mocks.resolveLocal.mockReturnValue({ grams: 18 });
  });

  it("uses the canonical local measure only when the persisted item has no stronger identity", async () => {
    const grams = await getCountableIncrementGrams({
      userId: 7,
      item: { foodName: "Presunto" },
      quantity: 1,
      unit: "fatia",
    });

    expect(grams).toBe(18);
    expect(mocks.resolveLocal).toHaveBeenCalledWith(
      "Presunto",
      1,
      "fatia",
      true
    );
    expect(mocks.getFood).not.toHaveBeenCalled();
    expect(mocks.convert).not.toHaveBeenCalled();
  });

  it("selects the exact persisted portion within the exact variant family", async () => {
    const grams = await getCountableIncrementGrams({
      userId: 7,
      item: {
        foodName: "Queijo fatiado",
        foodId: 41,
        foodVariantId: 4,
        foodPortionId: 92,
        brand: "Marca B",
        productVariant: "fatia grossa",
      },
      quantity: 2,
      unit: "fatia",
    });

    expect(grams).toBe(60);
    expect(mocks.getFood).toHaveBeenCalledWith(7, 41);
    expect(mocks.convert).toHaveBeenCalledWith(7, {
      foodId: 41,
      portionId: 92,
      quantity: 2,
      foodVariantId: 4,
    });
    expect(mocks.resolveLocal).not.toHaveBeenCalled();
  });

  it("rejects an explicit portion whose variant differs and never falls back locally", async () => {
    const grams = await getCountableIncrementGrams({
      userId: 7,
      item: {
        foodName: "Queijo fatiado",
        foodId: 41,
        foodVariantId: 4,
        foodPortionId: 91,
      },
      quantity: 1,
      unit: "fatia",
    });

    expect(grams).toBeNull();
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(mocks.resolveLocal).not.toHaveBeenCalled();
  });

  it("rejects ambiguous unit-only portions instead of guessing", async () => {
    mocks.getFood.mockResolvedValue({
      id: 41,
      portions: [portion(91, null), portion(92, null, "2 fatias")],
    });

    const grams = await getCountableIncrementGrams({
      userId: 7,
      item: { foodName: "Pão", foodId: 41 },
      quantity: 1,
      unit: "fatia",
    });

    expect(grams).toBeNull();
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(mocks.resolveLocal).not.toHaveBeenCalled();
  });

  it.each([
    { foodCatalogId: 55 },
    { foodVariantId: 4 },
    { nutritionProfileId: 5 },
    { foodPortionId: 92 },
    { portionId: 9 },
    { portionQuantity: 1 },
  ])("fails closed for legacy or partial identity %#", async identity => {
    const grams = await getCountableIncrementGrams({
      userId: 7,
      item: { foodName: "Presunto", ...identity },
      quantity: 1,
      unit: "fatia",
    });

    expect(grams).toBeNull();
    expect(mocks.resolveLocal).not.toHaveBeenCalled();
    expect(mocks.getFood).not.toHaveBeenCalled();
    expect(mocks.convert).not.toHaveBeenCalled();
  });

  it("fails closed for a branded item without a complete persisted identity", async () => {
    const grams = await getCountableIncrementGrams({
      userId: 7,
      item: {
        foodName: "Presunto",
        brand: "Marca A",
        productVariant: "fatiado",
      },
      quantity: 1,
      unit: "fatia",
    });

    expect(grams).toBeNull();
    expect(mocks.resolveLocal).not.toHaveBeenCalled();
    expect(mocks.getFood).not.toHaveBeenCalled();
  });
});
