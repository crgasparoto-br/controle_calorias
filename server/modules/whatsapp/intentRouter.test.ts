import { describe, expect, it } from "vitest";
import { routeWhatsappMessageBeforeNutrition } from "./intentRouter";

describe("routeWhatsappMessageBeforeNutrition", () => {
  it("encaminha alimento com quantidade para o fallback nutricional", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "100g de arroz" });

    expect(decision.shouldUseNutritionFallback).toBe(true);
    expect(decision.response).toBeNull();
    expect(decision.canonical.schema_version).toBe("whatsapp-intent-schema/v1");
    expect(decision.canonical.intent).toBe("adicionar_alimento");
    expect(decision.canonical.extracted_items).toEqual([expect.objectContaining({
      name: "arroz",
      quantity: 100,
      unit: "g",
    })]);
  });

  it("preserva comando explicito de adicionar alimento com quantidade", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "adicionar 30g de arroz" });

    expect(decision.shouldUseNutritionFallback).toBe(true);
    expect(decision.response).toBeNull();
    expect(decision.canonical.intent).toBe("adicionar_alimento");
    expect(decision.canonical.extracted_items).toEqual([expect.objectContaining({
      name: "arroz",
      quantity: 30,
      unit: "g",
    })]);
  });

  it("preserva registro alimentar simples com quantidade sem unidade", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "1 banana" });

    expect(decision.shouldUseNutritionFallback).toBe(true);
    expect(decision.response).toBeNull();
    expect(decision.reason).toBe("likely_food_with_simple_quantity");
    expect(decision.canonical.intent).toBe("adicionar_alimento");
    expect(decision.canonical.extracted_items).toEqual([expect.objectContaining({
      name: "banana",
      quantity: 1,
      unit: null,
    })]);
  });

  it("preserva narrativa de refeicao sem quantidades explicitas no fallback nutricional", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "almocei arroz, feijão e frango grelhado" });

    expect(decision.shouldUseNutritionFallback).toBe(true);
    expect(decision.response).toBeNull();
    expect(decision.reason).toBe("meal_narrative");
    expect(decision.canonical.intent).toBe("adicionar_alimento");
    expect(decision.canonical.extracted_items.map(item => item.name)).toEqual([
      "arroz",
      "feijao",
      "frango grelhado",
    ]);
  });

  it("bloqueia numero isolado sem contexto antes do parser nutricional", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "2" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("isolated_number_without_context");
    expect(decision.canonical.intent).toBe("mensagem_ambigua");
    expect(decision.response).toEqual(expect.objectContaining({
      action: "router_clarification_needed",
      eventType: "whatsapp.router.clarification_needed",
    }));
  });

  it("roteia numero isolado com contexto pendente como selecao", () => {
    const decision = routeWhatsappMessageBeforeNutrition({
      text: "2",
      pendingContextId: "pending-1",
      pendingContextKind: "selecionar item da ultima refeicao",
    });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.canonical.intent).toBe("selecionar_opcao");
    expect(decision.canonical.pending_context_id).toBe("pending-1");
    expect(decision.response).toEqual(expect.objectContaining({
      action: "router_contextual_response",
    }));
  });

  it("bloqueia resposta curta sem contexto pendente", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "sim" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("short_affirmative_without_context");
    expect(decision.canonical.intent).toBe("mensagem_ambigua");
    expect(decision.response).toEqual(expect.objectContaining({
      action: "router_clarification_needed",
    }));
  });

  it("roteia resposta curta com contexto pendente como confirmacao", () => {
    const decision = routeWhatsappMessageBeforeNutrition({
      text: "não",
      pendingContextId: "pending-2",
      pendingContextKind: "confirmar alteracao de refeicao",
    });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("short_negative_with_context");
    expect(decision.canonical.intent).toBe("cancelar_pendencia");
    expect(decision.response).toEqual(expect.objectContaining({
      action: "router_contextual_response",
    }));
  });

  it("roteia conta matematica com unidade antes de qualquer registro", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "110 - 30 g" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.canonical.intent).toBe("calcular_quantidade");
    expect(decision.canonical.calculations).toEqual([expect.objectContaining({
      result_value: 80,
      result_unit: "g",
    })]);
    expect(decision.response).toEqual(expect.objectContaining({
      action: "router_calculation_detected",
    }));
  });

  it("bloqueia ajuste numerico sem alvo seguro", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "somar 30g" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("numeric_adjustment_without_context");
    expect(decision.canonical.intent).toBe("somar_quantidade");
    expect(decision.response).toEqual(expect.objectContaining({
      action: "router_clarification_needed",
    }));
  });

  it("roteia comando numerico com contexto pendente antes de alterar dados", () => {
    const decision = routeWhatsappMessageBeforeNutrition({
      text: "excluir 2",
      pendingContextId: "pending-3",
      pendingContextKind: "lista de alimentos para remover",
    });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("numeric_adjustment_with_context");
    expect(decision.canonical.intent).toBe("excluir_alimento");
    expect(decision.response).toEqual(expect.objectContaining({
      action: "router_contextual_response",
    }));
  });

  it("bloqueia pedido de grafico antes do parser de alimentos", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "gere um gráfico da semana" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("chart_request");
    expect(decision.canonical.intent).toBe("gerar_grafico");
    expect(decision.canonical.requested_output_type).toBe("grafico");
    expect(decision.canonical.requested_period).toBe("semana");
    expect(decision.response?.reply).toContain("gráfico");
  });

  it("bloqueia pedido de relatorio antes do parser de alimentos", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "gere um relatório do mês" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("report_request");
    expect(decision.canonical.intent).toBe("gerar_relatorio");
    expect(decision.canonical.requested_output_type).toBe("relatorio");
    expect(decision.canonical.requested_period).toBe("mes");
  });

  it("roteia resumo de periodo sem criar alimento", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "resuma minha semana" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("summary_request");
    expect(decision.canonical.intent).toBe("resumo_periodo");
    expect(decision.canonical.requested_output_type).toBe("resumo");
    expect(decision.canonical.requested_period).toBe("semana");
  });

  it("roteia sugestao de refeicao sem registrar alimento", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "sugira um jantar leve" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("suggestion_request");
    expect(decision.canonical.intent).toBe("sugestao_refeicao");
    expect(decision.canonical.requested_output_type).toBe("sugestao");
  });

  it("roteia consulta de historico sem criar registro", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "o que eu comi hoje?" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("history_request");
    expect(decision.canonical.intent).toBe("consulta_historico");
    expect(decision.canonical.requested_period).toBe("hoje");
  });

  it("roteia pergunta sobre meta sem registrar alimento", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "como estou em relação à meta?" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("goal_question_request");
    expect(decision.canonical.intent).toBe("pergunta_sobre_meta");
  });

  it("roteia pergunta sobre evolucao sem registrar alimento", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "como está minha evolução essa semana?" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("progress_question_request");
    expect(decision.canonical.intent).toBe("pergunta_sobre_evolucao");
  });

  it("roteia pergunta sobre qualidade alimentar sem registrar alimento", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "minha alimentação está balanceada?" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("food_quality_question_request");
    expect(decision.canonical.intent).toBe("pergunta_sobre_qualidade_alimentar");
  });

  it("roteia pergunta sobre alimento sem criar registro", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "banana tem muita caloria?" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.reason).toBe("food_question_request");
    expect(decision.canonical.intent).toBe("pergunta_sobre_alimento");
  });

  it("pede esclarecimento para texto ambiguo sem alimento claro", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "registro" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.canonical.intent).toBe("mensagem_ambigua");
    expect(decision.response).toEqual(expect.objectContaining({
      action: "router_clarification_needed",
    }));
  });
});
