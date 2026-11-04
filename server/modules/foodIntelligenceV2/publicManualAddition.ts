/** #1308: authenticated manual-addition boundary for native V2 writes.
 * V1 remains the owner until independently approved Gate A/rollout evidence exists.
 * Manual items are treated as untrusted surface text, never as verified macros.
 */
import { createHash } from "node:crypto";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import type { ManualMealInput } from "../meals/schemas";
import { governedLinguisticLexiconStore } from "./linguisticLexiconRepository";
import { comprehendFoodLanguage, type LinguisticLexiconStore } from "./linguisticComprehension";
import { createFoodV2KnowledgeRepository } from "./repository";
import type { FoodKnowledgeStore } from "./knowledgeRead";
import { type FoodD1Request } from "./entrypointMigration";
import { runFoodD1Migration } from "./entrypointRunner";
import { createFoodD1RouteDbStore } from "./entrypointRouteRepository";
import { hashFoodD1OperationScope, type FoodD1PinnedRoute, type FoodD1RouteStore } from "./entrypointRouting";
import type { FoodOperationEnvelope } from "./schemas";
import { isCurrentFoodD1GateApproval, isFoodD1EntrypointCutoverRequested, isValidD1OperationId } from "./entrypointRouting";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";

type ApprovedContext = AuthorizedD1SimulationContext;
export type PublicD1ManualDependencies = {
  readAuthorizedContext: () => Promise<ApprovedContext | null>;
  lexicon?: LinguisticLexiconStore;
  knowledge?: FoodKnowledgeStore;
  run?: typeof runFoodD1Migration;
  /** Exact persisted resolver owner, not a process-local cache. */
  bindLegacyRoute?: (candidate: FoodD1PinnedRoute) => Promise<FoodD1PinnedRoute>;
  readPinnedRoute?: FoodD1RouteStore["readPinnedRoute"];
};

/** No production authority exists until #1335; a flag can never manufacture it. */
const unavailableManualD1Context: PublicD1ManualDependencies = {
  readAuthorizedContext: async () => null,
};

export function buildLegacyManualRoute(input: {
  userId: number; meal: ManualMealInput; timeZone: string;
  source?: "web" | "whatsapp";
}): FoodD1PinnedRoute {
  const opId = input.meal.d1OperationId;
  const occurredAt = new Date(input.meal.occurredAt);
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0 ||
      !Number.isFinite(occurredAt.getTime()) ||
      !isValidD1OperationId(opId ?? "")) {
    throw new Error("food-d1-public-addition-invalid-legacy-pin");
  }
  const key = "d1-manual-" + input.userId + ":" + opId;
  // Scope includes the complete untrusted manual payload, not merely the
  // meal name/date. Reusing a key for different items/macros must fail closed.
  const payloadHash = createHash("sha256").update(JSON.stringify({
    ownerUserId: input.userId, meal: input.meal,
  })).digest("hex");
  const legacyVersion = "legacy-v1";
  const revisions = {
    code: legacyVersion, knowledge: legacyVersion, lexicon: legacyVersion,
    policy: legacyVersion, resolver: legacyVersion,
  };
  const envelope: FoodOperationEnvelope = {
    schemaVersion: 2, traceId: "trace-" + key + ":" + payloadHash,
    idempotencyKey: key, ownerUserId: input.userId,
    conversationRef: null, turnRef: null, effectiveTimeZone: input.timeZone,
    mealOperation: {
      action: "add", targetMeal: input.meal.mealLabel,
      date: getDateKeyInTimeZone(occurredAt, input.timeZone),
    },
    contextSources: {
      previousMessage: { status: "unavailable", reason: "legacy_manual_operation", sourceRef: null },
      preferences: { status: "unavailable", reason: "legacy_manual_operation", sourceRef: null },
      recentHistory: { status: "unavailable", reason: "legacy_manual_operation", sourceRef: null },
    },
    revisions,
  };
  return {
    operationKey: key, ownerUserId: input.userId, originEntrypoint: "addition",
    resolver: "v1", operationScopeHash: hashFoodD1OperationScope(envelope, input.source ?? "web"),
    versions: revisions,
  };
}

function assertSameLegacyManualScope(pinned: FoodD1PinnedRoute, candidate: FoodD1PinnedRoute) {
  if (pinned.resolver === "v2") throw new Error("food-d1-operation-paused-by-rollback");
  if (pinned.resolver !== "v1" || pinned.operationKey !== candidate.operationKey ||
      pinned.ownerUserId !== candidate.ownerUserId ||
      pinned.operationScopeHash !== candidate.operationScopeHash ||
      pinned.originEntrypoint !== candidate.originEntrypoint ||
      (["code", "knowledge", "lexicon", "policy", "resolver"] as const)
        .some(key => pinned.versions?.[key] !== candidate.versions[key])) {
    throw new Error("food-d1-legacy-operation-scope-changed");
  }
}

