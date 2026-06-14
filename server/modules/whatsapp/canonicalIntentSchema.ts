import { z } from "zod";
import { WHATSAPP_INTENT_CONFIDENCE, type WhatsappIntentName, type WhatsappInterpretedIntent } from "./intentSchema";

export const WHATSAPP_CANONICAL_INTENT_SCHEMA_VERSION = "whatsapp-intent-schema/v1";

export const whatsappCanonicalIntentNames = [
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
  "pergunta_sobre_meta",
  "pergunta_sobre_evolucao",
  "pergunta_sobre_qualidade_alimentar",
  "pergunta_sobre_alimento",
  "pergunta_saude_dieta",
  "pergunta_medica_sensivel",
  "possivel_urgencia_saude",
  "analisar_imagem_alimento",
  "extrair_rotulo_nutricional",
  "midia_ambigua",
  "profissional_solicita_informacao",
  "profissional_sugere_meta",
  "profissional_sugere_plano_alimentar",
  "profissional_sugere_refeicao",
  "profissional_sugere_ajuste",
  "paciente_aceita_sugestao",
  "paciente_recusa_sugestao",
  "paciente_pede_ajuste_sugestao",
  "paciente_envia_mensagem_profissional",
  "profissional_envia_mensagem_paciente",
  "confirmar_alteracao_meta",
  "confirmar_alteracao_plano",
  "confirmacao_sim_nao",
  "selecionar_opcao",
  "pedir_esclarecimento",
  "cancelar_pendencia",
  "mensagem_ambigua",
  "mensagem_nao_relacionada",
] as const;

export const whatsappCanonicalIntentNameSchema = z.enum(whatsappCanonicalIntentNames);
export type WhatsappCanonicalIntentName = z.infer<typeof whatsappCanonicalIntentNameSchema>;

export const whatsappInputModalitySchema = z.enum(["texto", "audio", "imagem", "imagem_com_legenda"]);
export const whatsappSafetyLevelSchema = z.enum(["normal", "sensivel", "risco_saude", "bloqueado"]);
export const whatsappAutonomyLevelSchema = z.enum(["automatico", "requer_confirmacao", "requer_revisao", "bloqueado"]);
export const whatsappActorTypeSchema = z.enum(["usuario", "paciente", "profissional", "sistema", "desconhecido"]);
export const whatsappActionValidationStatusSchema = z.enum(["pendente", "valida", "invalida", "bloqueada"]);

const nullableShortText = z.string().trim().max(280).nullable();

export const whatsappCanonicalExtractedItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  normalized_name: z.string().trim().max(160).nullable(),
  quantity: z.number().positive().max(5000).nullable(),
  unit: z.string().trim().max(40).nullable(),
  brand: z.string().trim().max(80).nullable(),
  preparation: z.string().trim().max(120).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});

export const whatsappCanonicalCalculationSchema = z.object({
  expression: z.string().trim().min(1).max(240),
  result_value: z.number().nullable(),
  result_unit: z.string().trim().max(40).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});

export const whatsappCanonicalActionSchema = z.object({
  order: z.number().int().min(1).max(50),
  action_type: whatsappCanonicalIntentNameSchema,
  target: nullableShortText,
  depends_on_order: z.number().int().min(1).max(50).nullable(),
  item: whatsappCanonicalExtractedItemSchema.nullable(),
  quantity: z.object({
    value: z.number().positive().max(5000),
    unit: z.string().trim().min(1).max(40),
  }).nullable(),
  autonomy_level: whatsappAutonomyLevelSchema,
  needs_confirmation: z.boolean(),
  validation_status: whatsappActionValidationStatusSchema,
  message: nullableShortText,
});

