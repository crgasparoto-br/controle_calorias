import { beforeEach, describe, expect, it, vi } from "vitest";

type ProcessedItem = {
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
  source: "catalog";
};

/**
 * O motor nutricional real precisa da capacidade de IA para extrair um item
 * revisável. Este teste exercita a fronteira canônica de adição: cada item já
 * chega na gramatura resolvida por `resolveCanonicalFoodQuantity` ou pelo gate
 * contável, e o motor apenas materializa o snapshot nutricional.
 */
function buildItemFromLine(line: string): ProcessedItem | null {
  const match = line.match(/^\s*([\d.,]+)\s*(?:g|ml)\s+de\s+(.+)$/iu);
  if (!match) return null;
  const grams = Number(match[1].replace(",", "."));
  const foodName = match[2].trim().replace(/[.\s]+$/u, "");
  if (!Number.isFinite(grams) || grams <= 0) return null;
  return {
    foodName,
    canonicalName: foodName,
    portionText: `${grams} g`,
    servings: 1,
    estimatedGrams: grams,
    calories: grams,
    protein: grams / 100,
    carbs: grams / 10,
    fat: grams / 100,
    confidence: 0.9,
    source: "catalog",
  };
}

const processMealInputMock = vi.fn(async ({ text }: { text: string }) => {
  const items = text
    .split(/\r?\n/)
    .map(buildItemFromLine)
    .filter((item): item is ProcessedItem => Boolean(item));
  if (!items.length) return null;
  return {
    detectedMealLabel: "Refeição",
    sourceText: text,
    confidence: 0.9,
    needsConfirmation: false,
    reasoning: "Extração determinística de teste sobre a gramatura resolvida.",
    items,
    totals: items.reduce(
      (totals, item) => ({
        calories: totals.calories + item.calories,
        protein: totals.protein + item.protein,
        carbs: totals.carbs + item.carbs,
        fat: totals.fat + item.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    ),
  };
});

vi.mock("../../nutritionEngine", async () => {
  const actual = await vi.importActual<typeof import("../../nutritionEngine")>(
    "../../nutritionEngine",
  );
  return {
    ...actual,
    processMealInput: (input: { text: string }) => processMealInputMock(input),
  };
});

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
vi.mock("../meals/service", () => ({
  listMeals: (...args: unknown[]) => listMealsMock(...args),
  updateMeal: (...args: unknown[]) => updateMealMock(...args),
  createMeal: vi.fn(),
  deleteMeal: vi.fn(),
}));

const { executeWhatsappTextIntent } = await import("./intentActions");
const { upsertUserWhatsappConnection } = await import("../../db");

const USER_ID = 2280219;
const RECEIVED_AT = new Date("2026-10-01T18:55:00.000Z");
const TIME_ZONE = "America/Sao_Paulo";

const BREAKFAST_MEAL = {
  id: 91001,
  userId: USER_ID,
  mealLabel: "Café da manhã",
  occurredAt: RECEIVED_AT.toISOString(),
  notes: null,
  items: [
    {
      foodName: "Pão francês",
      canonicalName: "Pão francês",
      portionText: "50 g",
      servings: 1,
      estimatedGrams: 50,
      calories: 135,
      protein: 4.5,
      carbs: 28,
      fat: 1.5,
      confidence: 0.9,
      source: "catalog",
    },
  ],
};

const LUNCH_MEAL = {
  id: 91002,
  userId: USER_ID,
  mealLabel: "Almoço",
  occurredAt: RECEIVED_AT.toISOString(),
  notes: null,
  items: [
    {
      foodName: "Arroz branco cozido",
      canonicalName: "Arroz branco cozido",
      portionText: "100 g",
      servings: 1,
      estimatedGrams: 100,
      calories: 128,
      protein: 2.5,
      carbs: 28.1,
      fat: 0.2,
      confidence: 0.9,
      source: "catalog",
    },
  ],
};

async function run(text: string) {
  return executeWhatsappTextIntent(USER_ID, {
    text,
    receivedAt: RECEIVED_AT,
    userTimezone: TIME_ZONE,
  });
}

function lastWrittenItems() {
  const call = updateMealMock.mock.calls.at(-1);
  return (call?.[1]?.items ?? []) as Array<Record<string, unknown>>;
}

describe("issue #1278 — adição canônica a uma refeição existente", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await upsertUserWhatsappConnection({
      userId: USER_ID,
      phoneNumber: "5511228021900",
      displayName: "Issue 1278",
    });
    listMealsMock.mockResolvedValue([BREAKFAST_MEAL, LUNCH_MEAL]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: input.mealId,
      userId: USER_ID,
      mealLabel: input.mealLabel,
      occurredAt: input.occurredAt,
      notes: input.notes ?? null,
      items: input.items,
    }));
  });

  it("adiciona 1,5 fatias de mortadela ao café da manhã quando o destino vem antes dos itens", async () => {
    const result = await run("Adicionar o café da manhã, 1,5 fatias de mortadela");

    expect(result?.action).toBe("meal_item_added");
    expect(result?.data).toEqual(
      expect.objectContaining({
        mealLabel: "Café da manhã",
        foodName: "mortadela",
        quantity: 1.5,
        unit: "fatia",
        estimatedGrams: 22.5,
      }),
    );

    const items = lastWrittenItems();
    const added = items.at(-1) as { foodName: string; estimatedGrams: number } | undefined;
    expect(added?.foodName).toBe("mortadela");
    expect(added?.estimatedGrams).toBeCloseTo(22.5, 2);
    expect(items.some(item => /caf[eé] da manh[aã]/i.test(String(item.foodName)))).toBe(false);
  });

  it("adiciona 2 linguiças de frango assadas ao almoço sem contaminar o nome com o destino", async () => {
    const result = await run("Adicionar 2 linguiças de frango assadas ao almoço.");

    expect(result?.action).toBe("meal_item_added");
    expect(result?.data).toEqual(
      expect.objectContaining({
        mealLabel: "Almoço",
        foodName: "linguiças de frango assadas",
        quantity: 2,
        unit: "un",
        estimatedGrams: 200,
      }),
    );

    const added = lastWrittenItems().at(-1) as { foodName: string; estimatedGrams: number } | undefined;
    expect(added?.foodName).toBe("linguiças de frango assadas");
    expect(added?.estimatedGrams).toBeCloseTo(200, 2);
  });

  it("não pede gramatura nem cria refeição nova para as duas mensagens", async () => {
    for (const text of [
      "Adicionar o café da manhã, 1,5 fatias de mortadela",
      "Adicionar 2 linguiças de frango assadas ao almoço.",
    ]) {
      vi.clearAllMocks();
      listMealsMock.mockResolvedValue([BREAKFAST_MEAL, LUNCH_MEAL]);
      const result = await run(text);
      expect(result?.action).not.toBe("clarification_needed");
      expect(String(result?.reply ?? "")).not.toMatch(/informe somente o peso|não consegui|não encontrei essa refeição/i);
      expect(processMealInputMock).toHaveBeenCalled();
    }
  });
});