export function createFoodD1PublicManualAddition(deps: PublicD1ManualDependencies) {
  return async function tryRunFoodD1PublicManualAddition(input: {
    userId: number;
    meal: ManualMealInput;
    timeZone: string;
    source?: "web" | "whatsapp";
  }): Promise<number | null> {
    // Preserve a durable V1 owner on rollback; never silently retry a pinned
    // V2 operation through a V1 write. A selected V2 route needs real Gate A
    // even to inspect or execute an operation.
    if (!isFoodD1EntrypointCutoverRequested("addition")) {
      if (input.meal.d1OperationId) {
        const candidate = buildLegacyManualRoute(input);
        const pinned = await (deps.bindLegacyRoute
          ? deps.bindLegacyRoute(candidate)
          : createFoodD1RouteDbStore().bindPinnedRoute(candidate));
        assertSameLegacyManualScope(pinned, candidate);
      }
      return null;
    }
    const ctx = await deps.readAuthorizedContext();
    if (!ctx || !isCurrentFoodD1GateApproval(ctx.approval, ctx.expectedAuditedBaseSha) ||
        ctx.revisions.code !== ctx.expectedAuditedBaseSha) {
      throw new Error("food-d1-public-addition-gate-unavailable");
    }
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0 ||
        !isValidD1OperationId(input.meal.d1OperationId ?? "") ||
        !Array.isArray(input.meal.items) || !input.meal.items.length) {
      throw new Error("food-d1-public-addition-stable-operation-required");
    }
    const occurredAt = new Date(input.meal.occurredAt);
    if (!Number.isFinite(occurredAt.getTime())) {
      throw new Error("food-d1-public-addition-invalid-date");
    }
    const key = "d1-manual-" + input.userId + ":" + input.meal.d1OperationId;
    const pinned = await (deps.readPinnedRoute
      ? deps.readPinnedRoute(key, input.userId)
      : createFoodD1RouteDbStore().readPinnedRoute(key, input.userId));
    if (pinned?.resolver === "v1") {
      assertSameLegacyManualScope(pinned, buildLegacyManualRoute(input));
      return null;
    }
    const timeZone = input.timeZone;
    const source = input.source ?? "web";
    const observations = [];
    const lexicon = deps.lexicon ?? governedLinguisticLexiconStore;
    for (const [index, item] of input.meal.items.entries()) {
      // The public V1 item may contain arbitrary identity and nutrient claims.
      // Only its human-facing name/portion form food evidence for the V2 resolver.
      const surface = item.quantity + " " + item.unit + " de " + item.foodName;
      const current = await comprehendFoodLanguage({
        rawText: surface, sourceRef: key + ":item:" + index,
        modality: "text", ownerUserId: input.userId,
        lexiconRevision: ctx.revisions.lexicon, locale: "pt-BR",
        now: occurredAt,
      }, lexicon);
      if (current.length !== 1) {
        throw new Error("food-d1-public-addition-item-boundary-ambiguous");
      }
      observations.push(current[0]);
    }
    const evidence = { kind: "structured" as const, observations };
    const request: FoodD1Request = {
      authenticatedUserId: input.userId, entrypoint: "addition",
      envelope: {
        schemaVersion: 2, traceId: "trace-" + key,
        idempotencyKey: key, ownerUserId: input.userId,
        conversationRef: null, turnRef: null, effectiveTimeZone: timeZone,
        mealOperation: { action: "add", targetMeal: input.meal.mealLabel,
          date: getDateKeyInTimeZone(occurredAt, timeZone) },
        contextSources: {
          previousMessage: { status: "unavailable", reason: "manual_entry_without_conversation", sourceRef: null },
          preferences: { status: "unavailable", reason: "manual_entry_has_no_context_snapshot", sourceRef: null },
          recentHistory: { status: "unavailable", reason: "manual_entry_has_no_context_snapshot", sourceRef: null },
        },
        revisions: { ...ctx.revisions },
      },
      evidence, now: occurredAt,
    };
    const result = await (deps.run ?? runFoodD1Migration)({
      request, source, occurredAt,
      dependencies: {
        lexicon,
        knowledge: deps.knowledge ?? createFoodV2KnowledgeRepository(),
        authorizeEvidence: async candidate => candidate.ownerUserId === input.userId &&
          candidate.entrypoint === "addition" && candidate.evidence === evidence,
        authorizeExistingItem: async () => false,
      },
      legacy: async () => { throw new Error("food-d1-public-addition-cannot-replay-v1"); },
      expectedAuditedBaseSha: ctx.expectedAuditedBaseSha,
      verifyGates: async () => (await deps.readAuthorizedContext())?.approval ?? null,
      beforeCommit: plan => {
        // The V1 manual-create response has no way to represent pending siblings.
        // Reject the whole operation before any item is written, never silently
        // save a partial batch or fabricate macros from the client.
        if (plan.items.length !== input.meal.items.length ||
            plan.items.some(item => item.disposition !== "ready")) {
          throw new Error("food-d1-public-addition-needs-clarification");
        }
      },
    });
    if (!result || typeof result !== "object" || !("mealId" in result) ||
        typeof result.mealId !== "number" || result.mealId <= 0 ||
        !("committed" in result) || result.committed !== true) {
      throw new Error("food-d1-public-addition-commit-unavailable");
    }
    return result.mealId;
  };
}

export const tryRunFoodD1PublicManualAddition =
  createFoodD1PublicManualAddition(unavailableManualD1Context);
