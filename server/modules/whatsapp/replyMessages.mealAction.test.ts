import { describe, expect, it } from "vitest";

import { buildWhatsAppMealActionReplyMessage } from "./replyMessages";

const baseMeal = {
  id: 10,
  mealLabel: "Jantar",
  occurredAt: "2026-07-07T22:00:00.000Z",
  items: [
    {
      foodName: "Arroz branco",
      canonicalName: "Arroz branco",
      portionText: "120 g",
      estimatedGrams: 120,
      calories: 156,
      protein: 3,
      carbs: 34,
      fat: 0.4,
    },
    {
      foodName: "Frango grelhado",
      canonicalName: "Frango grelhado",
      portionText: "150 g",
      estimatedGrams: 150,
      calories: 248,
      protein: 46,
      carbs: 0,
      fat: 5.4,
    },
  ],
};

describe("buildWhatsAppMealActionReplyMessage", () => {
  it.each([
    ["Alimento adicionado", "Adicionei feijão ao jantar."],
    ["Alimento removido", "Removi feijão do jantar."],
    ["Alimento substituído", "Troquei batata por arroz."],
    ["Alimento ajustado", "Ajustei o arroz para 120 g."],
  ])("mantém a refeição completa em resposta de %s", (title, actionLine) => {
    const reply = buildWhatsAppMealActionReplyMessage(baseMeal, {
      title,
      actionLines: [actionLine],
    });

    expect(reply).toContain(title);
    expect(reply).toContain("Refeição atualizada:");
    expect(reply).toContain("Arroz branco");
    expect(reply).toContain("Frango grelhado");
    expect(reply).toContain("120g");
    expect(reply).toContain("150g");
    expect(reply).toContain("156 kcal | P 3 g | C 34 g | G 0,4 g");
    expect(reply).toContain("248 kcal | P 46 g | C 0 g | G 5,4 g");
    expect(reply).toContain("*Total da refeição*");
    expect(reply).toContain("404 kcal | P 49 g | C 34 g | G 5,8 g");
  });
});
