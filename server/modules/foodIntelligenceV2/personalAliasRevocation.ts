import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { z } from "zod";
import { foodEvidence, userFoodAliases } from "../../../drizzle/food-intelligence-v2-schema";

const dbId = z.number().int().min(1).max(2_147_483_647);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const command = z.strictObject({
  aliasId: dbId, variantId: dbId, aliasRevision: sha256, confirmationId: dbId, confirmationHash: sha256,
  requestKey: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
});
const confirmation = z.strictObject({
  purpose: z.literal("personal_alias_confirmation"), schemaVersion: z.literal(1),
  aliasId: dbId, userId: dbId, variantId: dbId, aliasRevision: sha256,
});
const scopeSchema = z.strictObject({
  aliasId: dbId, userId: dbId, variantId: dbId, aliasRevision: sha256,
  confirmationId: dbId, confirmationHash: sha256,
});
const witness = z.strictObject({ ...scopeSchema.shape, authority: z.literal("personal_alias_confirmation") });

type Alias = typeof userFoodAliases.$inferSelect;
type Command = z.infer<typeof command>;
type Scope = Readonly<z.infer<typeof scopeSchema>>;
type Tx = Parameters<Parameters<MySql2Database["transaction"]>[0]>[0];
type Dependencies = {
  db: Pick<MySql2Database, "transaction">;
  // The adapter owns session verification; no holder or generic role in the command.
  authenticateHolder: () => Promise<number | null>;
  // A trusted future issuer must prove that the holder confirmed this exact
  // binding, in this transaction. No production issuer or writer exists here.
  lockConfirmationAuthority: (read: Pick<Tx, "select">, scope: Scope) =>
    Promise<Readonly<z.infer<typeof witness>> | null>;
};

export type PersonalAliasRevocationResult =
  | { kind: "denied" }
  | { kind: "conflict" }
  | { kind: "revoked"; revokedAt: string };

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function decisionTime(value: Date | null) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

/** Stable for this mapping only. Lifecycle timestamps/status are deliberately
 * excluded so an exact replay survives revocation; the original row ID,
 * explicit text, owner, target, confirmation and creation are all bound. */
export function personalAliasRevision(row: Omit<Alias, "revocationRequestHash">): string | null {
  const confirmedAt = decisionTime(row.confirmedAt);
  const createdAt = decisionTime(row.createdAt);
  if (row.source !== "user_confirmed" || !confirmedAt || !createdAt) return null;
  return hash(JSON.stringify([
    "personal-alias-row-v1", row.id, row.userId, row.foodVariantId,
    row.alias, row.normalizedAlias, row.confidence, confirmedAt, createdAt,
  ]));
}

export function personalAliasConfirmationSubject(aliasId: number) {
  return "personal-alias-confirmation:v1:" + aliasId;
}

function receiptIdentity(holder: number, expected: Command) {
  return hash(JSON.stringify(["revoke-personal-alias-v1", holder, expected.aliasId, expected.variantId,
    expected.aliasRevision, expected.confirmationId, expected.confirmationHash, expected.requestKey]));
}

async function currentConfirmationExpiry(tx: Tx, row: Alias, scope: Scope): Promise<number | null> {
  const [proof] = await tx.select().from(foodEvidence).where(and(
    eq(foodEvidence.id, scope.confirmationId),
    eq(foodEvidence.ownerUserId, scope.userId),
    eq(foodEvidence.foodVariantId, scope.variantId),
    eq(foodEvidence.subjectKey, personalAliasConfirmationSubject(scope.aliasId)),
    eq(foodEvidence.evidenceType, "user_correction"),
    isNull(foodEvidence.sourceId), isNull(foodEvidence.sourceReference),
  )).limit(1).for("update");
  if (!proof || proof.contentHash !== scope.confirmationHash ||
      proof.payloadJson.length > 1_024 || hash(proof.payloadJson) !== scope.confirmationHash) return null;
  const now = Date.now();
  const captured = decisionTime(proof.capturedAt);
  const retention = decisionTime(proof.retentionUntil);
  if (!captured || captured !== decisionTime(row.confirmedAt) ||
      Date.parse(captured) > now || !retention || Date.parse(retention) <= now) return null;
  let data: unknown;
  try { data = JSON.parse(proof.payloadJson); }
  catch { return null; }
  const parsed = confirmation.safeParse(data);
  if (!parsed.success) return null;
  const canonical = { purpose: "personal_alias_confirmation", schemaVersion: 1, aliasId: scope.aliasId,
    userId: scope.userId, variantId: scope.variantId, aliasRevision: scope.aliasRevision };
  // Exact encoding disallows duplicate fields, extra data and shape drift.
  return proof.payloadJson === JSON.stringify(canonical) ? Date.parse(retention) : null;
}

