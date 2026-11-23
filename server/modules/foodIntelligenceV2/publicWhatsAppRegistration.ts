/**
 * #1308: native D1 WhatsApp text/transcription route. No legacy nutrition,
 * WhatsApp parser, persistence reader or reply UI is imported by this module.
 * Its trusted channel owner supplies operation/lifecycle and rendering.
 */
import { createHash } from "node:crypto";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import type { WhatsappIntentResult } from "../whatsapp/intent/types";
import {
  FoodD1NeedsClarificationError,
  type FoodD1Request,
  type FoodD1Dependencies,
  type FoodD1Result,
} from "./entrypointMigration";
import { comprehendFoodLanguage } from "./linguisticComprehension";
import { sanitizeD1WhatsAppObservations, type FoodD1WhatsAppPending } from "./publicWhatsAppPendingContract";
import type { runFoodD1Migration } from "./entrypointRunner";
import { isCurrentFoodD1GateApproval, isFoodD1EntrypointCutoverRequested } from "./entrypointRouting";
import type { FoodOperationEnvelope } from "./schemas";
import { readFoodD1PublicContextSources } from "./publicContextSources";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";
import type { FoodD1CommitResult } from "./entrypointPersistenceRepository";

export type TrustedD1WhatsAppModality = "text" | "audio_transcript";
export type PublicD1WhatsAppDependencies = {
  readAuthorizedContext: () => Promise<AuthorizedD1SimulationContext | null>;
  readContextSources?: typeof readFoodD1PublicContextSources;
  readActivePending: (userId: number, now: Date) => Promise<boolean>;
  /** Trust boundary: canonical MealOperation validated by authenticated channel, never client JSON. */
  readCanonicalOperation: (text: string, context: {
    referenceDate: Date; timeZone: string;
  }) => Promise<{ mealType: string; date: Date; itemCount: number }>;
  /** Channel-specific readback/presentation strictly after a native receipt is committed. */
  renderCommittedMeal: (input: {
    userId: number; mealId: number; registeredAt: Date; timeZone: string;
    skipped: FoodD1CommitResult["skipped"];
    recordedItemIds: readonly number[];
  }) => Promise<string>;
  /** Trusted transport owner supplies providers; never import V1 or DB here. */
  lexicon: FoodD1Dependencies["lexicon"];
  knowledge: FoodD1Dependencies["knowledge"];
  run: typeof runFoodD1Migration;
  stagePending?: (data: FoodD1WhatsAppPending) => Promise<unknown>;
  comprehend?: typeof comprehendFoodLanguage;
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
    const contextSources = await (deps.readContextSources ?? readFoodD1PublicContextSources)({
      ownerUserId: input.userId, source: "whatsapp", at: input.receivedAt,
      externalMessageId: input.externalMessageId,
    });
    const envelope: FoodOperationEnvelope = {
      schemaVersion: 2, traceId: "d1-trace-" + traceDigest,
      idempotencyKey: key, ownerUserId: input.userId,
      conversationRef: null, turnRef: null, effectiveTimeZone: input.timeZone,
      mealOperation: {
        action: "add", targetMeal: operation.mealType,
        date: getDateKeyInTimeZone(operation.date, input.timeZone),
      },
      contextSources,
      revisions: { ...context.revisions },
    };
    const request: FoodD1Request = {
      authenticatedUserId: input.userId, entrypoint: input.modality,
      envelope, evidence, now: input.receivedAt,
    };
    let incomplete: FoodD1Result | null = null;
    let response: Awaited<ReturnType<typeof deps.run>>;
    try {
    response = await deps.run({
      request, source: "whatsapp", occurredAt: operation.date,
      dependencies: {
        lexicon: deps.lexicon,
        knowledge: deps.knowledge,
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
        incomplete = plan;
        if (plan.items.length !== operation.itemCount ||
            plan.readyCount !== operation.itemCount ||
            plan.items.some(item => item.disposition !== "ready")) {
          throw new FoodD1NeedsClarificationError(
            "food-d1-whatsapp-public-needs-clarification",
          );
        }
      },
    });
    } catch (error) {
      if (!(error instanceof FoodD1NeedsClarificationError) ||
          !incomplete || !deps.stagePending) throw error;
      const plan: FoodD1Result = incomplete;
      if (plan.items.length !== operation.itemCount) {
        throw new Error("food-d1-whatsapp-public-observation-manifest-mismatch");
      }
      const original = await (deps.comprehend ?? comprehendFoodLanguage)({
        rawText: input.originalText, sourceRef: evidence.sourceRef,
        modality: input.modality, ownerUserId: input.userId,
        lexiconRevision: context.revisions.lexicon, locale: "pt-BR",
        now: input.receivedAt,
      }, deps.lexicon);
      if (original.length !== plan.items.length ||
          original.some((item, index) => item.observationId !== plan.items[index].observationId)) {
        throw new Error("food-d1-whatsapp-public-observation-manifest-mismatch");
      }
      const unresolvedIds = plan.items.filter(item =>
        item.disposition !== "ready").map(item => item.observationId);
      if (!unresolvedIds.length) throw error;
      await deps.stagePending({
        schemaVersion: 2, envelope, originEntrypoint: input.modality,
        occurredAt: operation.date.toISOString(),
        observations: sanitizeD1WhatsAppObservations(original),
        decisions: plan.items.map(item => item.decision), unresolvedIds,
      });
      const next = plan.items.find(item => item.observationId === unresolvedIds[0]);
      const label = next?.decision.identity.canonicalName ?? "o alimento indicado";
      return {
        handled: true, action: "food_clarification_requested",
        reply: `Preciso confirmar a identidade ou quantidade de ${label}. Responda nesta conversa com a informação faltante; a refeição só será registrada quando todos os itens estiverem resolvidos.`,
        eventType: "whatsapp.food_d1.pending_created",
        detail: "Lote V2 incompleto preservado em pendência transacional, sem registro parcial.",
        data: { resolverVersion: "v2", pending: true },
      };
    }
    if (!response || typeof response !== "object" ||
        !("committed" in response) || response.committed !== true ||
        !("mealId" in response) || typeof response.mealId !== "number" ||
        !Number.isSafeInteger(response.mealId) || response.mealId <= 0 ||
        !("skipped" in response) || !Array.isArray(response.skipped)) {
      throw new Error("food-d1-whatsapp-public-commit-unavailable");
    }
    // A committed flag alone cannot certify that the operation's complete
    // observation manifest was persisted. A partial or corrupt receipt must
    // never be presented as a complete registered meal.
    const receipt = response as FoodD1CommitResult;
    if (!Array.isArray(receipt.recordedItemIds) ||
        receipt.recordedItemIds.length !== operation.itemCount ||
        receipt.recordedItemIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
        new Set(receipt.recordedItemIds).size !== operation.itemCount ||
        receipt.skipped.length !== 0) {
      throw new Error("food-d1-whatsapp-public-commit-incomplete");
    }
    const mealId = receipt.mealId!;
    const skipped = receipt.skipped;
    const reply = await deps.renderCommittedMeal({
      userId: input.userId, mealId, registeredAt: operation.date,
      timeZone: input.timeZone, skipped,
      recordedItemIds: receipt.recordedItemIds,
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
