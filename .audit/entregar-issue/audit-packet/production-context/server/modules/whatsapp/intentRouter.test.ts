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

  it("bloqueia soma numerica sem alvo ou contexto antes do fallback alimentar", () => {
    const route = evaluateWhatsappIntentRoute({ text: "somar 30g" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_clarification",
      canonicalIntent: "somar_quantidade",
      shouldAllowNutritionFallback: false,
    }));
    expect(route.reply).toContain("em qual item ou refeição");
  });

  it("roteia ajuste numerico para contexto pendente quando disponivel", () => {
    const route = evaluateWhatsappIntentRoute({ text: "somar 30g", pendingContextKind: "quantity" });

    expect(route).toEqual(expect.objectContaining({
      action: "route_to_pending_context",
      canonicalIntent: "somar_quantidade",
      shouldAllowNutritionFallback: false,
    }));
    expect(route.data.pendingContextKind).toBe("quantity");
  });

  it("bloqueia correcao numerica sem alvo ou contexto", () => {
    const route = evaluateWhatsappIntentRoute({ text: "corrigir 30g" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_clarification",
      canonicalIntent: "corrigir_alimento",
      shouldAllowNutritionFallback: false,
    }));
    expect(route.reply).toContain("qual item ou refeição");
  });

  it("bloqueia remocao numerica sem lista ou contexto pendente", () => {
    const route = evaluateWhatsappIntentRoute({ text: "excluir 2" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_clarification",
      canonicalIntent: "excluir_alimento",
      shouldAllowNutritionFallback: false,
    }));
    expect(route.reply).toContain("lista ativa");
  });

  it("roteia remocao numerica para contexto pendente quando disponivel", () => {
    const route = evaluateWhatsappIntentRoute({ text: "excluir 2", pendingContextKind: "selection" });

    expect(route).toEqual(expect.objectContaining({
      action: "route_to_pending_context",
      canonicalIntent: "excluir_alimento",
      shouldAllowNutritionFallback: false,
    }));
    expect(route.data.pendingContextKind).toBe("selection");
  });

  it("roteia resumo do dia para fluxo de consulta sem fallback alimentar", () => {
    const route = evaluateWhatsappIntentRoute({ text: "resuma meu dia" });

    expect(route).toEqual(expect.objectContaining({
      action: "continue_pipeline",
      canonicalIntent: "resumo_dia",
      shouldAllowNutritionFallback: false,
    }));
  });

  it("responde relatorio e resumo de periodo com fallback seguro sem parser nutricional", () => {
    expect(evaluateWhatsappIntentRoute({ text: "relatório da semana" })).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "gerar_relatorio",
      shouldAllowNutritionFallback: false,
    }));
    expect(evaluateWhatsappIntentRoute({ text: "resumo do mês" })).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "resumo_periodo",
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

  it("roteia consulta de historico para fluxo proprio sem fallback alimentar", () => {
    const route = evaluateWhatsappIntentRoute({ text: "o que eu comi hoje?" });

    expect(route).toEqual(expect.objectContaining({
      action: "continue_pipeline",
      canonicalIntent: "consulta_historico",
      shouldAllowNutritionFallback: false,
    }));
  });

  it("responde sugestao de refeicao e alimento sem registrar comida", () => {
    expect(evaluateWhatsappIntentRoute({ text: "me sugira um jantar leve" })).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "sugestao_refeicao",
      shouldAllowNutritionFallback: false,
    }));
    expect(evaluateWhatsappIntentRoute({ text: "sugira um ingrediente para o lanche" })).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "sugestao_alimento",
      shouldAllowNutritionFallback: false,
    }));
  });

  it("classifica perguntas sobre meta, evolucao e qualidade alimentar", () => {
    expect(evaluateWhatsappIntentRoute({ text: "como estou em relação à meta?" })).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "pergunta_sobre_meta",
      shouldAllowNutritionFallback: false,
    }));
    expect(evaluateWhatsappIntentRoute({ text: "como está minha evolução?" })).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "pergunta_sobre_evolucao",
      shouldAllowNutritionFallback: false,
    }));
    expect(evaluateWhatsappIntentRoute({ text: "a qualidade da minha alimentação está boa?" })).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "pergunta_sobre_qualidade_alimentar",
      shouldAllowNutritionFallback: false,
    }));
  });

  it("classifica diabetes como pergunta medica sensivel sem registro alimentar", () => {
    const route = evaluateWhatsappIntentRoute({ text: "sou diabético, posso comer arroz?" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "pergunta_medica_sensivel",
      shouldAllowNutritionFallback: false,
    }));
    expect(route.reply).toContain("não vou diagnosticar");
  });

  it("classifica jejum e suplemento como pergunta de saude e dieta limitada", () => {
    expect(evaluateWhatsappIntentRoute({ text: "posso fazer jejum?" })).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "pergunta_saude_dieta",
      shouldAllowNutritionFallback: false,
    }));
    expect(evaluateWhatsappIntentRoute({ text: "esse suplemento é bom?" })).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "pergunta_saude_dieta",
      shouldAllowNutritionFallback: false,
    }));
  });

  it("orienta atendimento em sintoma grave ou risco", () => {
    const route = evaluateWhatsappIntentRoute({ text: "minha pressão está alta, o que faço?" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "possivel_urgencia_saude",
      shouldAllowNutritionFallback: false,
    }));
    expect(route.reply).toContain("Procure um serviço de urgência");
  });

  it("limita pedido de corte calorico sem prescricao individual", () => {
    const route = evaluateWhatsappIntentRoute({ text: "quantas calorias devo cortar?" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "pergunta_saude_dieta",
      shouldAllowNutritionFallback: false,
    }));
    expect(route.reply).toContain("não vou prescrever");
  });

  it("mantem pergunta alimentar simples fora de saude sensivel", () => {
    const route = evaluateWhatsappIntentRoute({ text: "banana tem muita caloria?" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_non_food_response",
      canonicalIntent: "pergunta_sobre_alimento",
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

  it("pede esclarecimento quando registro e analise aparecem juntos", () => {
    const route = evaluateWhatsappIntentRoute({ text: "adicione 100g de arroz e gere um relatório" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_clarification",
      canonicalIntent: "mensagem_ambigua",
      shouldAllowNutritionFallback: false,
    }));
    expect(route.data.possibleIntents).toEqual(expect.arrayContaining(["registrar_alimento", "gerar_relatorio"]));
  });

  it("pede esclarecimento para mensagem ambigua", () => {
    const route = evaluateWhatsappIntentRoute({ text: "beleza" });

    expect(route).toEqual(expect.objectContaining({
      action: "safe_clarification",
      canonicalIntent: "mensagem_ambigua",
      shouldAllowNutritionFallback: false,
    }));
  });

  it("roteia comando de remocao textual sem fallback alimentar", () => {
    const route = evaluateWhatsappIntentRoute({ text: "excluir o arroz" });

    expect(route).toEqual(expect.objectContaining({
      action: "continue_pipeline",
      canonicalIntent: "excluir_alimento",
      shouldAllowNutritionFallback: false,
    }));
  });
});
