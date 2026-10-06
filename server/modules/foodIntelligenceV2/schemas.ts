/**
 * Schemas executáveis dos contratos V2 (`FoodObservation`, `FoodResolutionDecision`,
 * envelope de operação e `MealOperation`).
 *
 * Fonte canônica: `docs/design-docs/adr-food-intelligence-resolver-v2.md` §4, §5,
 * §7.1.1 e §21.1. Os tipos inferidos saem da mesma definição que valida em
 * runtime, seguindo `AGENTS.md` (validação de entrada em
 * `server/modules/<dominio>/schemas.ts`).
 *
 * Regras gerais do contrato:
 * - campos obrigatórios; ausência usa `null` ou coleção vazia, nunca zero;
 * - números finitos; confiança entre 0 e 1 quando disponível, sem equivaler a
 *   probabilidade calibrada;
 * - IDs de banco são inteiros positivos; identificadores opacos não vazios;
 * - âncoras usam offsets UTF-16 `[start, end)` e regiões normalizadas 0..1;
 * - nenhuma referência de evidência pode apontar para outro proprietário;
 * - a validação nunca muta a entrada (o parse é somente leitura).
 */
import { z } from "zod";
import {
  DEFAULT_FOOD_LOCALE,
  FOOD_CONTRACT_LIMITS,
  FOOD_CONTEXT_STATUSES,
  FOOD_DECISION_NEXT_ACTIONS,
  FOOD_DECISION_STATUSES,
  FOOD_EVIDENCE_ORIGINS,
  FOOD_FIELD_VALUES,
  FOOD_INPUT_TYPES,
  FOOD_LOCALE_STATUSES,
  FOOD_MEASURE_KINDS,
  FOOD_NORMALIZATION_ORIGINS,
  FOOD_NORMALIZATION_STAGES,
  FOOD_NUTRITION_BASE_UNITS,
  FOOD_OBSERVATION_SCHEMA_VERSION,
  FOOD_PROCESSING_LEVELS,
  FOOD_QUANTITY_EPSILON,
  FOOD_REASON_CODES,
  FOOD_RESOLUTION_DECISION_SCHEMA_VERSION,
  FOOD_STAGE_ORIGIN,
  FOOD_STATUS_ALLOWED_ACTIONS,
  isGovernedEvidenceField,
  isGroundedEvidenceOrigin,
  isVolumeUnit,
  isMassUnit,
  type FoodDecisionNextAction,
  type FoodDecisionStatus,
  type FoodEvidenceOrigin,
} from "./contracts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const positiveInt = z.number().int().positive();
const nullablePositiveInt = positiveInt.nullable();
const confidence = z.number().finite().min(0).max(1).nullable();
const nonEmptyText = z.string().trim().min(1);
const opaqueId = (max: number = FOOD_CONTRACT_LIMITS.identifier) =>
  nonEmptyText.max(max);
const nullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable();
const finiteNumber = z.number().finite();
const nonNegativeNumber = z.number().finite().min(0);
const nullableNonNegativeNumber = z.number().finite().min(0).nullable();
const evidenceIdList = z.array(opaqueId()).max(FOOD_CONTRACT_LIMITS.collection);

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

export const foodNutritionValuesSchema = z.strictObject({
  calories: nonNegativeNumber,
  protein: nonNegativeNumber,
  carbs: nonNegativeNumber,
  fat: nonNegativeNumber,
  fiber: nullableNonNegativeNumber,
  sugar: nullableNonNegativeNumber,
  sodiumMg: nullableNonNegativeNumber,
});

export const foodNutritionBasisSchema = z.strictObject({
  quantity: z.number().finite().positive(),
  unit: z.enum(FOOD_NUTRITION_BASE_UNITS),
  values: foodNutritionValuesSchema,
});

export const foodDecisionNutritionSchema = z
  .strictObject({
    profileId: nullablePositiveInt,
    sourceId: nullablePositiveInt,
    verified: z.boolean(),
    provisional: z.boolean(),
    basis: foodNutritionBasisSchema.nullable(),
    consumed: foodNutritionValuesSchema.nullable(),
    snapshotHash: nullableText(200),
    evidenceIds: evidenceIdList,
  })
  .refine(
    nutrition => !(nutrition.verified && nutrition.provisional),
    "Flags nutricionais são exclusivos: (verified=true, provisional=true) é inválido."
  )
  .refine(
    nutrition =>
      nutrition.basis !== null ||
      (nutrition.consumed === null &&
        !nutrition.verified &&
        !nutrition.provisional),
    "Ausência de nutrição usa basis=null/consumed=null com flags falsos; nunca um conjunto de zeros."
  )
  .refine(
    nutrition => nutrition.consumed === null || nutrition.basis !== null,
    "consumed depende de uma base nutricional explícita (basis)."
  )
  .refine(
    nutrition =>
      nutrition.basis === null || nutrition.verified || nutrition.provisional,
    "Base nutricional presente exige estado declarado: verificado ou provisório utilizável."
  )
  .refine(
    nutrition => !nutrition.verified || nutrition.evidenceIds.length > 0,
    "Nutrição verificada exige evidência de procedência declarada."
  );

