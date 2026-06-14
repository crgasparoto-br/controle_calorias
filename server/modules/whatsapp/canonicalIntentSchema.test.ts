import { describe, expect, it } from "vitest";
import {
  WHATSAPP_CANONICAL_INTENT_SCHEMA_VERSION,
  buildCanonicalIntentOutputFromRuntime,
  parseWhatsappCanonicalIntentOutput,
  whatsappCanonicalIntentNames,
  whatsappCanonicalIntentOutputSchema,
} from "./canonicalIntentSchema";

describe("whatsapp canonical intent schema", () => {
  it("inclui a taxonomia inicial exigida pela issue 411", () => {
    expect(whatsappCanonicalIntentNames).toEqual(expect.arrayContaining([
      "registrar_alimento",
      "adicionar_alimento",
      "corrigir_alimento",
      "trocar_alimento",
      "excluir_alimento",
      "excluir_refeicao",
      "somar_quantidade",
      "calcular_quantidade",
      "acao_composta",
      "resumo_dia",
      "resumo_periodo",
      "gerar_grafico",
      "gerar_relatorio",
      "sugestao_refeicao",
      "sugestao_alimento",
      "consulta_historico",
      "pergunta_saude_dieta",
      "pergunta_medica_sensivel",
      "possivel_urgencia_saude",
      "analisar_imagem_alimento",
      "extrair_rotulo_nutricional",
      "profissional_sugere_plano_alimentar",
      "paciente_aceita_sugestao",
      "selecionar_opcao",
      "pedir_esclarecimento",
      "cancelar_pendencia",
      "mensagem_ambigua",
      "mensagem_nao_relacionada",
    ]));
  });

  it("valida uma saida canonica com ator, contexto, autonomia, midia, datas e acoes", () => {
    const parsed = whatsappCanonicalIntentOutputSchema.parse({
      schema_version: WHATSAPP_CANONICAL_INTENT_SCHEMA_VERSION,
      message_id: "wamid.123",
      input_modality: "imagem_com_legenda",
      original_text: "rótulo do iogurte zero",
      normalized_text: "rotulo do iogurte zero",
      transcribed_text: null,
      media_context: {
        media_id: "media-1",
        caption: "iogurte zero",
        media_kind: "rotulo_nutricional",
        extraction_confidence: 0.82,
      },
      intent: "extrair_rotulo_nutricional",
      confidence: 0.86,
      safety_level: "normal",
      autonomy_level: "requer_revisao",
      autonomy_reason: "Fonte nutricional extraida de mídia precisa de revisão antes de virar fonte global.",
      actor_type: "usuario",
      actor_id: "42",
      target_user_id: "42",
      professional_id: null,
      context_required: false,
      needs_confirmation: true,
      pending_context_id: null,
      pending_proposal_id: null,
      requested_output_type: null,
      requested_period: null,
      user_timezone: "America/Sao_Paulo",
      temporal_expression: "hoje",
      resolved_date: "2026-06-14",
      resolved_time_range: { start: "2026-06-14T00:00:00-03:00", end: "2026-06-14T23:59:59-03:00" },
      meal_slot: "lanche",
      extracted_items: [{
        name: "iogurte zero",
        normalized_name: "iogurte zero",
        quantity: 1,
        unit: "unidade",
        brand: null,
        preparation: null,
        confidence: 0.8,
      }],
      extracted_actions: [{
        order: 1,
        action_type: "extrair_rotulo_nutricional",
        target: "iogurte zero",
        depends_on_order: null,
        item: null,
        quantity: null,
        autonomy_level: "requer_revisao",
        needs_confirmation: true,
        validation_status: "pendente",
        message: "Extrair rótulo e validar fonte antes de salvar.",
      }],
      calculations: [],
      source_recommendation: {
        source_type: "rotulo",
        reason: "Usuário enviou imagem de rótulo nutricional.",
        confidence: 0.82,
      },
      clarification_options: [],
      processing_strategy: "llm_structured",
      warnings: ["Validar dados do rótulo antes de persistir como fonte nutricional."],
      ambiguity_reason: null,
    });

    expect(parsed.schema_version).toBe(WHATSAPP_CANONICAL_INTENT_SCHEMA_VERSION);
    expect(parsed.intent).toBe("extrair_rotulo_nutricional");
    expect(parsed.extracted_actions[0].validation_status).toBe("pendente");
  });

  it("rejeita intencao fora da taxonomia controlada", () => {
    const result = parseWhatsappCanonicalIntentOutput({
      schema_version: WHATSAPP_CANONICAL_INTENT_SCHEMA_VERSION,
      message_id: null,
      input_modality: "texto",
      original_text: null,
      normalized_text: null,
      transcribed_text: null,
      media_context: null,
      intent: "registrar_qualquer_coisa",
      confidence: 0.8,
      safety_level: "normal",
      autonomy_level: "automatico",
      autonomy_reason: null,
      actor_type: "usuario",
      actor_id: null,
      target_user_id: null,
      professional_id: null,
      context_required: false,
      needs_confirmation: false,
      pending_context_id: null,
      pending_proposal_id: null,
      requested_output_type: null,
      requested_period: null,
      user_timezone: null,
      temporal_expression: null,
      resolved_date: null,
      resolved_time_range: null,
      meal_slot: null,
      extracted_items: [],
      extracted_actions: [],
      calculations: [],
      source_recommendation: null,
      clarification_options: [],
      processing_strategy: null,
      warnings: [],
      ambiguity_reason: null,
    });

    expect(result.success).toBe(false);
  });

  it("adapta a intencao runtime atual para o contrato canonico", () => {
    const canonical = buildCanonicalIntentOutputFromRuntime({
      runtimeIntent: {
        intent: "add_foods_to_meal",
        confidence: 0.88,
        date: "hoje",
        meal: { label: "café da manhã", createIfMissing: true },
        items: [{ foodName: "banana", quantity: 1, unit: "unidade" }],
        requiresConfirmation: false,
        possibleIntents: [],
        reason: "Mensagem pede inclusão em refeição nomeada.",
      },
      messageId: "wamid.456",
      originalText: "Inclua no café da manhã: 1 banana",
      processingStrategy: "llm_structured",
      userTimezone: "America/Sao_Paulo",
      actorId: 42,
      targetUserId: 42,
    });

    expect(canonical.intent).toBe("adicionar_alimento");
    expect(canonical.schema_version).toBe(WHATSAPP_CANONICAL_INTENT_SCHEMA_VERSION);
    expect(canonical.autonomy_level).toBe("automatico");
    expect(canonical.meal_slot).toBe("café da manhã");
    expect(canonical.extracted_items[0]).toEqual(expect.objectContaining({
      name: "banana",
      quantity: 1,
      unit: "unidade",
    }));
    expect(canonical.extracted_actions[0]).toEqual(expect.objectContaining({
      action_type: "adicionar_alimento",
      autonomy_level: "automatico",
    }));
    expect(canonical.source_recommendation?.source_type).toBe("estimativa");
  });

  it("representa mensagem ambigua sem acao executavel", () => {
    const canonical = buildCanonicalIntentOutputFromRuntime({
      runtimeIntent: {
        intent: "ambiguous",
        confidence: 0.62,
        items: [],
        requiresConfirmation: true,
        clarificationQuestion: "Você quer registrar um alimento ou ver refeições?",
        possibleIntents: ["add_foods_to_meal", "list_meal_records"],
        reason: "Texto curto com múltiplas interpretações possíveis.",
      },
      originalText: "registro",
    });

    expect(canonical.intent).toBe("mensagem_ambigua");
    expect(canonical.autonomy_level).toBe("requer_confirmacao");
    expect(canonical.extracted_actions).toEqual([]);
    expect(canonical.clarification_options.map(option => option.intent)).toEqual([
      "adicionar_alimento",
      "consulta_historico",
    ]);
    expect(canonical.ambiguity_reason).toContain("múltiplas interpretações");
  });
});
