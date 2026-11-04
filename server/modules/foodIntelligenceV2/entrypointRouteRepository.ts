/**
 * #1308 D1: durable, tenant-scoped resolver ownership.
 * A database unique key chooses one resolver across processes.
 */
import { and, eq, sql } from "drizzle-orm";
import { foodD1OperationRoutes } from "../../../drizzle/food-intelligence-v2-schema";
import { getDb } from "../../db";
import { D1_ENTRYPOINT_IDS } from "./entrypointMigration";
import type { FoodD1PinnedRoute, FoodD1RouteStore } from "./entrypointRouting";

const REVISION_KEYS = ["code", "knowledge", "lexicon", "policy", "resolver"] as const;

function decodeRoute(row: typeof foodD1OperationRoutes.$inferSelect): FoodD1PinnedRoute {
  let revisions: unknown;
  try { revisions = JSON.parse(row.revisionsJson); }
  catch { throw new Error("food-d1-corrupt-pinned-revisions"); }
  if (!revisions || typeof revisions !== "object" ||
      REVISION_KEYS.some(key => typeof (revisions as Record<string, unknown>)[key] !== "string" ||
        !(revisions as Record<string, string>)[key].trim())) {
    throw new Error("food-d1-corrupt-pinned-revisions");
  }
  if (!D1_ENTRYPOINT_IDS.some(candidate => candidate === row.originEntrypoint) ||
      (row.resolver !== "v1" && row.resolver !== "v2")) {
    throw new Error("food-d1-corrupt-pinned-owner");
  }
  const operationScopeHash = (revisions as Record<string, unknown>).operationScopeHash;
  if (typeof operationScopeHash !== "string" || !/^[a-f0-9]{64}$/.test(operationScopeHash)) {
    throw new Error("food-d1-corrupt-pinned-operation-scope");
  }
  return {
    operationScopeHash,
    operationKey: row.operationKey, ownerUserId: row.ownerUserId,
    originEntrypoint: row.originEntrypoint as FoodD1PinnedRoute["originEntrypoint"],
    resolver: row.resolver,
    versions: Object.fromEntries(REVISION_KEYS.map(key => [key,
      (revisions as Record<string, string>)[key]])) as FoodD1PinnedRoute["versions"],
  };
}

function assertCandidate(candidate: FoodD1PinnedRoute): void {
  if (!candidate || !Number.isSafeInteger(candidate.ownerUserId) || candidate.ownerUserId <= 0 ||
      !candidate.operationKey || candidate.operationKey.length > 200 ||
      !D1_ENTRYPOINT_IDS.includes(candidate.originEntrypoint) ||
      (candidate.resolver !== "v1" && candidate.resolver !== "v2") ||
      !/^[a-f0-9]{64}$/.test(candidate.operationScopeHash) ||
      !candidate.versions || REVISION_KEYS.some(key =>
        typeof candidate.versions[key] !== "string" || !candidate.versions[key].trim())) {
    throw new Error("food-d1-invalid-pinned-route");
  }
}

export function createFoodD1RouteDbStore(): FoodD1RouteStore {
  return {
    async readPinnedRoute(operationKey, ownerUserId) {
      if (!operationKey || !Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) {
        throw new Error("food-d1-invalid-route-lookup");
      }
      const db = await getDb();
      if (!db) throw new Error("food-d1-route-db-unavailable");
      const rows = await db.select().from(foodD1OperationRoutes)
        .where(and(eq(foodD1OperationRoutes.ownerUserId, ownerUserId),
          eq(foodD1OperationRoutes.operationKey, operationKey))).limit(1);
      return rows.length ? decodeRoute(rows[0]) : null;
    },
    async bindPinnedRoute(candidate) {
      assertCandidate(candidate);
      const db = await getDb();
      if (!db || typeof db.transaction !== "function") {
        throw new Error("food-d1-route-transaction-unavailable");
      }
      return db.transaction(async tx => {
        await tx.insert(foodD1OperationRoutes).values({
          operationKey: candidate.operationKey,
          ownerUserId: candidate.ownerUserId,
          originEntrypoint: candidate.originEntrypoint,
          resolver: candidate.resolver,
          revisionsJson: JSON.stringify({ ...candidate.versions,
            operationScopeHash: candidate.operationScopeHash }),
        }).onDuplicateKeyUpdate({ set: { operationKey: sql.raw("operation_key") } });
        const rows = await tx.select().from(foodD1OperationRoutes)
          .where(and(eq(foodD1OperationRoutes.ownerUserId, candidate.ownerUserId),
            eq(foodD1OperationRoutes.operationKey, candidate.operationKey)))
          .for("update").limit(1);
        if (rows.length !== 1) throw new Error("food-d1-route-atomic-upsert-failed");
        return decodeRoute(rows[0]);
      });
    },
  };
}
