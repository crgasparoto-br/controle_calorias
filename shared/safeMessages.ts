export const FORBIDDEN_FOOD_MESSAGE_TERMS = [
  "fracasso",
  "culpa",
  "jacou",
  "estragou",
  "falhou",
  "compensar com punição",
] as const;

export const SAFE_NUTRITION_MESSAGES = {
  noFoodYet: "Comece com um registro simples hoje. Consistência conta mais do que precisão perfeita.",
  aboveDailyGoal: "Hoje ficou acima da meta planejada. Use a média semanal para olhar o contexto e escolher o próximo passo com calma.",
  nearDailyGoal: "Você está próximo da sua meta de hoje.",
  lowIntakeWithProteinRoom: "Ainda há espaço para uma refeição com proteína, se fizer sentido para sua rotina e fome de hoje.",
  lowIntakeNeutral: "O dia ainda tem pouca informação registrada. Próximos registros ajudam a leitura ficar mais clara.",
  macroAboveGoal: "Acima da meta planejada hoje; a média semanal ajuda a dar contexto.",
  aggressiveCalorieGoal: "Essa meta calórica está em uma faixa agressiva. Revise se ela é sustentável e considere acompanhamento profissional.",
  couldNotUpdateGoals: "Não foi possível atualizar as metas agora.",
} as const;

export function buildDailyNutritionStatus(consumedCalories: number, goalCalories: number, proteinRemainingGrams: number) {
  if (!goalCalories || consumedCalories <= 0) {
    return SAFE_NUTRITION_MESSAGES.noFoodYet;
  }

  const ratio = consumedCalories / goalCalories;
  if (ratio > 1.05) {
    return SAFE_NUTRITION_MESSAGES.aboveDailyGoal;
  }
  if (ratio >= 0.85) {
    return SAFE_NUTRITION_MESSAGES.nearDailyGoal;
  }
  if (proteinRemainingGrams > 10) {
    return SAFE_NUTRITION_MESSAGES.lowIntakeWithProteinRoom;
  }
  return SAFE_NUTRITION_MESSAGES.lowIntakeNeutral;
}
