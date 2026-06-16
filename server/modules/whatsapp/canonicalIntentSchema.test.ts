import { describe, expect, it } from "vitest";
import {
  CANONICAL_WHATSAPP_INTENT_SCHEMA_VERSION,
  canonicalWhatsappIntentNames,
  parseCanonicalWhatsappIntentOutput,
  type CanonicalWhatsappIntentOutput,
} from "./canonicalIntentSchema";

function baseIntent(overrides: Partial<CanonicalWhatsappIntentOutput> = {}): CanonicalWhatsappIntentOutput {
  return {
    schema_version: CANONICAL_WHATSAPP_INTENT_SCHEMA_VERSION,
    message_id: "wamid-1",
    input_modality: "texto",
    original_text: "Registre 100 g de arroz no almoco",
    normalized_text: "registre 100 g de arroz no almoco",
    transcribed_text: null,
    media_context: null,
    intent: "registrar_alimento",
    confidence: 0.91,
    safety_level: "seguro",
    autonomy_level: "automatico",
    autonomy_reason: "Registro alimentar simples com quantidade e refeicao explicitas.",
    actor_type: "usuario",
    actor_id: "user-42",
    target_user_id: "user-42",
    professional_id: null,
    context_required: false,
    needs_confirmation: false,
    pending_context_id: null,
    pending_proposal_id: null,
    requested_output_type: "nenhum",
    requested_period: null,
    user_timezone: "America/Sao_Paulo",
    temporal_expression: "hoje",
    resolved_date: "2026-06-15",
    resolved_time_range: null,
    meal_slot: "almoco",
    extracted_items: [{
      name: "arroz",
      normalizedName: "arroz",
      quantity: 100,
      unit: "g",
      brand: null,
      preparation: null,
      mealSlot: "almoco",
      sourceText: "100 g de arroz",
      confidence: 0.9,
    }],
    extracted_actions: [],
    calculations: [],
    source_recommendation: "catalogo_alimentos",
    clarification_options: [],
    processing_strategy: "llm_structured",
    warnings: [],
    ambiguity_reason: null,
    metadata: {},
    ...overrides,
  };
}

