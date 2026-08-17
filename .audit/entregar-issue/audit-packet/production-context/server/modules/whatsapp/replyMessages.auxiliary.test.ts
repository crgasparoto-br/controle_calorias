import { describe, expect, it } from "vitest";
import {
  buildWhatsAppClarificationReplyMessage,
  buildWhatsAppPeriodReportReplyMessage,
  buildWhatsAppSnackSuggestionReplyMessage,
  buildWhatsAppWaterLoggedReplyMessage,
} from "./replyMessages";

describe("WhatsApp auxiliary reply messages", () => {
  it("padroniza confirmação de água registrada", () => {
    const reply = buildWhatsAppWaterLoggedReplyMessage({
      amountLabel: "500",
      occurredAtLabel: "02/06/2026 09:00",
    });

    expect(reply).toContain("*Água registrada*");
    expect(reply).toContain("Registrei 500 ml de água em 02/06/2026 09:00.");
  });

  it("padroniza esclarecimentos curtos", () => {
    const reply = buildWhatsAppClarificationReplyMessage("Me diga o período do resumo.");

    expect(reply).toContain("*Preciso de uma informação*");
    expect(reply).toContain("Me diga o período do resumo.");
  });

  it("padroniza sugestão de lanche com título e bullets", () => {
    const reply = buildWhatsAppSnackSuggestionReplyMessage();

    expect(reply).toContain("*Sugestão para o lanche da tarde*");
    expect(reply).toContain("• Iogurte natural com banana e aveia");
    expect(reply).toContain("Outra opção:");
  });

  it("padroniza resumo de período com título, contagem e análise", () => {
    const reply = buildWhatsAppPeriodReportReplyMessage({
      periodLabel: "semana",
      mealCount: 2,
      mealBreakdownLines: [
        "• *Jantar*",
        "198 kcal | P 37 g | C 0 g | G 4 g",
      ],
      goalSummaryLines: [
        "*Meta:* 15.400 kcal",
        "*Consumo:* 469 kcal (-14.931 kcal)",
      ],
    });

    expect(reply).toContain("*Resumo de semana*");
    expect(reply).toContain("Refeições registradas: 2");
    expect(reply).toContain("• *Jantar*");
    expect(reply).toContain("198 kcal | P 37 g | C 0 g | G 4 g");
    expect(reply).toContain("*Meta:* 15.400 kcal");
  });
});
