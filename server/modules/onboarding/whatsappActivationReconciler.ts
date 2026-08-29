import { sql } from "drizzle-orm";
import { getDb, logPersistenceWarning } from "../../db";
import { activateWhatsappOnboardingUser } from "./whatsappLeadService";

type PendingActivationRow = {
  user_id: number | string | null;
};

function rowsFromResult<T>(result: unknown): T[] {
  const rows = Array.isArray(result)
    ? result[0]
    : (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export type WhatsappActivationReconciliationResult = {
  scanned: number;
  activated: number;
  alreadyActive: number;
  blocked: number;
  unchanged: number;
  failed: number;
};

/**
 * Re-evaluates onboarding leads that already completed identity/profile setup but
 * were waiting for a commercial access source. The central eligibility service
 * remains authoritative: this worker never infers activation from a provider
 * callback, checkout return or local client state.
 *
 * The scan is intentionally bounded and idempotent. Candidates are ordered by
 * the oldest pending evaluation and moved to the back of that queue before the
 * eligibility check, so a blocked or transiently failing prefix cannot starve
 * later eligible users across repeated runs. Multiple billing events, retries or
 * workers can call it safely because activateWhatsappOnboardingUser owns the
 * conditional pending_activation -> active transition and the idempotent
 * welcome-message contract.
 */
export async function reconcilePendingWhatsappOnboardingActivations(
  limit = 100
): Promise<WhatsappActivationReconciliationResult> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit) || 100));
  const db = await getDb();
  const summary: WhatsappActivationReconciliationResult = {
    scanned: 0,
    activated: 0,
    alreadyActive: 0,
    blocked: 0,
    unchanged: 0,
    failed: 0,
  };

  if (!db) return summary;

  let rows: PendingActivationRow[];
  try {
    const result = await db.execute(sql`
      SELECT converted_user_id AS user_id, MIN(updated_at) AS oldest_pending_at
      FROM whatsapp_onboarding_leads
      WHERE status = 'pending_activation'
        AND converted_user_id IS NOT NULL
      GROUP BY converted_user_id
      ORDER BY oldest_pending_at ASC, converted_user_id ASC
      LIMIT ${safeLimit}
    `);
    rows = rowsFromResult<PendingActivationRow>(result);
  } catch (error) {
    logPersistenceWarning("whatsapp_onboarding_activation_scan", error);
    return { ...summary, failed: 1 };
  }

  summary.scanned = rows.length;
  for (const row of rows) {
    const userId = Number(row.user_id);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      summary.failed += 1;
      continue;
    }

    try {
      await db.execute(sql`
        UPDATE whatsapp_onboarding_leads
        SET updated_at = ${new Date()}
        WHERE status = 'pending_activation'
          AND converted_user_id = ${userId}
      `);
    } catch (error) {
      summary.failed += 1;
      logPersistenceWarning(
        "whatsapp_onboarding_activation_queue_rotation",
        error
      );
      continue;
    }

    try {
      const result = await activateWhatsappOnboardingUser(userId);
      if (result.status === "activated") {
        summary.activated += 1;
      } else if (result.status === "already_active") {
        summary.alreadyActive += 1;
      } else if (result.status === "blocked") {
        summary.blocked += 1;
      } else {
        summary.unchanged += 1;
      }
    } catch (error) {
      summary.failed += 1;
      logPersistenceWarning(
        "whatsapp_onboarding_activation_reconciliation",
        error
      );
    }
  }

  return summary;
}
