import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import { dateOrNull, requireDb, resultRows } from "../../repositories/billingRepositorySupport";
import { getWhatsAppChannelConfig } from "../../whatsappConfig";
import { sendWhatsAppLogicalReply } from "../whatsapp/replyTransport";
import {
  deliverBillingNotificationExternally,
  presentBillingFactAsNotification,
  type BillingNotificationDeliveryChannel,
} from "./billingNotificationCenter";

type Row = Record<string, unknown>;

function payload(row: Row): Record<string, unknown> {
  const value = row.payloadJson;
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function boolValue(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function completionState(row: Row) {
  if (row.invalidatedAt) return "completed" as const;
  const type = String(row.factType);
  const lifecycleState = String(row.lifecycleState ?? "");
  if (type.startsWith("past_due_")) return lifecycleState === "past_due" ? "open" as const : "completed" as const;
  if (type === "subscription_suspended") return lifecycleState === "suspended" ? "open" as const : "completed" as const;
  if (type === "contract_pending") return lifecycleState === "pending" ? "open" as const : "completed" as const;
  if (type === "trial_started" || type === "trial_ending") {
    const trialEndsAt = dateOrNull(row.trialEndsAt) ?? new Date(0);
    return lifecycleState === "pending" && trialEndsAt.getTime() > Date.now() ? "open" as const : "completed" as const;
  }
  if (type === "cancellation_requested") return boolValue(row.cancelAtPeriodEnd) ? "open" as const : "completed" as const;
  if (type === "late_payment_reconciliation_required" || type === "financial_reconciliation_required") {
    return boolValue(row.reconciliationRequired) ? "open" as const : "completed" as const;
  }
  if (type.startsWith("professional_capacity_")) {
    if (type === "professional_capacity_grandfathered_resolved") return "completed" as const;
    return boolValue(row.capacityResolved) ? "completed" as const : "open" as const;
  }
  if (type === "professional_coverage_individual_renewal_requested" || type === "professional_coverage_individual_renewal_pending") {
    return boolValue(row.individualRenewalResolved) ? "completed" as const : "open" as const;
  }
  return "completed" as const;
}

async function getNotification(userId: number, notificationId: string) {
  const db = await requireDb(getDb);
  const [fact] = resultRows<Row>(await db.execute(sql`
    SELECT f.id, f.subscriptionId, f.payerUserId, f.factType, f.factVersion, f.idempotencyKey, f.correlationId, f.payloadJson,
      f.effectiveAt, f.invalidatedAt, l.state AS lifecycleState, l.trialEndsAt,
      l.reconciliationRequired, s.cancelAtPeriodEnd,
      EXISTS (
        SELECT 1 FROM billingSubscriptionFacts resolved
        WHERE resolved.subscriptionId=f.subscriptionId
          AND resolved.factType='professional_capacity_grandfathered_resolved'
          AND JSON_UNQUOTE(JSON_EXTRACT(resolved.payloadJson, '$.windowKey'))=JSON_UNQUOTE(JSON_EXTRACT(f.payloadJson, '$.windowKey'))
          AND resolved.effectiveAt>=f.effectiveAt
      ) AS capacityResolved,
      EXISTS (
        SELECT 1 FROM billingSubscriptionFacts renewal
        WHERE renewal.subscriptionId=f.subscriptionId
          AND renewal.factType IN ('professional_coverage_individual_renewal_confirmed','professional_coverage_individual_renewal_kept_by_user')
          AND renewal.effectiveAt>=f.effectiveAt
      ) AS individualRenewalResolved
    FROM billingSubscriptionFacts f
    INNER JOIN billingSubscriptions s ON s.id=f.subscriptionId
    LEFT JOIN billingSubscriptionLifecycle l ON l.subscriptionId=f.subscriptionId
    WHERE f.id=${notificationId} AND f.payerUserId=${userId}
    LIMIT 1
  `));
  if (!fact) throw new Error("billing_admin_notification_not_found");
  const presentation = presentBillingFactAsNotification({ factType: String(fact.factType), payloadJson: fact.payloadJson });
  if (!presentation) throw new Error("billing_admin_notification_not_found");
  return { db, fact, presentation, completionState: completionState(fact) };
}

async function isCampaignPaused(campaign: string, campaignVersion: string) {
  const db = await requireDb(getDb);
  const [row] = resultRows<Row>(await db.execute(sql`
    SELECT payloadJson
    FROM billingProviderEvents
    WHERE provider='billing-admin' AND eventType='campaign_control'
      AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.campaign'))=${campaign}
      AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.campaignVersion'))=${campaignVersion}
    ORDER BY createdAt DESC
    LIMIT 1
  `));
  return row ? Boolean(payload(row).paused) : false;
}

function safePresentationText(item: { title: string; whatOccurred: string; expectedAction: string | null; consequence: string; support: string }) {
  return [item.title, item.whatOccurred, item.expectedAction, item.consequence, item.support].filter(Boolean).join("\n\n").slice(0, 3800);
}

export async function retryBillingAdminNotification(input: {
  requestId: string;
  notificationId: string;
  userId: number;
  channel: BillingNotificationDeliveryChannel;
  reason: string;
  overrideReason?: string;
  actorUserId: number;
}) {
  const { db, fact, presentation, completionState: completion } = await getNotification(input.userId, input.notificationId);
  const campaignVersion = `v${Number(fact.factVersion ?? 1) || 1}`;
  const blocked = completion === "completed" || Boolean(fact.invalidatedAt)
    || await isCampaignPaused(presentation.campaign, campaignVersion);
  if (blocked && !input.overrideReason?.trim()) throw new Error("billing_admin_notification_retry_override_required");

  const providerEventId = `notification-manual-retry:${input.requestId}`;
  const traceId = `billing-admin-retry:${input.requestId}`;
  const attemptPayload = JSON.stringify({
    sourceFactId: input.notificationId,
    sourceIdempotencyKey: String(fact.idempotencyKey),
    sourceCorrelationId: String(fact.correlationId),
    requestId: input.requestId,
    transportTraceId: traceId,
    userId: input.userId,
    channel: input.channel,
    campaign: presentation.campaign,
    campaignVersion,
    reason: input.reason,
    overrideReason: input.overrideReason ?? null,
    actorUserId: input.actorUserId,
    presentationSnapshot: {
      title: presentation.title,
      whatOccurred: presentation.whatOccurred,
      expectedAction: presentation.expectedAction,
      consequence: presentation.consequence,
      support: presentation.support,
    },
  });
  await db.execute(sql`
    INSERT IGNORE INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, subscriptionId,
      payloadJson, occurredAt, createdAt, updatedAt
    ) VALUES (
      ${crypto.randomUUID()}, 'billing-admin', ${providerEventId}, 'notification_manual_retry',
      'received', ${String(fact.subscriptionId)}, ${attemptPayload}, NOW(), NOW(), NOW()
    )
  `);

  const [existing] = resultRows<Row>(await db.execute(sql`
    SELECT status,payloadJson,updatedAt FROM billingProviderEvents
    WHERE provider='billing-admin' AND providerEventId=${providerEventId}
    LIMIT 1
  `));
  if (!existing) throw new Error("billing_admin_notification_retry_event_missing");
  const existingPayload = payload(existing);
  if (existingPayload.resultStatus) return { idempotent: true as const, status: String(existingPayload.resultStatus) };
  if (String(existing.status) !== "received") return { idempotent: true as const, status: "pending" as const };

  const now = new Date();
  const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);
  const claim = await db.execute(sql`
    UPDATE billingProviderEvents
    SET payloadJson=JSON_SET(COALESCE(payloadJson, JSON_OBJECT()),
          '$.dispatchStartedAt', ${now.toISOString()}, '$.recoveryAttemptAt', ${now.toISOString()}),
        updatedAt=${now}
    WHERE provider='billing-admin' AND providerEventId=${providerEventId} AND status='received'
      AND (JSON_EXTRACT(COALESCE(payloadJson, JSON_OBJECT()), '$.dispatchStartedAt') IS NULL OR updatedAt <= ${staleBefore})
  `);
  const claimed = Number((claim as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) === 1;
  if (!claimed) return { idempotent: true as const, status: "pending" as const };

  const result = await deliverBillingNotificationExternally({
    userId: input.userId,
    notificationId: input.notificationId,
    channel: input.channel,
    deliver: async () => {
      if (input.channel === "email") return false;
      const [connection] = resultRows<Row>(await db.execute(sql`
        SELECT phoneNumber FROM whatsappConnections
        WHERE userId=${input.userId} AND status='active'
        ORDER BY updatedAt DESC LIMIT 1
      `));
      const phone = connection?.phoneNumber ? String(connection.phoneNumber) : "";
      if (!phone) return false;
      const sent = await sendWhatsAppLogicalReply(phone, {
        kind: "functional",
        messages: [{ type: "text", body: safePresentationText(presentation) }],
      }, undefined, { origin: "billing-admin-manual-retry", traceId });
      return sent.primaryEffectiveOk;
    },
  });
  const resultAt = new Date();
  await db.execute(sql`
    UPDATE billingProviderEvents
    SET status=${result.status === "delivered" ? "processed" : "failed"}, processedAt=${resultAt},
        payloadJson=JSON_SET(COALESCE(payloadJson, JSON_OBJECT()), '$.resultStatus', ${result.status}, '$.resultAt', ${resultAt.toISOString()}),
        updatedAt=${resultAt}
    WHERE provider='billing-admin' AND providerEventId=${providerEventId}
  `);
  return { idempotent: false as const, status: result.status };
}
