import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  insertAuditEvent,
  requireDb,
  resultRows,
} from "../../repositories/billingRepositorySupport";
import type { z } from "zod";
import type {
  billingCommercialTransitionReconcileSchema,
  billingCommercialTransitionRunSchema,
} from "./billingCommercialTransitionSchemas";

type Row = Record<string, unknown>;
type RunInput = z.infer<typeof billingCommercialTransitionRunSchema> & {
  actorUserId: number;
};
type ReconcileInput = z.infer<typeof billingCommercialTransitionReconcileSchema>;

const PROVIDER = "billing-commercial-transition";
const TRANSITION_DAYS = 30;
const SYSTEM_ACCESS_ENTITLEMENTS = ["system_access"] as const;

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function dateValue(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error("billing_transition_invalid_date");
  return date;
}

export function getCommercialTransitionWindow(cutoverAt: Date) {
  const start = new Date(cutoverAt.getTime());
  const end = new Date(start.getTime() + TRANSITION_DAYS * 24 * 60 * 60 * 1000);
  return { validFrom: start, validUntil: end };
}

function manifestEventId(cutoverKey: string) {
  return `cutover:${cutoverKey}`;
}

function checkpointEventId(cutoverKey: string) {
  return `checkpoint:${cutoverKey}`;
}

function itemEventId(cutoverKey: string, userId: number) {
  return `item:${cutoverKey}:${userId}`;
}

function transitionSourceId(cutoverKey: string, userId: number) {
  return `commercial-cutover:${cutoverKey}:${userId}`;
}

function activeGrantKey(cutoverKey: string, userId: number) {
  return `transition:${cutoverKey}:${userId}`;
}

async function readManifest(cutoverKey: string) {
  const db = await requireDb(getDb);
  const [row] = resultRows<Row>(
    await db.execute(sql`
      SELECT payloadJson
      FROM billingProviderEvents
      WHERE provider = ${PROVIDER}
        AND providerEventId = ${manifestEventId(cutoverKey)}
      LIMIT 1
    `)
  );
  return row ? jsonObject(row.payloadJson) : null;
}

async function ensureManifest(input: RunInput, cutoverAt: Date, validUntil: Date) {
  const existing = await readManifest(input.cutoverKey);
  const expected = {
    cutoverKey: input.cutoverKey,
    cutoverAt: cutoverAt.toISOString(),
    validUntil: validUntil.toISOString(),
    timezone: input.timezone,
  };
  if (existing) {
    if (
      existing.cutoverAt !== expected.cutoverAt ||
      existing.validUntil !== expected.validUntil ||
      existing.timezone !== expected.timezone
    ) {
      throw new Error("billing_transition_cutover_immutable");
    }
    return;
  }

  const db = await requireDb(getDb);
  const now = new Date();
  await db.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, subscriptionId,
      payloadJson, occurredAt, processedAt, createdAt, updatedAt
    ) VALUES (
      ${crypto.randomUUID()}, ${PROVIDER}, ${manifestEventId(input.cutoverKey)},
      'commercial_transition_cutover', 'processed', NULL,
      ${JSON.stringify({
        ...expected,
        actorUserId: input.actorUserId,
        reason: input.reason,
      })}, ${cutoverAt}, ${now}, ${now}, ${now}
    )
  `);
}

async function readCheckpoint(cutoverKey: string) {
  const db = await requireDb(getDb);
  const [row] = resultRows<Row>(
    await db.execute(sql`
      SELECT payloadJson
      FROM billingProviderEvents
      WHERE provider = ${PROVIDER}
        AND providerEventId = ${checkpointEventId(cutoverKey)}
      LIMIT 1
    `)
  );
  if (!row) return 0;
  const payload = jsonObject(row.payloadJson);
  const value = Number(payload.afterUserId ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function writeCheckpoint(input: RunInput, afterUserId: number) {
  const db = await requireDb(getDb);
  const now = new Date();
  const payload = JSON.stringify({
    cutoverKey: input.cutoverKey,
    afterUserId,
    actorUserId: input.actorUserId,
    updatedAt: now.toISOString(),
  });
  await db.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, subscriptionId,
      payloadJson, occurredAt, processedAt, createdAt, updatedAt
    ) VALUES (
      ${crypto.randomUUID()}, ${PROVIDER}, ${checkpointEventId(input.cutoverKey)},
      'commercial_transition_checkpoint', 'processed', NULL,
      ${payload}, ${now}, ${now}, ${now}, ${now}
    )
    ON DUPLICATE KEY UPDATE
      status = 'processed', payloadJson = ${payload}, processedAt = ${now}, updatedAt = ${now}
  `);
}

