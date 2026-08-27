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
  type BillingNotificationDeliveryState,
} from "./billingNotificationCenter";
import {
  collectBillingAdminNotificationReadModel,
  type BillingAdminNotificationReadItem,
} from "./billingNotificationAdminReadModel";

type Row = Record<string, unknown>;
type AdminChannel = "internal" | "email" | "whatsapp";
type NotificationCategory = "promotional" | "operational" | "financial" | "security";
type NotificationAudience = "individual" | "professional";
type ExternalDeliveryState = "not_attempted" | "pending" | "delivered" | "failed";

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function categoryForFact(factType: string): NotificationCategory {
  if (factType.startsWith("promotion_")) return "promotional";
  if (factType.startsWith("professional_capacity_") || factType.startsWith("professional_coverage_")) return "operational";
  if (factType.includes("security")) return "security";
  return "financial";
}

function audienceForFact(factType: string): NotificationAudience {
  return factType.startsWith("professional_") ? "professional" : "individual";
}

function safePresentationText(item: {
  title: string;
  whatOccurred: string;
  expectedAction: string | null;
  consequence: string;
  support: string;
}) {
  return [item.title, item.whatOccurred, item.expectedAction, item.consequence, item.support]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 3800);
}

function eventPayload(row: Row) {
  return jsonObject(row.payloadJson);
}

async function loadControlEvents(limit = 1500) {
  const db = await requireDb(getDb);
  return resultRows<Row>(await db.execute(sql`
    SELECT providerEventId, eventType, status, payloadJson, occurredAt, processedAt, createdAt
    FROM billingProviderEvents
    WHERE provider='billing-admin'
      AND eventType IN ('notification_manual_retry','notification_failure_ack','campaign_control')
    ORDER BY createdAt DESC
    LIMIT ${limit}
  `));
}

function latestCampaignControl(events: Row[], campaign: string, campaignVersion: string) {
  return events.find(row => {
    if (String(row.eventType) !== "campaign_control") return false;
    const payload = eventPayload(row);
    return payload.campaign === campaign && payload.campaignVersion === campaignVersion;
  });
}

function latestFactEvent(events: Row[], eventType: string, notificationId: string, channel?: string) {
  return events.find(row => {
    if (String(row.eventType) !== eventType) return false;
    const payload = eventPayload(row);
    return payload.sourceFactId === notificationId && (!channel || payload.channel === channel);
  });
}

type NotificationItem = {
  notificationId: string;
  campaign: string;
  campaignVersion: string;
  title: string;
  whatOccurred: string;
  effectiveAt: Date;
  expectedAction: string | null;
  consequence: string;
  support: string;
  actionHref: "/billing" | null;
  readState: "read" | "unread";
  readAt: Date | null;
  deliveryState: BillingNotificationDeliveryState;
  deliveryChannel: BillingNotificationDeliveryChannel | null;
  deliveryUpdatedAt: Date | null;
  completionState: "open" | "completed";
  situation: string;
};

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
    return lifecycleState === "pending" && trialEndsAt && trialEndsAt.getTime() > Date.now()
      ? "open" as const
      : "completed" as const;
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

function notificationFromRow(row: Row): NotificationItem | null {
  const presentation = presentBillingFactAsNotification({ factType: String(row.factType), payloadJson: row.payloadJson });
  if (!presentation) return null;
  const effectiveAt = dateOrNull(row.effectiveAt) ?? new Date(0);
  const completed = completionState(row);
  return {
    notificationId: String(row.id),
    campaign: presentation.campaign,
    campaignVersion: `v${Number(row.factVersion ?? 1) || 1}`,
    title: presentation.title,
    whatOccurred: presentation.whatOccurred,
    effectiveAt,
    expectedAction: presentation.expectedAction,
    consequence: presentation.consequence,
    support: presentation.support,
    actionHref: presentation.actionHref,
    readState: row.readAt ? "read" : "unread",
    readAt: dateOrNull(row.readAt),
    deliveryState: String(row.lastDeliveryState ?? "not_attempted") as BillingNotificationDeliveryState,
    deliveryChannel: row.lastDeliveryChannel ? String(row.lastDeliveryChannel) as BillingNotificationDeliveryChannel : null,
    deliveryUpdatedAt: dateOrNull(row.lastDeliveryAt),
    completionState: completed,
    situation: completed === "open" ? "Ação ou acompanhamento pendente" : "Resolvida ou informativa",
  };
}

