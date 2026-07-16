import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listUserMeals: vi.fn(),
  listUserExercises: vi.fn(),
  listUserWaterLogs: vi.fn(),
  findMealsByRange: vi.fn(),
  findExercisesByRange: vi.fn(),
  findWaterLogsByRange: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: mocks.getDb,
  listUserMeals: mocks.listUserMeals,
  listUserExercises: mocks.listUserExercises,
  listUserWaterLogs: mocks.listUserWaterLogs,
}));

vi.mock("../../repositories/mealsRepository", () => ({
  createDrizzleMealsRepository: () => ({
    findConfirmedByUserId: mocks.findMealsByRange,
  }),
}));

vi.mock("../../repositories/exercisesRepository", () => ({
  createDrizzleExercisesRepository: () => ({
    findByUserIdAndRange: mocks.findExercisesByRange,
  }),
}));

vi.mock("../../repositories/waterRepository", () => ({
  createDrizzleWaterRepository: () => ({
    findLogsByUserIdAndRange: mocks.findWaterLogsByRange,
  }),
}));

const {
  listReportExercisesByDateRange,
  listReportMealsByDateRange,
  listReportWaterLogsByDateRange,
} = await import("./rangeData");

const reportRange = { startDate: "2026-06-22", endDate: "2026-06-23" };

function occurredAt(date: string) {
  return new Date(`${date}T15:00:00.000Z`).getTime();
}

function meal(id: number, date: string, calories = 100) {
  return {
    id,
    userId: 1,
    source: "web" as const,
    status: "confirmed" as const,
    mealLabel: "Almoço",
    occurredAt: occurredAt(date),
    sourceText: "",
    confidence: 0.9,
    items: [{
      foodName: "Arroz",
      canonicalName: "arroz",
      portionText: "1 porção",
      quantity: 1,
      unit: "porção",
      servings: 1,
      estimatedGrams: 100,
      calories,
      protein: 2,
      carbs: 20,
      fat: 1,
      confidence: 0.9,
      source: "manual",
    }],
    media: [{ id: 10, mediaType: "image" as const, storageKey: "heavy", storageUrl: "https://example.test/heavy.jpg", mimeType: "image/jpeg" }],
    createdAt: occurredAt(date),
  };
}

function exercise(id: number, date: string, caloriesBurned = 120) {
  return {
    id,
    userId: 1,
    activityType: "corrida",
    durationMinutes: 30,
    caloriesBurned,
    occurredAt: occurredAt(date),
    createdAt: occurredAt(date),
    updatedAt: new Date(`${date}T15:00:00.000Z`),
  };
}

function waterLog(id: number, date: string, amountMl = 500) {
  return {
    id,
    userId: 1,
    amountMl,
    occurredAt: occurredAt(date),
    createdAt: occurredAt(date),
    updatedAt: new Date(`${date}T15:00:00.000Z`),
  };
}

describe("report range data loaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockResolvedValue({});
    mocks.listUserMeals.mockResolvedValue([]);
    mocks.listUserExercises.mockResolvedValue([]);
    mocks.listUserWaterLogs.mockResolvedValue([]);
    mocks.findMealsByRange.mockResolvedValue([]);
    mocks.findExercisesByRange.mockResolvedValue([]);
    mocks.findWaterLogsByRange.mockResolvedValue([]);
  });

  it("busca refeições por intervalo, sem mídia pesada, e filtra pelo range lógico", async () => {
    mocks.findMealsByRange.mockResolvedValue([
      meal(1, "2026-06-22", 100),
      meal(2, "2026-06-23", 200),
      meal(3, "2026-06-24", 300),
    ]);

    const result = await listReportMealsByDateRange(1, reportRange, "UTC", { includeMedia: false });

    expect(mocks.findMealsByRange).toHaveBeenCalledWith(1, expect.objectContaining({ includeMedia: false }));
    const rangeOptions = mocks.findMealsByRange.mock.calls[0][1];
    expect(rangeOptions.startAt.toISOString()).toBe("2026-06-22T00:00:00.000Z");
    expect(rangeOptions.endAt.toISOString()).toBe("2026-06-24T00:00:00.000Z");
    expect(result.map(item => item.id)).toEqual([2, 1]);
    expect(result[0].totals).toMatchObject({ calories: 200, protein: 2, carbs: 20, fat: 1 });
  });

  it("não recupera histórico completo quando a leitura por intervalo vem vazia", async () => {
    mocks.findMealsByRange.mockResolvedValue([]);
    mocks.listUserMeals.mockResolvedValue([meal(1, "2026-06-22"), meal(2, "2026-06-24")]);

    const result = await listReportMealsByDateRange(1, reportRange, "UTC", { includeMedia: false });

    expect(mocks.listUserMeals).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("recupera refeições pelo fallback em memória quando a leitura por intervalo não está disponível", async () => {
    mocks.findMealsByRange.mockResolvedValue(null);
    mocks.listUserMeals.mockResolvedValue([meal(1, "2026-06-22"), meal(2, "2026-06-24")]);

    const result = await listReportMealsByDateRange(1, reportRange, "UTC", { includeMedia: false });

    expect(mocks.listUserMeals).toHaveBeenCalledWith(1);
    expect(result.map(item => item.id)).toEqual([1]);
  });

  it("busca exercícios e água por intervalo e remove itens fora do range lógico", async () => {
    mocks.findExercisesByRange.mockResolvedValue([
      exercise(1, "2026-06-22", 120),
      exercise(2, "2026-06-23", 220),
      exercise(3, "2026-06-24", 320),
    ]);
    mocks.findWaterLogsByRange.mockResolvedValue([
      waterLog(1, "2026-06-22", 400),
      waterLog(2, "2026-06-23", 600),
      waterLog(3, "2026-06-24", 800),
    ]);

    const [exercises, waterLogs] = await Promise.all([
      listReportExercisesByDateRange(1, reportRange, "UTC"),
      listReportWaterLogsByDateRange(1, reportRange, "UTC"),
    ]);

    expect(mocks.findExercisesByRange).toHaveBeenCalledTimes(1);
    expect(mocks.findWaterLogsByRange).toHaveBeenCalledTimes(1);
    expect(exercises.map(item => item.id)).toEqual([2, 1]);
    expect(waterLogs.map(item => item.id)).toEqual([2, 1]);
  });

  it("constrói limites UTC a partir do calendário local, inclusive durante DST", async () => {
    await listReportMealsByDateRange(1, { startDate: "2026-03-08", endDate: "2026-03-08" }, "America/New_York");

    const rangeOptions = mocks.findMealsByRange.mock.calls[0][1];
    expect(rangeOptions.startAt.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(rangeOptions.endAt.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

});