function sameAuthority(value: unknown, scope: Scope): boolean {
  const parsed = witness.safeParse(value);
  return parsed.success && parsed.data.aliasId === scope.aliasId && parsed.data.userId === scope.userId &&
    parsed.data.variantId === scope.variantId && parsed.data.aliasRevision === scope.aliasRevision &&
    parsed.data.confirmationId === scope.confirmationId && parsed.data.confirmationHash === scope.confirmationHash;
}

/** Dormant owner-only revocation; never acquires, relinks or rewrites evidence. */
export function createPersonalAliasRevocation(deps: Dependencies) {
  return async function revoke(input: unknown): Promise<PersonalAliasRevocationResult> {
    const parsed = command.safeParse(input);
    if (!parsed.success || typeof deps.authenticateHolder !== "function" ||
        typeof deps.lockConfirmationAuthority !== "function") return { kind: "denied" };
    const authenticated = dbId.safeParse(await deps.authenticateHolder());
    if (!authenticated.success) return { kind: "denied" };
    const holder = authenticated.data;
    const expected = parsed.data;
    const scope = Object.freeze({ aliasId: expected.aliasId, userId: holder, variantId: expected.variantId,
      aliasRevision: expected.aliasRevision, confirmationId: expected.confirmationId,
      confirmationHash: expected.confirmationHash });
    const requestHash = receiptIdentity(holder, expected);

    return deps.db.transaction(async tx => {
      const ownTarget = and(eq(userFoodAliases.id, expected.aliasId), eq(userFoodAliases.userId, holder),
        eq(userFoodAliases.foodVariantId, expected.variantId));
      const [row] = await tx.select().from(userFoodAliases).where(ownTarget).limit(1).for("update");
      if (!row || personalAliasRevision(row) !== expected.aliasRevision) return { kind: "denied" };

      if (row.status === "revoked") {
        const revokedAt = decisionTime(row.revokedAt);
        // Retention or loss of the original proof must not create a second
        // effect. Re-deliver only the exact durable receipt and never grant a new one.
        return row.revocationRequestHash === requestHash && row.currentSlot === null && revokedAt
          ? { kind: "revoked", revokedAt } : { kind: "denied" };
      }
      if (!row.confirmedAt || row.currentSlot !== 1 || row.revokedAt !== null ||
          row.revocationRequestHash !== null) return { kind: "denied" };
      const expires = await currentConfirmationExpiry(tx, row, scope);
      if (expires === null || !sameAuthority(
        await deps.lockConfirmationAuthority(Object.freeze({ select: tx.select.bind(tx) }), scope), scope
      ) || Date.now() >= expires) {
        return { kind: "denied" };
      }
      const [updated] = await tx.update(userFoodAliases).set({
        status: "revoked", currentSlot: null, revokedAt: sql`CURRENT_TIMESTAMP`, revocationRequestHash: requestHash,
      }).where(and(ownTarget, eq(userFoodAliases.source, "user_confirmed"),
        eq(userFoodAliases.confirmedAt, row.confirmedAt), eq(userFoodAliases.status, "active"),
        eq(userFoodAliases.currentSlot, 1), isNull(userFoodAliases.revokedAt),
        isNull(userFoodAliases.revocationRequestHash)));
      if (updated.affectedRows !== 1) return { kind: "conflict" };
      const [recorded] = await tx.select({ revokedAt: userFoodAliases.revokedAt }).from(userFoodAliases)
        .where(and(ownTarget, eq(userFoodAliases.revocationRequestHash, requestHash))).limit(1);
      const revokedAt = decisionTime(recorded?.revokedAt ?? null);
      if (!revokedAt) throw new Error("personal-alias-revocation-receipt-unavailable");
      return { kind: "revoked", revokedAt };
    });
  };
}
