import { describe, expect, it } from "vitest";

import { evaluateWhatsappIntentRoute } from "./intentRouter";

describe("friendly WhatsApp clarification", () => {
  it("orienta mensagens ambíguas e explica como fazer perguntas", () => {
    const route = evaluateWhatsappIntentRoute({ text: "beleza" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_clarification",
      canonicalIntent: "mensagem_ambigua",
      shouldAllowNutritionFallback: false,
    }));
    expect(route.reply).toBe(
      "Só preciso entender melhor o que você deseja 😊\n\n"
      + "Você quer registrar um alimento, corrigir uma refeição ou consultar seus registros?\n\n"
      + "Caso queira fazer uma pergunta, envie a mensagem novamente começando com `/`.",
    );
  });
});
