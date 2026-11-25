import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { z } from "zod";
import {
  foodReviewCases,
  foodReviewEvents,
} from "../../../drizzle/food-intelligence-v2-schema";

// This is a storage primitive for one approved transition (§14.8), not an
// authorization policy or a public command handler. No runtime consumer.
const action = "close_no_change";
const reason = "no_material_effect";
const dbInt = z.number().int().min(1).max(2_147_483_647);
const opaque = (length: number) =>
  z.string().min(1).max(length).regex(/^[A-Za-z0-9][A-Za-z0-9_:.-]*$/);
const targetSchema = z.strictObject({
  artifactType: opaque(80),
  artifactId: opaque(100),
  revision: dbInt,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
// Persisted event vocabulary is checked at the boundary, not treated as
// unstructured text or as proof of a new command.
const receiptStateSchema = z.object({
  action: z.literal(action),
  reason: z.literal(reason),
  previousStatus: z.enum(["open", "in_review"]),
  newStatus: z.literal("closed"),
  outcome: z.literal("no_change"),
});
const commandSchema = z.strictObject({
  caseId: dbInt,
  reviewCycle: dbInt,
  expectedStateVersion: dbInt.max(2_147_483_646),
  requestKey: opaque(191),
  target: targetSchema,
  // The specifically implemented reason is §14.8's absence of material
  // effect. Neither raw justifications nor new retained evidence enter.
  reason: z.literal(reason),
});

type Command = Readonly<Omit<z.infer<typeof commandSchema>, "target">> & {
  readonly target: Readonly<z.infer<typeof targetSchema>>;
};

type Authorization = Readonly<{
  actorId: string;
  action: typeof action;
  command: Command;
}>;
type Dependencies = {
  db: Pick<MySql2Database, "transaction">;
  // Supplied only by a future authorized application boundary. Missing
  // authorizer/decision denies; this module defines no actors or permissions.
  authorize: (
    input: Authorization
  ) => Promise<Readonly<{ policyVersion: string }> | null>;
};
type Receipt = {
  eventId: number;
  caseId: number;
  reviewCycle: number;
  stateVersion: number;
  status: "closed";
  outcome: "no_change";
  policyVersion: string;
};
type ApplyResult =
  | { kind: "closed"; receipt: Receipt }
  | { kind: "invalid" | "denied" | "conflict" | "unavailable" };

const requestHash = (actorId: string, command: Command) =>
  createHash("sha256").update(JSON.stringify([
    "food-review-no-change-v1", action, actorId, command.caseId,
    command.reviewCycle, command.expectedStateVersion, command.requestKey,
    command.target.artifactType, command.target.artifactId,
    command.target.revision, command.target.contentHash, command.reason,
  ])).digest("hex");

type StoredTarget = Pick<typeof foodReviewCases.$inferSelect,
  "targetArtifactType" | "targetArtifactId" | "targetRevision" | "targetContentHash">;

function matchesTarget(row: StoredTarget, target: Command["target"]): boolean {
  return row.targetArtifactType === target.artifactType &&
    row.targetArtifactId === target.artifactId &&
    row.targetRevision === target.revision && row.targetContentHash === target.contentHash;
}

class TransactionInvariantFailure extends Error {}

export async function applyFoodReviewNoChange(
  dependencies: Dependencies,
  authenticatedActorId: string,
  input: unknown
): Promise<ApplyResult> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success || !opaque(120).safeParse(authenticatedActorId).success) {
    return { kind: "invalid" };
  }
  if (typeof dependencies.authorize !== "function") return { kind: "denied" };
  const command: Command = Object.freeze({
    ...parsed.data, target: Object.freeze(parsed.data.target),
  });
  const actorId = authenticatedActorId;
  try {
    // Fresh authorization is also required to read the result of a retry.
    // Perform it before DB reads; do not hold DB locks across policy checks.
    const permission = await dependencies.authorize(Object.freeze({ actorId, action, command }));
    const policy = opaque(100).safeParse(permission?.policyVersion);
    if (!policy.success) return { kind: "denied" };
    const digest = requestHash(actorId, command);
    const scope = eq(foodReviewCases.id, command.caseId);
    const stateVersion = command.expectedStateVersion + 1;
    const closed = (eventId: number, policyVersion: string): ApplyResult => ({
      kind: "closed",
      receipt: {
        eventId, caseId: command.caseId, reviewCycle: command.reviewCycle,
        stateVersion, status: "closed", outcome: "no_change", policyVersion,
      },
    });

    // Lock the existing case before a current read of the receipt. This is
    // deliberately not a check-then-insert in different transactions: retries
    // serialize on the case; persisted CAS/unique constraints remain required.
    return await dependencies.db.transaction(async tx => {
      const [current] = await tx.select({
        status: foodReviewCases.status, outcome: foodReviewCases.outcome,
        closedAt: foodReviewCases.closedAt, reviewCycle: foodReviewCases.reviewCycle,
        stateVersion: foodReviewCases.stateVersion,
        targetArtifactType: foodReviewCases.targetArtifactType,
        targetArtifactId: foodReviewCases.targetArtifactId,
        targetRevision: foodReviewCases.targetRevision,
        targetContentHash: foodReviewCases.targetContentHash,
      }).from(foodReviewCases).where(scope).limit(1).for("update");
      if (!current) return { kind: "conflict" };

      const [previous] = await tx.select({
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
        // Compare the persisted key byte-for-byte, regardless of SQL collation.
        if (previous.requestKey !== command.requestKey || previous.requestHash !== digest ||
            previous.actorId !== actorId || !receiptStateSchema.safeParse(previous).success ||
            !matchesTarget(previous, command.target) ||
            !dbInt.safeParse(previous.id).success ||
            !opaque(100).safeParse(previous.policyVersion).success) {
          return { kind: "conflict" };
        }
        return closed(previous.id, previous.policyVersion);
      }

      if ((current.status !== "open" && current.status !== "in_review") ||
          current.outcome !== null || current.closedAt !== null ||
          current.reviewCycle !== command.reviewCycle ||
          current.stateVersion !== command.expectedStateVersion ||
          !matchesTarget(current, command.target)) {
        return { kind: "conflict" };
      }

      const [update] = await tx.update(foodReviewCases).set({
        status: "closed", outcome: "no_change", stateVersion,
        closedAt: sql`CURRENT_TIMESTAMP`,
      }).where(and(
        scope, eq(foodReviewCases.status, current.status),
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
        action, actorId, reason: command.reason, policyVersion: policy.data,
        previousStatus: current.status, newStatus: "closed", outcome: "no_change",
        targetArtifactType: command.target.artifactType,
        targetArtifactId: command.target.artifactId,
        targetRevision: command.target.revision,
        targetContentHash: command.target.contentHash,
      });
      if (event?.affectedRows !== 1 || !dbInt.safeParse(event.insertId).success) {
        throw new TransactionInvariantFailure();
      }
      return closed(event.insertId, policy.data);
    });
  } catch {
    // Do not emit DB errors/parameters or convert failed commits into success.
    return { kind: "unavailable" };
  }
}
