import { z } from "zod";
import {
  FOOD_CONTRACT_LIMITS,
  FOOD_MATERIAL_OBSERVATION_SCHEMA_VERSION,
  isGovernedEvidenceField,
} from "./contracts";
import {
  foodObservationShape,
  validateFoodObservationFields,
} from "./observationSchemas";
import {
  foodEvidenceSchemaForFields,
  nonEmptyText,
  opaqueId,
} from "./schemaShared";

const materialFields = [
  "material.ingredient",
  "material.negation",
  "material.increment",
  "material.amount",
] as const;

const materialEvidenceSchema = foodEvidenceSchemaForFields(
  field =>
    isGovernedEvidenceField(field) ||
    materialFields.some(value => value === field)
);

const bindingSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("bound"),
    ownerObservationId: opaqueId(),
  }),
  z.strictObject({
    status: z.literal("unresolved"),
    reason: z.enum([
      "owner_ambiguous",
      "owner_unknown",
      "increment_target_unresolved",
    ]),
    candidateObservationIds: z
      .array(opaqueId())
      .max(FOOD_CONTRACT_LIMITS.observations),
  }),
]);
const ingredientSchema = z.strictObject({
  name: nonEmptyText.max(FOOD_CONTRACT_LIMITS.nameText),
  evidenceId: opaqueId(),
});
const amountSchema = z.strictObject({
  value: z.number().finite().positive(),
  unit: nonEmptyText.max(40),
  evidenceId: opaqueId(),
});
const incrementTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("food_quantity"),
    observationId: opaqueId(),
    evidenceId: opaqueId(),
  }),
  z.strictObject({
    kind: z.literal("ingredient_quantity"),
    claimId: opaqueId(),
  }),
]);

const claimBase = { claimId: opaqueId(), binding: bindingSchema };
const materialClaimSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...claimBase,
    kind: z.literal("ingredient"),
    ingredient: ingredientSchema,
    amount: amountSchema.nullable(),
  }),
  z.strictObject({
    ...claimBase,
    kind: z.literal("negation"),
    ingredient: ingredientSchema,
    operatorEvidenceId: opaqueId(),
  }),
  z.strictObject({
    ...claimBase,
    kind: z.literal("increment"),
    ingredient: ingredientSchema.nullable(),
    operatorEvidenceId: opaqueId(),
    target: incrementTargetSchema.nullable(),
    unresolvedAmount: amountSchema.nullable(),
  }),
]);

// Same observation contract and refinements; new wire revision is opt-in.
const materialObservationSchema = z
  .strictObject({
    ...foodObservationShape,
    // The legacy public schema still has its literal v2 and is not widened.
    schemaVersion: z.literal(FOOD_MATERIAL_OBSERVATION_SCHEMA_VERSION),
    evidence: z
      .array(materialEvidenceSchema)
      .max(FOOD_CONTRACT_LIMITS.collection),
    materialClaims: z
      .array(materialClaimSchema)
      .max(FOOD_CONTRACT_LIMITS.collection),
  })
  .superRefine(validateFoodObservationFields);

export type FoodMaterialObservation = z.infer<typeof materialObservationSchema>;
type MaterialClaim = z.infer<typeof materialClaimSchema>;
type MaterialEvidence = z.infer<typeof materialEvidenceSchema>;
type LocatedClaim = {
  claim: MaterialClaim;
  observation: FoodMaterialObservation;
  path: (string | number)[];
};

function localAnchor(
  observation: FoodMaterialObservation,
  evidence: MaterialEvidence
) {
  const surface = observation.surfaceSpan;
  const anchor = evidence.anchor;
  if (
    anchor.sourceRef !== surface.sourceRef ||
    !surface.span ||
    !anchor.span ||
    surface.region !== null ||
    anchor.region !== null ||
    observation.rawInput === null ||
    anchor.span.start < surface.span.start ||
    anchor.span.end > surface.span.end ||
    anchor.span.end > observation.rawInput.length
  )
    return null;
  if (
    evidence.origin !==
    (observation.modality === "audio_transcript" ? "transcription" : "text")
  ) {
    return null;
  }
  return anchor.span;
}

