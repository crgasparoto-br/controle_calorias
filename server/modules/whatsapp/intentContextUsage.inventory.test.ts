import { describe, expect, it } from "vitest";
import { contextUsage as deleteIntentContextUsage } from "./deleteIntent";
import { contextUsage as gramsAdjustmentContextUsage } from "./gramsAdjustmentIntent";
import { contextUsage as gramsIncrementContextUsage } from "./gramsIncrementIntent";
import { contextUsage as foodReplacementContextUsage } from "./contextualFoodReplacementIntent";
import { contextUsage as recordAdjustmentContextUsage } from "./recordAdjustmentIntent";
import { contextUsage as mealItemSelectionContextUsage } from "./mealItemSelectionCallback";
import { contextUsage as mealListContextUsage } from "./mealListIntent";
import { contextUsage as aiQuestionContextUsage } from "./aiQuestionAssistant";

describe("declaração de uso de contexto por intent", () => {
  const destructiveOrMutatingIntents = {
    deleteIntent: deleteIntentContextUsage,
    gramsAdjustmentIntent: gramsAdjustmentContextUsage,
    gramsIncrementIntent: gramsIncrementContextUsage,
    contextualFoodReplacementIntent: foodReplacementContextUsage,
    recordAdjustmentIntent: recordAdjustmentContextUsage,
    mealItemSelectionCallback: mealItemSelectionContextUsage,
    mealListIntent: mealListContextUsage,
  };

  it("toda intent destrutiva ou mutante exige consulta fresca ao banco", () => {
    for (const [name, usage] of Object.entries(destructiveOrMutatingIntents)) {
      expect(usage.requiresFreshDbQuery, `${name} deveria exigir consulta fresca ao banco`).toBe(true);
    }
  });

  it("todo caminho que cria ou consome seleção/confirmação declara pendência", () => {
    const pendingIntents = {
      deleteIntent: deleteIntentContextUsage,
      gramsAdjustmentIntent: gramsAdjustmentContextUsage,
      gramsIncrementIntent: gramsIncrementContextUsage,
      contextualFoodReplacementIntent: foodReplacementContextUsage,
      recordAdjustmentIntent: recordAdjustmentContextUsage,
      mealItemSelectionCallback: mealItemSelectionContextUsage,
    };
    for (const [name, usage] of Object.entries(pendingIntents)) {
      expect(usage.usesPendingOperation, `${name} deveria declarar uso de pendência`).toBe(true);
    }
  });

  it("o assistente / não exige consulta destrutiva ao banco", () => {
    expect(aiQuestionContextUsage.requiresFreshDbQuery).toBe(false);
  });
});
