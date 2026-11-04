/** #1308: no process-local pending store, no change to legacy pending rows. */
import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { whatsappPendingOperations, users } from "../../../drizzle/schema";
import { foodD1OperationRoutes } from "../../../drizzle/food-intelligence-v2-schema";
import { getDb } from "../../db";
import { hashFoodD1OperationScope } from "./entrypointRouting";
import { FOOD_D1_WHATSAPP_PENDING_TYPE, FOOD_D1_WHATSAPP_PENDING_ORIGIN,
  FOOD_D1_WHATSAPP_PENDING_TTL_MS, parseFoodD1WhatsAppPending,
  type FoodD1WhatsAppPending } from "./publicWhatsAppPendingContract";

type Row = typeof whatsappPendingOperations.$inferSelect;
export type FoodD1WhatsAppPendingRecord = {
  id: number; version: number; expiresAt: Date; target: FoodD1WhatsAppPending;
};

function checkedRow(row: Row, ownerUserId: number, now: Date): FoodD1WhatsAppPendingRecord {
  if (row.userId !== ownerUserId || row.type !== FOOD_D1_WHATSAPP_PENDING_TYPE ||
      row.origin !== FOOD_D1_WHATSAPP_PENDING_ORIGIN || row.state !== "active" ||
      row.expiresAt.getTime() <= now.getTime()) {
    throw new Error("food-d1-whatsapp-pending-owner-or-expiry-mismatch");
  }
  const parsed = parseFoodD1WhatsAppPending(row.target);
  if (parsed.envelope.ownerUserId !== ownerUserId) {
    throw new Error("food-d1-whatsapp-pending-owner-mismatch");
  }
  return { id: row.id, version: row.version, expiresAt: row.expiresAt, target: parsed };
}

function key(pending: FoodD1WhatsAppPending): string {
  return "food-d1:" + createHash("sha256")
    .update(JSON.stringify([pending.envelope.ownerUserId, pending.envelope.idempotencyKey]))
    .digest("hex");
}

function sameImmutableOperation(a: FoodD1WhatsAppPending, b: FoodD1WhatsAppPending): boolean {
  return JSON.stringify(a.envelope) === JSON.stringify(b.envelope) &&
    a.originEntrypoint === b.originEntrypoint &&
    a.occurredAt === b.occurredAt &&
    JSON.stringify(a.observations.map(item => item.observationId)) ===
      JSON.stringify(b.observations.map(item => item.observationId));
}

async function dbRequired() {
  const db = await getDb();
  if (!db || typeof db.transaction !== "function") {
    throw new Error("food-d1-whatsapp-pending-db-unavailable");
  }
  return db;
}

export async function readActiveFoodD1WhatsAppPending(
  ownerUserId: number, now = new Date(),
): Promise<FoodD1WhatsAppPendingRecord | null> {
  if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) {
    throw new Error("food-d1-whatsapp-pending-invalid-owner");
  }
  const db = await dbRequired();
  const rows = await db.select().from(whatsappPendingOperations).where(and(
    eq(whatsappPendingOperations.userId, ownerUserId),
    eq(whatsappPendingOperations.type, FOOD_D1_WHATSAPP_PENDING_TYPE),
    eq(whatsappPendingOperations.state, "active"),
    gt(whatsappPendingOperations.expiresAt, now),
  )).limit(2);
  if (rows.length > 1) throw new Error("food-d1-whatsapp-pending-ambiguous");
  return rows.length ? checkedRow(rows[0], ownerUserId, now) : null;
}

/**
 * The initial V2 route must already be pinned. Stage the full original
 * observation manifest under the same transaction as the pending payload.
 * A later turn never supplies its own manifest or another meal destination.
 */
