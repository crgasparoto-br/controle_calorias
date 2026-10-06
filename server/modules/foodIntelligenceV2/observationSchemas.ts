import { z } from "zod";
import {
  DEFAULT_FOOD_LOCALE,
  FOOD_CONTRACT_LIMITS,
  FOOD_INPUT_TYPES,
  FOOD_LOCALE_STATUSES,
  FOOD_NORMALIZATION_ORIGINS,
  FOOD_NORMALIZATION_STAGES,
  FOOD_OBSERVATION_SCHEMA_VERSION,
  FOOD_REASON_CODES,
  FOOD_STAGE_ORIGIN,
} from "./contracts";
import {
  confidence,
  evidenceIdList,
  foodAnchorSchema,
  foodEvidenceSchema,
  foodQualifierSchema,
  nonEmptyText,
  nullablePositiveInt,
  nullableText,
  opaqueId,
  rejectDuplicates,
} from "./schemaShared";

export const foodIdentityHintsSchema = z.strictObject({
  foodName: nullableText(FOOD_CONTRACT_LIMITS.nameText),
  brand: nullableText(200),
  variant: nullableText(200),
  preparation: z.array(nonEmptyText.max(80)).max(20),
  qualifiers: z.array(foodQualifierSchema).max(FOOD_CONTRACT_LIMITS.qualifiers),
  barcode: z.string().trim().min(4).max(64).nullable(),
});

export const foodQuantityHintsSchema = z
  .strictObject({
    value: z.number().finite().positive().nullable(),
    unit: nullableText(40),
    servingText: nullableText(200),
    visiblePackageQuantity: z.number().finite().positive().nullable(),
    visiblePackageUnit: nullableText(40),
  })
  .refine(
    hints => hints.value === null || hints.unit !== null,
    "quantityHints.value exige unit explícita: a unidade física nunca é implícita."
  );

export const foodNormalizationStepSchema = z
  .strictObject({
    stage: z.enum(FOOD_NORMALIZATION_STAGES),
    origin: z.enum(FOOD_NORMALIZATION_ORIGINS),
    lexiconEntryId: nullablePositiveInt,
    anchor: foodAnchorSchema,
    confidence,
  })
  .refine(
    step => FOOD_STAGE_ORIGIN[step.stage] === step.origin,
    "normalizationPath deve acoplar S1→deterministic, S2→lexicon e S3→interpreter."
  );

export const foodObservationAlternativeSchema = z.strictObject({
  hypothesisId: opaqueId(),
  identityHints: foodIdentityHintsSchema,
  quantityHints: foodQuantityHintsSchema,
  evidenceIds: evidenceIdList,
  confidence,
});

export const foodLocaleSchema = z
  .strictObject({
    requested: nullableText(40),
    effective: z.literal(DEFAULT_FOOD_LOCALE).nullable(),
    status: z.enum(FOOD_LOCALE_STATUSES),
  })
  .refine(
    locale => locale.status !== "explicit" || locale.requested !== null,
    "Locale com status=explicit exige requested preenchido."
  )
  .refine(
    locale => locale.status !== "explicit" || locale.effective !== null,
    "Locale explícito suportado exige effective preenchido."
  )
  .refine(
    locale =>
      locale.status !== "explicit" ||
      locale.requested === DEFAULT_FOOD_LOCALE,
    "Locale explícito suportado deve ser pt-BR no recorte atual; locale não suportado exige status=unsupported."
  )
  .refine(
    locale => locale.status !== "defaulted" || locale.requested === null,
    "Locale com status=defaulted corresponde à ausência de locale explícito."
  )
  .refine(
    locale =>
      locale.status !== "defaulted" || locale.effective === DEFAULT_FOOD_LOCALE,
    "Locale ausente usa pt-BR com status=defaulted (§4.2)."
  )
  .refine(
    locale => locale.status !== "unsupported" || locale.effective === null,
    "Locale não suportado usa effective=null sem fallback silencioso entre idiomas."
  )
  .refine(
    locale => locale.status !== "unsupported" || locale.requested !== null,
    "Locale não suportado só existe quando houve locale explícito do usuário."
  );