export const foodDecisionQuantitySchema = z.strictObject({
  value: z.number().finite().positive().nullable(),
  unit: nullableText(40),
  grams: z.number().finite().positive().nullable(),
  milliliters: z.number().finite().positive().nullable(),
  portionId: nullablePositiveInt,
  source: nullableText(FOOD_CONTRACT_LIMITS.shortText),
  measureKind: z.enum(FOOD_MEASURE_KINDS).nullable(),
  confidence,
  evidenceIds: evidenceIdList,
});

export const foodDecisionIdentitySchema = z
  .strictObject({
    candidateKey: nullableText(200),
    foodEntityId: nullablePositiveInt,
    variantId: nullablePositiveInt,
    canonicalName: nullableText(FOOD_CONTRACT_LIMITS.nameText),
    brand: nullableText(200),
    variant: nullableText(200),
    preparation: z.array(nonEmptyText.max(80)).max(20),
    qualifiers: z
      .array(foodQualifierSchema)
      .max(FOOD_CONTRACT_LIMITS.qualifiers),
    barcode: z.string().trim().min(4).max(64).nullable(),
    confidence,
    evidenceIds: evidenceIdList,
  })
  .refine(
    identity => identity.variantId === null || identity.foodEntityId !== null,
    "variantId referencia food_variants e exige a família (foodEntityId) correspondente."
  )
  .refine(
    identity => identity.variantId === null || identity.variant !== null,
    "variantId exige a variante declarada; IDs não substituem o rótulo observado."
  );

export const foodAlternativeSchema = z
  .strictObject({
    candidateKey: opaqueId(),
    foodEntityId: nullablePositiveInt,
    variantId: nullablePositiveInt,
    name: nonEmptyText.max(FOOD_CONTRACT_LIMITS.nameText),
    brand: nullableText(200),
    variant: nullableText(200),
    preparation: z.array(nonEmptyText.max(80)).max(20),
    qualifiers: z
      .array(foodQualifierSchema)
      .max(FOOD_CONTRACT_LIMITS.qualifiers),
    evidenceIds: evidenceIdList,
    confidence,
  })
  .refine(
    alternative =>
      alternative.variantId === null || alternative.foodEntityId !== null,
    "variantId de alternativa exige foodEntityId correspondente."
  );

export const foodDecisionClassificationSchema = z.strictObject({
  version: nullableText(FOOD_CONTRACT_LIMITS.shortText),
  processingLevel: z.enum(FOOD_PROCESSING_LEVELS).nullable(),
  isFruit: z.boolean().nullable(),
  isVegetable: z.boolean().nullable(),
  isUltraProcessed: z.boolean().nullable(),
  confidence,
  provisional: z.boolean(),
  evidenceIds: evidenceIdList,
});

