import { z } from "zod";

export const whatsappIntentNames = [
  "add_foods_to_meal",
  "replace_food_in_meal",
  "edit_food_quantity",
  "delete_food_from_meal",
  "delete_meal",
  "list_meal_records",
  "daily_summary",
  "meal_suggestion",
  "add_water",
  "add_exercise",
  "open_records_link",
  "help",
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
  "ambiguous",
  "unknown",
] as const;

export const whatsappIntentNameSchema = z.enum(whatsappIntentNames);

const whatsappIntentFoodItemSchema = z.object({
  foodName: z.string().trim().min(1).max(160),
  quantity: z.number().positive().max(5000).nullable().optional(),
  unit: z.string().trim().min(1).max(40).nullable().optional(),
  brand: z.string().trim().min(1).max(80).nullable().optional(),
  preparation: z.string().trim().min(1).max(120).nullable().optional(),
});

const whatsappIntentMealSchema = z.object({
  label: z.string().trim().min(1).max(80),
  createIfMissing: z.boolean().default(false),
});

const whatsappIntentQuantitySchema = z.object({
  value: z.number().positive().max(5000),
  unit: z.string().trim().min(1).max(40),
});

export const whatsappInterpretedIntentSchema = z.object({
  intent: whatsappIntentNameSchema,
  confidence: z.number().min(0).max(1),
  date: z.string().trim().min(1).max(32).nullable().optional(),
  meal: whatsappIntentMealSchema.nullable().optional(),
  items: z.array(whatsappIntentFoodItemSchema).max(20).default([]),
  sourceFood: z.string().trim().min(1).max(160).nullable().optional(),
  targetFood: z.string().trim().min(1).max(160).nullable().optional(),
  quantity: whatsappIntentQuantitySchema.nullable().optional(),
  requiresConfirmation: z.boolean().default(false),
  clarificationQuestion: z.string().trim().min(1).max(280).nullable().optional(),
  possibleIntents: z.array(whatsappIntentNameSchema).max(6).default([]),
  reason: z.string().trim().max(280).nullable().optional(),
});

export type WhatsappIntentName = z.infer<typeof whatsappIntentNameSchema>;
export type WhatsappInterpretedIntent = z.infer<typeof whatsappInterpretedIntentSchema>;
export type WhatsappIntentFoodItem = WhatsappInterpretedIntent["items"][number];

export const WHATSAPP_INTENT_CONFIDENCE = {
  execute: 0.74,
  clarify: 0.5,
} as const;

export const whatsappIntentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "confidence",
    "date",
    "meal",
    "items",
    "sourceFood",
    "targetFood",
    "quantity",
    "requiresConfirmation",
    "clarificationQuestion",
    "possibleIntents",
    "reason",
  ],
  properties: {
    intent: { type: "string", enum: [...whatsappIntentNames] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    date: { type: ["string", "null"] },
    meal: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["label", "createIfMissing"],
          properties: {
            label: { type: "string" },
            createIfMissing: { type: "boolean" },
          },
        },
        { type: "null" },
      ],
    },
    items: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["foodName", "quantity", "unit", "brand", "preparation"],
        properties: {
          foodName: { type: "string" },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          brand: { type: ["string", "null"] },
          preparation: { type: ["string", "null"] },
        },
      },
    },
    sourceFood: { type: ["string", "null"] },
    targetFood: { type: ["string", "null"] },
    quantity: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["value", "unit"],
          properties: {
            value: { type: "number", minimum: 0 },
            unit: { type: "string" },
          },
        },
        { type: "null" },
      ],
    },
    requiresConfirmation: { type: "boolean" },
    clarificationQuestion: { type: ["string", "null"] },
    possibleIntents: {
      type: "array",
      maxItems: 6,
      items: { type: "string", enum: [...whatsappIntentNames] },
    },
    reason: { type: ["string", "null"] },
  },
} as const;

export function parseWhatsappInterpretedIntent(value: unknown) {
  return whatsappInterpretedIntentSchema.safeParse(value);
}
