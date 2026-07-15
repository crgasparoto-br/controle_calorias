import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MealProcessingResult } from "../../nutritionEngine";
import {
  buildWhatsAppConsolidatedMealReplyMessage,
  buildWhatsAppMealActionReplyMessage,
  buildWhatsAppMealReplyMessage,
} from "./replyMessages";

const listMealsMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
}));

const { executeWhatsappMealListIntent } = await import("./mealListIntent");

const occurredAt = "2026-07-14T16:00:00.000Z";
const contextLine = "🍽️ *Almoço* — 13:00";
const item = {
  foodName: "Arroz branco",
  canonicalName: "Arroz branco cozido",
  quantity: 120,
  unit: "g",
  portionText: "120 g",
  servings: 1,
  estimatedGrams: 120,
  calories: 156,
  protein: 3.2,
  carbs: 33.6,
  fat: 0.4,
  confidence: 0.99,
  source: "catalog" as const,
};

function processedMeal(): MealProcessingResult {
  return {
    detectedMealLabel: "Almoço",
    sourceText: "120 g de arroz branco",
    imageUrl: undefined,
    audioUrl: undefined,
    transcript: undefined,
    confidence: 0.99,
    needsConfirmation: false,
    reasoning: "Teste do contrato de contexto.",
    items: [item],
    totals: {
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    },
  };
}

describe("issue #783 — bloco canônico de contexto da refeição", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    listMealsMock.mockResolvedValue([{
      id: 10,
      mealLabel: "Almoço",
      occurredAt,
      items: [item],
    }]);
  });

  it("reutiliza o mesmo bloco no registro, consolidação e atualização", () => {
    const registered = buildWhatsAppMealReplyMessage(processedMeal(), {
      registeredAt: new Date(occurredAt),
    });
    const consolidated = buildWhatsAppConsolidatedMealReplyMessage({
      mealLabel: "Almoço",
      occurredAt,
      items: [item],
    });
    const updated = buildWhatsAppMealActionReplyMessage({
      mealLabel: "Almoço",
      occurredAt,
      items: [item],
    }, {
      title: "Quantidade corrigida",
    });

    expect(registered.match(/🍽️ \*Almoço\* — 13:00/g)).toHaveLength(1);
    expect(consolidated.match(/🍽️ \*Almoço\* — 13:00/g)).toHaveLength(1);
    expect(updated.match(/🍽️ \*Almoço\* — 13:00/g)).toHaveLength(1);
  });

  it("reutiliza o mesmo bloco na consulta da refeição", async () => {
    const result = await executeWhatsappMealListIntent(42, {
      text: "listar alimentos do almoço de hoje",
      receivedAt: new Date("2026-07-14T20:00:00-03:00"),
    });

    expect(result?.action).toBe("meal_foods_listed");
    expect(result?.reply.match(/🍽️ \*Almoço\* — 13:00/g)).toHaveLength(1);
    expect(result?.reply).toContain("Arroz branco");
    expect(result?.reply).toContain("*Total da refeição*");
  });
});
