import { describe, expect, it } from "vitest";
import { buildWhatsAppConsolidatedMealReplyMessage, buildWhatsAppMealActionReplyMessage, buildWhatsAppMealReplyMessage } from "./replyMessages";
import type { MealProcessingResult } from "../../nutritionEngine";

const frangoItem = {
  foodName: "Frango grelhado",
  canonicalName: "Frango grelhado",
  portionText: "150 g",
  servings: 1,
  estimatedGrams: 150,
  calories: 247.5,
  protein: 46.5,
  carbs: 0,
  fat: 5.4,
  confidence: 0.9,
  source: "catalog" as const,
};

function buildProcessedMeal(overrides: Partial<MealProcessingResult> = {}): MealProcessingResult {
  return {
    detectedMealLabel: "Almoço",
    sourceText: "frango grelhado",
    imageUrl: undefined,
    audioUrl: undefined,
    transcript: undefined,
    confidence: 0.9,
    needsConfirmation: true,
    reasoning: "Teste de formatação.",
    items: [frangoItem],
    totals: {
      calories: 247.5,
      protein: 46.5,
      carbs: 0,
      fat: 5.4,
    },
    ...overrides,
  };
}

describe("buildWhatsAppMealReplyMessage", () => {
  it("inclui horário, alimento com ícone e total da refeição em negrito", () => {
    const reply = buildWhatsAppMealReplyMessage(buildProcessedMeal(), {
      registeredAt: new Date("2026-06-04T16:00:00.000Z"),
    });

    expect(reply).toContain("*Almoço Registrado às 13:00hs.*");
    expect(reply).toContain("• 🍗 Frango grelhado — 150g");
    expect(reply).toContain("*Total da refeição:*");
    expect(reply).toContain("*247,5 kcal | P 46,5 g | C 0 g | G 5,4 g*");
  });

  it("não mostra equivalência aproximada em gramas para porções líquidas em ml", () => {
    const reply = buildWhatsAppMealReplyMessage(buildProcessedMeal({
      detectedMealLabel: "Café da manhã",
      sourceText: "leite",
      items: [{
        foodName: "Leite integral",
        canonicalName: "Leite integral",
        portionText: "100 ml",
        servings: 1,
        estimatedGrams: 100,
        calories: 61,
        protein: 3.2,
        carbs: 4.7,
        fat: 3.3,
        confidence: 0.9,
        source: "catalog",
      }],
      totals: { calories: 61, protein: 3.2, carbs: 4.7, fat: 3.3 },
    }));

    expect(reply).toContain("• 🥛 Leite integral — 100 ml");
    expect(reply).not.toContain("aprox. 100g");
  });

  it("mantém equivalência aproximada em gramas para porções unitárias", () => {
    const reply = buildWhatsAppMealReplyMessage(buildProcessedMeal({
      detectedMealLabel: "Lanche",
      sourceText: "1 banana",
      items: [{
        foodName: "Banana",
        canonicalName: "Banana",
        portionText: "1 unidade",
        servings: 1,
        estimatedGrams: 80,
        calories: 72,
        protein: 0.9,
        carbs: 18.6,
        fat: 0.2,
        confidence: 0.9,
        source: "catalog",
      }],
      totals: { calories: 72, protein: 0.9, carbs: 18.6, fat: 0.2 },
    }));

    expect(reply).toContain("• 🍌 Banana — 1 unidade (aprox. 80g)");
  });

  it("aplica saldo e percentuais de macros no texto final da refeição", () => {
    const goalProgress = {
      consumedCalories: 1165,
      goalCalories: 2200,
      exerciseCalories: 200,
      consumedProteinGrams: 79.5,
      targetProteinGrams: 97,
      consumedCarbsGrams: 183.3,
      targetCarbsGrams: 221,
      consumedFatGrams: 61.7,
      targetFatGrams: 31,
    };
    const reply = buildWhatsAppMealReplyMessage(buildProcessedMeal(), {
      registeredAt: new Date("2026-06-04T16:00:00.000Z"),
      goalProgress,
    });

    expect(reply).toContain("*Meta:* 2.200 kcal");
    expect(reply).toContain("*Exercícios:* 200 kcal");
    expect(reply).toContain("*Consumo:* 1.165 kcal");
    expect(reply).toContain("*Déficit:* 1.035 kcal (-47%)");
    expect(reply).toContain("• P 79,5 g (-17,5 g/-18%)");
    expect(reply).toContain("• C 183,3 g (-37,7 g/-17%)");
    expect(reply).toContain("• G 61,7 g (+30,7 g/+99%)");
    expect(reply).not.toContain("Superávit/Déficit");
  });

  it("não inclui link de edição no corpo do texto", () => {
    const reply = buildWhatsAppMealReplyMessage(buildProcessedMeal({
      detectedMealLabel: "Jantar",
      sourceText: "300g amendoim japonês",
      items: [{
        foodName: "Amendoim japonês",
        canonicalName: "Amendoim japonês",
        portionText: "300 g",
        servings: 1,
        estimatedGrams: 300,
        calories: 450,
        protein: 15,
        carbs: 40,
        fat: 25,
        confidence: 0.9,
        source: "heuristic",
      }],
      totals: { calories: 450, protein: 15, carbs: 40, fat: 25 },
    }));

    expect(reply).not.toContain("Editar:");
    expect(reply).not.toContain("quick-edit");
  });

  it("monta resposta consolidada com todos os alimentos e total destacado", () => {
    const reply = buildWhatsAppConsolidatedMealReplyMessage({
      mealLabel: "Café da manhã",
      occurredAt: new Date("2026-06-04T10:14:00.000Z"),
      items: [
        {
          foodName: "Pêra William",
          canonicalName: "Pêra",
          portionText: "185 g",
          estimatedGrams: 185,
          calories: 105,
          protein: 0.7,
          carbs: 28,
          fat: 0.2,
          source: "catalog",
        },
        {
          foodName: "Banana prata",
          canonicalName: "Banana",
          portionText: "139 g",
          estimatedGrams: 139,
          calories: 125,
          protein: 1.5,
          carbs: 32.3,
          fat: 0.4,
          source: "catalog",
        },
        {
          foodName: "Iogurte grego light Danone",
          canonicalName: "Iogurte grego light",
          portionText: "80 g",
          estimatedGrams: 80,
          calories: 62,
          protein: 6,
          carbs: 7,
          fat: 1,
          source: "catalog",
        },
      ],
    });

    expect(reply).toContain("*Café da manhã Atualizado às 07:14hs.*");
    expect(reply).toContain("• 🍎 Pêra William — 185g");
    expect(reply).toContain("• 🍌 Banana prata — 139g");
    expect(reply).toContain("• 🥛 Iogurte grego light Danone — 80g");
    expect(reply).toContain("*Total da refeição:*");
    expect(reply).toContain("*292 kcal | P 8,2 g | C 67,3 g | G 1,6 g*");
  });

  it("monta resposta de ação com refeição resultante e total destacado", () => {
    const reply = buildWhatsAppMealActionReplyMessage({
      mealLabel: "Almoço",
      occurredAt: new Date("2026-06-04T15:00:00.000Z"),
      items: [
        frangoItem,
        {
          foodName: "Arroz branco",
          canonicalName: "Arroz branco cozido",
          portionText: "100 g",
          estimatedGrams: 100,
          calories: 130,
          protein: 2.7,
          carbs: 28,
          fat: 0.3,
          source: "catalog",
        },
      ],
    }, {
      title: "Alimento adicionado",
      actionLines: ["Adicionei 100 g de Arroz branco à refeição Almoço."],
    });

    expect(reply).toContain("*Alimento adicionado*");
    expect(reply).toContain("Refeição atualizada:");
    expect(reply).toContain("• 🍗 Frango grelhado — 150g");
    expect(reply).toContain("• 🍚 Arroz branco — 100g");
    expect(reply).toContain("*377,5 kcal | P 49,2 g | C 28 g | G 5,7 g*");
  });
});
