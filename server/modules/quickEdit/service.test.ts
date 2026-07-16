import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const listExercisesMock = vi.fn();
const updateExerciseMock = vi.fn();
const resolveEffectiveUserTimeZoneMock = vi.fn();

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  logInferenceEvent: vi.fn(),
}));

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
  removeMeal: vi.fn(),
}));

vi.mock("../exercises/service", () => ({
  listExercises: listExercisesMock,
  updateExercise: updateExerciseMock,
}));

vi.mock("../timeZone/service", () => ({
  resolveEffectiveUserTimeZone: resolveEffectiveUserTimeZoneMock,
}));

vi.mock("../../../drizzle/schema", () => ({
  quickEditTokens: {},
}));

const meal = {
  id: 456,
  userId: 123,
  source: "whatsapp" as const,
  mealLabel: "Jantar",
  status: "confirmed" as const,
  occurredAt: Date.now(),
  notes: undefined,
  sourceText: "300g amendoim japonês",
  transcript: "amendoim 300g",
  confidence: 0.9,
  items: [
    {
      foodName: "Amendoim japonês",
      canonicalName: "Amendoim japonês",
      portionText: "300 g",
      quantity: 300,
      unit: "g",
      servings: 1,
      estimatedGrams: 300,
      calories: 450,
      protein: 15,
      carbs: 40,
      fat: 25,
      confidence: 0.9,
      source: "heuristic" as const,
    },
  ],
  media: [{ storageKey: "abc", storageUrl: "https://internal.s3.amazonaws.com/abc", mimeType: "image/jpeg", mediaType: "image" as const, id: 1, mealId: 456, originalFileName: null, createdAt: Date.now() }],
  createdAt: Date.now(),
  totals: {
    calories: 450,
    protein: 15,
    carbs: 40,
    fat: 25,
  },
};

const exercise = {
  id: 987,
  userId: 123,
  activityType: "Corrida",
  durationMinutes: 45,
  caloriesBurned: 450,
  occurredAt: new Date("2026-07-16T12:00:45.000Z").getTime(),
  notes: null,
  externalProvider: null,
  externalId: null,
  createdAt: Date.now(),
};

