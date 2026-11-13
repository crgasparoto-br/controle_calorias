/** #1308: version-pinned WhatsApp follow-up; never re-parse the first turn. */
import { createHash } from "node:crypto";
import type { WhatsappIntentResult } from "../whatsapp/intent/types";
import { comprehendFoodLanguage } from "./linguisticComprehension";
import { isCurrentFoodD1GateApproval, isFoodD1EntrypointCutoverRequested } from "./entrypointRouting";
import { mergeD1WhatsAppReply, sanitizeD1WhatsAppObservations } from "./publicWhatsAppPendingContract";
import type { FoodD1WhatsAppPending } from "./publicWhatsAppPendingContract";
import type { FoodD1WhatsAppPendingRecord } from "./publicWhatsAppPendingRepository";
import {
  FoodD1NeedsClarificationError,
  type FoodD1Dependencies,
  type FoodD1Request,
  type FoodD1Result,
} from "./entrypointMigration";
import type { runFoodD1Migration } from "./entrypointRunner";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";
import type { FoodD1CommitResult } from "./entrypointPersistenceRepository";
import { FOOD_TEXT_INPUT_TYPE, haveEqualFoodEnvelopeRevisions } from "./contracts";

export type FoodD1WhatsAppContinuationDependencies = {
  readPending: (userId: number, now: Date) =>
    Promise<FoodD1WhatsAppPendingRecord | null>;
  updatePending: (before: FoodD1WhatsAppPendingRecord, next: FoodD1WhatsAppPending,
    userId: number) => Promise<FoodD1WhatsAppPendingRecord>;
  consumePending: (before: FoodD1WhatsAppPendingRecord, userId: number) => Promise<void>;
  readAuthorizedContext: () => Promise<AuthorizedD1SimulationContext | null>;
  comprehend: typeof comprehendFoodLanguage;
  lexicon: FoodD1Dependencies["lexicon"];
  knowledge: FoodD1Dependencies["knowledge"];
  run: typeof runFoodD1Migration;
  /** Pin this inbound message before a new physical item effect. */
  pinInbound?: (input: {
    ownerUserId: number; externalMessageId: string; envelope: FoodD1WhatsAppPending["envelope"];
  }) => Promise<void>;
  renderCommittedMeal: (input: {
    userId: number; mealId: number; registeredAt: Date; timeZone: string;
    skipped: FoodD1CommitResult["skipped"];
    recordedItemIds: readonly number[];
  }) => Promise<string>;
};

