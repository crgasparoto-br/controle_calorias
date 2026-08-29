import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import { requireDb } from "../../repositories/billingRepositorySupport";

const PROVIDER = "billing-commercial-transition";

export async function obsoleteSupersededCommercialTransitionDeliveryAttempts(
  cutoverKey: string
) {
  const db = await requireDb(getDb);
  const supersededAt = new Date();
  const result = await db.execute(sql`
    UPDATE billingProviderEvents attempt
    INNER JOIN billingProviderEvents source
      ON source.id = JSON_UNQUOTE(JSON_EXTRACT(attempt.payloadJson, '$.sourceNotificationId'))
      AND source.provider = ${PROVIDER}
      AND source.eventType = 'commercial_transition_notification'
      AND source.status = 'processed'
    INNER JOIN billingProviderEvents newer
      ON newer.provider = ${PROVIDER}
      AND newer.eventType = 'commercial_transition_notification'
      AND newer.status = 'processed'
      AND JSON_UNQUOTE(JSON_EXTRACT(newer.payloadJson, '$.cutoverKey')) = ${cutoverKey}
      AND JSON_UNQUOTE(JSON_EXTRACT(newer.payloadJson, '$.userId')) =
          JSON_UNQUOTE(JSON_EXTRACT(source.payloadJson, '$.userId'))
      AND newer.occurredAt > source.occurredAt
    SET attempt.status = 'ignored',
        attempt.processedAt = ${supersededAt},
        attempt.payloadJson = JSON_SET(
          COALESCE(attempt.payloadJson, JSON_OBJECT()),
          '$.state', 'obsolete',
          '$.obsoleteReason', 'superseded_by_newer_transition_milestone',
          '$.supersededAt', ${supersededAt.toISOString()}
        ),
        attempt.updatedAt = ${supersededAt}
    WHERE attempt.provider = ${PROVIDER}
      AND attempt.eventType = 'commercial_transition_delivery_attempt'
      AND attempt.status = 'received'
      AND JSON_UNQUOTE(JSON_EXTRACT(attempt.payloadJson, '$.cutoverKey')) = ${cutoverKey}
      AND JSON_UNQUOTE(JSON_EXTRACT(attempt.payloadJson, '$.communicationKey')) <>
          JSON_UNQUOTE(JSON_EXTRACT(newer.payloadJson, '$.communicationKey'))
  `);

  const affectedRows = Number(
    (result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
  );
  return { cutoverKey, obsoleteAttempts: affectedRows, supersededAt };
}
