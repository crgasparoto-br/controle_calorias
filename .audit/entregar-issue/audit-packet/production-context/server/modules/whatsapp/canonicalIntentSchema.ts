import { z } from "zod";

export const CANONICAL_WHATSAPP_INTENT_SCHEMA_VERSION = "whatsapp-intent-output/v1" as const;

export const canonicalWhatsappIntentNames = [
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

export const canonicalWhatsappIntentNameSchema = z.enum(canonicalWhatsappIntentNames);

export const whatsappInputModalitySchema = z.enum([
  "texto",
  "audio",
  "imagem",
  "imagem_com_legenda",
]);

export const whatsappIntentSafetyLevelSchema = z.enum([
  "seguro",
  "requer_cautela",
  "saude_sensivel",
  "possivel_urgencia",
  "bloqueado",
]);

export const whatsappIntentAutonomyLevelSchema = z.enum([
  "automatico",
  "requer_confirmacao",
  "requer_revisao",
  "bloqueado",
]);

export const whatsappIntentActorTypeSchema = z.enum([
  "usuario",
  "paciente",
  "profissional",
  "sistema",
  "desconhecido",
]);

export const whatsappIntentProcessingStrategySchema = z.enum([
  "deterministic",
  "llm_structured",
  "safe_fallback",
]);

const nullableString = z.string().trim().min(1).max(280).nullable();
const optionalMetadataSchema = z.record(z.string(), z.unknown()).default({});

const whatsappIntentMediaContextSchema = z.object({
  mediaId: nullableString,
  mimeType: nullableString,
  captionText: nullableString,
  extractedLabelText: nullableString,
  extractionConfidence: z.number().min(0).max(1).nullable(),
  safetyNotes: z.array(z.string().trim().min(1).max(160)).max(10).default([]),
});

const whatsappIntentTimeRangeSchema = z.object({
  start: nullableString,
  end: nullableString,
  precision: z.enum(["exata", "aproximada", "periodo", "desconhecida"]),
});

const whatsappIntentRequestedPeriodSchema = z.object({
  kind: z.enum(["dia", "semana", "mes", "periodo_customizado", "relativo", "desconhecido"]),
  rawText: nullableString,
  startDate: nullableString,
  endDate: nullableString,
});

const whatsappIntentFoodItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  normalizedName: nullableString,
  quantity: z.number().positive().max(5000).nullable(),
  unit: nullableString,
  brand: nullableString,
  preparation: nullableString,
  mealSlot: nullableString,
  sourceText: nullableString,
  confidence: z.number().min(0).max(1),
});

const whatsappIntentCalculationSchema = z.object({
  expression: z.string().trim().min(1).max(160),
  result: z.number().finite().nullable(),
  unit: nullableString,
  confidence: z.number().min(0).max(1),
});

const whatsappIntentActionValidationStatusSchema = z.enum([
  "pendente",
  "valida",
  "invalida",
  "requer_esclarecimento",
  "bloqueada",
]);

const whatsappIntentExtractedActionSchema = z.object({
  actionId: z.string().trim().min(1).max(80),
  order: z.number().int().positive(),
  actionType: canonicalWhatsappIntentNameSchema,
  target: nullableString,
  dependsOnActionIds: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  item: whatsappIntentFoodItemSchema.nullable(),
  quantity: z.object({
    value: z.number().positive().max(5000),
    unit: z.string().trim().min(1).max(40),
  }).nullable(),
  autonomyLevel: whatsappIntentAutonomyLevelSchema,
  needsConfirmation: z.boolean(),
  validationStatus: whatsappIntentActionValidationStatusSchema,
  validationMessage: nullableString,
});

const whatsappIntentClarificationOptionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(80),
  intent: canonicalWhatsappIntentNameSchema.nullable(),
});

const whatsappIntentWarningSchema = z.object({
  code: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(220),
  severity: z.enum(["info", "warning", "blocked"]),
});

