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

  it("bloqueia pedido de grafico antes do parser de alimentos", () => {
    const decision = routeWhatsappMessageBeforeNutrition({ text: "gere um gráfico da semana" });

    expect(decision.shouldUseNutritionFallback).toBe(false);
    expect(decision.canonical.intent).toBe("gerar_grafico");
    expect(decision.canonical.requested_output_type).toBe("grafico");
    expect(decision.response?.reply).toContain("gráfico");
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