function channelSnapshot(input: {
  channel: Exclude<AdminChannel, "internal">;
  notification: NotificationItem;
  events: Row[];
}) {
  const attempts = input.events.filter(row => {
    if (String(row.eventType) !== "notification_manual_retry") return false;
    const payload = eventPayload(row);
    return payload.sourceFactId === input.notification.notificationId && payload.channel === input.channel;
  });
  const latestRetry = attempts[0] ? eventPayload(attempts[0]) : null;
  const receiptState = input.notification.deliveryChannel === input.channel
    ? input.notification.deliveryState
    : "not_attempted";
  const state = String(latestRetry?.resultStatus ?? receiptState) as ExternalDeliveryState;
  const ack = latestFactEvent(input.events, "notification_failure_ack", input.notification.notificationId, input.channel);
  const ackPayload = ack ? eventPayload(ack) : null;
  return {
    channel: input.channel,
    state,
    attempts: attempts.length + (receiptState !== "not_attempted" && attempts.length === 0 ? 1 : 0),
    definitiveFailure: state === "failed",
    acknowledged: Boolean(ack),
    responsibleUserId: ackPayload?.assignedToUserId == null ? null : Number(ackPayload.assignedToUserId),
    nextAttemptAt: null as Date | null,
    updatedAt: latestRetry?.resultAt ? new Date(String(latestRetry.resultAt)) : input.notification.deliveryUpdatedAt,
  };
}

