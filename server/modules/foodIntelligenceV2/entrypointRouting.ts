/**
 * #1308 / D1: durable, fail-closed resolver ownership for an operation.
 *
 * This is the routing contract, NOT a storage implementation. A caller must
 * supply a shared, transactional store with a unique operation key; never use
 * a process-local Map for production. Native V2 writes remain gated by #1335
 * and by a separate V2 consumer/persistence adapter.
 */
import { createHash } from "node:crypto";
import { parseFoodOperationEnvelope, type FoodOperationEnvelope } from "./schemas";
import type { FoodD1Entrypoint } from "./entrypointMigration";

export type FoodD1PinnedRoute = {
  operationKey: string;
  ownerUserId: number;
  originEntrypoint: FoodD1Entrypoint;
  resolver: "v1" | "v2";
  operationScopeHash: string;
  versions: FoodOperationEnvelope["revisions"];
};

/**
 * Immutable identity of the meal operation across retries and later turns.
 * turnRef is intentionally excluded; a clarification can follow a new turn.
 */
export function hashFoodD1OperationScope(
  envelope: FoodOperationEnvelope, source: "web" | "whatsapp",
): string {
  return createHash("sha256").update(JSON.stringify({
    ownerUserId: envelope.ownerUserId, operationKey: envelope.idempotencyKey,
    source, effectiveTimeZone: envelope.effectiveTimeZone,
    mealOperation: envelope.mealOperation,
  })).digest("hex");
}

/** bindPinnedRoute must be atomic across instances and return the winning row. */
export type FoodD1RouteStore = {
  readPinnedRoute(operationKey: string, ownerUserId: number): Promise<FoodD1PinnedRoute | null>;
  bindPinnedRoute(candidate: FoodD1PinnedRoute): Promise<FoodD1PinnedRoute>;
};

export type FoodD1GateApproval = {
  status: "approved";
  gateAReference: string;
  rolloutReference: string;
  auditedBaseSha: string;
};

/** Flags are server-side, OFF by default; tests may inject a per-test override. */
export function isFoodD1CutoverRequested(): boolean {
  return process.env.FOOD_V2_D1_ENABLED?.trim().toLowerCase() === "true";
}

function enabledForRequest(override: boolean | undefined): boolean {
  return process.env.NODE_ENV === "test" && override !== undefined
    ? override : isFoodD1CutoverRequested();
}

export function isCurrentFoodD1GateApproval(input: FoodD1GateApproval | null | undefined, expectedBaseSha: string | undefined): boolean {
  return typeof expectedBaseSha === "string" && /^[a-f0-9]{40}$/i.test(expectedBaseSha) &&
    input?.status === "approved" &&
    typeof input.gateAReference === "string" && input.gateAReference.trim().length > 5 &&
    typeof input.rolloutReference === "string" && input.rolloutReference.trim().length > 5 &&
    typeof input.auditedBaseSha === "string" &&
    input.auditedBaseSha.toLowerCase() === expectedBaseSha.toLowerCase();
}

function assertPinnedIdentity(
  pin: FoodD1PinnedRoute, env: FoodOperationEnvelope, entrypoint: FoodD1Entrypoint,
  source: "web" | "whatsapp",
): void {
  if (!pin || pin.operationKey !== env.idempotencyKey ||
      pin.ownerUserId !== env.ownerUserId ||
      (pin.resolver !== "v1" && pin.resolver !== "v2")) {
    throw new Error("food-d1-pinned-route-scope-mismatch");
  }
  // The original handler owns the operation. A later continuation does not
  // change its version, while a different new command cannot steal the key.
  if (pin.originEntrypoint !== entrypoint &&
      entrypoint !== "continuation" && entrypoint !== "nutrition_label") {
    throw new Error("food-d1-entrypoint-changed-during-operation");
  }
  if (pin.operationScopeHash !== hashFoodD1OperationScope(env, source)) {
    throw new Error("food-d1-operation-scope-changed");
  }
  if (!pin.versions ||
      (["code", "knowledge", "lexicon", "policy", "resolver"] as const)
        .some(key => pin.versions[key] !== env.revisions[key])) {
    throw new Error("food-d1-pinned-versions-changed");
  }
}