export const foodResolutionDecisionSchema = z
  .strictObject({
    schemaVersion: z.literal(FOOD_RESOLUTION_DECISION_SCHEMA_VERSION),
    decisionId: opaqueId(),
    revision: positiveInt,
    observationIds: z
      .array(opaqueId())
      .min(1)
      .max(FOOD_CONTRACT_LIMITS.observations),
    traceId: opaqueId(),
    status: z.enum(FOOD_DECISION_STATUSES),
    nextAction: z.enum(FOOD_DECISION_NEXT_ACTIONS),
    identity: foodDecisionIdentitySchema,
    quantity: foodDecisionQuantitySchema,
    nutrition: foodDecisionNutritionSchema,
    classification: foodDecisionClassificationSchema.nullable(),
    unresolvedFields: z.array(z.enum(FOOD_FIELD_VALUES)).max(4),
    reasonCodes: z
      .array(z.enum(FOOD_REASON_CODES))
      .max(FOOD_CONTRACT_LIMITS.alternatives),
    alternatives: z
      .array(foodAlternativeSchema)
      .max(FOOD_CONTRACT_LIMITS.alternatives),
    evidence: z.array(foodEvidenceSchema).max(FOOD_CONTRACT_LIMITS.collection),
    knowledgeRevision: nonEmptyText.max(FOOD_CONTRACT_LIMITS.shortText),
    policyVersion: nonEmptyText.max(FOOD_CONTRACT_LIMITS.shortText),
  })
  .superRefine((decision, ctx) => {
    rejectDuplicates(decision.observationIds, ctx, ["observationIds"]);
    rejectDuplicates(
      decision.evidence.map(evidence => evidence.evidenceId),
      ctx,
      ["evidence"]
    );
    rejectDuplicates(
      decision.unresolvedFields.map(field => field),
      ctx,
      ["unresolvedFields"]
    );
    rejectDuplicates(
      decision.reasonCodes.map(code => code),
      ctx,
      ["reasonCodes"]
    );

    const identity = decision.identity;
    const quantity = decision.quantity;
    const nutrition = decision.nutrition;

    const identitySustained =
      identity.canonicalName !== null &&
      (identity.foodEntityId !== null || identity.candidateKey !== null);

    if (decision.status === "resolved") {
      if (decision.unresolvedFields.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "status=resolved exige unresolvedFields=[] (precedência de §5).",
          path: ["unresolvedFields"],
        });
      }
      if (!identitySustained) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "status=resolved exige identidade sustentada (nome canônico e candidato/entidade).",
          path: ["identity"],
        });
      }
      if (
        quantity.value === null &&
        quantity.grams === null &&
        quantity.milliliters === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "status=resolved exige quantidade utilizável; ausência de quantidade não vira zero.",
          path: ["quantity"],
        });
      }
      if (nutrition.basis === null && nutrition.consumed === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "status=resolved exige nutrição utilizável com procedência declarada; ausência nunca vira zeros.",
          path: ["nutrition"],
        });
      }
    }

    if (decision.status === "unknown" && identitySustained) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "status=unknown significa que nenhuma identidade foi sustentada; use partially_resolved/ambiguous quando houver identidade.",
        path: ["status"],
      });
    }

    if (decision.status !== "resolved" && decision.reasonCodes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Resultado não resolvido exige reasonCodes.",
        path: ["reasonCodes"],
      });
    }

    if (decision.status === "ambiguous" && decision.alternatives.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "status=ambiguous exige alternativas materialmente concorrentes rastreáveis.",
        path: ["alternatives"],
      });
    }

    if (
      !FOOD_STATUS_ALLOWED_ACTIONS[decision.status].includes(
        decision.nextAction
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `nextAction=${decision.nextAction} é incompatível com status=${decision.status}.`,
        path: ["nextAction"],
      });
    }

    if (quantity.grams !== null && quantity.milliliters !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "grams e milliliters são bases físicas exclusivas; ml não vira g nem g vira ml sem relação comprovada.",
        path: ["quantity"],
      });
    }

    if (quantity.value !== null && quantity.unit === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "quantity.value exige unit explícita; nenhuma unidade física é implícita.",
        path: ["quantity", "unit"],
      });
    }

    rejectDuplicates(quantity.evidenceIds, ctx, ["quantity", "evidenceIds"]);
    rejectDuplicates(nutrition.evidenceIds, ctx, ["nutrition", "evidenceIds"]);
    rejectDuplicates(identity.evidenceIds, ctx, ["identity", "evidenceIds"]);
    if (decision.classification) {
      rejectDuplicates(decision.classification.evidenceIds, ctx, [
        "classification",
        "evidenceIds",
      ]);
    }

    const evidenceById = new Map(
      decision.evidence.map(evidence => [evidence.evidenceId, evidence])
    );
    const referenceGroups: Array<{
      ids: string[];
      path: (string | number)[];
      allowedPrefixes: readonly string[];
      ownerLabel: string;
    }> = [
      {
        ids: identity.evidenceIds,
        path: ["identity", "evidenceIds"],
        allowedPrefixes: ["identity.", "variant."],
        ownerLabel: "identity",
      },
      {
        ids: quantity.evidenceIds,
        path: ["quantity", "evidenceIds"],
        allowedPrefixes: ["quantity."],
        ownerLabel: "quantity",
      },
      {
        ids: nutrition.evidenceIds,
        path: ["nutrition", "evidenceIds"],
        allowedPrefixes: ["nutrition."],
        ownerLabel: "nutrition",
      },
      {
        ids: decision.classification?.evidenceIds ?? [],
        path: ["classification", "evidenceIds"],
        allowedPrefixes: ["classification."],
        ownerLabel: "classification",
      },
      {
        ids: decision.alternatives.flatMap(alternative => alternative.evidenceIds),
        path: ["alternatives"],
        allowedPrefixes: ["identity.", "variant."],
        ownerLabel: "alternative",
      },
    ];
    for (const { ids, path, allowedPrefixes, ownerLabel } of referenceGroups) {
      for (const id of ids) {
        const evidence = evidenceById.get(id);
        if (!evidence) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Referência de evidência não resolve no envelope da decisão: ${id}.`,
            path,
          });
          continue;
        }
        if (!allowedPrefixes.some(prefix => evidence.field.startsWith(prefix))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Evidência ${id} de ${evidence.field} não pertence ao proprietário ${ownerLabel}; referência cruzada entre domínios é inválida.`,
            path,
          });
        }
      }
    }

    assertPhysicalBasisProvenance(decision, evidenceById, ctx);

    const barcodeEvidence = decision.evidence.some(
      evidence =>
        evidence.field === "identity.barcode" &&
        evidence.origin === "barcode" &&
        evidence.value === identity.barcode
    );
    if (identity.barcode !== null && !barcodeEvidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "identity.barcode exige evidência de origem barcode com o mesmo valor: código exato não perde precedência para correspondência aproximada.",
        path: ["identity", "barcode"],
      });
    }
  });

