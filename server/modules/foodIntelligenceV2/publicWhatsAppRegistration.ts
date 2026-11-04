/**
 * #1308: authenticated, provenance-bound WhatsApp text/transcription entrypoint.
 * Unlike a V1 draft this commits a native V2 decision without reinterpreting
 * or serializing it through the legacy nutrition engine.
 *
 * Only the trusted message-lifecycle boundary can select the modality. No
 * production Gate A provider is installed before #1335.
 */
import { createHash } from "node:crypto";
import { listUserMeals } from "../../db";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import { parseMealCommandFromWhatsApp } from "../whatsapp/mealCommandParser";
import { buildWhatsAppPartialRegistrationWarning,
  buildWhatsAppRegisteredPersistedMealReplyMessage } from "../whatsapp/replyMessages";
import type { WhatsappIntentResult } from "../whatsapp/intent/types";
import { hasActiveWhatsappPendingInDb,
  type AuthorizedD1SimulationContext } from "./publicSimulator";
import { governedLinguisticLexiconStore } from "./linguisticLexiconRepository";
import { createFoodV2KnowledgeRepository } from "./repository";
import type { FoodD1Request, FoodD1Dependencies } from "./entrypointMigration";
import { runFoodD1Migration } from "./entrypointRunner";
import { isCurrentFoodD1GateApproval, isFoodD1EntrypointCutoverRequested } from "./entrypointRouting";
import type { FoodOperationEnvelope } from "./schemas";

export type TrustedD1WhatsAppModality = "text" | "audio_transcript";
type PersistedMeal = Awaited<ReturnType<typeof listUserMeals>>[number];
type RegistrationDependencies = {
  readAuthorizedContext: () => Promise<AuthorizedD1SimulationContext | null>;
  readActivePending: (userId: number, now: Date) => Promise<boolean>;
  parseOperation?: typeof parseMealCommandFromWhatsApp;
  readMeal?: (userId: number, mealId: number) => Promise<PersistedMeal | null>;
  lexicon?: FoodD1Dependencies["lexicon"];
  knowledge?: FoodD1Dependencies["knowledge"];
  run?: typeof runFoodD1Migration;
};

const unavailableRegistrationDependencies: RegistrationDependencies = {
  readAuthorizedContext: async () => null,
  readActivePending: hasActiveWhatsappPendingInDb,
};

