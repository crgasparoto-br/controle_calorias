import { z } from "zod";
import {
  FOOD_CONTRACT_LIMITS,
  FOOD_MATERIAL_OBSERVATION_SCHEMA_VERSION,
  isGovernedEvidenceField,
} from "./contracts";
import {
  foodObservationSchema,
  validateFoodObservationFields,
} from "./observationSchemas";
import {
  foodEvidenceSchemaForFields,
  nonEmptyText,
  opaqueId,
} from "./schemaShared";

// Schema-owned wire discriminants. Decoding/validation and cross-reference
// checks use the same declared values, without a vocabulary of food names.
const ingredientEvidenceField = z.literal("material.ingredient");
const negationEvidenceField = z.literal("material.negation");
const incrementEvidenceField = z.literal("material.increment");
const measuredEvidenceField = z.literal("material.amount");
const wholeQuantityEvidenceField = z.literal("quantity.value");
const materialEvidenceFieldSchema = z.union([
  ingredientEvidenceField,
  negationEvidenceField,
  incrementEvidenceField,
  measuredEvidenceField,
]);
const boundStatus = z.literal("bound");
const unresolvedStatus = z.literal("unresolved");
const unresolvedReasonSchema = z.enum([
  "owner_ambiguous",
  "owner_unknown",
  "increment_target_unresolved",
]);
const ingredientClaimKind = z.literal("ingredient");
const negationClaimKind = z.literal("negation");
const incrementClaimKind = z.literal("increment");
const wholeQuantityTargetKind = z.literal("food_quantity");
const ingredientQuantityTargetKind = z.literal("ingredient_quantity");
const modalities = foodObservationSchema.shape.modality.enum;

const materialEvidenceSchema = foodEvidenceSchemaForFields(
  field =>
    isGovernedEvidenceField(field) ||
    materialEvidenceFieldSchema.safeParse(field).success
)
  // The backlink belongs to the measured evidence, not the mutable claim
  // reference. Distinct anchors can carry equal values and labels.
  .safeExtend({ ingredientEvidenceId: opaqueId().optional() })
  .refine(
    evidence =>
      evidence.ingredientEvidenceId === undefined ||
      evidence.field === measuredEvidenceField.value,
    "A referência de ingrediente pertence apenas à evidência de medida material."
  );

const bindingSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: boundStatus,
    ownerObservationId: opaqueId(),
  }),
  z.strictObject({
    status: unresolvedStatus,
    reason: unresolvedReasonSchema,
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
    kind: wholeQuantityTargetKind,
    observationId: opaqueId(),
    evidenceId: opaqueId(),
  }),
  z.strictObject({
    kind: ingredientQuantityTargetKind,
    claimId: opaqueId(),
  }),
]);

const claimBase = { claimId: opaqueId(), binding: bindingSchema };
const materialClaimSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...claimBase,
    kind: ingredientClaimKind,
    ingredient: ingredientSchema,
    amount: amountSchema.nullable(),
  }),
  z.strictObject({
    ...claimBase,
    kind: negationClaimKind,
    ingredient: ingredientSchema,
    operatorEvidenceId: opaqueId(),
  }),
  z.strictObject({
    ...claimBase,
    kind: incrementClaimKind,
    ingredient: ingredientSchema.nullable(),
    operatorEvidenceId: opaqueId(),
    target: incrementTargetSchema.nullable(),
    unresolvedAmount: amountSchema.nullable(),
  }),
]);

// Same observation contract and refinements; new wire revision is opt-in.
const materialObservationSchema = z
  .strictObject({
    ...foodObservationSchema.shape,
    // The legacy public schema still has its literal v2 and is not widened.
    schemaVersion: z.literal(FOOD_MATERIAL_OBSERVATION_SCHEMA_VERSION),
    // This entire revision is scoped to textual evidence, even without claims.
    modality: z.enum([modalities.text, modalities.audio_transcript]),
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
    (observation.modality === modalities.audio_transcript
      ? "transcription"
      : "text")
  ) {
    return null;
  }
  return anchor.span;
}

