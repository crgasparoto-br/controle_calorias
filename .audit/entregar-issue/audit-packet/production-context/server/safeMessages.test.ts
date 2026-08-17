import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDailyNutritionStatus,
  buildWeeklyNutritionStatus,
  FORBIDDEN_FOOD_MESSAGE_TERMS,
  SAFE_NUTRITION_MESSAGES,
} from "@shared/safeMessages";
import { assessNutritionGoalTargets } from "@shared/nutritionSafety";

function expectSafeMessage(message: string) {
  for (const term of FORBIDDEN_FOOD_MESSAGE_TERMS) {
    expect(message.toLowerCase()).not.toContain(term);
  }
}

describe("safe nutrition messages", () => {
  it("usa mensagens neutras para excesso calórico e baixa ingestão", () => {
    const aboveGoal = buildDailyNutritionStatus(2300, 2000, 0);
    const lowIntake = buildDailyNutritionStatus(450, 2000, 80);

    expect(aboveGoal).toContain("contexto");
    expect(lowIntake).not.toMatch(/parab[eé]ns|ótimo|excelente/i);
    expectSafeMessage(aboveGoal);
    expectSafeMessage(lowIntake);
  });

  it("alerta metas calóricas agressivas com linguagem acolhedora", () => {
    const assessment = assessNutritionGoalTargets([
      { label: "Meta geral", calories: 1450, proteinGrams: 120, carbsGrams: 160, fatGrams: 45 },
    ]);

    expect(assessment.warnings.map(issue => issue.code)).toContain("calories_low");
    expect(assessment.warnings[0]?.message).toContain(SAFE_NUTRITION_MESSAGES.aggressiveCalorieGoal);
    expectSafeMessage(assessment.warnings[0]?.message ?? "");
  });

  it("centraliza mensagens de progresso semanal sem linguagem punitiva", () => {
    const messages = [
      buildWeeklyNutritionStatus({ totalCalories: 0, daysAboveGoal: 0, daysWithinGoal: 0 }),
      buildWeeklyNutritionStatus({ totalCalories: 4200, daysAboveGoal: 1, daysWithinGoal: 1 }),
      buildWeeklyNutritionStatus({ totalCalories: 6200, daysAboveGoal: 0, daysWithinGoal: 3 }),
      buildWeeklyNutritionStatus({ totalCalories: 1200, daysAboveGoal: 0, daysWithinGoal: 0 }),
    ];

    expect(messages[0]).toContain("primeiro lançamento");
    expect(messages[1]).toContain("contexto completo");
    expect(messages[2]).toContain("boa consistência");
    expect(messages[3]).toContain("semana ainda está em construção");
    messages.forEach(expectSafeMessage);
  });

  it("não expõe termos proibidos nas páginas da interface", () => {
    const root = process.cwd();
    const files = [
      "client/src/pages/Home.tsx",
      "client/src/pages/ReportsPage.tsx",
      "client/src/pages/GoalsPage.tsx",
      "client/src/pages/LogMealPage.tsx",
      "client/src/pages/ChannelsPage.tsx",
      "client/src/pages/AdminPage.tsx",
    ];

    const source = files.map(file => readFileSync(join(root, file), "utf8").toLowerCase()).join("\n");
    for (const term of FORBIDDEN_FOOD_MESSAGE_TERMS) {
      expect(source).not.toContain(term);
    }
    expect(source).not.toMatch(/falha ao|falhou|fracasso|culpa|jacou|estragou/i);
  });
});