export type FoodD1RouteRequest<T> = {
  envelope: FoodOperationEnvelope;
  authenticatedUserId: number;
  entrypoint: FoodD1Entrypoint;
  source: "web" | "whatsapp";
  store: FoodD1RouteStore;
  /** V1 callback must retain its current arguments and semantics. */
  runV1: () => Promise<T>;
  /** V2 callback must consume native structured decisions, never a V1 round-trip. */
  runV2: () => Promise<T>;
  /** No production approval provider is registered until #1335 is certified. */
  verifyGates?: () => Promise<FoodD1GateApproval | null>;
  /** Sealed server-side material SHA; never read it from an untrusted inbound. */
  expectedAuditedBaseSha?: string;
  enabled?: boolean;
};

/**
 * Pins ownership before executing either path; never retries by switching
 * resolvers. Rollback pauses a pinned V2 operation instead of replaying it
 * through V1. A pinned V1 operation continues through V1 even if the flag
 * becomes enabled later.
 */
export async function routeFoodD1Operation<T>(request: FoodD1RouteRequest<T>): Promise<T> {
  const { authenticatedUserId, entrypoint, store } = request;
  const parsed = parseFoodOperationEnvelope(request.envelope);
  if (!parsed.ok) throw new Error("invalid-food-d1-envelope:" + parsed.code);
  const envelope = parsed.value;
  if (!Number.isSafeInteger(authenticatedUserId) || authenticatedUserId <= 0 ||
      envelope.ownerUserId !== authenticatedUserId ||
      !envelope.idempotencyKey?.trim()) {
    throw new Error("food-d1-owner-mismatch");
  }
  const enabled = enabledForRequest(request.enabled);
  let pin = await store.readPinnedRoute(envelope.idempotencyKey, authenticatedUserId);
  let approved = false;
  if (!pin) {
    if (enabled) {
      let proof: FoodD1GateApproval | null = null;
      try { proof = await request.verifyGates?.() ?? null; }
      catch { /* Missing Gate A/rollout never permits V2. */ }
      if (!isCurrentFoodD1GateApproval(proof, request.expectedAuditedBaseSha)) {
        // A concurrently winning legacy owner remains authoritative even if
        // the V2 gate is revoked. Never create a new V2 owner without proof.
        pin = await store.readPinnedRoute(envelope.idempotencyKey, authenticatedUserId);
        if (!pin) throw new Error("food-d1-independent-gates-not-approved");
      } else {
        approved = true;
      }
    }
    if (!pin) {
      const candidate: FoodD1PinnedRoute = {
        operationKey: envelope.idempotencyKey,
        ownerUserId: authenticatedUserId,
        originEntrypoint: entrypoint,
        resolver: enabled ? "v2" : "v1",
        operationScopeHash: hashFoodD1OperationScope(envelope, request.source),
        versions: { ...envelope.revisions },
      };
      pin = await store.bindPinnedRoute(candidate);
    }
  }
  assertPinnedIdentity(pin, envelope, entrypoint, request.source);
  if (pin.resolver === "v1") return request.runV1();
  if (!enabled) throw new Error("food-d1-operation-paused-by-rollback");
  if (!approved) {
    let proof: FoodD1GateApproval | null = null;
    try { proof = await request.verifyGates?.() ?? null; }
    catch { /* Revocation/failure always blocks the pinned V2 path. */ }
    if (!isCurrentFoodD1GateApproval(proof, request.expectedAuditedBaseSha)) {
      throw new Error("food-d1-independent-gates-not-approved");
    }
  }
  return request.runV2();
}