export async function listBillingAdminNotifications(input: {
  limit: number;
  campaign?: string;
  campaignVersion?: string;
  category?: NotificationCategory;
  audience?: NotificationAudience;
  trigger?: string;
  milestone?: string;
  channel?: AdminChannel;
  deliveryState?: ExternalDeliveryState;
  state?: "open" | "completed" | "failed";
}) {
  const db = await requireDb(getDb);
  const controls = await loadControlEvents();
  const whatsappConfigured = Boolean(getWhatsAppChannelConfig().phoneNumberId);
  const readModel = await collectBillingAdminNotificationReadModel<Row, BillingAdminNotificationReadItem & Record<string, unknown>>({
    filter: input,
    pageSize: 500,
    loadPage: async ({ offset, limit }) => resultRows<Row>(await db.execute(sql`
      SELECT f.id, f.subscriptionId, f.payerUserId, f.factType, f.factVersion, f.payloadJson,
        f.effectiveAt, f.invalidatedAt, f.createdAt, l.state AS lifecycleState, l.trialEndsAt,
        l.reconciliationRequired, s.cancelAtPeriodEnd,
        JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.readAt')) AS readAt,
        JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryChannel')) AS lastDeliveryChannel,
        JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryState')) AS lastDeliveryState,
        JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryAt')) AS lastDeliveryAt,
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
      LEFT JOIN billingProviderEvents receipt
        ON receipt.provider='billing-web'
        AND receipt.eventType='notification_receipt'
        AND receipt.providerEventId=CONCAT('notification-receipt:', f.payerUserId, ':', f.id)
      ORDER BY f.effectiveAt DESC, f.createdAt DESC
      LIMIT ${limit} OFFSET ${offset}
    `)),
    hydrate: row => {
      const payerUserId = Number(row.payerUserId);
      const notification = notificationFromRow(row);
      if (!notification) return null;
      const factType = String(row.factType);
      const payload = jsonObject(row.payloadJson);
      const category = categoryForFact(factType);
      const audience = audienceForFact(factType);
      const milestone = payload.milestone == null ? null : String(payload.milestone);
      const campaignControl = latestCampaignControl(controls, notification.campaign, notification.campaignVersion);
      const campaignPayload = campaignControl ? eventPayload(campaignControl) : null;
      const email = channelSnapshot({ channel: "email", notification, events: controls });
      const whatsapp = channelSnapshot({ channel: "whatsapp", notification, events: controls });
      return {
        ...notification,
        payerUserId,
        factType,
        category,
        audience,
        trigger: factType,
        milestone,
        correlationId: String(row.id),
        obsolete: Boolean(row.invalidatedAt),
        paused: Boolean(campaignPayload?.paused),
        pauseReason: campaignPayload?.reason == null ? null : String(campaignPayload.reason),
        optOutApplicable: category === "promotional",
        legalBasisClassification: "classificação interna pendente de homologação jurídica e de privacidade",
        senders: {
          internal: { configured: true, label: "Central interna" },
          email: { configured: false, label: "E-mail ainda sem transport configurado" },
          whatsapp: { configured: whatsappConfigured, label: "WhatsApp oficial" },
        },
        channels: [
          { channel: "internal" as const, state: "available" as const, attempts: 1, definitiveFailure: false, acknowledged: true, responsibleUserId: null, nextAttemptAt: null, updatedAt: notification.effectiveAt },
          email,
          whatsapp,
        ],
        audit: {
          sourceFactVersion: Number(row.factVersion ?? 1) || 1,
          sourceEffectiveAt: dateOrNull(row.effectiveAt),
          latestCampaignControlAt: campaignControl ? dateOrNull(campaignControl.createdAt) : null,
          latestCampaignControlActorUserId: campaignPayload?.actorUserId == null ? null : Number(campaignPayload.actorUserId),
        },
      };
    },
  });

  return {
    items: readModel.items,
    analytics: readModel.analytics,
    matchedTotal: readModel.matchedTotal,
    generatedAt: new Date(),
  };
}

async function getAdminNotification(userId: number, notificationId: string) {
  const db = await requireDb(getDb);
  const [row] = resultRows<Row>(await db.execute(sql`
    SELECT f.id, f.subscriptionId, f.payerUserId, f.factType, f.factVersion, f.payloadJson,
      f.effectiveAt, f.invalidatedAt, l.state AS lifecycleState, l.trialEndsAt,
      l.reconciliationRequired, s.cancelAtPeriodEnd,
      JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.readAt')) AS readAt,
      JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryChannel')) AS lastDeliveryChannel,
      JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryState')) AS lastDeliveryState,
      JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryAt')) AS lastDeliveryAt,
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
    LEFT JOIN billingProviderEvents receipt
      ON receipt.provider='billing-web'
      AND receipt.eventType='notification_receipt'
      AND receipt.providerEventId=CONCAT('notification-receipt:', ${userId}, ':', f.id)
    WHERE f.id=${notificationId} AND f.payerUserId=${userId}
    LIMIT 1
  `));
  const notification = row ? notificationFromRow(row) : null;
  if (!row || !notification) throw new Error("billing_admin_notification_not_found");
  return { db, fact: row, notification };
}

