import { describe, expect, it } from "vitest";
import { buildWhatsappRouterResult, evaluateWhatsappIntentRoute } from "./intentRouter";

describe("evaluateWhatsappIntentRoute", () => {
  it("permite alimento simples com quantidade seguir para fallback nutricional", () => {
    const route = evaluateWhatsappIntentRoute({ text: "100g de arroz" });

    expect(route).toEqual(expect.objectContaining({
      action: "continue_pipeline",
      canonicalIntent: "registrar_alimento",
      shouldAllowNutritionFallback: true,
    }));
  });

  it("permite comando de adicionar alimento seguir para fluxo proprio", () => {
    const route = evaluateWhatsappIntentRoute({ text: "adicionar 30g de arroz" });

    expect(route).toEqual(expect.objectContaining({
      action: "continue_pipeline",
      canonicalIntent: "adicionar_alimento",
      shouldAllowNutritionFallback: true,
    }));
  });

  it("bloqueia numero isolado sem contexto pendente", () => {
    const route = evaluateWhatsappIntentRoute({ text: "2" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_clarification",
      canonicalIntent: "selecionar_opcao",
      shouldAllowNutritionFallback: false,
    }));
    expect(buildWhatsappRouterResult(route)).toEqual(expect.objectContaining({
      action: "router_safe_response",
      reply: expect.stringContaining("não encontrei uma lista"),
    }));
  });

  it("roteia numero isolado para contexto pendente quando disponivel", () => {
    const route = evaluateWhatsappIntentRoute({ text: "2", pendingContextKind: "selection" });

    expect(route).toEqual(expect.objectContaining({
      action: "route_to_pending_context",
      canonicalIntent: "selecionar_opcao",
      shouldAllowNutritionFallback: false,
    }));
    expect(route.data.pendingContextKind).toBe("selection");
  });

  it("bloqueia confirmacao curta sem contexto pendente", () => {
    const route = evaluateWhatsappIntentRoute({ text: "sim" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_clarification",
      canonicalIntent: "confirmacao_sim_nao",
      shouldAllowNutritionFallback: false,
    }));
  });

  it("calcula conta matematica com unidade sem registrar alimento", () => {
    const route = evaluateWhatsappIntentRoute({ text: "110 - 30 g" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_clarification",
      canonicalIntent: "calcular_quantidade",
      shouldAllowNutritionFallback: false,
    }));
    expect(route.data.calculation).toEqual({
      expression: "110 - 30",
      result: 80,
      unit: "g",
    });
    expect(route.reply).toContain("80 g");
  });

  it("roteia resumo e relatorio para fluxo proprio sem fallback alimentar", () => {
    expect(evaluateWhatsappIntentRoute({ text: "resuma meu dia" })).toEqual(expect.objectContaining({
      action: "continue_pipeline",
      canonicalIntent: "resumo_periodo",
      shouldAllowNutritionFallback: false,
    }));
    expect(evaluateWhatsappIntentRoute({ text: "relatório da semana" })).toEqual(expect.objectContaining({
      action: "continue_pipeline",
      canonicalIntent: "gerar_relatorio",
      shouldAllowNutritionFallback: false,
    }));
  });

  it("responde pedido de grafico sem parser nutricional", () => {
    const route = evaluateWhatsappIntentRoute({ text: "gere um gráfico da semana" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "gerar_grafico",
      shouldAllowNutritionFallback: false,
    }));
  });

  it("roteia sugestao para fluxo proprio sem fallback alimentar", () => {
    const route = evaluateWhatsappIntentRoute({ text: "me sugira um lanche da tarde" });

    expect(route).toEqual(expect.objectContaining({
      action: "continue_pipeline",
      canonicalIntent: "sugestao_refeicao",
      shouldAllowNutritionFallback: false,
    }));
  });

  it("bloqueia pergunta sem alimento registravel", () => {
    const route = evaluateWhatsappIntentRoute({ text: "qual melhor horario para jantar?" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "pergunta_sobre_alimento",
      shouldAllowNutritionFallback: false,
    }));
  });

  it("pede esclarecimento para mensagem ambigua", () => {
    const route = evaluateWhatsappIntentRoute({ text: "beleza" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_clarification",
      canonicalIntent: "mensagem_ambigua",
      shouldAllowNutritionFallback: false,
    }));
  });

  it("roteia comando de remocao sem fallback alimentar", () => {
    const route = evaluateWhatsappIntentRoute({ text: "excluir 2" });

    expect(route).toEqual(expect.objectContaining({
      action: "continue_pipeline",
      canonicalIntent: "excluir_alimento",
      shouldAllowNutritionFallback: false,
    }));
  });
});
