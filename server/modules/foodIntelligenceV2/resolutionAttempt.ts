/** #1305: an evaluated V2 decision and an unaccepted attempt are distinct. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { FOOD_FIELD_VALUES, FOOD_RESOLUTION_DECISION_SCHEMA_VERSION } from "./contracts";
import { foodResolutionDecisionSchema } from "./decisionSchemas";
import { opaqueId, positiveInt } from "./schemaShared";
import { type FoodObservation, type FoodResolutionDecision } from "./schemas";

const VERSION = 1;
const ID_PREFIX = "resolution-attempt:";
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const attemptIdSchema = z.string().regex(/^resolution-attempt:[a-f0-9]{64}$/u);
const priorSnapshotSchema = z.strictObject({
  decisionId: opaqueId(),
  revision: positiveInt,
  digest: sha256,
});
const scope = {
  attemptVersion: z.literal(VERSION),
  attemptId: attemptIdSchema,
  requestHash: sha256,
  observationId: opaqueId(),
};
export const emptyResolutionIdentity = (): FoodResolutionDecision["identity"] => ({
  candidateKey: null, foodEntityId: null, variantId: null, canonicalName: null,
  brand: null, variant: null, preparation: [], qualifiers: [], barcode: null,
  confidence: null, evidenceIds: [],
});
export const emptyResolutionQuantity = (): FoodResolutionDecision["quantity"] => ({
  value: null, unit: null, grams: null, milliliters: null, portionId: null,
  portionSnapshot: null, source: null, measureKind: null, confidence: null, evidenceIds: [],
});
export const emptyResolutionNutrition = (): FoodResolutionDecision["nutrition"] => ({
  profileId: null, sourceId: null, verified: false, provisional: false, basis: null,
  consumed: null, snapshotHash: null, evidenceIds: [],
});
const failedFields = () => ({
  status: "unknown" as const, nextAction: "retry" as const,
  identity: emptyResolutionIdentity(), quantity: emptyResolutionQuantity(),
  nutrition: emptyResolutionNutrition(), classification: null, alternatives: [], evidence: [],
  unresolvedFields: [...FOOD_FIELD_VALUES], reasonCodes: ["decision_validation_failed" as const],
});

const deferred = z.strictObject({
  ...scope, outcome: z.literal("deferred"),
  // Reference only. Never re-emit the old (possibly expired) proposal in this result.
  acceptedDecision: priorSnapshotSchema,
  failure: foodResolutionDecisionSchema,
});
const evaluated = z.strictObject({
  ...scope, outcome: z.literal("evaluated"), decision: foodResolutionDecisionSchema,
});
export const foodResolutionAttemptSchema = z.discriminatedUnion("outcome", [evaluated, deferred])
  .refine(attempt => {
    const d = attempt.outcome === "deferred" ? attempt.failure : attempt.decision;
    if (d.observationIds.length !== 1 || d.observationIds[0] !== attempt.observationId) return false;
    if (attempt.outcome === "evaluated") return !isDetachedResolutionFailure(d);
    return d.decisionId === attempt.attemptId && d.revision === 1 &&
      d.knowledgeValidity === undefined && d.ownerUserId !== undefined &&
      attempt.acceptedDecision.decisionId !== d.decisionId &&
      Object.entries(failedFields()).every(([key, value]) =>
        JSON.stringify(d[key as keyof FoodResolutionDecision]) === JSON.stringify(value));
  }, "Tentativa V1 deve preservar o escopo e separar a falha da decisão aceita.");
export type FoodResolutionAttempt = z.infer<typeof foodResolutionAttemptSchema>;

type AttemptContext = {
  userId: number | null; traceId: string; knowledgeRevision: string;
  policyVersion: string; resolverVersion: string;
};
type AttemptScope = z.infer<z.ZodObject<typeof scope>>;
type PriorSnapshot = z.infer<typeof priorSnapshotSchema>;
const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const isDetachedResolutionFailure = (decision: FoodResolutionDecision) =>
  decision.decisionId.startsWith(ID_PREFIX);

export function identifyFoodResolutionAttempt(
  input: FoodObservation, context: AttemptContext, prior: FoodResolutionDecision | null,
  requestKey?: string,
): { scope: AttemptScope; accepted: PriorSnapshot | null } {
  // A trusted operation supplies this opaque key. It is not included in the result.
  const key = requestKey === undefined
    ? "detached-v2:" + digest([input, prior?.decisionId, prior?.revision,
      context.knowledgeRevision, context.policyVersion, context.resolverVersion])
    : opaqueId().parse(requestKey);
  const accepted = prior === null ? null : {
    decisionId: prior.decisionId, revision: prior.revision, digest: digest(prior),
  };
  const { userId, traceId, knowledgeRevision, policyVersion, resolverVersion } = context;
  const observationId = input.observationId;
  const attemptId = ID_PREFIX + digest([VERSION, userId, traceId, observationId, key]);
  // Serialized parsed inputs have a stable schema order. Wall clock time is not an
  // idempotency dimension: recovery requires a new request after a deferred receipt.
  return { accepted, scope: {
    attemptVersion: VERSION, attemptId, observationId,
    requestHash: digest([attemptId, input, accepted, knowledgeRevision, policyVersion, resolverVersion]),
  } };
}

/** No persistence occurs here. An opted-in caller may replay its saved receipt. */
export function reuseDeferredResolutionAttempt(
  saved: unknown, scope: AttemptScope, accepted: PriorSnapshot | null, context: AttemptContext,
): FoodResolutionAttempt {
  const parsed = foodResolutionAttemptSchema.safeParse(saved);
  if (!parsed.success || parsed.data.outcome !== "deferred" || accepted === null ||
      parsed.data.attemptId !== scope.attemptId || parsed.data.requestHash !== scope.requestHash ||
      parsed.data.observationId !== scope.observationId ||
      parsed.data.failure.ownerUserId !== context.userId ||
      parsed.data.failure.traceId !== context.traceId ||
      parsed.data.failure.knowledgeRevision !== context.knowledgeRevision ||
      parsed.data.failure.policyVersion !== context.policyVersion ||
      JSON.stringify(parsed.data.acceptedDecision) !== JSON.stringify(accepted)) {
    throw new TypeError("food-resolution-attempt-replay-conflict");
  }
  return parsed.data;
}

export function detachedFoodResolutionFailure(
  scope: AttemptScope, context: AttemptContext,
): FoodResolutionDecision {
  return foodResolutionDecisionSchema.parse({
    ...failedFields(), schemaVersion: FOOD_RESOLUTION_DECISION_SCHEMA_VERSION,
    decisionId: scope.attemptId, revision: 1, observationIds: [scope.observationId],
    ownerUserId: context.userId, traceId: context.traceId,
    knowledgeRevision: context.knowledgeRevision, policyVersion: context.policyVersion,
  });
}

export function deferredFoodResolutionAttempt(
  scope: AttemptScope, accepted: PriorSnapshot, context: AttemptContext,
): Extract<FoodResolutionAttempt, { outcome: "deferred" }> {
  return { ...scope, outcome: "deferred", acceptedDecision: accepted,
    failure: detachedFoodResolutionFailure(scope, context) };
}