describe("canonicalWhatsappIntentOutputSchema", () => {
  it("expoe a taxonomia controlada esperada pela epic #397", () => {
    expect(canonicalWhatsappIntentNames).toContain("registrar_alimento");
    expect(canonicalWhatsappIntentNames).toContain("gerar_relatorio");
    expect(canonicalWhatsappIntentNames).toContain("pergunta_medica_sensivel");
    expect(canonicalWhatsappIntentNames).toContain("possivel_urgencia_saude");
    expect(canonicalWhatsappIntentNames).toContain("profissional_sugere_plano_alimentar");
    expect(canonicalWhatsappIntentNames).toContain("mensagem_ambigua");
    expect(new Set(canonicalWhatsappIntentNames).size).toBe(canonicalWhatsappIntentNames.length);
  });

  it("valida uma mensagem alimentar estruturada com ator, alvo, autonomia e item extraido", () => {
    const result = parseCanonicalWhatsappIntentOutput(baseIntent());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.schema_version).toBe("whatsapp-intent-output/v1");
    expect(result.data.intent).toBe("registrar_alimento");
    expect(result.data.extracted_items[0].quantity).toBe(100);
    expect(result.data.autonomy_level).toBe("automatico");
  });

  it("representa pedido de relatorio sem classificar como alimento", () => {
    const result = parseCanonicalWhatsappIntentOutput(baseIntent({
      original_text: "Gere um relatorio da minha semana",
      normalized_text: "gere um relatorio da minha semana",
      intent: "gerar_relatorio",
      confidence: 0.88,
      requested_output_type: "relatorio",
      requested_period: {
        kind: "semana",
        rawText: "minha semana",
        startDate: "2026-06-08",
        endDate: "2026-06-15",
      },
      meal_slot: null,
      extracted_items: [],
      source_recommendation: "nenhuma",
    }));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.intent).toBe("gerar_relatorio");
    expect(result.data.extracted_items).toHaveLength(0);
  });

  it("representa midia com legenda e rotulo nutricional extraido", () => {
    const result = parseCanonicalWhatsappIntentOutput(baseIntent({
      input_modality: "imagem_com_legenda",
      original_text: "Esse rotulo serve para meu lanche?",
      normalized_text: "esse rotulo serve para meu lanche",
      transcribed_text: "Esse rotulo serve para meu lanche?",
      media_context: {
        mediaId: "media-1",
        mimeType: "image/jpeg",
        captionText: "Esse rotulo serve para meu lanche?",
        extractedLabelText: "Porcao 30 g, 120 kcal",
        extractionConfidence: 0.82,
        safetyNotes: [],
      },
      intent: "extrair_rotulo_nutricional",
      autonomy_level: "requer_revisao",
      autonomy_reason: "Rotulo extraido de imagem precisa de revisao antes de persistencia.",
      needs_confirmation: true,
      meal_slot: "lanche",
      source_recommendation: "rotulo_extraido",
    }));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.media_context?.extractedLabelText).toContain("120 kcal");
    expect(result.data.autonomy_level).toBe("requer_revisao");
  });

  it("suporta datas relativas com fuso horario e data resolvida", () => {
    const result = parseCanonicalWhatsappIntentOutput(baseIntent({
      original_text: "Resumo de ontem",
      normalized_text: "resumo de ontem",
      intent: "resumo_dia",
      confidence: 0.9,
      requested_output_type: "resumo",
      requested_period: {
        kind: "dia",
        rawText: "ontem",
        startDate: "2026-06-14",
        endDate: "2026-06-14",
      },
      temporal_expression: "ontem",
      resolved_date: "2026-06-14",
      extracted_items: [],
      source_recommendation: "nenhuma",
    }));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.user_timezone).toBe("America/Sao_Paulo");
    expect(result.data.resolved_date).toBe("2026-06-14");
  });

  it("suporta multiplas acoes ordenadas com validacao individual", () => {
    const result = parseCanonicalWhatsappIntentOutput(baseIntent({
      original_text: "Adicione banana e exclua o suco do lanche",
      normalized_text: "adicione banana e exclua o suco do lanche",
      intent: "acao_composta",
      confidence: 0.76,
      autonomy_level: "requer_confirmacao",
      autonomy_reason: "Ha mais de uma acao e uma delas remove dado persistente.",
      needs_confirmation: true,
      extracted_items: [],
      extracted_actions: [
        {
          actionId: "a1",
          order: 1,
          actionType: "adicionar_alimento",
          target: "lanche",
          dependsOnActionIds: [],
          item: {
            name: "banana",
            normalizedName: "banana",
            quantity: null,
            unit: null,
            brand: null,
            preparation: null,
            mealSlot: "lanche",
            sourceText: "banana",
            confidence: 0.72,
          },
          quantity: null,
          autonomyLevel: "requer_confirmacao",
          needsConfirmation: true,
          validationStatus: "requer_esclarecimento",
          validationMessage: "Quantidade da banana nao informada.",
        },
        {
          actionId: "a2",
          order: 2,
          actionType: "excluir_alimento",
          target: "suco do lanche",
          dependsOnActionIds: [],
          item: null,
          quantity: null,
          autonomyLevel: "requer_confirmacao",
          needsConfirmation: true,
          validationStatus: "pendente",
          validationMessage: null,
        },
      ],
      source_recommendation: "revisao_manual",
    }));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.extracted_actions.map(action => action.order)).toEqual([1, 2]);
    expect(result.data.extracted_actions[1].actionType).toBe("excluir_alimento");
  });

  it("representa perguntas sensiveis de saude como bloqueadas sem acao nutricional", () => {
    const result = parseCanonicalWhatsappIntentOutput(baseIntent({
      original_text: "Estou com dor no peito, o que eu tomo?",
      normalized_text: "estou com dor no peito o que eu tomo",
      intent: "possivel_urgencia_saude",
      confidence: 0.93,
      safety_level: "bloqueado",
      autonomy_level: "bloqueado",
      autonomy_reason: "Possivel urgencia de saude deve orientar busca de atendimento e nao executar acao.",
      needs_confirmation: false,
      extracted_items: [],
      source_recommendation: "nenhuma",
      warnings: [{
        code: "possible_health_emergency",
        message: "Mensagem indica possivel urgencia de saude.",
        severity: "blocked",
      }],
    }));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.intent).toBe("possivel_urgencia_saude");
    expect(result.data.autonomy_level).toBe("bloqueado");
  });

  it("representa interacao profissional-paciente vinculada a pendencia", () => {
    const result = parseCanonicalWhatsappIntentOutput(baseIntent({
      original_text: "Ajuste a meta da Maria para 1800 kcal",
      normalized_text: "ajuste a meta da maria para 1800 kcal",
      intent: "profissional_sugere_meta",
      confidence: 0.87,
      actor_type: "profissional",
      actor_id: "professional-7",
      target_user_id: "patient-42",
      professional_id: "professional-7",
      context_required: true,
      needs_confirmation: true,
      pending_context_id: "pending-context-1",
      pending_proposal_id: "proposal-1",
      autonomy_level: "requer_confirmacao",
      autonomy_reason: "Alteracao de meta sugerida por profissional exige aceite ou revisao conforme politica de autonomia.",
      extracted_items: [],
      source_recommendation: "nenhuma",
    }));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.actor_type).toBe("profissional");
    expect(result.data.target_user_id).toBe("patient-42");
    expect(result.data.pending_proposal_id).toBe("proposal-1");
  });

  it("rejeita intencao inexistente ou estrutura incompleta", () => {
    const invalidIntent = parseCanonicalWhatsappIntentOutput(baseIntent({
      intent: "registrar_meta" as CanonicalWhatsappIntentOutput["intent"],
    }));
    const missingAmbiguityReason = parseCanonicalWhatsappIntentOutput(baseIntent({
      intent: "mensagem_ambigua",
      confidence: 0.41,
      autonomy_level: "requer_confirmacao",
      autonomy_reason: "Mensagem curta com multiplas interpretacoes.",
      needs_confirmation: true,
      extracted_items: [],
      ambiguity_reason: null,
    }));

    expect(invalidIntent.success).toBe(false);
    expect(missingAmbiguityReason.success).toBe(false);
  });
});
