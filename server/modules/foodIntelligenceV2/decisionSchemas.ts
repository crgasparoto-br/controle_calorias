import { z } from "zod";
import {
  assertDeclaredPhysicalConsistency,
  assertNutritionScaleConsistency,
  assertPhysicalBasisProvenance,
} from "./nutritionConsistency";
import {
  FOOD_CONTRACT_LIMITS,
  FOOD_DECISION_NEXT_ACTIONS,
  FOOD_DECISION_STATUSES,
  FOOD_FIELD_VALUES,
  FOOD_MEASURE_KINDS,
  FOOD_NUTRITION_BASE_UNITS,
  FOOD_PROCESSING_LEVELS,
  FOOD_REASON_CODES,
  FOOD_RESOLUTION_DECISION_SCHEMA_VERSION,
  FOOD_STATUS_ALLOWED_ACTIONS,
} from "./contracts";
import {
  confidence,
  evidenceIdList,
  foodEvidenceSchema,
  foodQualifierSchema,
  nonEmptyText,
  nonNegativeNumber,
  nullableOpaqueId,
  nullableNonNegativeNumber,
  nullablePositiveInt,
  nullableText,
  opaqueId,
  positiveInt,
  rejectDuplicates,
} from "./schemaShared";
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
    snapshotHash: nullableOpaqueId(200),
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
    candidateKey: nullableOpaqueId(200),
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
    const identityReferencePresent =
      identity.canonicalName !== null ||
      identity.candidateKey !== null ||
      identity.foodEntityId !== null ||
      identity.variantId !== null;
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
      if (nutrition.consumed === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "status=resolved exige nutrição utilizável com procedência declarada; ausência nunca vira zeros.",
          path: ["nutrition"],
        });
      }
    }
    if (decision.status === "unknown" && identityReferencePresent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "status=unknown significa que nenhuma identidade foi sustentada; use partially_resolved/ambiguous quando houver identidade.",
        path: ["status"],
      });
    }
    if (
      decision.status === "partially_resolved" &&
      decision.unresolvedFields.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "status=partially_resolved exige ao menos um campo material em unresolvedFields.",
        path: ["unresolvedFields"],
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
    if (decision.status === "ambiguous") {
      rejectDuplicates(
        decision.alternatives.map(alternative => alternative.candidateKey),
        ctx,
        ["alternatives"]
      );
      decision.alternatives.forEach((alternative, index) => {
        if (alternative.evidenceIds.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Cada alternativa ambígua exige ao menos uma evidência rastreável.",
            path: ["alternatives", index, "evidenceIds"],
          });
        }
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
    if (nutrition.verified) {
      for (const evidenceId of nutrition.evidenceIds) {
        const evidence = evidenceById.get(evidenceId);
        if (evidence?.verified !== true) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Nutrição verificada exige que toda evidência nutricional referenciada seja verificada e grounded; confiança de IA não substitui verificação.",
            path: ["nutrition", "evidenceIds"],
          });
        }
      }
    }
    if (
      decision.classification !== null &&
      !decision.classification.provisional
    ) {
      if (decision.classification.evidenceIds.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Classificação não provisória exige evidência governada e verificada; ausência de evidência não pode ser promovida silenciosamente.",
          path: ["classification", "evidenceIds"],
        });
      } else {
        const hasVerifiedGrounding = decision.classification.evidenceIds.some(
          evidenceId => {
            const evidence = evidenceById.get(evidenceId);
            return evidence?.verified === true;
          }
        );
        if (!hasVerifiedGrounding) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Classificação não provisória exige ao menos uma evidência verificada do domínio classification.",
            path: ["classification", "evidenceIds"],
          });
        }
      }
    }
    assertDeclaredPhysicalConsistency(decision, ctx);
    assertPhysicalBasisProvenance(decision, evidenceById, ctx);
    assertNutritionScaleConsistency(decision, ctx);
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
export type FoodNutritionValues = z.infer<typeof foodNutritionValuesSchema>;
export type FoodNutritionBasis = z.infer<typeof foodNutritionBasisSchema>;
export type FoodDecisionNutrition = z.infer<typeof foodDecisionNutritionSchema>;
export type FoodDecisionQuantity = z.infer<typeof foodDecisionQuantitySchema>;
export type FoodDecisionIdentity = z.infer<typeof foodDecisionIdentitySchema>;
export type FoodAlternative = z.infer<typeof foodAlternativeSchema>;
export type FoodDecisionClassification = z.infer<typeof foodDecisionClassificationSchema>;
export type FoodResolutionDecision = z.infer<typeof foodResolutionDecisionSchema>;