export function createFoodD1WhatsAppContinuation(
  deps: FoodD1WhatsAppContinuationDependencies,
) {
  return async (input: {
    userId: number; replyText: string | null | undefined;
    externalMessageId: string | null; receivedAt: Date;
    timeZone: string;
  }): Promise<WhatsappIntentResult | null> => {
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
      throw new Error("food-d1-whatsapp-continuation-owner-invalid");
    }
    const pending = await deps.readPending(input.userId, new Date());
    if (!pending) return null;
    const current = pending.target;
    const env = current.envelope;
    if (!isFoodD1EntrypointCutoverRequested(current.originEntrypoint)) {
      throw new Error("food-d1-operation-paused-by-rollback");
    }
    const context = await deps.readAuthorizedContext();
    if (!context || !isCurrentFoodD1GateApproval(
      context.approval, context.expectedAuditedBaseSha,
    ) || context.revisions.code !== context.expectedAuditedBaseSha ||
        !haveEqualFoodEnvelopeRevisions(context.revisions, env.revisions)) {
      throw new Error("food-d1-whatsapp-continuation-gate-or-version-unavailable");
    }
    if (!input.externalMessageId?.trim() ||
        !(input.receivedAt instanceof Date) || !Number.isFinite(input.receivedAt.getTime()) ||
        input.timeZone !== env.effectiveTimeZone ||
        input.userId !== env.ownerUserId ||
        !env.mealOperation) {
      throw new Error("food-d1-whatsapp-continuation-scope-mismatch");
    }
    if (!input.replyText?.trim()) {
      return {
        handled: true, action: "food_clarification_reprompted",
        reply: "Aguardo uma resposta em texto à pergunta anterior. Não registrei novos alimentos.",
        eventType: "whatsapp.food_d1.awaiting_text",
        detail: "Pendência V2 preservada até receber esclarecimento textual.",
      };
    }
    const digest = createHash("sha256").update(JSON.stringify([
      input.userId, input.externalMessageId.trim(),
    ])).digest("hex");
    const ref = "d1-turn-" + digest;
    const interpreted = await deps.comprehend({
      rawText: input.replyText, sourceRef: ref, modality: FOOD_TEXT_INPUT_TYPE,
      ownerUserId: input.userId, lexiconRevision: env.revisions.lexicon,
      locale: "pt-BR", now: input.receivedAt,
    }, deps.lexicon);
    // One answer may complete one pending sibling. Never use a guessed order
    // to assign multiple new foods or a second meal to an existing operation.
    if (interpreted.length !== 1 || current.unresolvedIds.length === 0) {
      throw new Error("food-d1-whatsapp-continuation-ambiguous-reply");
    }
    const targetId = current.unresolvedIds[0];
    const index = current.observations.findIndex(item => item.observationId === targetId);
    if (index < 0) throw new Error("food-d1-whatsapp-continuation-target-missing");
    const nextObservations = current.observations.map((item, i) =>
      i === index ? mergeD1WhatsAppReply(item, interpreted[0], ref) : item);
    const evidence = {
      kind: "structured" as const, observations: nextObservations,
    };
    const request: FoodD1Request = {
      authenticatedUserId: input.userId,
      entrypoint: "continuation",
      envelope: env, evidence,
      targets: current.observations.map((item, i) => ({
        observationId: item.observationId, mealItemId: null,
        previousDecision: current.decisions[i],
      })),
      now: input.receivedAt,
    };
    // Fenced even if the final reply fails to reach the user: a redelivery
    // cannot become a second legacy meal after the original D1 batch commits.
    await deps.pinInbound?.({
      ownerUserId: input.userId,
      externalMessageId: input.externalMessageId.trim(),
      envelope: env,
    });
    let incomplete: FoodD1Result | null = null;
    let outcome: Awaited<ReturnType<typeof deps.run>>;
    try {
      outcome = await deps.run({
        request, source: "whatsapp",
        occurredAt: new Date(current.occurredAt),
        dependencies: {
          lexicon: deps.lexicon, knowledge: deps.knowledge,
          authorizeEvidence: async candidate =>
            candidate.ownerUserId === input.userId &&
            candidate.entrypoint === "continuation" &&
            candidate.evidence === evidence,
          authorizeExistingItem: async () => false,
        },
        legacy: async () => {
          throw new Error("food-d1-whatsapp-continuation-no-v1-replay");
        },
        expectedAuditedBaseSha: context.expectedAuditedBaseSha,
        verifyGates: async () => (await deps.readAuthorizedContext())?.approval ?? null,
        beforeCommit: plan => {
          incomplete = plan;
          if (plan.items.length !== current.observations.length ||
              plan.items.some((item, i) =>
                item.observationId !== current.observations[i].observationId) ||
              plan.items.some(item => item.disposition !== "ready")) {
            throw new FoodD1NeedsClarificationError(
              "food-d1-whatsapp-continuation-needs-clarification",
            );
          }
        },
      });
    } catch (error) {
      if (!(error instanceof FoodD1NeedsClarificationError) ||
          !incomplete) throw error;
      const plan: FoodD1Result = incomplete;
      if (plan.items.length !== current.observations.length ||
          plan.items.some((item, i) => item.observationId !== current.observations[i].observationId)) {
        throw new Error("food-d1-whatsapp-continuation-observation-manifest-changed");
      }
      const unresolvedIds = plan.items.filter(item => item.disposition !== "ready")
        .map(item => item.observationId);
      if (!unresolvedIds.length) throw error;
      const updated = await deps.updatePending(pending, {
        ...current,
        observations: sanitizeD1WhatsAppObservations(nextObservations),
        decisions: plan.items.map(item => item.decision),
        unresolvedIds,
      }, input.userId);
      const wanted = plan.items.find(item => item.observationId === unresolvedIds[0]);
      const label = wanted?.decision?.identity?.canonicalName ?? "o alimento pendente";
      return {
        handled: true, action: "food_clarification_reprompted",
        reply: `Ainda preciso confirmar ${label}. A resposta anterior foi preservada; nenhum item foi registrado parcialmente.`,
        eventType: "whatsapp.food_d1.pending_updated",
        detail: "Retomada V2 com revisão durável e conjunto de irmãos imutável.",
        data: { pending: true, revision: updated.version, resolverVersion: "v2" },
      };
    }
    if (!outcome || typeof outcome !== "object" ||
        !("committed" in outcome) || outcome.committed !== true ||
        !("recordedItemIds" in outcome) || !Array.isArray(outcome.recordedItemIds) ||
        outcome.recordedItemIds.length !== current.observations.length ||
        new Set(outcome.recordedItemIds).size !== current.observations.length ||
        !("skipped" in outcome) || !Array.isArray(outcome.skipped) ||
        outcome.skipped.length !== 0 ||
        !("mealId" in outcome) || typeof outcome.mealId !== "number" ||
        !Number.isSafeInteger(outcome.mealId) || outcome.mealId <= 0) {
      throw new Error("food-d1-whatsapp-continuation-commit-incomplete");
    }
    const receipt = outcome as FoodD1CommitResult;
    await deps.consumePending(pending, input.userId);
    const reply = await deps.renderCommittedMeal({
      userId: input.userId, mealId: receipt.mealId!,
      registeredAt: new Date(current.occurredAt), timeZone: input.timeZone,
      skipped: receipt.skipped, recordedItemIds: receipt.recordedItemIds,
    });
    if (!reply?.trim()) throw new Error("food-d1-whatsapp-continuation-readback-unavailable");
    return {
      handled: true, action: "food_clarification_completed",
      reply, eventType: "whatsapp.food_d1.continuation_completed",
      detail: "Lote original confirmado por recibo V2, sem duplicar refeição.",
      data: { mealId: receipt.mealId, resolverVersion: "v2", pending: false },
    };
  };
}
