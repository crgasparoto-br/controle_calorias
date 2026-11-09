/** #1308: public item-edit migration to the single D1 resolver.
 * Keeps V1 items on their original legacy path; verified V2 items require
 * a native revision, authorized physical target and independent rollout.
 */
import { asc, and, eq } from "drizzle-orm";
import { mealItems, meals } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import type { UpdateMealItemInput } from "../meals/schemas";
import { hasBoundFoodV2Snapshot } from "../meals/foodV2Snapshot";
import { governedLinguisticLexiconStore } from "./linguisticLexiconRepository";
import { comprehendFoodLanguage, type LinguisticLexiconStore } from "./linguisticComprehension";
import { createFoodV2KnowledgeRepository } from "./repository";
import type { FoodKnowledgeStore } from "./knowledgeRead";
import type { FoodD1Request } from "./entrypointMigration";
import { runFoodD1Migration } from "./entrypointRunner";
import { isCurrentFoodD1GateApproval, isFoodD1EntrypointCutoverRequested, isValidD1OperationId } from "./entrypointRouting";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";
import { readFoodD1PublicContextSources } from "./publicContextSources";

type EditTarget = { itemId: number; mealId: number; ownerUserId: number;
  mealLabel: string; occurredAt: Date };
type PublicEditDependencies = {
  readAuthorizedContext: () => Promise<AuthorizedD1SimulationContext | null>;
  readContextSources?: typeof readFoodD1PublicContextSources;
  readTarget?: (userId: number, mealId: number, itemIndex: number) => Promise<EditTarget | null>;
  lexicon?: LinguisticLexiconStore;
  knowledge?: FoodKnowledgeStore;
  run?: typeof runFoodD1Migration;
};
const unavailableEditD1Context: PublicEditDependencies = {
  readAuthorizedContext: async () => null,
};

async function readPhysicalEditTarget(userId: number, mealId: number, itemIndex: number): Promise<EditTarget | null> {
  const db = await getDb();
  if (!db) throw new Error("food-d1-public-edit-db-unavailable");
  const records = await db.select().from(mealItems)
    .innerJoin(meals, eq(meals.id, mealItems.mealId))
    .where(and(eq(meals.id, mealId), eq(meals.userId, userId),
      eq(meals.status, "confirmed")))
    .orderBy(asc(mealItems.id));
  const record = records[itemIndex];
  if (!record || !hasBoundFoodV2Snapshot(record.mealItems)) return null;
  return {
    itemId: record.mealItems.id, mealId: record.meals.id,
    ownerUserId: record.meals.userId, mealLabel: record.meals.mealLabel,
    occurredAt: record.meals.occurredAt,
  };
}

export function createFoodD1PublicEdit(deps: PublicEditDependencies) {
  return async function tryRunFoodD1PublicEdit(input: {
    userId: number; request: UpdateMealItemInput; timeZone: string;
  }): Promise<number | null> {
    if (!isFoodD1EntrypointCutoverRequested("edit")) return null;
    const ctx = await deps.readAuthorizedContext();
    if (!ctx || !isCurrentFoodD1GateApproval(ctx.approval, ctx.expectedAuditedBaseSha) ||
        ctx.revisions.code !== ctx.expectedAuditedBaseSha) {
      throw new Error("food-d1-public-edit-gate-unavailable");
    }
    const { userId, request } = input;
    const id = request.d1OperationId;
    if (!Number.isSafeInteger(userId) || userId <= 0 ||
        !Number.isSafeInteger(request.mealId) || request.mealId <= 0 ||
        !Number.isSafeInteger(request.itemIndex) || request.itemIndex < 0 ||
        !isValidD1OperationId(id ?? "")) {
      throw new Error("food-d1-public-edit-stable-operation-required");
    }
    const lookup = deps.readTarget ?? readPhysicalEditTarget;
    const target = await lookup(userId, request.mealId, request.itemIndex);
    if (!target) {
      // A V1 physical item is never silently projected into a V2 identity.
      // Its original handler owns that historical item.
      return null;
    }
    if (target.ownerUserId !== userId || target.mealId !== request.mealId ||
        request.mealLabel.trim() !== target.mealLabel ||
        !Number.isSafeInteger(target.itemId) || target.itemId <= 0 ||
        !(target.occurredAt instanceof Date) || !Number.isFinite(target.occurredAt.getTime())) {
      throw new Error("food-d1-public-edit-target-scope-mismatch");
    }
    const contextSources = await (deps.readContextSources ?? readFoodD1PublicContextSources)({
      ownerUserId: userId, source: "web", at: new Date(),
    });
    const key = "d1-edit-" + userId + ":" + id;
    const surface = request.item.quantity + " " + request.item.unit + " de " + request.item.foodName;
    const lexicon = deps.lexicon ?? governedLinguisticLexiconStore;
    const observations = await comprehendFoodLanguage({
      rawText: surface, sourceRef: key + ":item", modality: "text",
      ownerUserId: userId, lexiconRevision: ctx.revisions.lexicon, locale: "pt-BR",
      now: target.occurredAt,
    }, lexicon);
    if (observations.length !== 1) {
      throw new Error("food-d1-public-edit-ambiguous-item");
    }
    const evidence = { kind: "structured" as const, observations };
    const requestV2: FoodD1Request = {
      authenticatedUserId: userId, entrypoint: "edit",
      envelope: {
        schemaVersion: 2, traceId: "trace-" + key, idempotencyKey: key,
        ownerUserId: userId, conversationRef: null, turnRef: null,
        effectiveTimeZone: input.timeZone,
        mealOperation: {
          action: "edit", targetMeal: target.mealLabel,
          date: getDateKeyInTimeZone(target.occurredAt, input.timeZone),
        },
        contextSources,
        revisions: { ...ctx.revisions },
      },
      evidence,
      targets: [{ observationId: observations[0].observationId,
        mealItemId: String(target.itemId), previousDecision: null }],
      now: target.occurredAt,
    };
    const output = await (deps.run ?? runFoodD1Migration)({
      request: requestV2, source: "web", occurredAt: target.occurredAt,
      dependencies: {
        lexicon, knowledge: deps.knowledge ?? createFoodV2KnowledgeRepository(),
        authorizeEvidence: async candidate => candidate.ownerUserId === userId &&
          candidate.entrypoint === "edit" && candidate.evidence === evidence,
        authorizeExistingItem: async candidate => {
          if (candidate.ownerUserId !== userId ||
              candidate.mealItemId !== String(target.itemId)) return false;
          const fresh = await lookup(userId, request.mealId, request.itemIndex);
          return fresh?.itemId === target.itemId && fresh.mealId === target.mealId;
        },
      },
      legacy: async () => { throw new Error("food-d1-public-edit-cannot-replay-v1"); },
      expectedAuditedBaseSha: ctx.expectedAuditedBaseSha,
      verifyGates: async () => (await deps.readAuthorizedContext())?.approval ?? null,
      beforeCommit: plan => {
        if (plan.items.length !== 1 || plan.items[0].disposition !== "ready" ||
            plan.items[0].mealItemId !== String(target.itemId)) {
          throw new Error("food-d1-public-edit-needs-clarification");
        }
      },
    });
    if (!output || typeof output !== "object" || !("committed" in output) ||
        output.committed !== true || !("mealId" in output) ||
        output.mealId !== target.mealId) {
      throw new Error("food-d1-public-edit-commit-unavailable");
    }
    return target.mealId;
  };
}

export const tryRunFoodD1PublicEdit = createFoodD1PublicEdit(unavailableEditD1Context);
