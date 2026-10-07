import { z } from "zod";
import {
  FOOD_CONTRACT_LIMITS,
  FOOD_EVIDENCE_ORIGINS,
  isGovernedEvidenceField,
  isGroundedEvidenceOrigin,
} from "./contracts";

export const positiveInt = z.number().int().positive();
export const nullablePositiveInt = positiveInt.nullable();
export const confidence = z.number().finite().min(0).max(1).nullable();
export const nonEmptyText = z.string().trim().min(1);
export const opaqueId = (max: number = FOOD_CONTRACT_LIMITS.identifier) =>
  nonEmptyText.max(max);
export const nullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable();
export const finiteNumber = z.number().finite();
export const nonNegativeNumber = z.number().finite().min(0);
export const nullableNonNegativeNumber = z.number().finite().min(0).nullable();
export const evidenceIdList = z.array(opaqueId()).max(FOOD_CONTRACT_LIMITS.collection);

/** Span usa offsets UTF-16 `[start, end)` do texto original referenciado. */
const foodSpanSchema = z
  .strictObject({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  })
  .refine(
    span => span.end > span.start,
    "Anchor.span deve usar offsets UTF-16 [start, end) com end > start."
  );

/** Região usa coordenadas normalizadas de 0 a 1 dentro da imagem. */
const foodRegionSchema = z
  .strictObject({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().gt(0).max(1),
    height: z.number().finite().gt(0).max(1),
  })
  .refine(
    region => region.x + region.width <= 1 && region.y + region.height <= 1,
    "Anchor.region deve caber em coordenadas normalizadas de 0 a 1."
  );

export const foodAnchorSchema = z.strictObject({
  sourceRef: opaqueId(512),
  span: foodSpanSchema.nullable(),
  region: foodRegionSchema.nullable(),
});

export const foodQualifierSchema = z.strictObject({
  value: nonEmptyText.max(FOOD_CONTRACT_LIMITS.shortText),
  attributeCode: nullableText(80),
  /**
   * Papel semântico explícito. Qualificador sem classificação conserva `value`
   * e `role=null`; não vira ruído nem é reclassificado downstream.
   */
  role: nullableText(80),
  confidence,
});

export const foodEvidenceSchema = z
  .strictObject({
    evidenceId: opaqueId(),
    field: nonEmptyText
      .max(120)
      .refine(
        isGovernedEvidenceField,
        "FoodEvidence.field deve ser um caminho governado do contrato (ex.: identity.brand, quantity.value, nutrition.protein)."
      ),
    origin: z.enum(FOOD_EVIDENCE_ORIGINS),
    value: z.union([z.string(), finiteNumber, z.boolean(), z.null()]),
    unit: nullableText(40),
    confidence,
    verified: z.boolean(),
    anchor: foodAnchorSchema,
    sourceId: nullablePositiveInt,
  })
  .refine(
    evidence => !evidence.verified || isGroundedEvidenceOrigin(evidence.origin),
    "Evidência estimada por IA/heurística/provisória ou indisponível não pode declarar verified=true."
  )
  .refine(
    evidence => evidence.origin !== "unavailable" || evidence.value === null,
    "Evidência com origin=unavailable deve usar value=null; ausência nunca vira zero."
  )
  .refine(
    evidence =>
      evidence.origin !== "unavailable" || evidence.confidence === null,
    "Evidência com origin=unavailable não pode declarar confiança."
  );


export function rejectDuplicates(
  values: readonly string[],
  ctx: z.RefinementCtx,
  path: (string | number)[]
) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Valor duplicado não é permitido: ${value}.`,
        path,
      });
      return;
    }
    seen.add(value);
  }
}


export type FoodAnchor = z.infer<typeof foodAnchorSchema>;
export type FoodQualifier = z.infer<typeof foodQualifierSchema>;
export type FoodEvidence = z.infer<typeof foodEvidenceSchema>;
