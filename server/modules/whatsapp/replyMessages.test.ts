import { describe, expect, it } from "vitest";
import { buildWhatsAppConsolidatedMealReplyMessage, buildWhatsAppMealReplyMessage } from "./replyMessages";
import type { MealProcessingResult } from "../../nutritionEngine";

describe("buildWhatsAppMealReplyMessage", () => {
  it("inclui horário no cabeçalho e alimento com ícone e calorias na mesma linha", () => {
    const processed: MealProcessingResult = {
      detectedMealLabel: "Almoço",
      sourceText: "frango grelhado",
      imageUrl: undefined,
      audioUrl: undefined,
      transcript: undefined,
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "Teste de formatação.",
      items: [
        {
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
          source: "catalog",
        },
      ],
      totals: {
        calories: 247.5,
        protein: 46.5,
        carbs: 0,
        fat: 5.4,
      },
    };

    const reply = buildWhatsAppMealReplyMessage(processed, {
      registeredAt: new Date("2026-06-04T16:00:00.000Z"),
    });

    expect(reply).toContain("Almoço Registrado às 13:00hs.");
    expect(reply).toContain("• 🍗 Frango grelhado, 150g - 247,5 Kcal");
    expect(reply).toContain("Prot. 46,5 g | Carb. 0 g | Gord. 5,4 g");
  });

  it("não mostra equivalência aproximada em gramas para porções líquidas em ml", () => {
    const processed: MealProcessingResult = {
      detectedMealLabel: "Café da manhã",
      sourceText: "whey, creatina e leite",
      imageUrl: undefined,
      audioUrl: undefined,
      transcript: undefined,
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "Teste de formatação.",
      items: [
        {
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
        },
      ],
      totals: {
        calories: 61,
        protein: 3.2,
        carbs: 4.7,
        fat: 3.3,
      },
    };

    const reply = buildWhatsAppMealReplyMessage(processed);

    expect(reply).toContain("• 🥛 Leite integral, 100 ml - 61 Kcal");
    expect(reply).not.toContain("aprox. 100g");
  });

  it("mantém equivalência aproximada em gramas para porções unitárias", () => {
    const processed: MealProcessingResult = {
      detectedMealLabel: "Lanche",
      sourceText: "1 banana",
      imageUrl: undefined,
      audioUrl: undefined,
      transcript: undefined,
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "Teste de formatação.",
      items: [
        {
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
        },
      ],
      totals: {
        calories: 72,
        protein: 0.9,
        carbs: 18.6,
        fat: 0.2,
      },
    };

    const reply = buildWhatsAppMealReplyMessage(processed);

    expect(reply).toContain("• 🍌 Banana, 1 unidade (aprox. 80g) - 72 Kcal");
  });

  it("resume meta com consumo total e bullets compatíveis com WhatsApp", () => {
    const processed: MealProcessingResult = {
      detectedMealLabel: "Almoço",
      sourceText: "frango grelhado",
      imageUrl: undefined,
      audioUrl: undefined,
      transcript: undefined,
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "Teste de formatação.",
      items: [
        {
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
          source: "catalog",
        },
      ],
      totals: {
        calories: 247.5,
        protein: 46.5,
        carbs: 0,
        fat: 5.4,
      },
    };

    const reply = buildWhatsAppMealReplyMessage(processed, {
      registeredAt: new Date("2026-06-04T16:00:00.000Z"),
      goalProgress: {
        consumedCalories: 1165,
        goalCalories: 2000,
        exerciseCalories: 200,
      },
    });

    expect(reply).toContain("Meta de hoje:");
    expect(reply).toContain("* Meta estimada: 2.000 kcal");
    expect(reply).toContain("* Exercícios: 200 kcal");
    expect(reply).toContain("* Meta ajustada: 2.200 kcal");
    expect(reply).toContain("* Consumo: 1.165 kcal");
    expect(reply).toContain("* Déficit: 1.035 kcal");
  });

  it("não inclui link de edição no corpo do texto (link é enviado como botão separado)", () => {
    const processed: MealProcessingResult = {
      detectedMealLabel: "Jantar",
      sourceText: "300g amendoim japonês",
      imageUrl: undefined,
      audioUrl: undefined,
      transcript: undefined,
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "Teste de edição rápida.",
      items: [
        {
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
        },
      ],
      totals: {
        calories: 450,
        protein: 15,
        carbs: 40,
        fat: 25,
      },
    };

    const reply = buildWhatsAppMealReplyMessage(processed);

    expect(reply).toContain("Amendoim japonês");
    expect(reply).not.toContain("Editar:");
    expect(reply).not.toContain("quick-edit");
  });

  it("monta resposta consolidada com todos os alimentos da refeição atualizada", () => {
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

    expect(reply).toContain("Café da manhã Atualizado às 07:14hs.");
    expect(reply).toContain("• 🍽️ Pêra William, 185g - 105 Kcal");
    expect(reply).toContain("• 🍌 Banana prata, 139g - 125 Kcal");
    expect(reply).toContain("• 🥛 Iogurte grego light Danone, 80g - 62 Kcal");
    expect(reply).toContain("Total da refeição:");
    expect(reply).toContain("292 Kcal");
    expect(reply).toContain("Prot. 8,2 g | Carb. 67,3 g | Gord. 1,6 g");
  });
});
