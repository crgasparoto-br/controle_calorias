import { describe, expect, it } from "vitest";
import { contextUsage as deleteIntentContextUsage } from "./deleteIntent";
import { contextUsage as gramsAdjustmentContextUsage } from "./gramsAdjustmentIntent";
import { contextUsage as foodReplacementContextUsage } from "./contextualFoodReplacementIntent";
import { contextUsage as mealListContextUsage } from "./mealListIntent";
import { contextUsage as aiQuestionContextUsage } from "./aiQuestionAssistant";

/**
 * Inventário exigido pela issue #766 (clarificação #7): cada intent declara quais
 * partes do contexto usa/ignora. Aqui garantimos que toda intent que altera ou
 * exclui um registro persistido declara requiresFreshDbQuery: true — ou seja,
 * nunca aplica uma mutação confiando cegamente em estado antigo/em cache.
 */
describe("declaração de uso de contexto por intent (issue #766)", () => {
  const destructiveOrMutatingIntents = {
    deleteIntent: deleteIntentContextUsage,
    gramsAdjustmentIntent: gramsAdjustmentContextUsage,
    contextualFoodReplacementIntent: foodReplacementContextUsage,
    mealListIntent: mealListContextUsage,
  };

  it("toda intent destrutiva/mutante declara requiresFreshDbQuery: true", () => {
    for (const [name, usage] of Object.entries(destructiveOrMutatingIntents)) {
      expect(usage.requiresFreshDbQuery, `${name} deveria exigir consulta fresca ao banco`).toBe(true);
    }
  });

  it("o assistente `/` declara não exigir consulta destrutiva ao banco", () => {
    expect(aiQuestionContextUsage.requiresFreshDbQuery).toBe(false);
  });

  it("deleteIntent declara que consome pendência operacional", () => {
    expect(deleteIntentContextUsage.usesPendingOperation).toBe(true);
  });
});
