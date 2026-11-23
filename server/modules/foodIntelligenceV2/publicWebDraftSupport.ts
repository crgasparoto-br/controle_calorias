/** #1308 D1 web draft composition primitives; no provider or DB calls. */
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import type { FoodD1WebDraftItem } from "../../../shared/foodD1WebDraft";
import type { FoodOperationEnvelope } from "./schemas";
import type { FoodD1ContextSources } from "./publicContextSources";
import type {
  FoodD1Dependencies, FoodD1Entrypoint, FoodD1Request, FoodD1Result,
} from "./entrypointMigration";
import type { LinguisticLexiconStore } from "./linguisticComprehension";

export function buildEnvelope(input: {
  userId: number;
  operationKey: string;
  traceId: string;
  mealLabel: string;
  occurredAt: Date;
  timeZone: string;
  entrypoint: FoodD1Entrypoint;
  revisions: FoodOperationEnvelope["revisions"];
  contextSources: FoodD1ContextSources;
}): FoodOperationEnvelope {
  return {
    schemaVersion: 2,
    traceId: input.traceId,
    idempotencyKey: input.operationKey,
    ownerUserId: input.userId,
    conversationRef: null,
    turnRef: null,
    effectiveTimeZone: input.timeZone,
    mealOperation: {
      action: "add",
      targetMeal: input.mealLabel,
      date: getDateKeyInTimeZone(input.occurredAt, input.timeZone),
    },
    contextSources: input.contextSources,
    revisions: { ...input.revisions },
  };
}

export function toReviewItem(item: FoodD1Result["items"][number]): FoodD1WebDraftItem {
  const decision = item.decision;
  const consumed = decision.nutrition.verified ? decision.nutrition.consumed : null;
  return {
    observationId: item.observationId,
    foodName: decision.identity.canonicalName ?? decision.alternatives[0]?.name ?? "",
    quantity: decision.quantity.value,
    unit: decision.quantity.unit,
    disposition: item.disposition,
    reasonCodes: [...item.reasonCodes],
    nutrition: {
      verified: consumed !== null,
      calories: consumed?.calories ?? null,
      protein: consumed?.protein ?? null,
      carbs: consumed?.carbs ?? null,
      fat: consumed?.fat ?? null,
    },
  };
}

export function buildDependencies(input: {
  userId: number;
  entrypoint: FoodD1Entrypoint;
  evidence: FoodD1Request["evidence"];
  lexicon: LinguisticLexiconStore;
  knowledge: FoodD1Dependencies["knowledge"];
}): FoodD1Dependencies {
  return {
    lexicon: input.lexicon,
    knowledge: input.knowledge,
    authorizeEvidence: async request =>
      request.ownerUserId === input.userId &&
      request.entrypoint === input.entrypoint &&
      request.evidence === input.evidence,
    authorizeExistingItem: async () => false,
  };
}