export const canonicalWhatsappIntentOutputSchema = z.object({
  schema_version: z.literal(CANONICAL_WHATSAPP_INTENT_SCHEMA_VERSION),
  message_id: nullableString,
  input_modality: whatsappInputModalitySchema,
  original_text: nullableString,
  normalized_text: nullableString,
  transcribed_text: nullableString,
  media_context: whatsappIntentMediaContextSchema.nullable(),
  intent: canonicalWhatsappIntentNameSchema,
  confidence: z.number().min(0).max(1),
  safety_level: whatsappIntentSafetyLevelSchema,
  autonomy_level: whatsappIntentAutonomyLevelSchema,
  autonomy_reason: z.string().trim().min(1).max(280),
  actor_type: whatsappIntentActorTypeSchema,
  actor_id: nullableString,
  target_user_id: nullableString,
  professional_id: nullableString,
  context_required: z.boolean(),
  needs_confirmation: z.boolean(),
  pending_context_id: nullableString,
  pending_proposal_id: nullableString,
  requested_output_type: z.enum([
    "nenhum",
    "resumo",
    "relatorio",
    "grafico",
    "sugestao",
    "analise",
    "historico",
  ]),
  requested_period: whatsappIntentRequestedPeriodSchema.nullable(),
  user_timezone: nullableString,
  temporal_expression: nullableString,
  resolved_date: nullableString,
  resolved_time_range: whatsappIntentTimeRangeSchema.nullable(),
  meal_slot: nullableString,
  extracted_items: z.array(whatsappIntentFoodItemSchema).max(30).default([]),
  extracted_actions: z.array(whatsappIntentExtractedActionSchema).max(12).default([]),
  calculations: z.array(whatsappIntentCalculationSchema).max(8).default([]),
  source_recommendation: z.enum([
    "catalogo_alimentos",
    "produto_com_marca",
    "rotulo_extraido",
    "fonte_online",
    "estimativa_ia",
    "revisao_manual",
    "nenhuma",
  ]),
  clarification_options: z.array(whatsappIntentClarificationOptionSchema).max(8).default([]),
  processing_strategy: whatsappIntentProcessingStrategySchema,
  warnings: z.array(whatsappIntentWarningSchema).max(12).default([]),
  ambiguity_reason: nullableString,
  metadata: optionalMetadataSchema,
}).superRefine((value, ctx) => {
  if ((value.input_modality === "audio" || value.input_modality === "imagem_com_legenda") && !value.transcribed_text && !value.media_context) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["media_context"],
      message: "Mensagens de audio ou imagem com legenda precisam carregar transcricao ou contexto de midia.",
    });
  }

  if (value.intent === "acao_composta" && value.extracted_actions.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["extracted_actions"],
      message: "acao_composta precisa ter ao menos duas acoes extraidas.",
    });
  }

  if (value.intent === "mensagem_ambigua" && !value.ambiguity_reason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ambiguity_reason"],
      message: "mensagem_ambigua precisa registrar o motivo da ambiguidade.",
    });
  }

  if (value.autonomy_level === "bloqueado" && value.safety_level !== "bloqueado") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["safety_level"],
      message: "autonomia bloqueada exige safety_level bloqueado.",
    });
  }
});

export type CanonicalWhatsappIntentName = z.infer<typeof canonicalWhatsappIntentNameSchema>;
export type CanonicalWhatsappIntentOutput = z.infer<typeof canonicalWhatsappIntentOutputSchema>;
export type WhatsappIntentAutonomyLevel = z.infer<typeof whatsappIntentAutonomyLevelSchema>;
export type WhatsappIntentSafetyLevel = z.infer<typeof whatsappIntentSafetyLevelSchema>;

export function parseCanonicalWhatsappIntentOutput(value: unknown) {
  return canonicalWhatsappIntentOutputSchema.safeParse(value);
}