function validateMaterialBatch(
  observations: FoodMaterialObservation[],
  ctx: z.RefinementCtx
) {
  const addIssue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });
  const byId = new Map<string, FoodMaterialObservation>();
  const sources = new Map<string, string>();
  const byClaim = new Map<string, LocatedClaim>();
  const usedEvidence = new Map<FoodMaterialObservation, Set<string>>();
  const occurrences = new Set<string>();
  const incrementTargets = new Set<string>();
  observations.forEach((observation, index) => {
    if (byId.has(observation.observationId)) {
      addIssue([index, "observationId"], "ID de observação duplicado no lote.");
    }
    byId.set(observation.observationId, observation);
    if (observation.rawInput !== null) {
      const ref = observation.surfaceSpan.sourceRef;
      if (sources.has(ref) && sources.get(ref) !== observation.rawInput) {
        addIssue(
          [index, "surfaceSpan"],
          "A mesma referência não pode ter textos diferentes."
        );
      }
      sources.set(ref, observation.rawInput);
    }
    observation.materialClaims.forEach((claim, claimIndex) => {
      const path = [index, "materialClaims", claimIndex];
      if (byClaim.has(claim.claimId))
        addIssue(path, "ID de ocorrência duplicado no lote.");
      byClaim.set(claim.claimId, { claim, observation, path });
    });
  });

  for (const { claim, observation, path } of byClaim.values()) {
    const fail = (message: string) => addIssue(path, message);
    const used = usedEvidence.get(observation) ?? new Set<string>();
    usedEvidence.set(observation, used);
    const binding = claim.binding;
    if (
      observation.modality !== "text" &&
      observation.modality !== "audio_transcript"
    ) {
      fail(
        "Vínculo material nesta revisão exige fonte textual ou transcrição com span."
      );
    }
    if (binding.status === "bound") {
      if (
        binding.ownerObservationId !== observation.observationId ||
        observation.identityHints.foodName === null
      )
        fail("Vínculo deve estar na ocorrência do alimento dono.");
    } else {
      if (
        binding.reason === "increment_target_unresolved" &&
        (claim.kind !== "increment" ||
          binding.candidateObservationIds.length !== 1)
      ) {
        fail(
          "Um alvo de incremento pendente deve identificar o único dono comprovado."
        );
      }
      if (
        observation.identityHints.foodName !== null ||
        observation.unresolvedReason === null
      ) {
        fail("Vínculo pendente não pode materializar um item alimentar.");
      }
      const candidateIds = binding.candidateObservationIds;
      if (
        new Set(candidateIds).size !== candidateIds.length ||
        (binding.reason === "owner_ambiguous" && candidateIds.length < 2) ||
        (binding.reason === "owner_unknown" && candidateIds.length !== 0)
      ) {
        fail("Candidatos não correspondem à razão da pendência.");
      }
      for (const id of candidateIds) {
        const candidate = byId.get(id);
        if (
          !candidate ||
          candidate.identityHints.foodName === null ||
          candidate.surfaceSpan.sourceRef !==
            observation.surfaceSpan.sourceRef ||
          candidate.rawInput !== observation.rawInput ||
          candidate.modality !== observation.modality
        ) {
          fail("Candidato não identifica alimento na mesma fonte do lote.");
        }
      }
    }

    const fact = (
      id: string,
      field: string,
      expected?: string | number,
      unit?: string
    ) => {
      const evidence = observation.evidence.find(
        item => item.evidenceId === id
      );
      const span = evidence ? localAnchor(observation, evidence) : null;
      used.add(id);
      if (
        !evidence ||
        !span ||
        evidence.field !== field ||
        (expected === undefined
          ? typeof evidence.value !== "string" || !evidence.value.trim()
          : evidence.value !== expected) ||
        evidence.unit !== (unit ?? null) ||
        (typeof evidence.value === "string" &&
          observation.rawInput?.slice(span.start, span.end) !== evidence.value)
      ) {
        fail(
          "Fato material exige evidência do campo, valor e fonte correspondentes."
        );
        return null;
      }
      return span;
    };
    const registerOccurrence = (
      kind: string,
      span: { start: number; end: number } | null
    ) => {
      if (!span) return;
      const key = JSON.stringify([
        observation.surfaceSpan.sourceRef,
        kind,
        span.start,
        span.end,
      ]);
      if (occurrences.has(key))
        fail("A mesma ocorrência de origem foi utilizada mais de uma vez.");
      occurrences.add(key);
    };

    const ingredient = claim.ingredient;
    const ingredientSpan = ingredient
      ? fact(ingredient.evidenceId, "material.ingredient", ingredient.name)
      : null;
    if (claim.kind === "ingredient") {
      registerOccurrence("ingredient", ingredientSpan);
      if (claim.amount)
        registerOccurrence(
          "amount",
          fact(
            claim.amount.evidenceId,
            "material.amount",
            claim.amount.value,
            claim.amount.unit
          )
        );
    } else {
      const operator = fact(claim.operatorEvidenceId, `material.${claim.kind}`);
      registerOccurrence(claim.kind, operator);
      if (
        !operator ||
        (ingredientSpan && operator.end > ingredientSpan.start)
      ) {
        fail("Operador deve anteceder o ingrediente ancorado no mesmo trecho.");
      }
      if (claim.kind === "negation") {
        registerOccurrence("ingredient", ingredientSpan);
        continue;
      }
      if (binding.status === "unresolved") {
        registerOccurrence("ingredient", ingredientSpan);
        if (claim.target !== null)
          fail("Incremento pendente não pode indicar alvo resolvido.");
        if (claim.unresolvedAmount)
          registerOccurrence(
            "amount",
            fact(
              claim.unresolvedAmount.evidenceId,
              "material.amount",
              claim.unresolvedAmount.value,
              claim.unresolvedAmount.unit
            )
          );
        continue;
      }
      const target = claim.target;
      if (claim.unresolvedAmount !== null || target === null) {
        fail(
          "Incremento vinculado exige ocorrência de quantidade sem valor duplicado."
        );
        continue;
      }
      const ingredientTarget =
        target.kind === "ingredient_quantity"
          ? byClaim.get(target.claimId)
          : null;
      const targetId =
        target.kind === "food_quantity"
          ? target.evidenceId
          : ingredientTarget?.claim.kind === "ingredient"
            ? ingredientTarget.claim.amount?.evidenceId
            : null;
      const targetEvidence = observation.evidence.find(
        item => item.evidenceId === targetId
      );
      const targetSpan = targetEvidence
        ? localAnchor(observation, targetEvidence)
        : null;
      const targetValid =
        target.kind === "food_quantity"
          ? target.observationId === observation.observationId &&
            ingredient === null &&
            targetEvidence?.field === "quantity.value" &&
            observation.quantityHints.value !== null &&
            targetEvidence.value === observation.quantityHints.value &&
            targetEvidence.unit === observation.quantityHints.unit
          : ingredientTarget?.observation.observationId ===
              observation.observationId &&
            ingredientTarget.claim.kind === "ingredient" &&
            ingredientTarget.claim.binding.status === "bound" &&
            ingredientTarget.claim.ingredient.name === ingredient?.name &&
            targetEvidence?.field === "material.amount";
      if (
        !targetValid ||
        !operator ||
        !targetSpan ||
        operator.end > targetSpan.start
      ) {
        fail(
          "Alvo do incremento deve identificar a medida posterior da mesma ocorrência dona."
        );
      }
      if (targetSpan) {
        const key = JSON.stringify([
          observation.surfaceSpan.sourceRef,
          targetSpan.start,
          targetSpan.end,
        ]);
        if (incrementTargets.has(key))
          fail("Operadores distintos não podem compartilhar o mesmo alvo.");
        incrementTargets.add(key);
      }
    }
  }
  observations.forEach((observation, index) => {
    const used = usedEvidence.get(observation);
    observation.evidence.forEach((evidence, evidenceIndex) => {
      if (
        materialFields.some(field => field === evidence.field) &&
        !used?.has(evidence.evidenceId)
      ) {
        addIssue(
          [index, "evidence", evidenceIndex],
          "Evidência material exige ocorrência correspondente."
        );
      }
    });
  });
}

export const foodMaterialObservationBatchSchema = z
  .array(materialObservationSchema)
  .max(FOOD_CONTRACT_LIMITS.observations)
  .superRefine(validateMaterialBatch);