function rejectDuplicates(
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

/**
 * Prova da base física (§5): converter volume em massa (ou massa em volume)
 * exige relação comprovada. A prova é uma evidência escalar do próprio campo
 * convertido, verificada e com o mesmo valor numérico declarado.
 */
function assertPhysicalBasisProvenance(
  decision: z.infer<typeof foodResolutionDecisionSchema>,
  evidenceById: Map<string, z.infer<typeof foodEvidenceSchema>>,
  ctx: z.RefinementCtx
) {
  const quantity = decision.quantity;
  const basisUnit = decision.nutrition.basis?.unit ?? null;
  const claimVolumeToMass =
    quantity.grams !== null &&
    (isVolumeUnit(quantity.unit) ||
      quantity.milliliters !== null ||
      basisUnit === "ml");
  const claimMassToVolume =
    quantity.milliliters !== null &&
    (isMassUnit(quantity.unit) || basisUnit === "g");

  if (claimVolumeToMass) {
    if (
      !isProvenConversion(
        quantity.evidenceIds,
        "quantity.grams",
        quantity.grams,
        evidenceById
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Conversão de volume (ml) para massa (g) exige relação comprovada por evidência verificada; sem densidade comprovada ml não vira gramas.",
        path: ["quantity", "grams"],
      });
    }
  }

  if (claimMassToVolume) {
    if (
      !isProvenConversion(
        quantity.evidenceIds,
        "quantity.milliliters",
        quantity.milliliters,
        evidenceById
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Conversão de massa (g) para volume (ml) exige relação comprovada por evidência verificada.",
        path: ["quantity", "milliliters"],
      });
    }
  }
}

function isProvenConversion(
  evidenceIds: readonly string[],
  field: "quantity.grams" | "quantity.milliliters",
  expected: number | null,
  evidenceById: Map<string, z.infer<typeof foodEvidenceSchema>>
): boolean {
  if (expected === null) return true;
  return evidenceIds.some(evidenceId => {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) return false;
    if (evidence.field !== field) return false;
    if (evidence.verified !== true) return false;
    return (
      typeof evidence.value === "number" &&
      Math.abs(evidence.value - expected) <= FOOD_QUANTITY_EPSILON
    );
  });
}

export type FoodAnchor = z.infer<typeof foodAnchorSchema>;
export type FoodQualifier = z.infer<typeof foodQualifierSchema>;
export type FoodEvidence = z.infer<typeof foodEvidenceSchema>;
export type FoodIdentityHints = z.infer<typeof foodIdentityHintsSchema>;
export type FoodQuantityHints = z.infer<typeof foodQuantityHintsSchema>;
export type FoodNormalizationStep = z.infer<typeof foodNormalizationStepSchema>;
export type FoodObservationAlternative = z.infer<
  typeof foodObservationAlternativeSchema
>;
export type FoodLocale = z.infer<typeof foodLocaleSchema>;
export type FoodObservation = z.infer<typeof foodObservationSchema>;
export type MealOperation = z.infer<typeof foodMealOperationSchema>;
export type FoodOperationEnvelope = z.infer<typeof foodOperationEnvelopeSchema>;
export type FoodNutritionValues = z.infer<typeof foodNutritionValuesSchema>;
export type FoodNutritionBasis = z.infer<typeof foodNutritionBasisSchema>;
export type FoodDecisionNutrition = z.infer<typeof foodDecisionNutritionSchema>;
export type FoodDecisionQuantity = z.infer<typeof foodDecisionQuantitySchema>;
export type FoodDecisionIdentity = z.infer<typeof foodDecisionIdentitySchema>;
export type FoodAlternative = z.infer<typeof foodAlternativeSchema>;
export type FoodDecisionClassification = z.infer<
  typeof foodDecisionClassificationSchema
>;
export type FoodResolutionDecision = z.infer<
  typeof foodResolutionDecisionSchema
>;

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
  const parsed = foodOperationEnvelopeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid-contract",
      issues: toIssues(parsed.error),
    };
  }
  return { ok: true, value: parsed.data };
}

/** `status`/`nextAction` aceitos pelo contrato (reexportado para consumidores). */
export type { FoodDecisionNextAction, FoodDecisionStatus, FoodEvidenceOrigin };
