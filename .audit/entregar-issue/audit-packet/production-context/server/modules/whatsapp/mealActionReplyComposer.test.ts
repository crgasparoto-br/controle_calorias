import { beforeEach, describe, expect, it, vi } from "vitest";

const goalProgressMock = vi.hoisted(() => vi.fn());
const timeZoneMock = vi.hoisted(() => vi.fn());

vi.mock("./goalProgressService", () => ({ getWhatsAppMealGoalProgress: goalProgressMock }));
vi.mock("./timeZoneContext", () => ({ getWhatsAppOperationTimeZone: timeZoneMock }));

import { composeWhatsAppMealActionReply, composeWhatsAppMealActionReplies } from "./mealActionReplyComposer";

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

function meal(id: number, mealLabel: string, occurredAt: string) {
  return {
    id,
    mealLabel,
    occurredAt: new Date(occurredAt).getTime(),
    items: [riceItem],
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

describe("mealActionReplyComposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    timeZoneMock.mockResolvedValue("America/Los_Angeles");
    goalProgressMock.mockResolvedValue(progress);
  });

  it("entrega a confirmação de ação já composta pelo builder canônico", async () => {
    const updatedMeal = meal(10, "Almoço", "2026-07-15T15:00:00.000Z");

    const reply = await composeWhatsAppMealActionReply({
      userId: 42,
      meal: updatedMeal,
      options: {
        title: "Alimento ajustado",
        actionLines: ["Ajustei a quantidade e recalculei os macros."],
      },
    });

    expect(reply).toContain("🍽️ *Almoço* — 08:00");
    expect(reply).toContain("*Total da refeição:*");
    expect(reply).toContain("*130 kcal | P 2,7 g | C 28 g | G 0,3 g*");
    expect(reply).toContain("*Meta:* 2.000 kcal");
    expect(reply).toContain("*Exercícios:* 300 kcal");
    expect(reply).toContain("*Consumo:* 1.850 kcal");
    expect(reply).toContain("*Déficit:* 150 kcal (-7%)");
    expect(reply).toContain("• P 110 g (-10 g/-8%)");
    expect(reply).toContain("• C 130 g (-20 g/-13%)");
    expect(reply).toContain("• G 55 g (+5 g/+10%)");
    expect(goalProgressMock).toHaveBeenCalledWith(42, new Date("2026-07-15T15:00:00.000Z"), "America/Los_Angeles");
  });

  it("reutiliza uma única consulta de progresso para várias refeições do mesmo dia lógico", async () => {
    const lunch = meal(10, "Almoço", "2026-07-15T15:00:00.000Z");
    const dinner = meal(11, "Jantar", "2026-07-15T23:00:00.000Z");

    const reply = await composeWhatsAppMealActionReplies({
      userId: 42,
      entries: [
        { meal: lunch, options: { title: "Alimentos ajustados" } },
        { meal: dinner, options: { title: "Alimentos ajustados" } },
      ],
    });

    expect(reply.match(/\*Meta:\* 2\.000 kcal/g)).toHaveLength(2);
    expect(reply).toContain("🍽️ *Almoço* — 08:00");
    expect(reply).toContain("🍽️ *Jantar* — 16:00");
    expect(goalProgressMock).toHaveBeenCalledOnce();
  });

  it("preserva a resposta principal quando o progresso não pode ser resolvido", async () => {
    goalProgressMock.mockRejectedValue(new Error("goal unavailable"));
    const updatedMeal = meal(10, "Almoço", "2026-07-15T15:00:00.000Z");

    const reply = await composeWhatsAppMealActionReply({
      userId: 42,
      meal: updatedMeal,
      options: { title: "Alimento ajustado" },
    });

    expect(reply).toContain("*Alimento ajustado*");
    expect(reply).toContain("*Total da refeição:*");
    expect(reply).not.toContain("*Meta:*");
    expect(reply).not.toContain("*Consumo:*");
  });

  it("usa o timezone explícito sem consultar novamente o perfil", async () => {
    const updatedMeal = meal(10, "Almoço", "2026-07-15T15:00:00.000Z");

    const reply = await composeWhatsAppMealActionReply({
      userId: 42,
      meal: updatedMeal,
      timeZone: "America/Sao_Paulo",
      options: { title: "Alimento ajustado" },
    });

    expect(reply).toContain("🍽️ *Almoço* — 12:00");
    expect(timeZoneMock).not.toHaveBeenCalled();
    expect(goalProgressMock).toHaveBeenCalledWith(42, expect.any(Date), "America/Sao_Paulo");
  });
});
