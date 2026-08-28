import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import { requireDb, resultRows } from "../../repositories/billingRepositorySupport";
import {
  listBillingAdminNotifications as listCore,
  acknowledgeBillingNotificationFailure,
  setBillingCampaignPaused,
} from "./billingNotificationAdminCore";
import { retryBillingAdminNotification } from "./billingNotificationAdminRetry";

export { acknowledgeBillingNotificationFailure, retryBillingAdminNotification, setBillingCampaignPaused };

export async function listBillingAdminNotifications(input: Parameters<typeof listCore>[0]) {
  const result = await listCore(input);
  if (result.items.length === 0) return result;

  const db = await requireDb(getDb);
  const ids = result.items.map(item => item.notificationId);
  const identityRows = resultRows<Record<string, unknown>>(await db.execute(sql`
    SELECT id, idempotencyKey, correlationId
    FROM billingSubscriptionFacts
    WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
  `));
  const identities = new Map(identityRows.map(row => [String(row.id), row]));

  return {
    ...result,
    items: result.items.map(item => {
      const identity = identities.get(item.notificationId);
      if (!identity) throw new Error("billing_admin_notification_identity_missing");
      return {
        ...item,
        correlationId: String(identity.correlationId),
        idempotencyKey: String(identity.idempotencyKey),
      };
    }),
  };
}
