import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  BillingAdminUserRow,
  GrantBillingOverrideInput,
  RevokeBillingOverrideInput,
} from "../modules/billing/types";
import {
  insertAuditEvent,
  mapOverride,
  numberValue,
  requireDb,
  resultRows,
  type BillingRepositoryDeps,
} from "./billingRepositorySupport";

export function createBillingAdminRepository(deps: BillingRepositoryDeps) {
  async function grantAdminOverride(input: GrantBillingOverrideInput) {
    const db = await requireDb(deps.getDb);
    const startsAt = input.startsAt ?? new Date();
    const overrideId = crypto.randomUUID();
    return db.transaction(async tx => {
      await tx.execute(sql`
        UPDATE billingAdminOverrides
        SET state = 'expired', activeUserKey = NULL, updatedAt = NOW()
        WHERE userId = ${input.userId}
          AND state = 'active'
          AND endsAt IS NOT NULL
          AND endsAt <= ${startsAt}
      `);
      const [existing] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT * FROM billingAdminOverrides
          WHERE activeUserKey = ${String(input.userId)}
          LIMIT 1
          FOR UPDATE
        `)
      );
      if (existing) {
        await tx.execute(sql`
          UPDATE billingAdminOverrides
          SET state = 'revoked', activeUserKey = NULL,
            revokedByUserId = ${input.grantedByUserId}, revokedAt = NOW(),
            updatedAt = NOW()
          WHERE id = ${String(existing.id)} AND state = 'active'
        `);
        await insertAuditEvent(tx, {
          subjectUserId: input.userId,
          actorUserId: input.grantedByUserId,
          action: "override_revoked",
          sourceType: "admin_override",
          sourceId: String(existing.id),
          reason: "Exceção substituída por uma nova concessão administrativa.",
        });
      }

      await tx.execute(sql`
        INSERT INTO billingAdminOverrides (
          id, userId, accessWithoutSubscription, reason, startsAt, endsAt,
          state, activeUserKey, grantedByUserId, createdAt, updatedAt
        ) VALUES (
          ${overrideId}, ${input.userId}, true, ${input.reason}, ${startsAt},
          ${input.endsAt ?? null}, 'active', ${String(input.userId)},
          ${input.grantedByUserId}, NOW(), NOW()
        )
      `);
      await insertAuditEvent(tx, {
        subjectUserId: input.userId,
        actorUserId: input.grantedByUserId,
        action: "override_granted",
        sourceType: "admin_override",
        sourceId: overrideId,
        reason: input.reason,
        metadata: {
          startsAt: startsAt.toISOString(),
          endsAt: input.endsAt?.toISOString() ?? null,
        },
      });
      const [saved] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT * FROM billingAdminOverrides WHERE id = ${overrideId} LIMIT 1
        `)
      );
      if (!saved) {
        throw new Error("Não foi possível persistir a exceção administrativa.");
      }
      return mapOverride(saved);
    });
  }

  async function revokeAdminOverride(input: RevokeBillingOverrideInput) {
    const db = await requireDb(deps.getDb);
    return db.transaction(async tx => {
      const [current] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT * FROM billingAdminOverrides
          WHERE id = ${input.overrideId}
          LIMIT 1
          FOR UPDATE
        `)
      );
      if (!current) throw new Error("Exceção administrativa não encontrada.");
      if (current.state === "active") {
        await tx.execute(sql`
          UPDATE billingAdminOverrides
          SET state = 'revoked', activeUserKey = NULL,
            revokedByUserId = ${input.revokedByUserId}, revokedAt = NOW(),
            updatedAt = NOW()
          WHERE id = ${input.overrideId} AND state = 'active'
        `);
        await insertAuditEvent(tx, {
          subjectUserId: numberValue(current.userId),
          actorUserId: input.revokedByUserId,
          action: "override_revoked",
          sourceType: "admin_override",
          sourceId: input.overrideId,
          reason: input.reason,
        });
      }
      const [saved] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT * FROM billingAdminOverrides WHERE id = ${input.overrideId} LIMIT 1
        `)
      );
      if (!saved) throw new Error("Exceção administrativa não encontrada.");
      return mapOverride(saved);
    });
  }

  async function getActiveAdminOverride(userId: number, now: Date) {
    const db = await requireDb(deps.getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT * FROM billingAdminOverrides
        WHERE userId = ${userId}
          AND state = 'active'
          AND accessWithoutSubscription = true
          AND startsAt <= ${now}
          AND (endsAt IS NULL OR endsAt > ${now})
        ORDER BY createdAt DESC, id DESC
        LIMIT 1
      `)
    );
    return row ? mapOverride(row) : null;
  }

  async function listAdminOverrides(userId: number, limit: number, now: Date) {
    const db = await requireDb(deps.getDb);
    const rows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT id, userId, reason, startsAt, endsAt,
          CASE
            WHEN state = 'active' AND endsAt IS NOT NULL AND endsAt <= ${now}
              THEN 'expired'
            ELSE state
          END AS state,
          grantedByUserId, revokedByUserId, revokedAt, createdAt, updatedAt
        FROM billingAdminOverrides
        WHERE userId = ${userId}
        ORDER BY
          CASE
            WHEN state = 'active'
              AND startsAt <= ${now}
              AND (endsAt IS NULL OR endsAt > ${now})
              THEN 0
            ELSE 1
          END,
          createdAt DESC,
          id DESC
        LIMIT ${limit}
      `)
    );
    return rows.map(mapOverride);
  }

  async function searchUsers(query: string, limit: number, offset = 0) {
    const db = await requireDb(deps.getDb);
    const normalized = query.trim();
    const pattern = `%${normalized}%`;
    const rows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT u.id, u.name, u.email, MAX(w.phoneNumber) AS phoneNumber
        FROM users u
        LEFT JOIN whatsappConnections w ON w.userId = u.id
        WHERE ${normalized === ""}
          OR u.name LIKE ${pattern}
          OR u.email LIKE ${pattern}
          OR w.phoneNumber LIKE ${pattern}
        GROUP BY u.id, u.name, u.email
        ORDER BY u.name ASC, u.id ASC
        LIMIT ${limit} OFFSET ${offset}
      `)
    );
    return rows.map(
      row =>
        ({
          id: numberValue(row.id),
          name: row.name ? String(row.name) : null,
          email: row.email ? String(row.email) : null,
          phoneNumber: row.phoneNumber ? String(row.phoneNumber) : null,
        }) satisfies BillingAdminUserRow
    );
  }

  return {
    grantAdminOverride,
    revokeAdminOverride,
    getActiveAdminOverride,
    listAdminOverrides,
    searchUsers,
  };
}
