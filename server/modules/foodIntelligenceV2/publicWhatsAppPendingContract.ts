/** D1 durable WhatsApp continuation contract: sanitized facts and an immutable envelope. */
import { z } from "zod";
import { foodObservationSchema } from "./observationSchemas";
import { foodResolutionDecisionSchema } from "./decisionSchemas";
import { foodOperationEnvelopeSchema } from "./schemas";
import type { FoodObservation, FoodResolutionDecision, FoodOperationEnvelope } from "./schemas";

export const FOOD_D1_WHATSAPP_PENDING_TYPE = "food_d1_clarification";
export const FOOD_D1_WHATSAPP_PENDING_ORIGIN = "FoodIntelligenceV2";
export const FOOD_D1_WHATSAPP_PENDING_TTL_MS = 30 * 60 * 1000;

const storedObservation = foodObservationSchema.refine(item =>
  item.rawInput === null && item.normalizedInput === null,
);
const storedDecision = foodResolutionDecisionSchema;
const pendingSchema = z.strictObject({
  schemaVersion: z.literal(2),
  envelope: foodOperationEnvelopeSchema,
  originEntrypoint: z.enum([
    "text", "audio_transcript", "multimodal", "plate_image", "packaging",
  ]),
  occurredAt: z.string().datetime({ offset: true }),
  observations: z.array(storedObservation).min(1).max(80),
  decisions: z.array(storedDecision).min(1).max(80),
  unresolvedIds: z.array(z.string().min(1).max(200)).min(1).max(80),
}).superRefine((v, ctx) => {
  const ids = v.observations.map(item => item.observationId);
  const expected = new Set(ids);
  if (expected.size !== ids.length ||
      v.decisions.length !== ids.length ||
      v.decisions.some((d, i) =>
        d.ownerUserId !== v.envelope.ownerUserId ||
        d.traceId !== v.envelope.traceId ||
        !d.observationIds.includes(ids[i])) ||
      v.unresolvedIds.some(id => !expected.has(id)) ||
      new Set(v.unresolvedIds).size !== v.unresolvedIds.length ||
      !v.envelope.mealOperation ||
      v.envelope.mealOperation.action !== "add") {
    ctx.addIssue({ code: "custom", message: "food-d1-whatsapp-pending-scope-inconsistent" });
  }
});

export type FoodD1WhatsAppPending = {
  schemaVersion: 2;
  envelope: FoodOperationEnvelope;
  originEntrypoint: "text" | "audio_transcript" | "multimodal" | "plate_image" | "packaging";
  occurredAt: string;
  observations: FoodObservation[];
  decisions: FoodResolutionDecision[];
  unresolvedIds: string[];
};

export function parseFoodD1WhatsAppPending(value: unknown): FoodD1WhatsAppPending {
  const parsed = pendingSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("food-d1-whatsapp-pending-state-invalid");
  }
  return parsed.data;
}

/** Save facts, not conversational text or provider payloads. */
export function sanitizeD1WhatsAppObservations(
  items: readonly FoodObservation[],
): FoodObservation[] {
  return items.map(item => ({
    ...item, rawInput: null, normalizedInput: null,
  }));
}

/** Original evidence is immutable. A reply may fill missing facts but cannot
 * silently replace an already observed identity/quantity or erase siblings.
 */
export function mergeD1WhatsAppReply(
  stored: FoodObservation, reply: FoodObservation, turnRef: string,
): FoodObservation {
  if (!turnRef || !/^[a-z0-9:_-]{8,160}$/i.test(turnRef)) {
    throw new Error("food-d1-whatsapp-continuation-turn-required");
  }
  const sameOrMissing = (before: string | number | null, next: string | number | null) =>
    next === null || before === null || before === next;
  const s = stored.identityHints, r = reply.identityHints;
  const q = stored.quantityHints, p = reply.quantityHints;
  if (!sameOrMissing(s.foodName, r.foodName) ||
      !sameOrMissing(s.brand, r.brand) ||
      !sameOrMissing(s.variant, r.variant) ||
      !sameOrMissing(s.barcode, r.barcode) ||
      !sameOrMissing(q.value, p.value) ||
      !sameOrMissing(q.unit, p.unit) ||
      !sameOrMissing(q.servingText, p.servingText)) {
    throw new Error("food-d1-whatsapp-continuation-material-conflict");
  }
  if (reply.alternatives.length ||
      (reply.identityHints.qualifiers.length &&
       JSON.stringify(reply.identityHints.qualifiers) !== JSON.stringify(s.qualifiers))) {
    throw new Error("food-d1-whatsapp-continuation-ambiguous-attribute");
  }
  const evidence = reply.evidence.map((item, i) => ({
    ...item, evidenceId: turnRef + ":e:" + i,
  }));
  const merged: FoodObservation = {
    ...stored,
    identityHints: {
      ...s, foodName: s.foodName ?? r.foodName, brand: s.brand ?? r.brand,
      variant: s.variant ?? r.variant, barcode: s.barcode ?? r.barcode,
    },
    quantityHints: {
      ...q, value: q.value ?? p.value, unit: q.unit ?? p.unit,
      servingText: q.servingText ?? p.servingText,
      visiblePackageQuantity: q.visiblePackageQuantity ?? p.visiblePackageQuantity,
      visiblePackageUnit: q.visiblePackageUnit ?? p.visiblePackageUnit,
    },
    evidence: [...stored.evidence, ...evidence],
    normalizationPath: [...stored.normalizationPath, ...reply.normalizationPath],
    rawInput: null, normalizedInput: null,
  };
  const checked = foodObservationSchema.safeParse(merged);
  if (!checked.success) throw new Error("food-d1-whatsapp-continuation-observation-invalid");
  return checked.data;
}
