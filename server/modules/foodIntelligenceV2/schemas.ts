/**
 * Schemas executáveis dos contratos V2.
 *
 * A superfície pública permanece neste módulo; definições internas são separadas
 * por responsabilidade para manter o contrato auditável sem alterar consumidores.
 */
import { z } from "zod";
import {
  FOOD_CONTEXT_STATUSES,
  FOOD_CONTRACT_LIMITS,
  FOOD_OBSERVATION_SCHEMA_VERSION,
  FOOD_OPERATION_ENVELOPE_SCHEMA_VERSION,
  FOOD_RESOLUTION_DECISION_SCHEMA_VERSION,
  type FoodDecisionNextAction,
  type FoodDecisionStatus,
  type FoodEvidenceOrigin,
} from "./contracts";
import { nonEmptyText, nullableText, opaqueId, positiveInt } from "./schemaShared";
import { foodObservationSchema, type FoodObservation } from "./observationSchemas";
import { foodResolutionDecisionSchema, type FoodResolutionDecision } from "./decisionSchemas";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const foodMealOperationSchema = z.strictObject({
  action: nonEmptyText.max(60),
  targetMeal: nonEmptyText.max(80),
  date: z
    .string()
    .trim()
    .regex(
      ISO_DATE,
      "MealOperation.date exige data explícita ISO (YYYY-MM-DD)."
    ),
});

const foodContextSourceSchema = (name: string) =>
  z
    .strictObject({
      status: z.enum(FOOD_CONTEXT_STATUSES),
      reason: nullableText(FOOD_CONTRACT_LIMITS.shortText),
      sourceRef: nullableText(512),
    })
    .refine(
      source => source.status === "available" || source.reason !== null,
      `Contexto ${name} indisponível exige motivo estruturado; falha de consulta não vira ausência.`
    )
    .refine(
      source => source.status !== "available" || source.sourceRef !== null,
      `Contexto ${name} disponível exige sourceRef explícito para preservar a origem.`
    );

export const foodContextSourcesSchema = z.strictObject({
  previousMessage: foodContextSourceSchema("previousMessage"),
  preferences: foodContextSourceSchema("preferences"),
  recentHistory: foodContextSourceSchema("recentHistory"),
});

export const foodOperationEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(FOOD_OPERATION_ENVELOPE_SCHEMA_VERSION),
  traceId: opaqueId(),
  idempotencyKey: opaqueId(),
  ownerUserId: positiveInt,
  conversationRef: nullableText(200),
  turnRef: nullableText(200),
  effectiveTimeZone: nonEmptyText.max(80),
  mealOperation: foodMealOperationSchema.nullable(),
  contextSources: foodContextSourcesSchema,
  revisions: z.strictObject({
    code: nonEmptyText.max(FOOD_CONTRACT_LIMITS.shortText),
    knowledge: nonEmptyText.max(FOOD_CONTRACT_LIMITS.shortText),
    lexicon: nonEmptyText.max(FOOD_CONTRACT_LIMITS.shortText),
    policy: nonEmptyText.max(FOOD_CONTRACT_LIMITS.shortText),
    resolver: nonEmptyText.max(FOOD_CONTRACT_LIMITS.shortText),
  }),
});


export type MealOperation = z.infer<typeof foodMealOperationSchema>;
export type FoodOperationEnvelope = z.infer<typeof foodOperationEnvelopeSchema>;
export type FoodContractIssue = {
  path: string;
  code: string;
  message: string;
};

export type FoodContractParseResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: "unsupported-schema-version" | "invalid-contract";
      issues: FoodContractIssue[];
    };

function toIssues(error: z.ZodError): FoodContractIssue[] {
  return error.issues.map(issue => ({
    path: issue.path.map(String).join("."),
    code: String(issue.code),
    message: issue.message,
  }));
}

function readSchemaVersion(input: unknown): number | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as { schemaVersion?: unknown }).schemaVersion;
  return typeof value === "number" ? value : null;
}

function parseContract<T>(
  schema: z.ZodType<T>,
  supportedVersion: number,
  input: unknown
): FoodContractParseResult<T> {
  const version = readSchemaVersion(input);
  if (version !== null && version !== supportedVersion) {
    return {
      ok: false,
      code: "unsupported-schema-version",
      issues: [
        {
          path: "schemaVersion",
          code: "unsupported_schema_version",
          message: `Versão de contrato não suportada: ${version}. Versão exigida: ${supportedVersion}.`,
        },
      ],
    };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid-contract",
      issues: toIssues(parsed.error),
    };
  }
  return { ok: true, value: parsed.data };
}

/** Valida `FoodObservation` sem mutar a entrada. */
export function parseFoodObservation(
  input: unknown
): FoodContractParseResult<FoodObservation> {
  return parseContract(
    foodObservationSchema,
    FOOD_OBSERVATION_SCHEMA_VERSION,
    input
  );
}

/** Valida `FoodResolutionDecision` sem mutar a entrada. */
export function parseFoodResolutionDecision(
  input: unknown
): FoodContractParseResult<FoodResolutionDecision> {
  return parseContract(
    foodResolutionDecisionSchema,
    FOOD_RESOLUTION_DECISION_SCHEMA_VERSION,
    input
  );
}

/** Valida o envelope interno da operação (inclui `MealOperation` separado). */
export function parseFoodOperationEnvelope(
  input: unknown
): FoodContractParseResult<FoodOperationEnvelope> {
  return parseContract(
    foodOperationEnvelopeSchema,
    FOOD_OPERATION_ENVELOPE_SCHEMA_VERSION,
    input
  );
}

/** `status`/`nextAction` aceitos pelo contrato (reexportado para consumidores). */
export type { FoodDecisionNextAction, FoodDecisionStatus, FoodEvidenceOrigin };

export { foodAnchorSchema, foodEvidenceSchema, foodQualifierSchema } from "./schemaShared";
export type { FoodAnchor, FoodEvidence, FoodQualifier } from "./schemaShared";
export * from "./observationSchemas";
export * from "./decisionSchemas";