export function createFoodD1PublicWhatsAppRegistration(deps: RegistrationDependencies) {
  return async function tryRunFoodD1PublicWhatsAppRegistration(input: {
    userId: number;
    originalText: string;
    /** The lifecycle's authenticated external message ID, never a generated nonce. */
    externalMessageId: string | null;
    modality: TrustedD1WhatsAppModality;
    receivedAt: Date;
    timeZone: string;
  }): Promise<WhatsappIntentResult | null> {
    if (!isFoodD1EntrypointCutoverRequested(input.modality)) return null;

    // Gate A must be checked before a parser, database or AI is consulted.
    const context = await deps.readAuthorizedContext();
    if (!context || !isCurrentFoodD1GateApproval(
      context.approval, context.expectedAuditedBaseSha,
    ) || context.revisions.code !== context.expectedAuditedBaseSha) {
      throw new Error("food-d1-whatsapp-public-gate-unavailable");
    }
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0 ||
        !input.originalText?.trim() || !input.externalMessageId?.trim() ||
        !(input.receivedAt instanceof Date) || !Number.isFinite(input.receivedAt.getTime()) ||
        !input.timeZone?.trim()) {
      throw new Error("food-d1-whatsapp-public-stable-message-required");
    }
    // A V1 pending interaction belongs to its own versioned handler. This
    // query survives restart and cannot be replaced by an in-memory heuristic.
    let activePending = false;
    try { activePending = await deps.readActivePending(input.userId, new Date()); }
    catch { throw new Error("food-d1-whatsapp-public-pending-state-unavailable"); }
    if (activePending) throw new Error("food-d1-whatsapp-public-legacy-pending-active");

    // Use the existing canonical WhatsApp *operation* parser. Never ask the
    // legacy nutrition engine to identify food, servings or calories.
    const operation = (deps.parseOperation ?? parseMealCommandFromWhatsApp)(
      input.originalText, { referenceDate: input.receivedAt, timeZone: input.timeZone },
    );
    if (operation.intent !== "add_items_to_meal" || !operation.mealType?.trim() ||
        !(operation.date instanceof Date) || !Number.isFinite(operation.date.getTime()) ||
        !operation.items.length || operation.missingFields.length ||
        operation.items.some(item => !item.foodName?.trim() ||
          item.quantity === null || !Number.isFinite(item.quantity) || item.quantity <= 0 ||
          !item.unit?.trim())) {
      throw new Error("food-d1-whatsapp-public-meal-operation-unresolved");
    }

    // One idempotency key for an inbound message, independent of modality:
    // changing the modality on a retry must not create a second meal.
    const digest = createHash("sha256").update(JSON.stringify([
      input.userId, input.externalMessageId.trim(),
    ])).digest("hex");
    const key = "d1-whatsapp-" + digest;
    // The external ID owns one immutable message payload. A replay with the
    // same ID but altered text must change the operation scope, not silently
    // return the receipt of an unrelated or rewritten food observation.
    const traceDigest = createHash("sha256").update(JSON.stringify([
      input.userId, input.externalMessageId.trim(), input.originalText,
    ])).digest("hex");
    const evidence = {
      kind: "surface" as const,
      modality: input.modality,
      rawText: input.originalText,
      sourceRef: "whatsapp:" + key,
    };
    const unavailable = {
      status: "unavailable" as const,
      reason: "whatsapp_operation_context_not_materialized",
      sourceRef: null,
    };
    const envelope: FoodOperationEnvelope = {
      schemaVersion: 2, traceId: "d1-trace-" + traceDigest,
      idempotencyKey: key, ownerUserId: input.userId,
      conversationRef: null, turnRef: null,
      effectiveTimeZone: input.timeZone,
      mealOperation: {
        action: "add", targetMeal: operation.mealType,
        date: getDateKeyInTimeZone(operation.date, input.timeZone),
      },
      contextSources: {
        previousMessage: { ...unavailable },
        preferences: { ...unavailable },
        recentHistory: { ...unavailable },
      },
      revisions: { ...context.revisions },
    };
    const request: FoodD1Request = {
      authenticatedUserId: input.userId, entrypoint: input.modality,
      envelope, evidence, now: input.receivedAt,
    };
    const response = await (deps.run ?? runFoodD1Migration)({
      request, source: "whatsapp", occurredAt: operation.date,
      dependencies: {
        lexicon: deps.lexicon ?? governedLinguisticLexiconStore,
        knowledge: deps.knowledge ?? createFoodV2KnowledgeRepository(),
        authorizeEvidence: async candidate => candidate.ownerUserId === input.userId &&
          candidate.entrypoint === input.modality && candidate.evidence === evidence,
        authorizeExistingItem: async () => false,
      },
      legacy: async () => {
        throw new Error("food-d1-whatsapp-public-cannot-replay-v1");
      },
      expectedAuditedBaseSha: context.expectedAuditedBaseSha,
      verifyGates: async () => (await deps.readAuthorizedContext())?.approval ?? null,
      beforeCommit: plan => {
        if (plan.items.length === 0 || plan.readyCount === 0) {
          throw new Error("food-d1-whatsapp-public-needs-clarification");
        }
      },
    });
    if (!response || typeof response !== "object" ||
        !("committed" in response) || response.committed !== true ||
        !("mealId" in response) || typeof response.mealId !== "number" ||
        !Number.isSafeInteger(response.mealId) || response.mealId <= 0 ||
        !("skipped" in response) || !Array.isArray(response.skipped)) {
      throw new Error("food-d1-whatsapp-public-commit-unavailable");
    }

    const mealId = response.mealId;
    const meal = await (deps.readMeal ??
      (async (userId, id) => (await listUserMeals(userId)).find(meal =>
        meal.id === id && meal.userId === userId) ?? null))(input.userId, mealId);
    if (!meal || meal.userId !== input.userId || meal.id !== mealId ||
        !meal.items?.length) {
      throw new Error("food-d1-whatsapp-public-committed-meal-unavailable");
    }
    const skipped = response.skipped as Array<{ observationId: string }>;
    const rendered = buildWhatsAppRegisteredPersistedMealReplyMessage(meal, {
      registeredAt: operation.date, timeZone: input.timeZone,
    });
    const warning = skipped.length
      ? buildWhatsAppPartialRegistrationWarning(skipped.map((_item, index) => ({
          segment: "Item " + (index + 1),
          reason: "Identidade, medida ou fonte nutricional ainda não confirmada.",
        })))
      : null;
    return {
      handled: true,
      action: "meal_item_added",
      reply: warning ? rendered + "\n\n" + warning : rendered,
      eventType: "whatsapp.meal_intent_decision.v2_registered",
      detail: "Refeição confirmada por recibo V2 transacional e lida novamente do banco.",
      data: { mealId, resolverVersion: "v2", skippedItemCount: skipped.length,
        originalTextPreserved: true },
    };
  };
}

export const tryRunPublicFoodD1WhatsAppRegistration =
  createFoodD1PublicWhatsAppRegistration(unavailableRegistrationDependencies);
