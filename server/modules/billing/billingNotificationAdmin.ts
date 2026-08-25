import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import { dateOrNull, requireDb, resultRows } from "../../repositories/billingRepositorySupport";
import { getWhatsAppChannelConfig } from "../../whatsappConfig";
import { sendWhatsAppLogicalReply } from "../whatsapp/replyTransport";
import {
  deliverBillingNotificationExternally,
  listBillingUserNotifications,
  type BillingNotificationDeliveryChannel,
} from "./billingNotificationCenter";

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

function channelSnapshot(input: {
  channel: Exclude<AdminChannel, "internal">;
  notification: Awaited<ReturnType<typeof listBillingUserNotifications>>[number];
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
  const sourceRows = resultRows<Row>(await db.execute(sql`
    SELECT id, payerUserId, factType, factVersion, payloadJson, effectiveAt, invalidatedAt, createdAt
    FROM billingSubscriptionFacts
    ORDER BY effectiveAt DESC, createdAt DESC
    LIMIT ${Math.min(750, Math.max(input.limit * 4, input.limit))}
  `));
  const payerIds = Array.from(new Set(sourceRows.map(row => Number(row.payerUserId)).filter(value => Number.isInteger(value) && value > 0))).slice(0, 100);
  const userNotifications = (await Promise.all(
    payerIds.map(async userId => ({ userId, items: await listBillingUserNotifications(userId, 250) })),
  )).flatMap(group => group.items.map(item => ({ ...item, payerUserId: group.userId })));
  const byId = new Map(userNotifications.map(item => [item.notificationId, item]));
  const controls = await loadControlEvents();
  const whatsappConfigured = Boolean(getWhatsAppChannelConfig().phoneNumberId);

  const items = sourceRows.flatMap(row => {
    const notification = byId.get(String(row.id));
    if (!notification) return [];
    const factType = String(row.factType);
    const payload = jsonObject(row.payloadJson);
    const category = categoryForFact(factType);
    const audience = audienceForFact(factType);
    const milestone = payload.milestone == null ? null : String(payload.milestone);
    const campaignControl = latestCampaignControl(controls, notification.campaign, notification.campaignVersion);
    const campaignPayload = campaignControl ? eventPayload(campaignControl) : null;
    const email = channelSnapshot({ channel: "email", notification, events: controls });
    const whatsapp = channelSnapshot({ channel: "whatsapp", notification, events: controls });
    const failed = email.state === "failed" || whatsapp.state === "failed";
    const selectedChannel = input.channel === "email" ? email : input.channel === "whatsapp" ? whatsapp : null;
    if (input.campaign && notification.campaign !== input.campaign) return [];
    if (input.campaignVersion && notification.campaignVersion !== input.campaignVersion) return [];
    if (input.category && category !== input.category) return [];
    if (input.audience && audience !== input.audience) return [];
    if (input.trigger && factType !== input.trigger) return [];
    if (input.milestone && milestone !== input.milestone) return [];
    if (input.channel === "email" && email.state === "not_attempted") return [];
    if (input.channel === "whatsapp" && whatsapp.state === "not_attempted") return [];
    if (input.deliveryState && input.channel === "internal") return [];
    if (input.deliveryState && selectedChannel && selectedChannel.state !== input.deliveryState) return [];
    if (input.deliveryState && !input.channel && email.state !== input.deliveryState && whatsapp.state !== input.deliveryState) return [];
    if (input.state === "open" && notification.completionState !== "open") return [];
    if (input.state === "completed" && notification.completionState !== "completed") return [];
    if (input.state === "failed" && !failed) return [];
    return [{
      ...notification,
      payerUserId: Number(row.payerUserId),
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
    }];
  }).slice(0, input.limit);

  const analytics = new Map<string, {
    campaign: string;
    campaignVersion: string;
    channel: AdminChannel;
    created: number;
    sent: number;
    delivered: number;
    failed: number;
    retries: number;
    deduplications: number;
    opened: number | null;
    actionCompleted: number;
    optOut: number | null;
    tickets: number | null;
    averageResolutionMinutes: number | null;
  }>();
  for (const item of items) {
    for (const channel of item.channels) {
      const key = `${item.campaign}|${item.campaignVersion}|${channel.channel}`;
      const current = analytics.get(key) ?? {
        campaign: item.campaign,
        campaignVersion: item.campaignVersion,
        channel: channel.channel,
        created: 0,
        sent: 0,
        delivered: 0,
        failed: 0,
        retries: 0,
        deduplications: 0,
        opened: channel.channel === "internal" ? 0 : null,
        actionCompleted: 0,
        optOut: null,
        tickets: null,
        averageResolutionMinutes: null,
      };
      current.created += 1;
      if (channel.state !== "not_attempted") current.sent += 1;
      if (channel.state === "delivered" || channel.state === "available") current.delivered += 1;
      if (channel.state === "failed") current.failed += 1;
      current.retries += Math.max(0, channel.attempts - 1);
      if (channel.channel === "internal" && item.readState === "read") current.opened = Number(current.opened ?? 0) + 1;
      if (item.completionState === "completed") current.actionCompleted += 1;
      analytics.set(key, current);
    }
  }
  return { items, analytics: Array.from(analytics.values()), generatedAt: new Date() };
}

async function getAdminNotification(userId: number, notificationId: string) {
  const notification = (await listBillingUserNotifications(userId, 250)).find(item => item.notificationId === notificationId);
  if (!notification) throw new Error("billing_admin_notification_not_found");
  const db = await requireDb(getDb);
  const [fact] = resultRows<Row>(await db.execute(sql`
    SELECT id, subscriptionId, invalidatedAt
    FROM billingSubscriptionFacts
    WHERE id=${notificationId} AND payerUserId=${userId}
    LIMIT 1
  `));
  if (!fact) throw new Error("billing_admin_notification_not_found");
  return { db, fact, notification };
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
