import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import { requireDb } from "../../repositories/billingRepositorySupport";

const PROVIDER = "billing-commercial-transition";

function affectedRows(result: unknown) {
  return Number(
    (result as [{ affectedRows?: number }])[0]?.affectedRows ?? 0
  );
}

export async function obsoleteSupersededCommercialTransitionDeliveryAttempts(
  cutoverKey: string
) {
  const db = await requireDb(getDb);
  const supersededAt = new Date();

  const invalidWhatsappResult = await db.execute(sql`
    UPDATE billingProviderEvents attempt
    SET attempt.status = 'ignored',
        attempt.processedAt = ${supersededAt},
        attempt.payloadJson = JSON_SET(
          COALESCE(attempt.payloadJson, JSON_OBJECT()),
          '$.state', 'ineligible',
          '$.obsoleteReason', 'whatsapp_not_validated_or_active',
          '$.supersededAt', ${supersededAt.toISOString()}
        ),
        attempt.updatedAt = ${supersededAt}
    WHERE attempt.provider = ${PROVIDER}
      AND attempt.eventType = 'commercial_transition_delivery_attempt'
      AND attempt.status = 'received'
      AND JSON_UNQUOTE(JSON_EXTRACT(attempt.payloadJson, '$.cutoverKey')) = ${cutoverKey}
      AND JSON_UNQUOTE(JSON_EXTRACT(attempt.payloadJson, '$.channel')) = 'whatsapp'
      AND NOT EXISTS (
        SELECT 1
        FROM whatsappConnections wc
        WHERE wc.userId = CAST(
          JSON_UNQUOTE(JSON_EXTRACT(attempt.payloadJson, '$.userId')) AS UNSIGNED
        )
          AND wc.status = 'active'
      )
  `);

  const supersededResult = await db.execute(sql`
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

  return {
    cutoverKey,
    ineligibleWhatsappAttempts: affectedRows(invalidWhatsappResult),
    obsoleteAttempts: affectedRows(supersededResult),
    supersededAt,
  };
}
