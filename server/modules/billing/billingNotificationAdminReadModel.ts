export type BillingAdminChannel = "internal" | "email" | "whatsapp";
export type BillingAdminNotificationCategory = "promotional" | "operational" | "financial" | "security";
export type BillingAdminNotificationAudience = "individual" | "professional";
export type BillingAdminExternalDeliveryState = "not_attempted" | "pending" | "delivered" | "failed";

export type BillingAdminNotificationFilter = {
  limit: number;
  campaign?: string;
  campaignVersion?: string;
  category?: BillingAdminNotificationCategory;
  audience?: BillingAdminNotificationAudience;
  trigger?: string;
  milestone?: string;
  channel?: BillingAdminChannel;
  deliveryState?: BillingAdminExternalDeliveryState;
  state?: "open" | "completed" | "failed";
};

export type BillingAdminDeliverySnapshot = {
  channel: BillingAdminChannel;
  state: BillingAdminExternalDeliveryState | "available";
  attempts: number;
  definitiveFailure: boolean;
};

export type BillingAdminNotificationReadItem = {
  notificationId: string;
  campaign: string;
  campaignVersion: string;
  category: BillingAdminNotificationCategory;
  audience: BillingAdminNotificationAudience;
  trigger: string;
  milestone: string | null;
  completionState: "open" | "completed";
  readState: "read" | "unread";
  channels: BillingAdminDeliverySnapshot[];
};

export function matchesBillingAdminNotification(
  item: BillingAdminNotificationReadItem,
  input: BillingAdminNotificationFilter,
) {
  const email = item.channels.find(channel => channel.channel === "email");
  const whatsapp = item.channels.find(channel => channel.channel === "whatsapp");
  const failed = Boolean(email?.state === "failed" || whatsapp?.state === "failed");
  const selectedChannel = input.channel
    ? item.channels.find(channel => channel.channel === input.channel)
    : null;

  if (input.campaign && item.campaign !== input.campaign) return false;
  if (input.campaignVersion && item.campaignVersion !== input.campaignVersion) return false;
  if (input.category && item.category !== input.category) return false;
  if (input.audience && item.audience !== input.audience) return false;
  if (input.trigger && item.trigger !== input.trigger) return false;
  if (input.milestone && item.milestone !== input.milestone) return false;
  if (input.channel === "email" && email?.state === "not_attempted") return false;
  if (input.channel === "whatsapp" && whatsapp?.state === "not_attempted") return false;
  if (input.deliveryState && input.channel === "internal") return false;
  if (input.deliveryState && selectedChannel && selectedChannel.state !== input.deliveryState) return false;
  if (
    input.deliveryState &&
    !input.channel &&
    email?.state !== input.deliveryState &&
    whatsapp?.state !== input.deliveryState
  ) return false;
  if (input.state === "open" && item.completionState !== "open") return false;
  if (input.state === "completed" && item.completionState !== "completed") return false;
  if (input.state === "failed" && !failed) return false;
  return true;
}

export type BillingAdminNotificationAnalyticsRow = {
  campaign: string;
  campaignVersion: string;
  channel: BillingAdminChannel;
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
};

export function aggregateBillingAdminNotificationAnalytics(
  items: BillingAdminNotificationReadItem[],
): BillingAdminNotificationAnalyticsRow[] {
  const analytics = new Map<string, BillingAdminNotificationAnalyticsRow>();
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
      if (channel.channel === "internal" && item.readState === "read") {
        current.opened = Number(current.opened ?? 0) + 1;
      }
      if (item.completionState === "completed") current.actionCompleted += 1;
      analytics.set(key, current);
    }
  }
  return Array.from(analytics.values());
}

export async function collectBillingAdminNotificationReadModel<Row, Item extends BillingAdminNotificationReadItem>(input: {
  filter: BillingAdminNotificationFilter;
  pageSize?: number;
  loadPage: (input: { offset: number; limit: number }) => Promise<Row[]>;
  hydrate: (row: Row) => Item | null;
}) {
  const pageSize = Math.max(1, input.pageSize ?? 500);
  const matching: Item[] = [];
  let offset = 0;

  while (true) {
    const page = await input.loadPage({ offset, limit: pageSize });
    for (const row of page) {
      const item = input.hydrate(row);
      if (item && matchesBillingAdminNotification(item, input.filter)) matching.push(item);
    }
    if (page.length < pageSize) break;
    offset += page.length;
  }

  return {
    items: matching.slice(0, input.filter.limit),
    analytics: aggregateBillingAdminNotificationAnalytics(matching),
    matchedTotal: matching.length,
  };
}
