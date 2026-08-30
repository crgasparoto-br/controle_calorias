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
  billingCommercialTransitionMaintenanceSchema,
  billingCommercialTransitionReconcileSchema,
  billingCommercialTransitionRunSchema,
} from "./billingCommercialTransitionSchemas";

type Row = Record<string, unknown>;
type RunInput = z.infer<typeof billingCommercialTransitionRunSchema> & {
  actorUserId: number;
};
type MaintenanceInput = z.infer<typeof billingCommercialTransitionMaintenanceSchema> & {
  actorUserId: number;
};
type ReconcileInput = z.infer<typeof billingCommercialTransitionReconcileSchema>;

export type CommercialTransitionMilestone = "start" | "D15" | "D7" | "D1" | "end";
export type CommercialTransitionDeliveryChannel = "email" | "whatsapp";

const PROVIDER = "billing-commercial-transition";
const TRANSITION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const CAMPAIGN_VERSION = "v1";
const SNAPSHOT_RULE_VERSION = "users-created-at-lte-cutover-v1";
const SNAPSHOT_EVENT_TYPE = "commercial_transition_snapshot_member";
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

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integerValue(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function getCommercialTransitionWindow(cutoverAt: Date) {
  const start = new Date(cutoverAt.getTime());
  const end = new Date(start.getTime() + TRANSITION_DAYS * DAY_MS);
  return { validFrom: start, validUntil: end };
}

export function getCommercialTransitionMilestones(
  validFrom: Date,
  validUntil: Date
): Array<{ milestone: CommercialTransitionMilestone; scheduledAt: Date }> {
  return [
    { milestone: "start", scheduledAt: new Date(validFrom.getTime()) },
    { milestone: "D15", scheduledAt: new Date(validUntil.getTime() - 15 * DAY_MS) },
    { milestone: "D7", scheduledAt: new Date(validUntil.getTime() - 7 * DAY_MS) },
    { milestone: "D1", scheduledAt: new Date(validUntil.getTime() - DAY_MS) },
    { milestone: "end", scheduledAt: new Date(validUntil.getTime()) },
  ];
}

export function getCommercialTransitionDeliverySchedule(
  scheduledAt: Date,
  channel: CommercialTransitionDeliveryChannel
) {
  const offsets = channel === "email" ? [0, 60 * 60 * 1000, DAY_MS] : [0, 2 * 60 * 60 * 1000, DAY_MS];
  return offsets.map((offsetMs, attemptIndex) => ({
    attemptIndex,
    dueAt: new Date(scheduledAt.getTime() + offsetMs),
  }));
}

export function getCommercialTransitionSnapshotFingerprint(userIds: number[]) {
  const normalized = [...new Set(userIds.filter(Number.isSafeInteger))].sort((a, b) => a - b);
  const hash = crypto.createHash("sha256");
  for (const userId of normalized) hash.update(`${userId}\n`, "utf8");
  return hash.digest("hex");
}

function manifestEventId(cutoverKey: string) {
  return `cutover:${cutoverKey}`;
}

function snapshotMemberEventPrefix(cutoverKey: string) {
  return `snapshot:${cutoverKey}:`;
}

function snapshotMemberEventId(cutoverKey: string, userId: number) {
  return `${snapshotMemberEventPrefix(cutoverKey)}${userId}`;
}

function migrationCheckpointEventId(cutoverKey: string) {
  return `checkpoint:${cutoverKey}`;
}

function phaseCheckpointEventId(cutoverKey: string, phase: string) {
  return `checkpoint:${phase}:${cutoverKey}`;
}

function itemEventId(cutoverKey: string, userId: number) {
  return `item:${cutoverKey}:${userId}`;
}

function phaseItemEventId(cutoverKey: string, phase: string, userId: number) {
  return `${phase}-item:${cutoverKey}:${userId}`;
}

function transitionSourcePrefix(cutoverKey: string) {
  return `commercial-cutover:${cutoverKey}:`;
}

function transitionSourceId(cutoverKey: string, userId: number) {
  return `${transitionSourcePrefix(cutoverKey)}${userId}`;
}

function itemEventPrefix(cutoverKey: string) {
  return `item:${cutoverKey}:`;
}

function phaseItemEventPrefix(cutoverKey: string, phase: string) {
  return `${phase}-item:${cutoverKey}:`;
}

function notificationEventPrefix(cutoverKey: string) {
  return `notification:${cutoverKey}:`;
}

function notificationProviderEventId(
  cutoverKey: string,
  userId: number,
  milestone: CommercialTransitionMilestone
) {
  return `${notificationEventPrefix(cutoverKey)}${userId}:${milestone}:${CAMPAIGN_VERSION}`;
}

function deliveryProviderEventId(input: {
  cutoverKey: string;
  userId: number;
  milestone: CommercialTransitionMilestone;
  channel: CommercialTransitionDeliveryChannel;
  attemptIndex: number;
}) {
  return `delivery:${input.cutoverKey}:${input.userId}:${input.milestone}:${input.channel}:${input.attemptIndex}:${CAMPAIGN_VERSION}`;
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

function expectedManifestIdentity(input: RunInput, cutoverAt: Date, validUntil: Date) {
  return {
    cutoverKey: input.cutoverKey,
    cutoverAt: cutoverAt.toISOString(),
    validUntil: validUntil.toISOString(),
    timezone: input.timezone,
    snapshotRuleVersion: SNAPSHOT_RULE_VERSION,
    snapshotMemberPrefix: snapshotMemberEventPrefix(input.cutoverKey),
  };
}

function assertManifestMatches(
  existing: Record<string, unknown>,
  expected: ReturnType<typeof expectedManifestIdentity>
) {
  if (
    existing.cutoverKey !== expected.cutoverKey ||
    existing.cutoverAt !== expected.cutoverAt ||
    existing.validUntil !== expected.validUntil ||
    existing.timezone !== expected.timezone ||
    existing.snapshotRuleVersion !== expected.snapshotRuleVersion ||
    existing.snapshotMemberPrefix !== expected.snapshotMemberPrefix
  ) {
    throw new Error("billing_transition_cutover_immutable");
  }
  if (
    existing.snapshotState !== "ready" ||
    integerValue(existing.eligibleCount) === null ||
    typeof existing.populationSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(existing.populationSha256)
  ) {
    throw new Error("billing_transition_snapshot_manifest_invalid");
  }
}

async function countSnapshotMembers(cutoverKey: string) {
  const db = await requireDb(getDb);
  const prefix = snapshotMemberEventPrefix(cutoverKey);
  const [row] = resultRows<Row>(await db.execute(sql`
    SELECT COUNT(*) AS total
    FROM billingProviderEvents
    WHERE provider = ${PROVIDER}
      AND eventType = ${SNAPSHOT_EVENT_TYPE}
      AND LEFT(providerEventId, CHAR_LENGTH(${prefix})) = ${prefix}
  `));
  return numberValue(row?.total);
}

async function assertSnapshotMemberCount(
  cutoverKey: string,
  manifest: Record<string, unknown>
) {
  const expectedCount = integerValue(manifest.eligibleCount);
  if (expectedCount === null) throw new Error("billing_transition_snapshot_manifest_invalid");
  const snapshotCount = await countSnapshotMembers(cutoverKey);
  if (snapshotCount !== expectedCount) {
    throw new Error("billing_transition_snapshot_integrity_mismatch");
  }
}

async function ensureManifest(input: RunInput, cutoverAt: Date, validUntil: Date) {
  const expected = expectedManifestIdentity(input, cutoverAt, validUntil);
  const existing = await readManifest(input.cutoverKey);
  if (existing) {
    assertManifestMatches(existing, expected);
    await assertSnapshotMemberCount(input.cutoverKey, existing);
    return existing;
  }

  const db = await requireDb(getDb);
  const now = new Date();
  const manifestRowId = crypto.randomUUID();
  return db.transaction(async tx => {
    const buildingPayload = JSON.stringify({
      ...expected,
      actorUserId: input.actorUserId,
      reason: input.reason,
      snapshotState: "building",
    });
    await tx.execute(sql`
      INSERT IGNORE INTO billingProviderEvents (
        id, provider, providerEventId, eventType, status, subscriptionId,
        payloadJson, occurredAt, processedAt, createdAt, updatedAt
      ) VALUES (
        ${manifestRowId}, ${PROVIDER}, ${manifestEventId(input.cutoverKey)},
        'commercial_transition_cutover', 'received', NULL,
        ${buildingPayload}, ${cutoverAt}, NULL, ${now}, ${now}
      )
    `);

    const [manifestRow] = resultRows<Row>(await tx.execute(sql`
      SELECT id, status, payloadJson
      FROM billingProviderEvents
      WHERE provider = ${PROVIDER}
        AND providerEventId = ${manifestEventId(input.cutoverKey)}
      LIMIT 1
      FOR UPDATE
    `));
    if (!manifestRow) throw new Error("billing_transition_cutover_manifest_missing");

    if (String(manifestRow.id) !== manifestRowId) {
      const persisted = jsonObject(manifestRow.payloadJson);
      assertManifestMatches(persisted, expected);
      return persisted;
    }

    const snapshotPrefix = snapshotMemberEventPrefix(input.cutoverKey);
    await tx.execute(sql`
      INSERT IGNORE INTO billingProviderEvents (
        id, provider, providerEventId, eventType, status, subscriptionId,
        payloadJson, occurredAt, processedAt, createdAt, updatedAt
      )
      SELECT
        UUID(), ${PROVIDER}, CONCAT(${snapshotPrefix}, CAST(u.id AS CHAR)),
        ${SNAPSHOT_EVENT_TYPE}, 'processed', NULL,
        JSON_OBJECT(
          'cutoverKey', ${input.cutoverKey},
          'userId', u.id,
          'userCreatedAt', u.createdAt,
          'selectionRuleVersion', ${SNAPSHOT_RULE_VERSION}
        ),
        ${cutoverAt}, ${now}, ${now}, ${now}
      FROM users u
      WHERE u.createdAt <= ${cutoverAt}
    `);

    const snapshotRows = resultRows<Row>(await tx.execute(sql`
      SELECT CAST(SUBSTRING_INDEX(providerEventId, ':', -1) AS UNSIGNED) AS id
      FROM billingProviderEvents
      WHERE provider = ${PROVIDER}
        AND eventType = ${SNAPSHOT_EVENT_TYPE}
        AND LEFT(providerEventId, CHAR_LENGTH(${snapshotPrefix})) = ${snapshotPrefix}
      ORDER BY CAST(SUBSTRING_INDEX(providerEventId, ':', -1) AS UNSIGNED) ASC
    `));
    const snapshotUserIds = snapshotRows
      .map(row => Number(row.id))
      .filter(Number.isSafeInteger);
    const finalManifest = {
      ...expected,
      actorUserId: input.actorUserId,
      reason: input.reason,
      snapshotState: "ready",
      eligibleCount: snapshotUserIds.length,
      populationSha256: getCommercialTransitionSnapshotFingerprint(snapshotUserIds),
    };
    const finalPayload = JSON.stringify(finalManifest);
    await tx.execute(sql`
      UPDATE billingProviderEvents
      SET status = 'processed', payloadJson = ${finalPayload},
        processedAt = ${now}, updatedAt = ${now}
      WHERE id = ${manifestRowId}
    `);
    return finalManifest;
  });
}

async function readCheckpoint(cutoverKey: string, phase?: string) {
  const db = await requireDb(getDb);
  const providerEventId = phase
    ? phaseCheckpointEventId(cutoverKey, phase)
    : migrationCheckpointEventId(cutoverKey);
  const [row] = resultRows<Row>(
    await db.execute(sql`
      SELECT payloadJson
      FROM billingProviderEvents
      WHERE provider = ${PROVIDER}
        AND providerEventId = ${providerEventId}
      LIMIT 1
    `)
  );
  if (!row) return 0;
  const payload = jsonObject(row.payloadJson);
  const value = Number(payload.afterUserId ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function writeCheckpoint(input: {
  cutoverKey: string;
  actorUserId: number;
  afterUserId: number;
  phase?: string;
}) {
  const db = await requireDb(getDb);
  const now = new Date();
  const providerEventId = input.phase
    ? phaseCheckpointEventId(input.cutoverKey, input.phase)
    : migrationCheckpointEventId(input.cutoverKey);
  const payload = JSON.stringify({
    cutoverKey: input.cutoverKey,
    phase: input.phase ?? "migration",
    afterUserId: input.afterUserId,
    actorUserId: input.actorUserId,
    updatedAt: now.toISOString(),
  });
  await db.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, subscriptionId,
      payloadJson, occurredAt, processedAt, createdAt, updatedAt
    ) VALUES (
      ${crypto.randomUUID()}, ${PROVIDER}, ${providerEventId},
      'commercial_transition_checkpoint', 'processed', NULL,
      ${payload}, ${now}, ${now}, ${now}, ${now}
    )
    ON DUPLICATE KEY UPDATE
      status = 'processed', payloadJson = ${payload}, processedAt = ${now}, updatedAt = ${now}
  `);
}

async function listSnapshotMigrationCandidates(input: RunInput, afterUserId: number) {
  const db = await requireDb(getDb);
  const snapshotPrefix = snapshotMemberEventPrefix(input.cutoverKey);
  if (input.retryFailed) {
    const failedPrefix = itemEventPrefix(input.cutoverKey);
    return resultRows<Row>(await db.execute(sql`
      SELECT CAST(SUBSTRING_INDEX(snapshot.providerEventId, ':', -1) AS UNSIGNED) AS id
      FROM billingProviderEvents snapshot
      INNER JOIN billingProviderEvents item
        ON item.provider = ${PROVIDER}
        AND item.eventType = 'commercial_transition_item'
        AND item.providerEventId = CONCAT(
          ${failedPrefix}, SUBSTRING_INDEX(snapshot.providerEventId, ':', -1)
        )
      WHERE snapshot.provider = ${PROVIDER}
        AND snapshot.eventType = ${SNAPSHOT_EVENT_TYPE}
        AND LEFT(snapshot.providerEventId, CHAR_LENGTH(${snapshotPrefix})) = ${snapshotPrefix}
        AND item.status = 'failed'
      ORDER BY CAST(SUBSTRING_INDEX(snapshot.providerEventId, ':', -1) AS UNSIGNED) ASC
      LIMIT ${input.batchSize}
    `));
  }

  return resultRows<Row>(await db.execute(sql`
    SELECT CAST(SUBSTRING_INDEX(providerEventId, ':', -1) AS UNSIGNED) AS id
    FROM billingProviderEvents
    WHERE provider = ${PROVIDER}
      AND eventType = ${SNAPSHOT_EVENT_TYPE}
      AND LEFT(providerEventId, CHAR_LENGTH(${snapshotPrefix})) = ${snapshotPrefix}
      AND CAST(SUBSTRING_INDEX(providerEventId, ':', -1) AS UNSIGNED) > ${afterUserId}
    ORDER BY CAST(SUBSTRING_INDEX(providerEventId, ':', -1) AS UNSIGNED) ASC
    LIMIT ${input.batchSize}
  `));
}

async function listPreviewMigrationCandidates(input: RunInput, cutoverAt: Date, afterUserId: number) {
  if (input.retryFailed) return [];
  const db = await requireDb(getDb);
  return resultRows<Row>(await db.execute(sql`
    SELECT id, createdAt
    FROM users
    WHERE createdAt <= ${cutoverAt}
      AND id > ${afterUserId}
    ORDER BY id ASC
    LIMIT ${input.batchSize}
  `));
}

async function listTransitionUsers(input: {
  cutoverKey: string;
  validFrom: Date;
  validUntil: Date;
  batchSize: number;
  afterUserId: number;
  retryFailed: boolean;
  phase: string;
}) {
  const db = await requireDb(getDb);
  const sourcePrefix = transitionSourcePrefix(input.cutoverKey);
  if (input.retryFailed) {
    const failedPrefix = phaseItemEventPrefix(input.cutoverKey, input.phase);
    return resultRows<Row>(
      await db.execute(sql`
        SELECT e2.beneficiaryUserId AS id, e2.id AS entitlementId, e2.state, e2.validFrom, e2.validUntil
        FROM billingProviderEvents event
        INNER JOIN billingEntitlements e2
          ON e2.beneficiaryUserId = CAST(SUBSTRING_INDEX(event.providerEventId, ':', -1) AS UNSIGNED)
        WHERE event.provider = ${PROVIDER}
          AND event.eventType = 'commercial_transition_phase_item'
          AND event.status = 'failed'
          AND LEFT(event.providerEventId, CHAR_LENGTH(${failedPrefix})) = ${failedPrefix}
          AND e2.sourceType = 'transition'
          AND LEFT(e2.sourceId, CHAR_LENGTH(${sourcePrefix})) = ${sourcePrefix}
          AND e2.validFrom = ${input.validFrom}
          AND e2.validUntil = ${input.validUntil}
        ORDER BY e2.beneficiaryUserId ASC
        LIMIT ${input.batchSize}
      `)
    );
  }

  return resultRows<Row>(
    await db.execute(sql`
      SELECT beneficiaryUserId AS id, id AS entitlementId, state, validFrom, validUntil
      FROM billingEntitlements
      WHERE sourceType = 'transition'
        AND LEFT(sourceId, CHAR_LENGTH(${sourcePrefix})) = ${sourcePrefix}
        AND validFrom = ${input.validFrom}
        AND validUntil = ${input.validUntil}
        AND beneficiaryUserId > ${input.afterUserId}
      ORDER BY beneficiaryUserId ASC
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

async function recordPhaseItem(input: {
  cutoverKey: string;
  phase: string;
  userId: number;
  status: "processed" | "failed";
  payload: Record<string, unknown>;
}) {
  const db = await requireDb(getDb);
  const now = new Date();
  const payload = JSON.stringify({ ...input.payload, phase: input.phase });
  await db.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, subscriptionId,
      payloadJson, occurredAt, processedAt, createdAt, updatedAt
    ) VALUES (
      ${crypto.randomUUID()}, ${PROVIDER}, ${phaseItemEventId(input.cutoverKey, input.phase, input.userId)},
      'commercial_transition_phase_item', ${input.status}, NULL,
      ${payload}, ${now}, ${input.status === "processed" ? now : null}, ${now}, ${now}
    )
    ON DUPLICATE KEY UPDATE
      status = ${input.status}, payloadJson = ${payload},
      processedAt = ${input.status === "processed" ? now : null}, updatedAt = ${now}
  `);
}

async function persistTransitionNotification(input: {
  cutoverKey: string;
  userId: number;
  milestone: CommercialTransitionMilestone;
  scheduledAt: Date;
  validFrom: Date;
  validUntil: Date;
  actorUserId: number;
}) {
  const db = await requireDb(getDb);
  const now = new Date();
  const providerEventId = notificationProviderEventId(
    input.cutoverKey,
    input.userId,
    input.milestone
  );
  const communicationKey = `commercial-transition:${input.cutoverKey}:${input.userId}:${input.milestone}:${CAMPAIGN_VERSION}`;
  const notificationId = crypto.randomUUID();
  const payload = JSON.stringify({
    userId: input.userId,
    cutoverKey: input.cutoverKey,
    campaign: "Transição comercial",
    campaignVersion: CAMPAIGN_VERSION,
    communicationKey,
    milestone: input.milestone,
    validFrom: input.validFrom.toISOString(),
    validUntil: input.validUntil.toISOString(),
    effectiveAt: input.scheduledAt.toISOString(),
    actorUserId: input.actorUserId,
    essential: true,
  });
  await db.execute(sql`
    INSERT IGNORE INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, subscriptionId,
      payloadJson, occurredAt, processedAt, createdAt, updatedAt
    ) VALUES (
      ${notificationId}, ${PROVIDER}, ${providerEventId},
      'commercial_transition_notification', 'processed', NULL,
      ${payload}, ${input.scheduledAt}, ${now}, ${now}, ${now}
    )
  `);
  const [persisted] = resultRows<Row>(await db.execute(sql`
    SELECT id FROM billingProviderEvents
    WHERE provider=${PROVIDER} AND providerEventId=${providerEventId}
    LIMIT 1
  `));
  if (!persisted?.id) throw new Error("billing_transition_notification_missing");
  const sourceNotificationId = String(persisted.id);

  for (const channel of ["email", "whatsapp"] as const) {
    for (const attempt of getCommercialTransitionDeliverySchedule(input.scheduledAt, channel)) {
      const attemptPayload = JSON.stringify({
        userId: input.userId,
        cutoverKey: input.cutoverKey,
        sourceNotificationId,
        communicationKey,
        campaign: "Transição comercial",
        campaignVersion: CAMPAIGN_VERSION,
        milestone: input.milestone,
        channel,
        attemptIndex: attempt.attemptIndex,
        dueAt: attempt.dueAt.toISOString(),
        state: "scheduled",
        requiresApprovedSenderAndTemplate: true,
      });
      await db.execute(sql`
        INSERT IGNORE INTO billingProviderEvents (
          id, provider, providerEventId, eventType, status, subscriptionId,
          payloadJson, occurredAt, createdAt, updatedAt
        ) VALUES (
          ${crypto.randomUUID()}, ${PROVIDER}, ${deliveryProviderEventId({
            cutoverKey: input.cutoverKey,
            userId: input.userId,
            milestone: input.milestone,
            channel,
            attemptIndex: attempt.attemptIndex,
          })}, 'commercial_transition_delivery_attempt', 'received', NULL,
          ${attemptPayload}, ${attempt.dueAt}, ${now}, ${now}
        )
      `);
    }
  }
  return { notificationId: sourceNotificationId, communicationKey };
}

async function ensureDueNotificationsForUser(input: {
  cutoverKey: string;
  userId: number;
  validFrom: Date;
  validUntil: Date;
  actorUserId: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const due = getCommercialTransitionMilestones(input.validFrom, input.validUntil)
    .filter(item => item.scheduledAt.getTime() <= now.getTime());
  for (const item of due) {
    await persistTransitionNotification({
      ...input,
      milestone: item.milestone,
      scheduledAt: item.scheduledAt,
    });
  }
  return due.length;
}

async function applyTransition(
  input: RunInput,
  userId: number,
  cutoverAt: Date,
  validUntil: Date
) {
  const db = await requireDb(getDb);
  return db.transaction(async tx => {
    const [user] = resultRows<Row>(
      await tx.execute(sql`
        SELECT id
        FROM users
        WHERE id = ${userId}
        LIMIT 1
        FOR UPDATE
      `)
    );
    const [snapshotMember] = resultRows<Row>(await tx.execute(sql`
      SELECT providerEventId
      FROM billingProviderEvents
      WHERE provider = ${PROVIDER}
        AND eventType = ${SNAPSHOT_EVENT_TYPE}
        AND providerEventId = ${snapshotMemberEventId(input.cutoverKey, userId)}
      LIMIT 1
    `));
    if (!user || !snapshotMember) {
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

async function finalizeTransition(input: {
  cutoverKey: string;
  userId: number;
  validFrom: Date;
  validUntil: Date;
  actorUserId: number;
}) {
  const db = await requireDb(getDb);
  return db.transaction(async tx => {
    const sourceId = transitionSourceId(input.cutoverKey, input.userId);
    const [existing] = resultRows<Row>(await tx.execute(sql`
      SELECT id, state, validFrom, validUntil, endedAt
      FROM billingEntitlements
      WHERE beneficiaryUserId=${input.userId}
        AND sourceType='transition'
        AND sourceId=${sourceId}
      LIMIT 1 FOR UPDATE
    `));
    if (!existing) throw new Error("billing_transition_entitlement_not_found");
    if (
      dateValue(existing.validFrom).getTime() !== input.validFrom.getTime() ||
      dateValue(existing.validUntil).getTime() !== input.validUntil.getTime()
    ) {
      throw new Error("billing_transition_entitlement_immutable");
    }
    if (String(existing.state) === "ended") {
      return { ended: false, entitlementId: String(existing.id) };
    }
    await tx.execute(sql`
      UPDATE billingEntitlements
      SET state='ended', activeGrantKey=NULL,
        endedAt=COALESCE(endedAt, ${input.validUntil}), updatedAt=NOW()
      WHERE id=${String(existing.id)}
    `);
    await insertAuditEvent(tx, {
      subjectUserId: input.userId,
      actorUserId: input.actorUserId,
      action: "entitlement_ended",
      sourceType: "transition",
      sourceId,
      metadata: {
        reason: "commercial_transition_elapsed",
        cutoverKey: input.cutoverKey,
        validUntil: input.validUntil.toISOString(),
      },
    });
    return { ended: true, entitlementId: String(existing.id) };
  });
}

function assertExecutionConfirmed(input: { cutoverKey: string; dryRun: boolean; confirmation?: string }) {
  if (!input.dryRun && input.confirmation !== input.cutoverKey) {
    throw new Error("billing_transition_confirmation_required");
  }
}

export async function runBillingCommercialTransitionBatch(input: RunInput) {
  const cutoverAt = dateValue(input.cutoverAt);
  const { validUntil } = getCommercialTransitionWindow(cutoverAt);
  const now = new Date();
  assertExecutionConfirmed(input);

  let manifest: Record<string, unknown> | null = null;
  if (!input.dryRun) {
    if (cutoverAt.getTime() > now.getTime()) {
      throw new Error("billing_transition_cutover_not_reached");
    }
    if (validUntil.getTime() <= now.getTime()) {
      throw new Error("billing_transition_window_elapsed");
    }
    manifest = await ensureManifest(input, cutoverAt, validUntil);
  } else {
    manifest = await readManifest(input.cutoverKey);
    if (manifest) {
      assertManifestMatches(manifest, expectedManifestIdentity(input, cutoverAt, validUntil));
      await assertSnapshotMemberCount(input.cutoverKey, manifest);
    } else if (input.retryFailed) {
      throw new Error("billing_transition_cutover_not_found");
    }
  }

  const afterUserId = input.retryFailed ? 0 : await readCheckpoint(input.cutoverKey);
  const candidates = manifest
    ? await listSnapshotMigrationCandidates(input, afterUserId)
    : await listPreviewMigrationCandidates(input, cutoverAt, afterUserId);
  const ids = candidates.map(row => Number(row.id)).filter(Number.isSafeInteger);

  if (input.dryRun) {
    return {
      dryRun: true as const,
      cutoverKey: input.cutoverKey,
      cutoverAt,
      validUntil,
      retryFailed: input.retryFailed,
      snapshotFrozen: Boolean(manifest),
      snapshotEligibleCount: manifest ? integerValue(manifest.eligibleCount) : null,
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
  let notificationsEnsured = 0;
  const failures: Array<{ userId: number; code: string }> = [];

  for (const userId of ids) {
    try {
      const result = await applyTransition(input, userId, cutoverAt, validUntil);
      notificationsEnsured += await ensureDueNotificationsForUser({
        cutoverKey: input.cutoverKey,
        userId,
        validFrom: cutoverAt,
        validUntil,
        actorUserId: input.actorUserId,
        now,
      });
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
          internalNotificationsEnsured: true,
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
    await writeCheckpoint({
      cutoverKey: input.cutoverKey,
      actorUserId: input.actorUserId,
      afterUserId: checkpointAfter,
    });
  }

  return {
    dryRun: false as const,
    cutoverKey: input.cutoverKey,
    cutoverAt,
    validUntil,
    retryFailed: input.retryFailed,
    snapshotFrozen: true,
    snapshotEligibleCount: integerValue(manifest?.eligibleCount),
    snapshotPopulationSha256: String(manifest?.populationSha256 ?? ""),
    checkpointBefore: afterUserId,
    candidateCount: ids.length,
    processed,
    created,
    idempotent,
    trialsEnded,
    notificationsEnsured,
    failed: failures.length,
    failures,
    checkpointAfter,
  };
}

export async function runBillingCommercialTransitionNotificationBatch(input: MaintenanceInput) {
  assertExecutionConfirmed(input);
  const manifest = await readManifest(input.cutoverKey);
  if (!manifest) throw new Error("billing_transition_cutover_not_found");
  const validFrom = dateValue(manifest.cutoverAt);
  const validUntil = dateValue(manifest.validUntil);
  const now = new Date();
  const dueMilestones = getCommercialTransitionMilestones(validFrom, validUntil)
    .filter(item => item.scheduledAt.getTime() <= now.getTime());
  const results: Array<Record<string, unknown>> = [];

  for (const milestone of dueMilestones) {
    const phase = `notify-${milestone.milestone}`;
    const checkpointBefore = input.retryFailed ? 0 : await readCheckpoint(input.cutoverKey, phase);
    const candidates = await listTransitionUsers({
      cutoverKey: input.cutoverKey,
      validFrom,
      validUntil,
      batchSize: input.batchSize,
      afterUserId: checkpointBefore,
      retryFailed: input.retryFailed,
      phase,
    });
    const ids = candidates.map(row => Number(row.id)).filter(Number.isSafeInteger);
    if (input.dryRun) {
      results.push({
        milestone: milestone.milestone,
        scheduledAt: milestone.scheduledAt,
        checkpointBefore,
        candidateCount: ids.length,
        checkpointAfter: checkpointBefore,
        processed: 0,
        failed: 0,
      });
      continue;
    }

    let processed = 0;
    const failures: Array<{ userId: number; code: string }> = [];
    for (const userId of ids) {
      try {
        await persistTransitionNotification({
          cutoverKey: input.cutoverKey,
          userId,
          milestone: milestone.milestone,
          scheduledAt: milestone.scheduledAt,
          validFrom,
          validUntil,
          actorUserId: input.actorUserId,
        });
        processed += 1;
        await recordPhaseItem({
          cutoverKey: input.cutoverKey,
          phase,
          userId,
          status: "processed",
          payload: { milestone: milestone.milestone, scheduledAt: milestone.scheduledAt.toISOString() },
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : "billing_transition_notification_failure";
        failures.push({ userId, code });
        await recordPhaseItem({
          cutoverKey: input.cutoverKey,
          phase,
          userId,
          status: "failed",
          payload: { milestone: milestone.milestone, code },
        });
      }
    }
    const checkpointAfter = input.retryFailed ? checkpointBefore : (ids.at(-1) ?? checkpointBefore);
    if (!input.retryFailed && checkpointAfter !== checkpointBefore) {
      await writeCheckpoint({
        cutoverKey: input.cutoverKey,
        actorUserId: input.actorUserId,
        afterUserId: checkpointAfter,
        phase,
      });
    }
    results.push({
      milestone: milestone.milestone,
      scheduledAt: milestone.scheduledAt,
      checkpointBefore,
      candidateCount: ids.length,
      checkpointAfter,
      processed,
      failed: failures.length,
      failures,
    });
  }

  return {
    dryRun: input.dryRun,
    cutoverKey: input.cutoverKey,
    validFrom,
    validUntil,
    dueMilestones: dueMilestones.map(item => item.milestone),
    results,
  };
}

export async function runBillingCommercialTransitionFinalizeBatch(input: MaintenanceInput) {
  assertExecutionConfirmed(input);
  const manifest = await readManifest(input.cutoverKey);
  if (!manifest) throw new Error("billing_transition_cutover_not_found");
  const validFrom = dateValue(manifest.cutoverAt);
  const validUntil = dateValue(manifest.validUntil);
  const now = new Date();
  if (now.getTime() < validUntil.getTime()) {
    throw new Error("billing_transition_window_not_elapsed");
  }
  const phase = "finalize";
  const checkpointBefore = input.retryFailed ? 0 : await readCheckpoint(input.cutoverKey, phase);
  const candidates = await listTransitionUsers({
    cutoverKey: input.cutoverKey,
    validFrom,
    validUntil,
    batchSize: input.batchSize,
    afterUserId: checkpointBefore,
    retryFailed: input.retryFailed,
    phase,
  });
  const ids = candidates.map(row => Number(row.id)).filter(Number.isSafeInteger);
  if (input.dryRun) {
    return {
      dryRun: true as const,
      cutoverKey: input.cutoverKey,
      validFrom,
      validUntil,
      checkpointBefore,
      candidateCount: ids.length,
      ended: 0,
      idempotent: 0,
      failed: 0,
      checkpointAfter: checkpointBefore,
    };
  }

  let ended = 0;
  let idempotent = 0;
  const failures: Array<{ userId: number; code: string }> = [];
  for (const userId of ids) {
    try {
      await persistTransitionNotification({
        cutoverKey: input.cutoverKey,
        userId,
        milestone: "end",
        scheduledAt: validUntil,
        validFrom,
        validUntil,
        actorUserId: input.actorUserId,
      });
      const result = await finalizeTransition({
        cutoverKey: input.cutoverKey,
        userId,
        validFrom,
        validUntil,
        actorUserId: input.actorUserId,
      });
      ended += result.ended ? 1 : 0;
      idempotent += result.ended ? 0 : 1;
      await recordPhaseItem({
        cutoverKey: input.cutoverKey,
        phase,
        userId,
        status: "processed",
        payload: { entitlementId: result.entitlementId, idempotent: !result.ended },
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "billing_transition_finalize_failure";
      failures.push({ userId, code });
      await recordPhaseItem({
        cutoverKey: input.cutoverKey,
        phase,
        userId,
        status: "failed",
        payload: { code },
      });
    }
  }
  const checkpointAfter = input.retryFailed ? checkpointBefore : (ids.at(-1) ?? checkpointBefore);
  if (!input.retryFailed && checkpointAfter !== checkpointBefore) {
    await writeCheckpoint({
      cutoverKey: input.cutoverKey,
      actorUserId: input.actorUserId,
      afterUserId: checkpointAfter,
      phase,
    });
  }
  return {
    dryRun: false as const,
    cutoverKey: input.cutoverKey,
    validFrom,
    validUntil,
    checkpointBefore,
    candidateCount: ids.length,
    ended,
    idempotent,
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
  const now = new Date();
  const db = await requireDb(getDb);
  const sourcePrefix = transitionSourcePrefix(input.cutoverKey);
  const migrationPrefix = itemEventPrefix(input.cutoverKey);
  const notificationPrefix = notificationEventPrefix(input.cutoverKey);
  const deliveryPrefix = `delivery:${input.cutoverKey}:`;
  const snapshotPrefix = snapshotMemberEventPrefix(input.cutoverKey);

  const [snapshotMembers] = resultRows<Row>(await db.execute(sql`
    SELECT COUNT(*) AS total
    FROM billingProviderEvents
    WHERE provider=${PROVIDER}
      AND eventType=${SNAPSHOT_EVENT_TYPE}
      AND LEFT(providerEventId, CHAR_LENGTH(${snapshotPrefix}))=${snapshotPrefix}
  `));
  const [granted] = resultRows<Row>(await db.execute(sql`
    SELECT COUNT(*) AS total
    FROM billingEntitlements
    WHERE sourceType='transition'
      AND LEFT(sourceId, CHAR_LENGTH(${sourcePrefix}))=${sourcePrefix}
      AND validFrom=${cutoverAt} AND validUntil=${validUntil}
  `));
  const [ended] = resultRows<Row>(await db.execute(sql`
    SELECT COUNT(*) AS total
    FROM billingEntitlements
    WHERE sourceType='transition'
      AND LEFT(sourceId, CHAR_LENGTH(${sourcePrefix}))=${sourcePrefix}
      AND validFrom=${cutoverAt} AND validUntil=${validUntil}
      AND state='ended'
  `));
  const [failed] = resultRows<Row>(await db.execute(sql`
    SELECT COUNT(*) AS total
    FROM billingProviderEvents
    WHERE provider=${PROVIDER}
      AND eventType='commercial_transition_item'
      AND status='failed'
      AND LEFT(providerEventId, CHAR_LENGTH(${migrationPrefix}))=${migrationPrefix}
  `));
  const [notifications] = resultRows<Row>(await db.execute(sql`
    SELECT COUNT(*) AS total
    FROM billingProviderEvents
    WHERE provider=${PROVIDER}
      AND eventType='commercial_transition_notification'
      AND status='processed'
      AND LEFT(providerEventId, CHAR_LENGTH(${notificationPrefix}))=${notificationPrefix}
  `));
  const [deliveryPlans] = resultRows<Row>(await db.execute(sql`
    SELECT COUNT(*) AS total
    FROM billingProviderEvents
    WHERE provider=${PROVIDER}
      AND eventType='commercial_transition_delivery_attempt'
      AND LEFT(providerEventId, CHAR_LENGTH(${deliveryPrefix}))=${deliveryPrefix}
  `));
  const [externalFailures] = resultRows<Row>(await db.execute(sql`
    SELECT COUNT(*) AS total
    FROM billingProviderEvents n
    INNER JOIN billingProviderEvents receipt
      ON receipt.provider='billing-web'
      AND receipt.eventType='notification_receipt'
      AND receipt.providerEventId=CONCAT(
        'notification-receipt:',
        JSON_UNQUOTE(JSON_EXTRACT(n.payloadJson, '$.userId')),
        ':', n.id
      )
    WHERE n.provider=${PROVIDER}
      AND n.eventType='commercial_transition_notification'
      AND LEFT(n.providerEventId, CHAR_LENGTH(${notificationPrefix}))=${notificationPrefix}
      AND JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryState'))='failed'
  `));

  const eligibleCount = integerValue(manifest.eligibleCount);
  if (eligibleCount === null) throw new Error("billing_transition_snapshot_manifest_invalid");
  const snapshotMemberCount = numberValue(snapshotMembers?.total);
  const snapshotIntegrityOk = snapshotMemberCount === eligibleCount;
  const grantedCount = numberValue(granted?.total);
  const endedCount = numberValue(ended?.total);
  const failedCount = numberValue(failed?.total);
  const notificationCount = numberValue(notifications?.total);
  const deliveryPlanCount = numberValue(deliveryPlans?.total);
  const externalFailureCount = numberValue(externalFailures?.total);
  const dueMilestoneCount = getCommercialTransitionMilestones(cutoverAt, validUntil)
    .filter(item => item.scheduledAt.getTime() <= now.getTime()).length;
  const expectedDueNotificationCount = grantedCount * dueMilestoneCount;
  const expectedDeliveryPlanCount = notificationCount * 6;
  const checkpointAfter = await readCheckpoint(input.cutoverKey);
  const windowElapsed = now.getTime() >= validUntil.getTime();

  return {
    cutoverKey: input.cutoverKey,
    cutoverAt,
    validUntil,
    timezone: String(manifest.timezone ?? ""),
    snapshotRuleVersion: String(manifest.snapshotRuleVersion ?? ""),
    snapshotMemberPrefix: String(manifest.snapshotMemberPrefix ?? ""),
    populationSha256: String(manifest.populationSha256 ?? ""),
    snapshotMemberCount,
    snapshotIntegrityOk,
    eligibleCount,
    grantedCount,
    endedCount,
    failedCount,
    missingCount: Math.max(0, eligibleCount - grantedCount - failedCount),
    checkpointAfter,
    dueMilestoneCount,
    notificationCount,
    expectedDueNotificationCount,
    missingDueNotificationCount: Math.max(0, expectedDueNotificationCount - notificationCount),
    deliveryPlanCount,
    expectedDeliveryPlanCount,
    missingDeliveryPlanCount: Math.max(0, expectedDeliveryPlanCount - deliveryPlanCount),
    externalFailureCount,
    windowElapsed,
    reconciled:
      snapshotIntegrityOk &&
      eligibleCount === grantedCount &&
      failedCount === 0 &&
      notificationCount >= expectedDueNotificationCount &&
      deliveryPlanCount >= expectedDeliveryPlanCount &&
      (!windowElapsed || endedCount === grantedCount),
  };
}