function occurrenceKey(
  sourceRef: string,
  span: { start: number; end: number }
) {
  return JSON.stringify([sourceRef, span.start, span.end]);
}

type Span = { start: number; end: number };
type QuantityOccurrence = { span: Span; path: (string | number)[] };

function appendToSource<T>(
  index: Map<string, T[]>,
  sourceRef: string,
  value: T
) {
  const values = index.get(sourceRef);
  if (values) values.push(value);
  else index.set(sourceRef, [value]);
}

/** Union the typed whole-quantity ranges for the half-open overlap test. */
function unionSpans(spans: Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of spans.sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
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
  const wholeQuantitySpans = new Map<string, Span[]>();
  const measuredOccurrences = new Map<string, QuantityOccurrence[]>();
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
    let hasLocalWholeQuantity = false;
    for (const evidence of observation.evidence) {
      if (
        evidence.field !== wholeQuantityEvidenceField.value ||
        observation.quantityHints.value === null ||
        evidence.value !== observation.quantityHints.value ||
        evidence.unit !== observation.quantityHints.unit
      )
        continue;
      const span = localAnchor(observation, evidence);
      if (span) {
        hasLocalWholeQuantity = true;
        appendToSource(
          wholeQuantitySpans,
          observation.surfaceSpan.sourceRef,
          span
        );
      }
    }
    if (observation.quantityHints.value !== null && !hasLocalWholeQuantity) {
      addIssue(
        [index, "quantityHints"],
        "A quantidade do alimento exige evidência local com valor e unidade correspondentes."
      );
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
    if (binding.status === boundStatus.value) {
      if (
        binding.ownerObservationId !== observation.observationId ||
        observation.identityHints.foodName === null
      )
        fail("Vínculo deve estar na ocorrência do alimento dono.");
    } else {
      if (
        binding.reason ===
          unresolvedReasonSchema.enum.increment_target_unresolved &&
        (claim.kind !== incrementClaimKind.value ||
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
        (binding.reason === unresolvedReasonSchema.enum.owner_ambiguous &&
          candidateIds.length < 2) ||
        (binding.reason === unresolvedReasonSchema.enum.owner_unknown &&
          candidateIds.length !== 0)
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
      const sourceSpan = occurrenceKey(observation.surfaceSpan.sourceRef, span);
      const key = JSON.stringify([kind, sourceSpan]);
      if (occurrences.has(key))
        fail("A mesma ocorrência de origem foi utilizada mais de uma vez.");
      occurrences.add(key);
    };

    const registerMeasuredOccurrence = (span: Span | null) => {
      if (span)
        appendToSource(measuredOccurrences, observation.surfaceSpan.sourceRef, {
          span,
          path,
        });
    };

    const ingredient = claim.ingredient;
    const ingredientSpan = ingredient
      ? fact(
          ingredient.evidenceId,
          ingredientEvidenceField.value,
          ingredient.name
        )
      : null;
    if (claim.kind === ingredientClaimKind.value) {
      registerOccurrence("ingredient", ingredientSpan);
      if (claim.amount) {
        const amountId = claim.amount.evidenceId;
        const evidence = observation.evidence.find(
          item => item.evidenceId === amountId
        );
        if (evidence?.ingredientEvidenceId !== claim.ingredient.evidenceId) {
          addIssue(
            [...path, "amount", "evidenceId"],
            "Evidência de medida deve preservar a referência à sua ocorrência de ingrediente."
          );
        }
        registerMeasuredOccurrence(
          fact(
            claim.amount.evidenceId,
            measuredEvidenceField.value,
            claim.amount.value,
            claim.amount.unit
          )
        );
      }
    } else {
      const operatorField =
        claim.kind === negationClaimKind.value
          ? negationEvidenceField
          : incrementEvidenceField;
      const operator = fact(claim.operatorEvidenceId, operatorField.value);
      registerOccurrence(claim.kind, operator);
      if (
        !operator ||
        (ingredientSpan && operator.end > ingredientSpan.start)
      ) {
        fail("Operador deve anteceder o ingrediente ancorado no mesmo trecho.");
      }
      if (claim.kind === negationClaimKind.value) {
        registerOccurrence("ingredient", ingredientSpan);
        continue;
      }
      if (binding.status === unresolvedStatus.value) {
        registerOccurrence("ingredient", ingredientSpan);
        if (claim.target !== null)
          fail("Incremento pendente não pode indicar alvo resolvido.");
        if (claim.unresolvedAmount) {
          const amountId = claim.unresolvedAmount.evidenceId;
          const evidence = observation.evidence.find(
            item => item.evidenceId === amountId
          );
          if (evidence?.ingredientEvidenceId !== ingredient?.evidenceId) {
            fail(
              "Medida pendente deve referenciar sua ocorrência de ingrediente, quando presente."
            );
          }
          const amountSpan = fact(
            amountId,
            measuredEvidenceField.value,
            claim.unresolvedAmount.value,
            claim.unresolvedAmount.unit
          );
          if (amountSpan && (!operator || operator.end > amountSpan.start)) {
            fail(
              "Medida pendente deve estar ancorada após o operador do próprio incremento."
            );
          }
          registerMeasuredOccurrence(amountSpan);
        }
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
        target.kind === ingredientQuantityTargetKind.value
          ? byClaim.get(target.claimId)
          : null;
      const targetId =
        target.kind === wholeQuantityTargetKind.value
          ? target.evidenceId
          : ingredientTarget?.claim.kind === ingredientClaimKind.value
            ? ingredientTarget.claim.amount?.evidenceId
            : null;
      const targetEvidence = observation.evidence.find(
        item => item.evidenceId === targetId
      );
      const targetSpan = targetEvidence
        ? localAnchor(observation, targetEvidence)
        : null;
      const targetValid =
        target.kind === wholeQuantityTargetKind.value
          ? target.observationId === observation.observationId &&
            ingredient === null &&
            targetEvidence?.field === wholeQuantityEvidenceField.value &&
            observation.quantityHints.value !== null &&
            targetEvidence.value === observation.quantityHints.value &&
            targetEvidence.unit === observation.quantityHints.unit
          : ingredientTarget?.observation.observationId ===
              observation.observationId &&
            ingredientTarget.claim.kind === ingredientClaimKind.value &&
            ingredientTarget.claim.binding.status === boundStatus.value &&
            ingredientTarget.claim.ingredient.evidenceId ===
              ingredient?.evidenceId &&
            targetEvidence?.field === measuredEvidenceField.value;
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
        const key = occurrenceKey(
          observation.surfaceSpan.sourceRef,
          targetSpan
        );
        if (incrementTargets.has(key))
          fail("Operadores distintos não podem compartilhar o mesmo alvo.");
        incrementTargets.add(key);
      }
    }
  }
  // Compare typed source spans, not numeric text. Touching half-open ranges
  // are distinct. Whole quantities and measured occurrences own different
  // indexes; a reference to a quantity (e.g. an increment) adds no measure.
  for (const [sourceRef, measures] of measuredOccurrences) {
    const occupied = unionSpans(wholeQuantitySpans.get(sourceRef) ?? []);
    let nextOccupied = 0;
    let previousMeasureEnd = -1;
    for (const { span, path } of measures.sort(
      (left, right) => left.span.start - right.span.start
    )) {
      while (
        nextOccupied < occupied.length &&
        occupied[nextOccupied].end <= span.start
      )
        nextOccupied++;
      if (
        nextOccupied < occupied.length &&
        occupied[nextOccupied].start < span.end
      ) {
        addIssue(
          path,
          "Medida material não pode sobrepor a quantidade do alimento."
        );
      }
      if (span.start < previousMeasureEnd) {
        addIssue(path, "Ocorrências de medida material não podem se sobrepor.");
      }
      previousMeasureEnd = Math.max(previousMeasureEnd, span.end);
    }
  }
  observations.forEach((observation, index) => {
    const used = usedEvidence.get(observation);
    observation.evidence.forEach((evidence, evidenceIndex) => {
      if (
        materialEvidenceFieldSchema.safeParse(evidence.field).success &&
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
