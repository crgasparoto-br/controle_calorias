import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { z } from "zod";
import {
  foodReviewCases,
  foodReviewEvents,
} from "../../../drizzle/food-intelligence-v2-schema";

// Dormant storage seam for only the preassigned reviewer (§25 item 4).
const start = "start_review";
const close = "close_no_change";
const reason = "no_material_effect";
const initialAssignment = "single_reviewer_initial_assignment";
const existingAssignment = "existing_assignment";
const dbInt = z.number().int().min(1).max(2_147_483_647);
const opaque = (length: number) =>
  z.string().min(1).max(length).regex(/^[A-Za-z0-9][A-Za-z0-9_:.-]*$/);
const targetSchema = z.strictObject({
  artifactType: opaque(80),
  artifactId: opaque(100),
  revision: dbInt,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
const commandFields = {
  caseId: dbInt,
  reviewCycle: dbInt,
  expectedStateVersion: dbInt.max(2_147_483_646),
  requestKey: opaque(191),
  target: targetSchema,
};
const commandSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...commandFields, action: z.literal(start), reason: z.null() }),
  z.strictObject({ ...commandFields, action: z.literal(close), reason: z.literal(reason) }),
]);
const receiptStateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal(start), reason: z.literal(initialAssignment).nullable(), previousStatus: z.literal("open"),
    newStatus: z.literal("in_review"), outcome: z.null(),
  }),
  z.object({
    action: z.literal(close), reason: z.literal(reason), previousStatus: z.enum(["open", "in_review"]),
    newStatus: z.literal("closed"), outcome: z.literal("no_change"),
  }),
]);
const lockedScopeSchema = z.strictObject({
  actorUserId: dbInt,
  action: z.enum([start, close]),
  caseId: dbInt,
  reviewCycle: dbInt,
  stateVersion: dbInt,
  target: targetSchema,
  assignmentMode: z.enum([existingAssignment, initialAssignment]),
});
const grantSchema = z.strictObject({
  ...lockedScopeSchema.shape,
  authority: z.literal("food_review"),
  status: z.literal("active"),
  policyVersion: opaque(100),
});

type Command = z.infer<typeof commandSchema>;
type FrozenScope = Readonly<Omit<z.infer<typeof lockedScopeSchema>, "target">> & {
  readonly target: Readonly<Command["target"]>;
};
type Tx = Parameters<Parameters<MySql2Database["transaction"]>[0]>[0];
type GrantRead = Pick<Tx, "select">;
type Dependencies = {
  db: Pick<MySql2Database, "transaction">;
  // Optional closed single-reviewer policy. This is trusted dependency
  // configuration, never inferred from an actor, command, or generic role.
  singleReviewerUserId?: number;
  // Trusted future Food authority: lock and validate the active permission
  // for this action in this very transaction, or return null. No permission
  // source is configured here. Repo-wide admin/billing flags are not grants.
  lockFoodReviewGrant: (
    read: GrantRead,
    lockedScope: FrozenScope
  ) => Promise<Readonly<z.infer<typeof grantSchema>> | null>;
};

type Transition =
  | { action: typeof start; status: "in_review"; outcome: null }
  | { action: typeof close; status: "closed"; outcome: "no_change" };
const transitions: { [Action in Transition["action"]]: Extract<Transition, { action: Action }> } = {
  [start]: { action: start, status: "in_review", outcome: null },
  [close]: { action: close, status: "closed", outcome: "no_change" },
};
type Receipt = Transition & {
  eventId: number;
  caseId: number;
  reviewCycle: number;
  stateVersion: number;
  policyVersion: string;
};
type ApplyResult =
  | { kind: "applied"; receipt: Receipt }
  | { kind: "invalid" | "denied" | "conflict" | "unavailable" };

const requestHash = (actorId: string, command: Command) =>
  createHash("sha256").update(JSON.stringify([
    "food-review-assigned-v1", command.action, actorId, command.caseId,
    command.reviewCycle, command.expectedStateVersion, command.requestKey,
    command.target.artifactType, command.target.artifactId,
    command.target.revision, command.target.contentHash, command.reason,
  ])).digest("hex");

type StoredTarget = Pick<typeof foodReviewCases.$inferSelect,
  "targetArtifactType" | "targetArtifactId" | "targetRevision" | "targetContentHash">;
