import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const goalProgressMock = vi.hoisted(() => vi.fn());
const timeZoneMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({ listMeals: listMealsMock }));
vi.mock("./goalProgressService", () => ({ getWhatsAppMealGoalProgress: goalProgressMock }));
vi.mock("./timeZoneContext", () => ({ getWhatsAppOperationTimeZone: timeZoneMock }));

import { enrichWhatsAppMealActionReply } from "./mealActionReplyEnrichment";
import { buildWhatsAppMealActionReplyMessage } from "./replyMessages";

const riceItem = {
  foodName: "Arroz branco",
  canonicalName: "Arroz branco cozido",
  portionText: "100 g",
  estimatedGrams: 100,
  calories: 130,
  protein: 2.7,
  carbs: 28,
  fat: 0.3,
  source: "catalog" as const,
};

const beansItem = {
  foodName: "Feijão carioca",
  canonicalName: "Feijão carioca cozido",
  portionText: "100 g",
  estimatedGrams: 100,
  calories: 76,
  protein: 4.8,
  carbs: 13.6,
  fat: 0.5,
  source: "catalog" as const,
};

function meal(id: number, mealLabel: string, occurredAt: string, items = [riceItem]) {
  return {
    id,
    mealLabel,
    occurredAt: new Date(occurredAt).getTime(),
    items,
  };
}

const progress = {
  consumedCalories: 1850,
  goalCalories: 2000,
  exerciseCalories: 300,
  consumedProteinGrams: 110,
  targetProteinGrams: 120,
  consumedCarbsGrams: 130,
  targetCarbsGrams: 150,
  consumedFatGrams: 55,
  targetFatGrams: 50,
};

describe("mealActionReplyEnrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    timeZoneMock.mockResolvedValue("America/Los_Angeles");
    goalProgressMock.mockResolvedValue(progress);
  });

  it("adiciona saldo, percentuais e timezone efetivo à resposta final de alteração", async () => {
    const updatedMeal = meal(10, "Almoço", "2026-07-15T15:00:00.000Z");
    listMealsMock.mockResolvedValue([updatedMeal]);
    const original = buildWhatsAppMealActionReplyMessage(updatedMeal, {
      title: "Alimento ajustado",
      actionLines: ["Ajustei a quantidade e recalculei os macros."],
    });

    const reply = await enrichWhatsAppMealActionReply({ userId: 42, mealId: 10, replyText: original });

    expect(reply).toContain("🍽️ *Almoço* — 08:00");
    expect(reply).not.toContain("🍽️ *Almoço* — 12:00");
    expect(reply).toContain("*Meta:* 2.000 kcal");
    expect(reply).toContain("*Exercícios:* 300 kcal");
    expect(reply).toContain("*Consumo:* 1.850 kcal");
    expect(reply).toContain("*Déficit:* 150 kcal (-7%)");
    expect(reply).toContain("• P 110 g (-10 g/-8%)");
    expect(reply).toContain("• C 130 g (-20 g/-13%)");
    expect(reply).toContain("• G 55 g (+5 g/+10%)");
    expect(goalProgressMock).toHaveBeenCalledWith(42, new Date("2026-07-15T15:00:00.000Z"), "America/Los_Angeles");
  });

  it("enriquece várias refeições do mesmo dia reutilizando uma única consulta de progresso", async () => {
    const lunch = meal(10, "Almoço", "2026-07-15T15:00:00.000Z", [riceItem]);
    const dinner = meal(11, "Jantar", "2026-07-15T23:00:00.000Z", [beansItem]);
    listMealsMock.mockResolvedValue([lunch, dinner]);
    const original = [
      buildWhatsAppMealActionReplyMessage(lunch, { title: "Alimentos ajustados" }),
      buildWhatsAppMealActionReplyMessage(dinner, { title: "Alimentos ajustados" }),
    ].join("\n\n");

    const reply = await enrichWhatsAppMealActionReply({ userId: 42, replyText: original });

    expect(reply.match(/\*Meta:\* 2\.000 kcal/g)).toHaveLength(2);
    expect(reply).toContain("🍽️ *Almoço* — 08:00");
    expect(reply).toContain("🍽️ *Jantar* — 16:00");
    expect(goalProgressMock).toHaveBeenCalledOnce();
  });

  it("preserva a resposta principal quando o progresso não pode ser resolvido", async () => {
    const updatedMeal = meal(10, "Almoço", "2026-07-15T15:00:00.000Z");
    listMealsMock.mockResolvedValue([updatedMeal]);
    goalProgressMock.mockRejectedValue(new Error("goal unavailable"));
    const original = buildWhatsAppMealActionReplyMessage(updatedMeal, { title: "Alimento ajustado" });

    await expect(enrichWhatsAppMealActionReply({ userId: 42, replyText: original })).resolves.toBe(original);
  });

  it("não consulta novamente quando a resposta já possui progresso canônico", async () => {
    const replyText = "*Total da refeição:*\n*130 kcal | P 2,7 g | C 28 g | G 0,3 g*\n\n*Meta:* 2.000 kcal";

    await expect(enrichWhatsAppMealActionReply({ userId: 42, replyText })).resolves.toBe(replyText);
    expect(listMealsMock).not.toHaveBeenCalled();
    expect(goalProgressMock).not.toHaveBeenCalled();
  });
});
