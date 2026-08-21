import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  requireDb,
  resultRows,
} from "../../repositories/billingRepositorySupport";
import type { BillingPaymentMethod } from "./catalogPolicy";

export async function getSubscriptionManagementCapabilities(input: {
  subscriptionId: string;
  payerUserId: number;
}) {
  const db = await requireDb(getDb);
  const [row] = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT s.provider, i.paymentMethod
      FROM billingSubscriptions s
      INNER JOIN billingContractIntents i ON i.subscriptionId = s.id
      WHERE s.id = ${input.subscriptionId}
        AND s.payerUserId = ${input.payerUserId}
      ORDER BY i.createdAt DESC
      LIMIT 1
    `)
  );
  if (!row) return null;
  const paymentMethod = String(row.paymentMethod) as BillingPaymentMethod;
  const provider = String(row.provider);
  return {
    provider,
    paymentMethod,
    canReactivateRenewal: provider === "asaas" && paymentMethod === "credit_card",
    canUpdatePaymentMethod: false,
    requiresNewPixAuthorizationForReactivation:
      provider === "asaas" && paymentMethod === "pix_automatic",
  };
}