async function campaignPaused(campaign: string, campaignVersion: string) {
  const controls = await loadControlEvents(500);
  const row = latestCampaignControl(controls, campaign, campaignVersion);
  return row ? Boolean(eventPayload(row).paused) : false;
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
  const { db, fact, notification } = await getAdminNotification(input.userId, input.notificationId);
  const blocked = notification.completionState === "completed" || Boolean(fact.invalidatedAt)
    || await campaignPaused(notification.campaign, notification.campaignVersion);
  if (blocked && !input.overrideReason?.trim()) throw new Error("billing_admin_notification_retry_override_required");

  const providerEventId = `notification-manual-retry:${input.requestId}`;
  const attemptPayload = JSON.stringify({
    sourceFactId: input.notificationId,
    userId: input.userId,
    channel: input.channel,
    campaign: notification.campaign,
    campaignVersion: notification.campaignVersion,
    reason: input.reason,
    overrideReason: input.overrideReason ?? null,
    actorUserId: input.actorUserId,
    presentationSnapshot: {
      title: notification.title,
      whatOccurred: notification.whatOccurred,
      expectedAction: notification.expectedAction,
      consequence: notification.consequence,
      support: notification.support,
    },
  });
  const inserted = await db.execute(sql`
    INSERT IGNORE INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, subscriptionId,
      payloadJson, occurredAt, createdAt, updatedAt
    ) VALUES (
      ${crypto.randomUUID()}, 'billing-admin', ${providerEventId}, 'notification_manual_retry',
      'received', ${String(fact.subscriptionId)}, ${attemptPayload}, NOW(), NOW(), NOW()
    )
  `);
  const created = Number((inserted as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0) === 1;
  if (!created) {
    const [existing] = resultRows<Row>(await db.execute(sql`
      SELECT payloadJson FROM billingProviderEvents
      WHERE provider='billing-admin' AND providerEventId=${providerEventId}
      LIMIT 1
    `));
    const payload = eventPayload(existing ?? {});
    return { idempotent: true as const, status: String(payload.resultStatus ?? "pending") };
  }

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
        messages: [{ type: "text", body: safePresentationText(notification) }],
      });
      return sent.primaryEffectiveOk;
    },
  });
  const resultAt = new Date();
  await db.execute(sql`
    UPDATE billingProviderEvents
    SET status=${result.status === "delivered" ? "processed" : "failed"},
        processedAt=${resultAt},
        payloadJson=JSON_SET(COALESCE(payloadJson, JSON_OBJECT()),
          '$.resultStatus', ${result.status}, '$.resultAt', ${resultAt.toISOString()}),
        updatedAt=${resultAt}
    WHERE provider='billing-admin' AND providerEventId=${providerEventId}
  `);
  return { idempotent: false as const, status: result.status };
}

export async function acknowledgeBillingNotificationFailure(input: {
  notificationId: string;
  userId: number;
  channel: BillingNotificationDeliveryChannel;
  assignedToUserId: number;
  reason: string;
  actorUserId: number;
}) {
  const { db, fact } = await getAdminNotification(input.userId, input.notificationId);
  const payload = JSON.stringify({
    sourceFactId: input.notificationId,
    userId: input.userId,
    channel: input.channel,
    assignedToUserId: input.assignedToUserId,
    reason: input.reason,
    actorUserId: input.actorUserId,
  });
  const id = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, subscriptionId,
      payloadJson, occurredAt, processedAt, createdAt, updatedAt
    ) VALUES (
      ${id}, 'billing-admin', ${`notification-failure-ack:${id}`}, 'notification_failure_ack',
      'processed', ${String(fact.subscriptionId)}, ${payload}, NOW(), NOW(), NOW(), NOW()
    )
  `);
  return { acknowledged: true as const, assignedToUserId: input.assignedToUserId };
}

export async function setBillingCampaignPaused(input: {
  campaign: string;
  campaignVersion: string;
  paused: boolean;
  reason: string;
  actorUserId: number;
}) {
  const db = await requireDb(getDb);
  const id = crypto.randomUUID();
  const payload = JSON.stringify({ ...input, changedAt: new Date().toISOString() });
  await db.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status,
      payloadJson, occurredAt, processedAt, createdAt, updatedAt
    ) VALUES (
      ${id}, 'billing-admin', ${`campaign-control:${id}`}, 'campaign_control', 'processed',
      ${payload}, NOW(), NOW(), NOW(), NOW()
    )
  `);
  return { campaign: input.campaign, campaignVersion: input.campaignVersion, paused: input.paused };
}