export const whatsappCanonicalIntentOutputSchema = z.object({
  schema_version: z.literal(WHATSAPP_CANONICAL_INTENT_SCHEMA_VERSION),
  message_id: z.string().trim().max(160).nullable(),
  input_modality: whatsappInputModalitySchema,
  original_text: z.string().max(4000).nullable(),
  normalized_text: z.string().max(4000).nullable(),
  transcribed_text: z.string().max(4000).nullable(),
  media_context: z.object({
    media_id: z.string().trim().max(160).nullable(),
    caption: z.string().max(1000).nullable(),
    media_kind: z.enum(["alimento", "rotulo_nutricional", "ambigua", "nao_relacionada"]).nullable(),
    extraction_confidence: z.number().min(0).max(1).nullable(),
  }).nullable(),
  intent: whatsappCanonicalIntentNameSchema,
  confidence: z.number().min(0).max(1),
  safety_level: whatsappSafetyLevelSchema,
  autonomy_level: whatsappAutonomyLevelSchema,
  autonomy_reason: nullableShortText,
  actor_type: whatsappActorTypeSchema,
  actor_id: z.string().trim().max(120).nullable(),
  target_user_id: z.string().trim().max(120).nullable(),
  professional_id: z.string().trim().max(120).nullable(),
  context_required: z.boolean(),
  needs_confirmation: z.boolean(),
  pending_context_id: z.string().trim().max(120).nullable(),
  pending_proposal_id: z.string().trim().max(120).nullable(),
  requested_output_type: z.enum(["texto", "grafico", "relatorio", "resumo", "sugestao"]).nullable(),
  requested_period: nullableShortText,
  user_timezone: z.string().trim().max(80).nullable(),
  temporal_expression: nullableShortText,
  resolved_date: z.string().trim().max(32).nullable(),
  resolved_time_range: z.object({
    start: z.string().trim().max(40),
    end: z.string().trim().max(40),
  }).nullable(),
  meal_slot: z.string().trim().max(80).nullable(),
  extracted_items: z.array(whatsappCanonicalExtractedItemSchema).max(30),
  extracted_actions: z.array(whatsappCanonicalActionSchema).max(50),
  calculations: z.array(whatsappCanonicalCalculationSchema).max(20),
  source_recommendation: z.object({
    source_type: z.enum(["catalogo", "fonte_confirmada", "estimativa", "rotulo", "online", "nao_aplicavel"]),
    reason: nullableShortText,
    confidence: z.number().min(0).max(1).nullable(),
  }).nullable(),
  clarification_options: z.array(z.object({
    id: z.string().trim().min(1).max(40),
    label: z.string().trim().min(1).max(160),
    intent: whatsappCanonicalIntentNameSchema.nullable(),
  })).max(10),
  processing_strategy: z.string().trim().max(80).nullable(),
  warnings: z.array(z.string().trim().min(1).max(240)).max(20),
  ambiguity_reason: nullableShortText,
});

export type WhatsappCanonicalIntentOutput = z.infer<typeof whatsappCanonicalIntentOutputSchema>;

export const runtimeToCanonicalIntentMap: Record<WhatsappIntentName, WhatsappCanonicalIntentName> = {
  add_foods_to_meal: "adicionar_alimento",
  replace_food_in_meal: "trocar_alimento",
  edit_food_quantity: "corrigir_alimento",
  list_meal_records: "consulta_historico",
  daily_summary: "resumo_dia",
  add_water: "registrar_alimento",
  add_exercise: "mensagem_nao_relacionada",
  open_records_link: "consulta_historico",
  help: "mensagem_nao_relacionada",
  ambiguous: "mensagem_ambigua",
  unknown: "mensagem_nao_relacionada",
};

function normalizeForContract(value?: string | null) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim() || null;
}

function resolveAutonomyLevel(intent: WhatsappInterpretedIntent): z.infer<typeof whatsappAutonomyLevelSchema> {
  if (intent.intent === "ambiguous" || intent.intent === "unknown") return "requer_confirmacao";
  if (intent.requiresConfirmation || intent.confidence < WHATSAPP_INTENT_CONFIDENCE.execute) return "requer_confirmacao";
  return "automatico";
}

function toCanonicalItem(item: WhatsappInterpretedIntent["items"][number]) {
  return {
    name: item.foodName,
    normalized_name: normalizeForContract(item.foodName),
    quantity: item.quantity ?? null,
    unit: item.unit ?? null,
    brand: item.brand ?? null,
    preparation: item.preparation ?? null,
    confidence: null,
  };
}