export const foodObservationSchema = z
  .strictObject({
    schemaVersion: z.literal(FOOD_OBSERVATION_SCHEMA_VERSION),
    observationId: opaqueId(),
    modality: z.enum(FOOD_INPUT_TYPES),
    rawInput: z.string().max(FOOD_CONTRACT_LIMITS.rawText).nullable(),
    normalizedInput: z.string().max(FOOD_CONTRACT_LIMITS.rawText).nullable(),
    locale: foodLocaleSchema,
    surfaceSpan: foodAnchorSchema,
    identityHints: foodIdentityHintsSchema,
    quantityHints: foodQuantityHintsSchema,
    evidence: z.array(foodEvidenceSchema).max(FOOD_CONTRACT_LIMITS.collection),
    normalizationPath: z
      .array(foodNormalizationStepSchema)
      .max(FOOD_CONTRACT_LIMITS.collection),
    alternatives: z
      .array(foodObservationAlternativeSchema)
      .max(FOOD_CONTRACT_LIMITS.alternatives),
    unresolvedReason: z.enum(FOOD_REASON_CODES).nullable(),
    lexiconRevision: nonEmptyText.max(FOOD_CONTRACT_LIMITS.shortText),
    interpreterVersion: nullableText(FOOD_CONTRACT_LIMITS.shortText),
  })
  .superRefine((observation, ctx) => {
    rejectDuplicates(
      observation.evidence.map(evidence => evidence.evidenceId),
      ctx,
      ["evidence"]
    );
    rejectDuplicates(
      observation.alternatives.map(alternative => alternative.hypothesisId),
      ctx,
      ["alternatives"]
    );
    rejectDuplicates(
      observation.identityHints.qualifiers.map(qualifier =>
        qualifier.value.trim().toLowerCase()
      ),
      ctx,
      ["identityHints", "qualifiers"]
    );

    const evidenceIds = new Set(
      observation.evidence.map(evidence => evidence.evidenceId)
    );
    observation.alternatives.forEach((alternative, index) => {
      rejectDuplicates(alternative.evidenceIds, ctx, [
        "alternatives",
        index,
        "evidenceIds",
      ]);
      for (const evidenceId of alternative.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `alternatives[${index}].evidenceIds referencia evidência inexistente: ${evidenceId}.`,
            path: ["alternatives", index, "evidenceIds"],
          });
        }
      }
    });

    const hasInterpreterStep = observation.normalizationPath.some(
      step => step.stage === "S3"
    );
    if (hasInterpreterStep && observation.interpreterVersion === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "interpreterVersion é obrigatório quando normalizationPath contém etapa S3.",
        path: ["interpreterVersion"],
      });
    }
    if (!hasInterpreterStep && observation.interpreterVersion !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "interpreterVersion só existe quando houve etapa S3 efetiva; nenhuma versão de interpretador pode ser declarada sem uso.",
        path: ["interpreterVersion"],
      });
    }

    if (
      observation.locale.status === "unsupported" &&
      observation.unresolvedReason !== "unsupported_locale"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Locale não suportado exige unresolvedReason=unsupported_locale (§4.2).",
        path: ["unresolvedReason"],
      });
    }

    if (
      (observation.modality === "text" ||
        observation.modality === "audio_transcript") &&
      observation.surfaceSpan.region !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Observação textual/voz preserva âncora de texto: surfaceSpan.region deve ser null.",
        path: ["surfaceSpan", "region"],
      });
    }
  });


export type FoodIdentityHints = z.infer<typeof foodIdentityHintsSchema>;
export type FoodQuantityHints = z.infer<typeof foodQuantityHintsSchema>;
export type FoodNormalizationStep = z.infer<typeof foodNormalizationStepSchema>;
export type FoodObservationAlternative = z.infer<typeof foodObservationAlternativeSchema>;
export type FoodLocale = z.infer<typeof foodLocaleSchema>;
export type FoodObservation = z.infer<typeof foodObservationSchema>;