const sameTarget = (left: Readonly<Command["target"]>, right: Readonly<Command["target"]>) =>
  left.artifactType === right.artifactType && left.artifactId === right.artifactId &&
  left.revision === right.revision && left.contentHash === right.contentHash;

function readTarget(row: StoredTarget): Command["target"] {
  return {
    artifactType: row.targetArtifactType, artifactId: row.targetArtifactId,
    revision: row.targetRevision, contentHash: row.targetContentHash,
  };
}

function grantPolicy(grant: unknown, scope: FrozenScope): string | null {
  const proof = grantSchema.safeParse(grant);
  if (!proof.success) return null;
  const { actorUserId, action, caseId, reviewCycle, stateVersion, target, policyVersion, assignmentMode } = proof.data;
  return actorUserId === scope.actorUserId && action === scope.action &&
    caseId === scope.caseId && reviewCycle === scope.reviewCycle && stateVersion === scope.stateVersion &&
    assignmentMode === scope.assignmentMode && sameTarget(target, scope.target) ? policyVersion : null;
}

class TransactionInvariantFailure extends Error {}

// actorUserId is supplied only by a trusted authenticated application boundary,
// never a public input field. No route, consumer or Food grant adapter exists.
export async function applyAssignedFoodReview(
  dependencies: Dependencies,
  authenticatedActorUserId: number,
  input: unknown
): Promise<ApplyResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success || !dbInt.safeParse(authenticatedActorUserId).success) {
    return { kind: "invalid" };
  }
  if (typeof dependencies.lockFoodReviewGrant !== "function") return { kind: "denied" };
  const singleReviewer = dependencies.singleReviewerUserId;
  if (singleReviewer !== undefined && !dbInt.safeParse(singleReviewer).success) {
    return { kind: "denied" };
  }
  if (singleReviewer !== undefined && singleReviewer !== authenticatedActorUserId) {
    return { kind: "denied" };
  }
  const command = parsed.data;
  const actorId = String(authenticatedActorUserId);
  const digest = requestHash(actorId, command);
  const stateVersion = command.expectedStateVersion + 1;
  const transition = transitions[command.action];
  const isStart = transition.outcome === null;
  const applied = (eventId: number, policyVersion: string): ApplyResult => ({
    kind: "applied",
    receipt: {
      ...transition, eventId, caseId: command.caseId, reviewCycle: command.reviewCycle,
      stateVersion, policyVersion,
    },
  });

  try {
    return await dependencies.db.transaction(async tx => {
      const caseCondition = eq(foodReviewCases.id, command.caseId);
      // Assignment, grant, receipt and case update are evaluated under the
      // same transaction, in that lock order. Never read a receipt first.
      const [current] = await tx.select({
        status: foodReviewCases.status, outcome: foodReviewCases.outcome,
        closedAt: foodReviewCases.closedAt, reviewCycle: foodReviewCases.reviewCycle,
        stateVersion: foodReviewCases.stateVersion, assignedReviewerId: foodReviewCases.assignedReviewerId,
        targetArtifactType: foodReviewCases.targetArtifactType,
        targetArtifactId: foodReviewCases.targetArtifactId,
        targetRevision: foodReviewCases.targetRevision,
        targetContentHash: foodReviewCases.targetContentHash,
      }).from(foodReviewCases).where(caseCondition).limit(1).for("update");
      if (!current) return { kind: "denied" };
      const assignInitially = current.assignedReviewerId === null;
      if (assignInitially
        ? !isStart || singleReviewer !== authenticatedActorUserId || current.status !== "open"
        : current.assignedReviewerId !== authenticatedActorUserId) {
        return { kind: "denied" };
      }
      if (assignInitially && (current.reviewCycle !== command.reviewCycle ||
          current.stateVersion !== command.expectedStateVersion)) {
        return { kind: "denied" };
      }
      const scope: FrozenScope = Object.freeze({
        actorUserId: authenticatedActorUserId, action: command.action, caseId: command.caseId,
        reviewCycle: current.reviewCycle, stateVersion: current.stateVersion,
        assignmentMode: assignInitially ? initialAssignment : existingAssignment,
        target: Object.freeze(readTarget(current)),
      });
      if (!lockedScopeSchema.safeParse(scope).success) throw new TransactionInvariantFailure();
      // A different target is outside the locked case's authority, even if
      // an old command has a receipt. Reject before looking up that receipt.
      if (!sameTarget(scope.target, command.target)) return { kind: "denied" };
      // Do not hand the authority adapter a writer or a second connection.
      const read: GrantRead = Object.freeze({ select: tx.select.bind(tx) });
      const policy = grantPolicy(await dependencies.lockFoodReviewGrant(read, scope), scope);
      if (!policy) return { kind: "denied" };

      // Historical receipts are readable only after the reviewer is assigned.
      // Initial assignment is a new mutation; an occupied event key makes
      // the transaction roll back, never authorizing a replay.
      const [previous] = assignInitially ? [] : await tx.select({
        id: foodReviewEvents.id, requestKey: foodReviewEvents.requestKey,
        requestHash: foodReviewEvents.requestHash, actorId: foodReviewEvents.actorId,
        action: foodReviewEvents.action, reason: foodReviewEvents.reason,
        previousStatus: foodReviewEvents.previousStatus,
        newStatus: foodReviewEvents.newStatus, outcome: foodReviewEvents.outcome,
        targetArtifactType: foodReviewEvents.targetArtifactType,
        targetArtifactId: foodReviewEvents.targetArtifactId,
        targetRevision: foodReviewEvents.targetRevision,
        targetContentHash: foodReviewEvents.targetContentHash,
        policyVersion: foodReviewEvents.policyVersion,
      }).from(foodReviewEvents).where(and(
        eq(foodReviewEvents.caseId, command.caseId),
        eq(foodReviewEvents.reviewCycle, command.reviewCycle),
        eq(foodReviewEvents.requestKey, command.requestKey),
      )).limit(1).for("update");

      if (previous) {
        // A newer cycle/version alone is OK for the same authorized and
        // designated reviewer, provided the original command is unchanged.
        if (previous.requestKey !== command.requestKey || previous.requestHash !== digest ||
            previous.actorId !== actorId || previous.action !== command.action ||
            !receiptStateSchema.safeParse(previous).success ||
            !sameTarget(readTarget(previous), command.target) ||
            !dbInt.safeParse(previous.id).success ||
            !opaque(100).safeParse(previous.policyVersion).success) {
          return { kind: "conflict" };
        }
        return applied(previous.id, previous.policyVersion);
      }

      if ((current.status !== "open" && (isStart || current.status !== "in_review")) ||
          current.outcome !== null || current.closedAt !== null ||
          current.reviewCycle !== command.reviewCycle ||
          current.stateVersion !== command.expectedStateVersion) {
        return { kind: "conflict" };
      }
      const [update] = await tx.update(foodReviewCases).set({
        status: transition.status, outcome: transition.outcome, stateVersion,
        closedAt: isStart ? null : sql`CURRENT_TIMESTAMP`,
        assignedReviewerId: assignInitially ? authenticatedActorUserId : undefined,
      }).where(and(
        caseCondition, eq(foodReviewCases.status, current.status),
        assignInitially
          ? isNull(foodReviewCases.assignedReviewerId)
          : eq(foodReviewCases.assignedReviewerId, authenticatedActorUserId),
        eq(foodReviewCases.reviewCycle, command.reviewCycle),
        eq(foodReviewCases.stateVersion, command.expectedStateVersion),
        eq(foodReviewCases.targetArtifactType, command.target.artifactType),
        eq(foodReviewCases.targetArtifactId, command.target.artifactId),
        eq(foodReviewCases.targetRevision, command.target.revision),
        eq(foodReviewCases.targetContentHash, command.target.contentHash),
        isNull(foodReviewCases.outcome), isNull(foodReviewCases.closedAt),
      ));
      if (update?.affectedRows === 0) return { kind: "conflict" };
      if (update?.affectedRows !== 1) throw new TransactionInvariantFailure();

      const [event] = await tx.insert(foodReviewEvents).values({
        caseId: command.caseId, reviewCycle: command.reviewCycle,
        requestKey: command.requestKey, requestHash: digest,
        action: command.action, actorId, reason: assignInitially ? initialAssignment : command.reason,
        policyVersion: policy,
        previousStatus: current.status, newStatus: transition.status, outcome: transition.outcome,
        targetArtifactType: command.target.artifactType,
        targetArtifactId: command.target.artifactId,
        targetRevision: command.target.revision,
        targetContentHash: command.target.contentHash,
      });
      if (event?.affectedRows !== 1 || !dbInt.safeParse(event.insertId).success) {
        throw new TransactionInvariantFailure();
      }
      return applied(event.insertId, policy);
    });
  } catch {
    return { kind: "unavailable" };
  }
}
