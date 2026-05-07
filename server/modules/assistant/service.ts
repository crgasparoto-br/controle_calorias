import { getDashboardSnapshot, getFoodAssistantProfile, logInferenceEvent } from "../../db";
import { invokeLLM } from "../../_core/llm";
import { assistantSuggestionSchema, type AssistantRequestInput, type AssistantSuggestion } from "./schemas";

const EDUCATIONAL_NOTICE = "Sugestões educativas para apoiar sua rotina alimentar. Elas não substituem orientação de nutricionista, médico ou outro profissional de saúde.";

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function sumSuggestedFoods(items: AssistantSuggestion["suggestedFoods"]) {
  return items.reduce(
    (acc, item) => ({
      calories: round(acc.calories + item.calories),
      protein: round(acc.protein + item.protein),
      carbs: round(acc.carbs + item.carbs),
      fat: round(acc.fat + item.fat),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function buildFallbackSuggestion(input: AssistantRequestInput, context: Awaited<ReturnType<typeof buildAssistantContext>>): AssistantSuggestion {
  const proteinRemaining = Math.max(context.today.remaining.protein, 0);
  const calorieTarget = Math.max(Math.min(context.today.remaining.calories || 450, 650), 250);
  const wantsProtein = /prote[ií]na|protein/i.test(input.message);
  const wantsSnack = /lanche|barato|econ[oô]mico/i.test(input.message);

  const foods = wantsProtein
    ? [
        { foodName: "Ovos mexidos", portionText: "2 unidades", estimatedGrams: 100, calories: 155, protein: 13, carbs: 1, fat: 11 },
        { foodName: "Feijão cozido", portionText: "1 concha média", estimatedGrams: 120, calories: 91, protein: 6, carbs: 16, fat: 1 },
      ]
    : wantsSnack
      ? [
          { foodName: "Banana", portionText: "1 unidade média", estimatedGrams: 86, calories: 76, protein: 1, carbs: 20, fat: 0 },
          { foodName: "Aveia", portionText: "2 colheres de sopa", estimatedGrams: 20, calories: 78, protein: 3, carbs: 13, fat: 1.4 },
        ]
      : [
          { foodName: "Arroz cozido", portionText: "4 colheres de sopa", estimatedGrams: 100, calories: 128, protein: 2.5, carbs: 28, fat: 0.2 },
          { foodName: "Frango grelhado", portionText: "1 filé pequeno", estimatedGrams: 100, calories: 165, protein: 31, carbs: 0, fat: 3.6 },
          { foodName: "Legumes cozidos", portionText: "1 prato de sobremesa", estimatedGrams: 120, calories: 55, protein: 2, carbs: 11, fat: 0.5 },
        ];

  const totals = sumSuggestedFoods(foods);

  return {
    text: `Uma opção simples seria combinar ${foods.map(food => food.foodName.toLowerCase()).join(", ")}. A ideia é ficar perto de ${Math.round(calorieTarget)} kcal e ajudar no saldo de proteína de hoje${proteinRemaining > 0 ? `, que ainda tem cerca de ${Math.round(proteinRemaining)} g planejados` : ""}.`,
    suggestedFoods: foods,
    estimatedCalories: totals.calories,
    estimatedMacros: {
      protein: totals.protein,
      carbs: totals.carbs,
      fat: totals.fat,
    },
    alert: context.restrictions.length ? "Revise se a sugestão respeita suas restrições cadastradas antes de salvar." : undefined,
    educationalNotice: EDUCATIONAL_NOTICE,
  };
}

async function buildAssistantContext(userId: number) {
  const [dashboard, profile] = await Promise.all([
    getDashboardSnapshot(userId),
    getFoodAssistantProfile(userId),
  ]);

  return {
    today: {
      goal: dashboard.today.goal,
      consumed: dashboard.today.consumed,
      remaining: dashboard.today.remaining,
    },
    week: {
      planned: dashboard.week.planned,
      consumed: dashboard.week.consumed,
      remaining: dashboard.week.remaining,
      adherence: dashboard.week.adherence,
    },
    preferences: profile.preferences.slice(0, 12),
    restrictions: profile.restrictions.slice(0, 12),
    eatingRoutine: profile.eatingRoutine,
    objective: profile.objective,
  };
}

function parseAssistantContent(content: unknown) {
  const text = Array.isArray(content)
    ? content.map(part => ("text" in part ? part.text : "")).join("\n")
    : String(content ?? "");
  return JSON.parse(text);
}

export async function generateFoodAssistantSuggestion(userId: number, input: AssistantRequestInput) {
  const context = await buildAssistantContext(userId);
  console.info("[FoodAssistant] suggestion_requested", {
    messageLength: input.message.length,
    hasRestrictions: context.restrictions.length > 0,
    preferenceCount: context.preferences.length,
  });

  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: [
            "Você é um assistente alimentar educativo para um app de rotina nutricional.",
            "Use somente o contexto nutricional fornecido. Não peça nem use dados pessoais.",
            "Não faça prescrição médica, diagnóstico, tratamento ou promessa de resultado.",
            "Respeite restrições alimentares e preferências. Se houver risco ou dúvida, inclua observação cautelosa.",
            "Use linguagem simples, acolhedora e não punitiva.",
            "Sempre inclua aviso educativo.",
            "Responda apenas JSON válido no schema solicitado.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            pedido: input.message,
            contexto: context,
            avisoObrigatorio: EDUCATIONAL_NOTICE,
          }),
        },
      ],
      outputSchema: {
        name: "food_assistant_suggestion",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string" },
            suggestedFoods: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  foodName: { type: "string" },
                  portionText: { type: "string" },
                  estimatedGrams: { type: "number" },
                  calories: { type: "number" },
                  protein: { type: "number" },
                  carbs: { type: "number" },
                  fat: { type: "number" },
                },
                required: ["foodName", "portionText", "estimatedGrams", "calories", "protein", "carbs", "fat"],
              },
            },
            estimatedCalories: { type: "number" },
            estimatedMacros: {
              type: "object",
              additionalProperties: false,
              properties: {
                protein: { type: "number" },
                carbs: { type: "number" },
                fat: { type: "number" },
              },
              required: ["protein", "carbs", "fat"],
            },
            alert: { type: "string" },
            educationalNotice: { type: "string" },
          },
          required: ["text", "suggestedFoods", "estimatedCalories", "estimatedMacros", "educationalNotice"],
        },
      },
    });

    const parsed = assistantSuggestionSchema.parse(parseAssistantContent(result.choices[0]?.message.content));
    console.info("[FoodAssistant] suggestion_generated", {
      itemCount: parsed.suggestedFoods.length,
      estimatedCalories: parsed.estimatedCalories,
      hasAlert: Boolean(parsed.alert),
    });
    return parsed;
  } catch (error) {
    logInferenceEvent({
      userId,
      origin: "web",
      status: "warning",
      eventType: "assistant.suggestion_fallback",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao gerar sugestão alimentar.",
    });
    return buildFallbackSuggestion(input, context);
  }
}