export function buildCanonicalIntentOutputFromRuntime(input: {
  runtimeIntent: WhatsappInterpretedIntent;
  messageId?: string | null;
  originalText?: string | null;
  normalizedText?: string | null;
  inputModality?: z.infer<typeof whatsappInputModalitySchema>;
  processingStrategy?: string | null;
  userTimezone?: string | null;
  actorId?: string | number | null;
  targetUserId?: string | number | null;
}): WhatsappCanonicalIntentOutput {
  const runtimeIntent = input.runtimeIntent;
  const canonicalIntent = runtimeToCanonicalIntentMap[runtimeIntent.intent];
  const autonomyLevel = resolveAutonomyLevel(runtimeIntent);
  const extractedItems = runtimeIntent.items.map(toCanonicalItem);
  const extractedActions = canonicalIntent === "mensagem_ambigua" || canonicalIntent === "mensagem_nao_relacionada"
    ? []
    : [{
        order: 1,
        action_type: canonicalIntent,
        target: runtimeIntent.meal?.label ?? runtimeIntent.sourceFood ?? runtimeIntent.targetFood ?? null,
        depends_on_order: null,
        item: extractedItems[0] ?? null,
        quantity: runtimeIntent.quantity ? { value: runtimeIntent.quantity.value, unit: runtimeIntent.quantity.unit } : null,
        autonomy_level: autonomyLevel,
        needs_confirmation: runtimeIntent.requiresConfirmation,
        validation_status: autonomyLevel === "automatico" ? "pendente" as const : "bloqueada" as const,
        message: runtimeIntent.reason ?? runtimeIntent.clarificationQuestion ?? null,
      }];

  return whatsappCanonicalIntentOutputSchema.parse({
    schema_version: WHATSAPP_CANONICAL_INTENT_SCHEMA_VERSION,
    message_id: input.messageId ?? null,
    input_modality: input.inputModality ?? "texto",
    original_text: input.originalText ?? null,
    normalized_text: input.normalizedText ?? normalizeForContract(input.originalText),
    transcribed_text: null,
    media_context: null,
    intent: canonicalIntent,
    confidence: runtimeIntent.confidence,
    safety_level: "normal",
    autonomy_level: autonomyLevel,
    autonomy_reason: runtimeIntent.reason ?? null,
    actor_type: "usuario",
    actor_id: input.actorId == null ? null : String(input.actorId),
    target_user_id: input.targetUserId == null ? null : String(input.targetUserId),
    professional_id: null,
    context_required: runtimeIntent.requiresConfirmation,
    needs_confirmation: runtimeIntent.requiresConfirmation,
    pending_context_id: null,
    pending_proposal_id: null,
    requested_output_type: runtimeIntent.intent === "daily_summary" ? "resumo" : null,
    requested_period: runtimeIntent.date ?? null,
    user_timezone: input.userTimezone ?? null,
    temporal_expression: runtimeIntent.date ?? null,
    resolved_date: null,
    resolved_time_range: null,
    meal_slot: runtimeIntent.meal?.label ?? null,
    extracted_items: extractedItems,
    extracted_actions: extractedActions,
    calculations: [],
    source_recommendation: extractedItems.length ? {
      source_type: "estimativa",
      reason: "Runtime atual ainda resolve fonte nutricional em etapa posterior.",
      confidence: null,
    } : null,
    clarification_options: runtimeIntent.possibleIntents.map((intentName, index) => ({
      id: String(index + 1),
      label: intentName,
      intent: runtimeToCanonicalIntentMap[intentName],
    })),
    processing_strategy: input.processingStrategy ?? null,
    warnings: runtimeIntent.requiresConfirmation ? ["Intencao exige confirmacao antes de executar acao sensivel."] : [],
    ambiguity_reason: runtimeIntent.intent === "ambiguous" ? runtimeIntent.reason ?? runtimeIntent.clarificationQuestion ?? null : null,
  });
}

export function parseWhatsappCanonicalIntentOutput(value: unknown) {
  return whatsappCanonicalIntentOutputSchema.safeParse(value);
}