export async function stageFoodD1WhatsAppPending(
  submitted: FoodD1WhatsAppPending, now = new Date(),
): Promise<FoodD1WhatsAppPendingRecord> {
  const pending = parseFoodD1WhatsAppPending(submitted);
  const owner = pending.envelope.ownerUserId;
  const db = await dbRequired();
  return db.transaction(async tx => {
    // Different original D1 routes do not share a route lock. Serialize
    // creation against the same user's physical row so two simultaneous
    // operations cannot both observe an empty active-pending set.
    const [owner] = await tx.select({ id: users.id }).from(users)
      .where(eq(users.id, pending.envelope.ownerUserId))
      .for("update").limit(1);
    if (!owner) throw new Error("food-d1-whatsapp-pending-owner-unavailable");
    const [route] = await tx.select().from(foodD1OperationRoutes).where(and(
      eq(foodD1OperationRoutes.ownerUserId, owner),
      eq(foodD1OperationRoutes.operationKey, pending.envelope.idempotencyKey),
    )).for("update").limit(1);
    if (!route || route.resolver !== "v2" ||
        route.originEntrypoint !== pending.originEntrypoint) {
      throw new Error("food-d1-whatsapp-pending-route-unavailable");
    }
    let revisions: Record<string, unknown>;
    try { revisions = JSON.parse(route.revisionsJson); }
    catch { throw new Error("food-d1-whatsapp-pending-corrupt-revisions"); }
    if (revisions.operationScopeHash !==
        hashFoodD1OperationScope(pending.envelope, "whatsapp") ||
        (["code", "knowledge", "lexicon", "policy", "resolver"] as const)
          .some(field => revisions[field] !== pending.envelope.revisions[field])) {
      throw new Error("food-d1-whatsapp-pending-route-mismatch");
    }
    const ids = pending.observations.map(item => item.observationId).sort();
    const priorIds = revisions.observationIds;
    if (priorIds !== undefined && JSON.stringify(priorIds) !== JSON.stringify(ids)) {
      throw new Error("food-d1-whatsapp-pending-manifest-conflict");
    }
    const rows = await tx.select().from(whatsappPendingOperations).where(and(
      eq(whatsappPendingOperations.userId, owner),
      eq(whatsappPendingOperations.type, FOOD_D1_WHATSAPP_PENDING_TYPE),
      eq(whatsappPendingOperations.state, "active"),
      gt(whatsappPendingOperations.expiresAt, now),
    )).for("update").limit(2);
    if (rows.length > 1 || rows.some(row => row.dedupeKey !== key(pending))) {
      throw new Error("food-d1-whatsapp-pending-other-operation-active");
    }
    if (rows.length === 1) {
      const found = checkedRow(rows[0], owner, now);
      if (!sameImmutableOperation(found.target, pending) ||
          JSON.stringify(found.target) !== JSON.stringify(pending)) {
        throw new Error("food-d1-whatsapp-pending-payload-changed");
      }
      return found;
    }
    if (priorIds === undefined) {
      await tx.update(foodD1OperationRoutes).set({
        revisionsJson: JSON.stringify({ ...revisions, observationIds: ids }),
      }).where(and(eq(foodD1OperationRoutes.ownerUserId, owner),
        eq(foodD1OperationRoutes.operationKey, pending.envelope.idempotencyKey)));
    }
    const expiresAt = new Date(now.getTime() + FOOD_D1_WHATSAPP_PENDING_TTL_MS);
    await tx.insert(whatsappPendingOperations).values({
      userId: owner, type: FOOD_D1_WHATSAPP_PENDING_TYPE,
      origin: FOOD_D1_WHATSAPP_PENDING_ORIGIN,
      state: "active", version: 1, target: pending,
      dedupeKey: key(pending), expiresAt,
    });
    const [saved] = await tx.select().from(whatsappPendingOperations).where(
      eq(whatsappPendingOperations.dedupeKey, key(pending))).limit(1);
    if (!saved) throw new Error("food-d1-whatsapp-pending-insert-not-visible");
    return checkedRow(saved, owner, now);
  });
}

export async function updateFoodD1WhatsAppPending(
  before: FoodD1WhatsAppPendingRecord, next: FoodD1WhatsAppPending,
  ownerUserId: number, now = new Date(),
): Promise<FoodD1WhatsAppPendingRecord> {
  const proposed = parseFoodD1WhatsAppPending(next);
  if (!sameImmutableOperation(before.target, proposed) ||
      proposed.envelope.ownerUserId !== ownerUserId) {
    throw new Error("food-d1-whatsapp-pending-attempted-operation-switch");
  }
  const db = await dbRequired();
  return db.transaction(async tx => {
    const [current] = await tx.select().from(whatsappPendingOperations)
      .where(and(eq(whatsappPendingOperations.id, before.id),
        eq(whatsappPendingOperations.userId, ownerUserId)))
      .for("update").limit(1);
    if (!current || current.version !== before.version ||
        current.dedupeKey !== key(before.target)) {
      throw new Error("food-d1-whatsapp-pending-stale-update");
    }
    const stored = checkedRow(current, ownerUserId, now);
    if (JSON.stringify(stored.target) !== JSON.stringify(before.target)) {
      throw new Error("food-d1-whatsapp-pending-stale-data");
    }
    await tx.update(whatsappPendingOperations).set({
      target: proposed, version: current.version + 1,
    }).where(and(eq(whatsappPendingOperations.id, current.id),
      eq(whatsappPendingOperations.userId, ownerUserId)));
    return { ...stored, version: current.version + 1, target: proposed };
  });
}

export async function consumeFoodD1WhatsAppPending(
  current: FoodD1WhatsAppPendingRecord, ownerUserId: number,
): Promise<void> {
  const db = await dbRequired();
  await db.transaction(async tx => {
    const [row] = await tx.select().from(whatsappPendingOperations).where(and(
      eq(whatsappPendingOperations.id, current.id),
      eq(whatsappPendingOperations.userId, ownerUserId),
    )).for("update").limit(1);
    if (!row || row.version !== current.version ||
        row.dedupeKey !== key(current.target) ||
        JSON.stringify(parseFoodD1WhatsAppPending(row.target)) !== JSON.stringify(current.target)) {
      throw new Error("food-d1-whatsapp-pending-consume-conflict");
    }
    checkedRow(row, ownerUserId, new Date());
    await tx.update(whatsappPendingOperations).set({
      state: "consumed", consumedAt: new Date(),
      dedupeKey: null, target: { schemaVersion: 2, consumed: true },
      version: row.version + 1,
    }).where(and(eq(whatsappPendingOperations.id, row.id),
      eq(whatsappPendingOperations.userId, ownerUserId)));
  });
}