describe("quickEdit service", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetModules();
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    listExercisesMock.mockReset();
    updateExerciseMock.mockReset();
    resolveEffectiveUserTimeZoneMock.mockReset();
    resolveEffectiveUserTimeZoneMock.mockResolvedValue({ timeZone: "Europe/Lisbon", source: "profile" });
    process.env.QUICK_EDIT_BASE_URL = "https://app.example.com";
    process.env.JWT_SECRET = "quick-edit-timezone-test-secret";
    const service = await import("./service");
    service.__resetQuickEditTokensForTests();
  });

  it("gera link opaco sem expor ids internos", async () => {
    const { createQuickEditLinkForMeal } = await import("./service");
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456 });

    expect(link.url).toMatch(/^https:\/\/app\.example\.com\/quick-edit\//);
    expect(link.url).not.toContain("123");
    expect(link.url).not.toContain("456");
    expect(link.token.length).toBeGreaterThanOrEqual(32);
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("carrega apenas a refeição vinculada ao token válido", async () => {
    const { createQuickEditLinkForMeal, getQuickEditMeal } = await import("./service");
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456 });
    listMealsMock.mockResolvedValue([meal, { ...meal, id: 999 }]);

    await expect(getQuickEditMeal(link.token)).resolves.toMatchObject({
      meal: expect.objectContaining({ id: 456, mealLabel: "Jantar" }),
      timeZone: "Europe/Lisbon",
    });
  });

  it("rejeita token expirado", async () => {
    const { createQuickEditLinkForMeal, getQuickEditMeal } = await import("./service");
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456, expiresInMs: 1 });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 2_000));

    await expect(getQuickEditMeal(link.token)).rejects.toThrow("Link de edição inválido ou expirado.");
  });

  it("atualiza a refeição vinculada ao token sem aceitar mealId externo", async () => {
    const { createQuickEditLinkForMeal, updateQuickEditMeal } = await import("./service");
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456 });
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockResolvedValue({ ...meal, mealLabel: "Jantar ajustado" });

    await updateQuickEditMeal(link.token, {
      mealLabel: "Jantar ajustado",
      occurredAt: new Date().toISOString(),
      items: meal.items,
    });

    expect(updateMealMock).toHaveBeenCalledWith(123, expect.objectContaining({
      mealId: 456,
      mealLabel: "Jantar ajustado",
    }));
  });

  it("converte horário civil no timezone do dono", async () => {
    const { createQuickEditLinkForMeal, updateQuickEditMeal } = await import("./service");
    const currentMeal = { ...meal, occurredAt: new Date("2026-07-16T12:00:45.000Z").getTime() };
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456 });
    listMealsMock.mockResolvedValue([currentMeal]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ ...currentMeal, ...input }));

    await updateQuickEditMeal(link.token, {
      mealLabel: "Jantar",
      dateTimeLocal: "2026-07-16T14:30",
      items: meal.items,
    });

    expect(updateMealMock).toHaveBeenCalledWith(123, expect.objectContaining({
      occurredAt: "2026-07-16T13:30:00.000Z",
    }));
  });

  it("preserva o instante original ao salvar o mesmo minuto civil", async () => {
    const { createQuickEditLinkForMeal, updateQuickEditMeal } = await import("./service");
    const original = "2026-07-16T12:00:45.321Z";
    const currentMeal = { ...meal, occurredAt: original };
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456 });
    listMealsMock.mockResolvedValue([currentMeal]);
    updateMealMock.mockResolvedValue(currentMeal);

    await updateQuickEditMeal(link.token, {
      mealLabel: "Jantar",
      dateTimeLocal: "2026-07-16T13:00",
      items: meal.items,
    });

    expect(updateMealMock).toHaveBeenCalledWith(123, expect.objectContaining({ occurredAt: original }));
  });

  it("rejeita horário inexistente no avanço de DST", async () => {
    const { createQuickEditLinkForMeal, updateQuickEditMeal } = await import("./service");
    resolveEffectiveUserTimeZoneMock.mockResolvedValue({ timeZone: "America/New_York", source: "profile" });
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456 });
    listMealsMock.mockResolvedValue([{ ...meal, occurredAt: "2026-03-08T06:00:00.000Z" }]);

    await expect(updateQuickEditMeal(link.token, {
      mealLabel: "Jantar",
      dateTimeLocal: "2026-03-08T02:30",
      items: meal.items,
    })).rejects.toThrow("Esse horário não existe");
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("escolhe a primeira ocorrência no retorno de DST", async () => {
    const { createQuickEditLinkForMeal, updateQuickEditMeal } = await import("./service");
    resolveEffectiveUserTimeZoneMock.mockResolvedValue({ timeZone: "America/New_York", source: "profile" });
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456 });
    listMealsMock.mockResolvedValue([{ ...meal, occurredAt: "2026-11-01T04:00:00.000Z" }]);
    updateMealMock.mockResolvedValue(meal);

    await updateQuickEditMeal(link.token, {
      mealLabel: "Jantar",
      dateTimeLocal: "2026-11-01T01:30",
      items: meal.items,
    });

    expect(updateMealMock).toHaveBeenCalledWith(123, expect.objectContaining({
      occurredAt: "2026-11-01T05:30:00.000Z",
    }));
  });

  it("usa o timezone do dono também na edição de exercício", async () => {
    const { createQuickEditLinkForExercise, getQuickEditExercise, updateQuickEditExercise } = await import("./service");
    listExercisesMock.mockResolvedValue([exercise]);
    updateExerciseMock.mockResolvedValue(exercise);
    const link = await createQuickEditLinkForExercise({ userId: 123, exerciseId: 987 });

    await expect(getQuickEditExercise(link.token)).resolves.toMatchObject({
      exercise: expect.objectContaining({ id: 987 }),
      timeZone: "Europe/Lisbon",
    });

    await updateQuickEditExercise(link.token, {
      activityType: "Corrida",
      durationMinutes: 45,
      caloriesBurned: 450,
      dateTimeLocal: "2026-07-16T14:30",
    });

    expect(updateExerciseMock).toHaveBeenCalledWith(123, expect.objectContaining({
      exerciseId: 987,
      occurredAt: "2026-07-16T13:30:00.000Z",
    }));
  });

  it("retorna null ao tentar gerar link sem URL pública configurada", async () => {
    delete process.env.QUICK_EDIT_BASE_URL;
    delete process.env.PUBLIC_APP_URL;
    delete process.env.APP_BASE_URL;
    delete process.env.APP_URL;
    const { tryCreateQuickEditLinkForMeal } = await import("./service");

    await expect(tryCreateQuickEditLinkForMeal({ userId: 123, mealId: 456 })).resolves.toBeNull();
  });

  it("retorna null ao tentar gerar link com URL relativa", async () => {
    process.env.QUICK_EDIT_BASE_URL = "/quick-edit";
    const { tryCreateQuickEditLinkForMeal } = await import("./service");

    await expect(tryCreateQuickEditLinkForMeal({ userId: 123, mealId: 456 })).resolves.toBeNull();
  });

  it("payload público não expõe userId, sourceText, transcript nem media", async () => {
    const { createQuickEditLinkForMeal, getQuickEditMeal } = await import("./service");
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456 });
    listMealsMock.mockResolvedValue([meal]);

    const result = await getQuickEditMeal(link.token);

    expect(result.meal).not.toHaveProperty("userId");
    expect(result.meal).not.toHaveProperty("sourceText");
    expect(result.meal).not.toHaveProperty("transcript");
    expect(result.meal).not.toHaveProperty("media");
  });

  it("purge remove tokens expirados da memória", async () => {
    const { createQuickEditLinkForMeal, purgeExpiredQuickEditTokens, getQuickEditMeal } = await import("./service");
    const link = await createQuickEditLinkForMeal({ userId: 123, mealId: 456, expiresInMs: 1 });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 2_000));

    await purgeExpiredQuickEditTokens();

    vi.useRealTimers();

    listMealsMock.mockResolvedValue([meal]);
    await expect(getQuickEditMeal(link.token)).rejects.toThrow("Link de edição inválido ou expirado.");
  });
});
