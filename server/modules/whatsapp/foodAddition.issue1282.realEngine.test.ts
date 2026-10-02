import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const createManualMealMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const listMealSchedulesMock = vi.fn();
const createTextResponseMock = vi.fn();

vi.mock("../../db", () => ({
  getUserNutritionGoal: getUserNutritionGoalMock,
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
  createManualMeal: createManualMealMock,
}));

vi.mock("../mealSchedules/service", () => ({
  listMealSchedules: listMealSchedulesMock,
  findConfiguredMealSchedule: vi.fn(() => null),
}));

vi.mock("../../_core/aiProvider", () => ({
  getAiProvider: () => ({ createTextResponse: createTextResponseMock }),
}));

vi.mock("../../_core/ai/providerResolver", () => ({
  getAiProviderById: () => ({
    createTextResponse: (request: unknown) => createTextResponseMock(request),
  }),
}));

const { executeWhatsappTextIntent } = await import("./intentActions");

const receivedAt = new Date("2026-10-01T21:04:00.000Z");
const breakfast = {
  id: 91,
  userId: 1282,
  mealLabel: "Café da manhã",
  occurredAt: receivedAt.getTime(),
  notes: null,
  items: [],
};

/**
 * Issue #1282 — relato de produção: `Adicionar ao café da manhã 1,5 fatias de
 * mortadela` não registrava nada. Este teste percorre o fluxo real (motor
 * nutricional + resolução canônica de adição) com o provedor de IA indisponível,
 * que é exatamente o caminho de degradação que atendeu o usuário.
 */
describe("issue #1282 — adição canônica de mortadela com o motor real", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    createManualMealMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    listMealSchedulesMock.mockReset();
    createTextResponseMock.mockReset();

    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    listMealSchedulesMock.mockResolvedValue([]);
    listMealsMock.mockResolvedValue([breakfast]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: input.mealId,
      ...input,
    }));
  });

  it("adiciona 1,5 fatias de mortadela ao café da manhã", async () => {
    const result = await executeWhatsappTextIntent(1282, {
      text: "Adicionar ao café da manhã 1,5 fatias de mortadela",
      receivedAt,
    });

    expect(result?.handled).toBe(true);
    expect(updateMealMock).toHaveBeenCalledTimes(1);
    const [, updateInput] = updateMealMock.mock.calls[0];
    const items = updateInput.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      foodName: "mortadela",
      canonicalName: "Mortadela",
      estimatedGrams: 22.5,
    });
    expect(result?.reply?.toLowerCase()).toContain("mortadela");
  });

  it("resolve a mesma adição quando o usuário escreve a massa direto", async () => {
    const result = await executeWhatsappTextIntent(1282, {
      text: "Adicionar ao café da manhã 22,5 g de mortadela",
      receivedAt,
    });

    expect(updateMealMock).toHaveBeenCalledTimes(1);
    const [, updateInput] = updateMealMock.mock.calls[0];
    const items = updateInput.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      foodName: "mortadela",
      canonicalName: "Mortadela",
      estimatedGrams: 22.5,
    });
    expect(result?.reply?.toLowerCase()).toContain("mortadela");
  });
});