async function listCandidates(input: RunInput, cutoverAt: Date, afterUserId: number) {
  const db = await requireDb(getDb);
  if (input.retryFailed) {
    return resultRows<Row>(
      await db.execute(sql`
        SELECT u.id, u.createdAt
        FROM billingProviderEvents e
        INNER JOIN users u
          ON u.id = CAST(SUBSTRING_INDEX(e.providerEventId, ':', -1) AS UNSIGNED)
        WHERE e.provider = ${PROVIDER}
          AND e.eventType = 'commercial_transition_item'
          AND e.status = 'failed'
          AND e.providerEventId LIKE ${`item:${input.cutoverKey}:%`}
          AND u.createdAt <= ${cutoverAt}
        ORDER BY u.id ASC
        LIMIT ${input.batchSize}
      `)
    );
  }

  return resultRows<Row>(
    await db.execute(sql`
      SELECT id, createdAt
      FROM users
      WHERE createdAt <= ${cutoverAt}
        AND id > ${afterUserId}
      ORDER BY id ASC
      LIMIT ${input.batchSize}
    `)
  );
}

async function recordItemEvent(input: {
  cutoverKey: string;
  userId: number;
  status: "processed" | "failed";
  payload: Record<string, unknown>;
}) {
  const db = await requireDb(getDb);
  const now = new Date();
  const payload = JSON.stringify(input.payload);
  await db.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, subscriptionId,
      payloadJson, occurredAt, processedAt, createdAt, updatedAt
    ) VALUES (
      ${crypto.randomUUID()}, ${PROVIDER}, ${itemEventId(input.cutoverKey, input.userId)},
      'commercial_transition_item', ${input.status}, NULL,
      ${payload}, ${now}, ${input.status === "processed" ? now : null}, ${now}, ${now}
    )
    ON DUPLICATE KEY UPDATE
      status = ${input.status}, payloadJson = ${payload},
      processedAt = ${input.status === "processed" ? now : null}, updatedAt = ${now}
  `);
}

async function applyTransition(input: RunInput, userId: number, cutoverAt: Date, validUntil: Date) {
  const db = await requireDb(getDb);
  return db.transaction(async tx => {
    const [user] = resultRows<Row>(
      await tx.execute(sql`
        SELECT id, createdAt
        FROM users
        WHERE id = ${userId}
        LIMIT 1
        FOR UPDATE
      `)
    );
    if (!user || dateValue(user.createdAt).getTime() > cutoverAt.getTime()) {
      throw new Error("billing_transition_user_not_eligible");
    }

    const sourceId = transitionSourceId(input.cutoverKey, userId);
    const [existing] = resultRows<Row>(
      await tx.execute(sql`
        SELECT id, validFrom, validUntil, state
        FROM billingEntitlements
        WHERE beneficiaryUserId = ${userId}
          AND sourceType = 'transition'
          AND sourceId = ${sourceId}
        LIMIT 1
        FOR UPDATE
      `)
    );
    if (existing) {
      const existingFrom = dateValue(existing.validFrom);
      const existingUntil = dateValue(existing.validUntil);
      if (
        existingFrom.getTime() !== cutoverAt.getTime() ||
        existingUntil.getTime() !== validUntil.getTime()
      ) {
        throw new Error("billing_transition_entitlement_immutable");
      }
      return { created: false, entitlementId: String(existing.id), trialsEnded: 0 };
    }

    const trials = resultRows<Row>(
      await tx.execute(sql`
        SELECT id, sourceId
        FROM billingEntitlements
        WHERE beneficiaryUserId = ${userId}
          AND sourceType = 'trial'
          AND state = 'active'
          AND validFrom <= ${cutoverAt}
          AND (validUntil IS NULL OR validUntil > ${cutoverAt})
        FOR UPDATE
      `)
    );
    if (trials.length > 0) {
      await tx.execute(sql`
        UPDATE billingEntitlements
        SET state = 'ended', activeGrantKey = NULL,
          endedAt = COALESCE(endedAt, ${cutoverAt}), updatedAt = NOW()
        WHERE beneficiaryUserId = ${userId}
          AND sourceType = 'trial'
          AND state = 'active'
          AND validFrom <= ${cutoverAt}
          AND (validUntil IS NULL OR validUntil > ${cutoverAt})
      `);
      for (const trial of trials) {
        await insertAuditEvent(tx, {
          subjectUserId: userId,
          actorUserId: input.actorUserId,
          action: "entitlement_ended",
          sourceType: "trial",
          sourceId: String(trial.sourceId ?? trial.id),
          metadata: {
            reason: "commercial_transition_replaces_trial",
            cutoverKey: input.cutoverKey,
          },
        });
      }
    }

    const entitlementId = crypto.randomUUID();
    await tx.execute(sql`
      INSERT INTO billingEntitlements (
        id, beneficiaryUserId, sourceType, sourceId, sponsorUserId,
        planId, professionalAuthorizationId, state, activeGrantKey,
        entitlementsJson, validFrom, validUntil, createdAt, updatedAt
      ) VALUES (
        ${entitlementId}, ${userId}, 'transition', ${sourceId}, NULL,
        NULL, NULL, 'active', ${activeGrantKey(input.cutoverKey, userId)},
        ${JSON.stringify(SYSTEM_ACCESS_ENTITLEMENTS)}, ${cutoverAt}, ${validUntil}, NOW(), NOW()
      )
    `);
    await insertAuditEvent(tx, {
      subjectUserId: userId,
      actorUserId: input.actorUserId,
      action: "entitlement_granted",
      sourceType: "transition",
      sourceId,
      metadata: {
        cutoverKey: input.cutoverKey,
        validFrom: cutoverAt.toISOString(),
        validUntil: validUntil.toISOString(),
        transitionDays: TRANSITION_DAYS,
      },
    });
    return { created: true, entitlementId, trialsEnded: trials.length };
  });
}

export async function runBillingCommercialTransitionBatch(input: RunInput) {
  const cutoverAt = dateValue(input.cutoverAt);
  const { validUntil } = getCommercialTransitionWindow(cutoverAt);
  const now = new Date();

  if (!input.dryRun) {
    if (input.confirmation !== input.cutoverKey) {
      throw new Error("billing_transition_confirmation_required");
    }
    if (cutoverAt.getTime() > now.getTime()) {
      throw new Error("billing_transition_cutover_not_reached");
    }
    if (validUntil.getTime() <= now.getTime()) {
      throw new Error("billing_transition_window_elapsed");
    }
    await ensureManifest(input, cutoverAt, validUntil);
  } else {
    const existing = await readManifest(input.cutoverKey);
    if (
      existing &&
      (existing.cutoverAt !== cutoverAt.toISOString() ||
        existing.validUntil !== validUntil.toISOString() ||
        existing.timezone !== input.timezone)
    ) {
      throw new Error("billing_transition_cutover_immutable");
    }
  }

  const afterUserId = input.retryFailed ? 0 : await readCheckpoint(input.cutoverKey);
  const candidates = await listCandidates(input, cutoverAt, afterUserId);
  const ids = candidates.map(row => Number(row.id)).filter(Number.isSafeInteger);

  if (input.dryRun) {
    return {
      dryRun: true as const,
      cutoverKey: input.cutoverKey,
      cutoverAt,
      validUntil,
      retryFailed: input.retryFailed,
      checkpointBefore: afterUserId,
      candidateCount: ids.length,
      firstCandidateUserId: ids[0] ?? null,
      lastCandidateUserId: ids.at(-1) ?? null,
      processed: 0,
      failed: 0,
      checkpointAfter: afterUserId,
    };
  }

  let processed = 0;
  let created = 0;
  let idempotent = 0;
  let trialsEnded = 0;
  const failures: Array<{ userId: number; code: string }> = [];

  for (const userId of ids) {
    try {
      const result = await applyTransition(input, userId, cutoverAt, validUntil);
      processed += 1;
      created += result.created ? 1 : 0;
      idempotent += result.created ? 0 : 1;
      trialsEnded += result.trialsEnded;
      await recordItemEvent({
        cutoverKey: input.cutoverKey,
        userId,
        status: "processed",
        payload: {
          cutoverKey: input.cutoverKey,
          userId,
          entitlementId: result.entitlementId,
          idempotent: !result.created,
          trialsEnded: result.trialsEnded,
        },
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "billing_transition_unknown_failure";
      failures.push({ userId, code });
      await recordItemEvent({
        cutoverKey: input.cutoverKey,
        userId,
        status: "failed",
        payload: { cutoverKey: input.cutoverKey, userId, code },
      });
    }
  }

  const checkpointAfter = input.retryFailed ? afterUserId : (ids.at(-1) ?? afterUserId);
  if (!input.retryFailed && checkpointAfter !== afterUserId) {
    await writeCheckpoint(input, checkpointAfter);
  }

  return {
    dryRun: false as const,
    cutoverKey: input.cutoverKey,
    cutoverAt,
    validUntil,
    retryFailed: input.retryFailed,
    checkpointBefore: afterUserId,
    candidateCount: ids.length,
    processed,
    created,
    idempotent,
    trialsEnded,
    failed: failures.length,
    failures,
    checkpointAfter,
  };
}

export async function reconcileBillingCommercialTransition(input: ReconcileInput) {
  const manifest = await readManifest(input.cutoverKey);
  if (!manifest) throw new Error("billing_transition_cutover_not_found");
  const cutoverAt = dateValue(manifest.cutoverAt);
  const validUntil = dateValue(manifest.validUntil);
  const db = await requireDb(getDb);
  const [eligible] = resultRows<Row>(
    await db.execute(sql`SELECT COUNT(*) AS total FROM users WHERE createdAt <= ${cutoverAt}`)
  );
  const [granted] = resultRows<Row>(
    await db.execute(sql`
      SELECT COUNT(*) AS total
      FROM billingEntitlements
      WHERE sourceType = 'transition'
        AND sourceId LIKE ${`commercial-cutover:${input.cutoverKey}:%`}
        AND validFrom = ${cutoverAt}
        AND validUntil = ${validUntil}
    `)
  );
  const [failed] = resultRows<Row>(
    await db.execute(sql`
      SELECT COUNT(*) AS total
      FROM billingProviderEvents
      WHERE provider = ${PROVIDER}
        AND eventType = 'commercial_transition_item'
        AND status = 'failed'
        AND providerEventId LIKE ${`item:${input.cutoverKey}:%`}
    `)
  );
  const checkpointAfter = await readCheckpoint(input.cutoverKey);
  const eligibleCount = Number(eligible?.total ?? 0);
  const grantedCount = Number(granted?.total ?? 0);
  const failedCount = Number(failed?.total ?? 0);
  return {
    cutoverKey: input.cutoverKey,
    cutoverAt,
    validUntil,
    timezone: String(manifest.timezone ?? ""),
    eligibleCount,
    grantedCount,
    failedCount,
    missingCount: Math.max(0, eligibleCount - grantedCount - failedCount),
    checkpointAfter,
    reconciled: eligibleCount === grantedCount && failedCount === 0,
  };
}
