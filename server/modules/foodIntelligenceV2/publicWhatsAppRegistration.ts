/**
 * #1308: native D1 WhatsApp text/transcription route. No legacy nutrition,
 * WhatsApp parser, persistence reader or reply UI is imported by this module.
 * Its trusted channel owner supplies operation/lifecycle and rendering.
 */
import { createHash } from "node:crypto";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import type { WhatsappIntentResult } from "../whatsapp/intent/types";
import { governedLinguisticLexiconStore } from "./linguisticLexiconRepository";
import { createFoodV2KnowledgeRepository } from "./repository";
import type { FoodD1Request, FoodD1Dependencies } from "./entrypointMigration";
import { runFoodD1Migration } from "./entrypointRunner";
import { isCurrentFoodD1GateApproval, isFoodD1EntrypointCutoverRequested } from "./entrypointRouting";
import type { FoodOperationEnvelope } from "./schemas";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";
import type { FoodD1CommitResult } from "./entrypointPersistenceRepository";

export type TrustedD1WhatsAppModality = "text" | "audio_transcript";
export type PublicD1WhatsAppDependencies = {
  readAuthorizedContext: () => Promise<AuthorizedD1SimulationContext | null>;
  readActivePending: (userId: number, now: Date) => Promise<boolean>;
  /** Trust boundary: canonical MealOperation validated by authenticated channel, never client JSON. */
  readCanonicalOperation: (text: string, context: {
    referenceDate: Date; timeZone: string;
  }) => Promise<{ mealType: string; date: Date; itemCount: number }>;
  /** Channel-specific readback/presentation strictly after a native receipt is committed. */
  renderCommittedMeal: (input: {
    userId: number; mealId: number; registeredAt: Date; timeZone: string;
    skipped: FoodD1CommitResult["skipped"];
  }) => Promise<string>;
  lexicon?: FoodD1Dependencies["lexicon"];
  knowledge?: FoodD1Dependencies["knowledge"];
  run?: typeof runFoodD1Migration;
};

export function createFoodD1PublicWhatsAppRegistration(deps: PublicD1WhatsAppDependencies) {
  return async function tryRunFoodD1PublicWhatsAppRegistration(input: {
    userId: number; originalText: string; externalMessageId: string | null;
    modality: TrustedD1WhatsAppModality; receivedAt: Date; timeZone: string;
  }): Promise<WhatsappIntentResult | null> {
    if (!isFoodD1EntrypointCutoverRequested(input.modality)) return null;
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
    let activePending = false;
    try { activePending = await deps.readActivePending(input.userId, new Date()); }
    catch { throw new Error("food-d1-whatsapp-public-pending-state-unavailable"); }
    if (activePending) throw new Error("food-d1-whatsapp-public-legacy-pending-active");

    const operation = await deps.readCanonicalOperation(input.originalText, {
      referenceDate: input.receivedAt, timeZone: input.timeZone,
    });
    if (!operation || !operation.mealType?.trim() ||
        !(operation.date instanceof Date) || !Number.isFinite(operation.date.getTime()) ||
        !Number.isSafeInteger(operation.itemCount) || operation.itemCount <= 0) {
      throw new Error("food-d1-whatsapp-public-meal-operation-unresolved");
    }

    const digest = createHash("sha256").update(JSON.stringify([
      input.userId, input.externalMessageId.trim(),
    ])).digest("hex");
    const key = "d1-whatsapp-" + digest;
    const traceDigest = createHash("sha256").update(JSON.stringify([
      input.userId, input.externalMessageId.trim(), input.originalText,
    ])).digest("hex");
    const evidence = {
      kind: "surface" as const, modality: input.modality,
      rawText: input.originalText, sourceRef: "whatsapp:" + key,
    };
    const unavailable = {
      status: "unavailable" as const,
      reason: "whatsapp_operation_context_not_materialized", sourceRef: null,
    };
    const envelope: FoodOperationEnvelope = {
      schemaVersion: 2, traceId: "d1-trace-" + traceDigest,
      idempotencyKey: key, ownerUserId: input.userId,
      conversationRef: null, turnRef: null, effectiveTimeZone: input.timeZone,
      mealOperation: {
        action: "add", targetMeal: operation.mealType,
        date: getDateKeyInTimeZone(operation.date, input.timeZone),
      },
      contextSources: {
        previousMessage: { ...unavailable }, preferences: { ...unavailable },
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
        if (!plan.items.length || plan.readyCount === 0) {
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
    const skipped = response.skipped as FoodD1CommitResult["skipped"];
    const reply = await deps.renderCommittedMeal({
      userId: input.userId, mealId, registeredAt: operation.date,
      timeZone: input.timeZone, skipped,
    });
    if (!reply?.trim()) throw new Error("food-d1-whatsapp-public-committed-meal-unavailable");
    return {
      handled: true, action: "meal_item_added", reply,
      eventType: "whatsapp.meal_intent_decision.v2_registered",
      detail: "Refeição confirmada por recibo V2 transacional e lida novamente do banco.",
      data: { mealId, resolverVersion: "v2",
        skippedItemCount: skipped.length, originalTextPreserved: true },
    };
  };
}
