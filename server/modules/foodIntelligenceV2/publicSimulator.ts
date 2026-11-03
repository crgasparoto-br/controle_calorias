/**
 * #1308 / D1: the existing authenticated WhatsApp simulator's V2 boundary.
 * This is never a second nutrition resolver, a new endpoint or a meal writer.
 * No production approval provider exists before the post-deploy Gate A (#1335).
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { whatsappPendingOperations } from "../../../drizzle/schema";
import { getDb } from "../../db";
import type { SimulateWhatsappInboundInput } from "../whatsapp/schemas";
import { governedLinguisticLexiconStore } from "./linguisticLexiconRepository";
import { createFoodV2KnowledgeRepository } from "./repository";
import { type FoodD1Result, type FoodD1Dependencies } from "./entrypointMigration";
import { runFoodD1Migration } from "./entrypointRunner";
import {
  isCurrentFoodD1GateApproval, isFoodD1EntrypointCutoverRequested,
  type FoodD1GateApproval,
} from "./entrypointRouting";
import type { FoodOperationEnvelope } from "./schemas";
import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";

export type AuthorizedD1SimulationContext = {
  /** Independent Gate A and rollout evidence, tied to the exact running build. */
  approval: FoodD1GateApproval;
  expectedAuditedBaseSha: string;
  /** Trusted versioned snapshots; never generated from the user's message. */
  revisions: FoodOperationEnvelope["revisions"];
};

type D1SimulatorDependencies = {
  readAuthorizedContext: () => Promise<AuthorizedD1SimulationContext | null>;
  /** Lookup is durable and user-scoped, not only the process-local conversation Map. */
  readActivePending: (userId: number, now: Date) => Promise<boolean>;
  lexicon?: FoodD1Dependencies["lexicon"];
  knowledge?: FoodD1Dependencies["knowledge"];
};

/**
 * Until #1335 publishes an approved, versioned runtime authority, even a
 * misconfigured server flag must not run this simulated V2 path.
 */
const unavailableD1SimulatorContext: D1SimulatorDependencies = {
  readAuthorizedContext: async () => null,
  readActivePending: async (userId, now) => {
    const db = await getDb();
    if (!db) throw new Error("food-d1-public-simulator-pending-store-unavailable");
    const rows = await db.select({ id: whatsappPendingOperations.id })
      .from(whatsappPendingOperations)
      .where(and(eq(whatsappPendingOperations.userId, userId),
        eq(whatsappPendingOperations.state, "active"),
        gt(whatsappPendingOperations.expiresAt, now)))
      .limit(1);
    return rows.length !== 0;
  },
};

function operationKey(ownerUserId: number, messageId: string | undefined): string {
  // A replay with an external message ID reproduces the same opaque key, not
  // the message content. Without an ID, simulation has no durable operation.
  const stableId = messageId ?? randomUUID();
  return "d1-simulator-" + createHash("sha256")
    .update(JSON.stringify({ ownerUserId, stableId }))
    .digest("hex");
}

/**
 * Return null without touching the request when the rollout selector is OFF.
 * In the selected path, a missing/revoked approval stops before lexicon/DB/AI
 * and before any V1 simulator action; the V2 path is always read-only.
 */
export function createFoodD1PublicSimulator(deps: D1SimulatorDependencies) {
  return async function tryRunFoodD1Simulation(
    authenticatedUserId: number,
    input: SimulateWhatsappInboundInput,
  ): Promise<FoodD1Result | null> {
    if (!isFoodD1EntrypointCutoverRequested("simulator")) return null;
    // A reply to a pending interaction has no trusted prior decision in this
    // read-only simulator. Never reinterpret it as a fresh food observation.
    if (input.pendingContextKind !== undefined) {
      throw new Error("food-d1-public-simulator-pending-context-unsupported");
    }
    const context = await deps.readAuthorizedContext();
    if (!context || !isCurrentFoodD1GateApproval(
      context.approval, context.expectedAuditedBaseSha,
    ) || context.revisions.code !== context.expectedAuditedBaseSha) {
      throw new Error("food-d1-public-simulator-gate-unavailable");
    }
    if (!Number.isSafeInteger(authenticatedUserId) || authenticatedUserId <= 0 ||
        !input.text?.trim()) {
      throw new Error("food-d1-public-simulator-invalid-input");
    }
    const now = input.receivedAt ?? new Date();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
      throw new Error("food-d1-public-simulator-invalid-time");
    }
    // Fail closed on an active, durable V1 interaction even after a process restart.
    // A DB read failure is not evidence that the conversation has no pending reply.
    let hasPending = false;
    try { hasPending = await deps.readActivePending(authenticatedUserId, now); }
    catch { throw new Error("food-d1-public-simulator-pending-state-unavailable"); }
    if (hasPending) {
      throw new Error("food-d1-public-simulator-pending-context-unsupported");
    }
    const key = operationKey(authenticatedUserId, input.messageId);
    const evidence = {
      kind: "surface" as const,
      modality: "text" as const,
      rawText: input.text,
      sourceRef: "simulator:" + key,
    };
    const contextUnavailable = { status: "unavailable" as const,
      reason: "simulator_context_snapshot_unavailable", sourceRef: null };
    const envelope: FoodOperationEnvelope = {
      schemaVersion: 2,
      // Retries of one external message must not create a different trace.
      traceId: "d1-trace-" + key.slice("d1-simulator-".length),
      idempotencyKey: key,
      ownerUserId: authenticatedUserId,
      conversationRef: null,
      turnRef: null,
      effectiveTimeZone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
      // The simulator does not infer a destination/operation from food text.
      mealOperation: null,
      contextSources: {
        previousMessage: { ...contextUnavailable },
        preferences: { ...contextUnavailable },
        recentHistory: { ...contextUnavailable },
      },
      revisions: { ...context.revisions },
    };
    const request = { authenticatedUserId, entrypoint: "simulator" as const,
      envelope, evidence, now };
    const plan = await runFoodD1Migration({
      request,
      source: "whatsapp", occurredAt: now,
      dependencies: {
        lexicon: deps.lexicon ?? governedLinguisticLexiconStore,
        knowledge: deps.knowledge ?? createFoodV2KnowledgeRepository(),
        authorizeEvidence: async ({ ownerUserId, entrypoint, evidence: submitted }) =>
          ownerUserId === authenticatedUserId && entrypoint === request.entrypoint &&
          submitted.kind === evidence.kind && "rawText" in submitted &&
          "modality" in submitted && submitted.modality === evidence.modality &&
          submitted.sourceRef === evidence.sourceRef && submitted.rawText === evidence.rawText,
        authorizeExistingItem: async () => false,
      },
      legacy: async () => {
        // A concurrent rollback must never run the legacy simulator a second time.
        throw new Error("food-d1-public-simulator-paused-by-rollback");
      },
      expectedAuditedBaseSha: context.expectedAuditedBaseSha,
      verifyGates: async () => (await deps.readAuthorizedContext())?.approval ?? null,
    });
    if (plan && typeof plan === "object" && "schemaVersion" in plan &&
        plan.schemaVersion === 2 && "entrypoint" in plan &&
        plan.entrypoint === "simulator" && "committed" in plan &&
        plan.committed === false) {
      return plan as FoodD1Result;
    }
    throw new Error("food-d1-public-simulator-invalid-result");
  };
}

export const tryRunPublicFoodD1Simulation =
  createFoodD1PublicSimulator(unavailableD1SimulatorContext);
