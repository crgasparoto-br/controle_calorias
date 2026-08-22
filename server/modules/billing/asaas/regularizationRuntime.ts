import { sql } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  requireDb,
  resultRows,
} from "../../../repositories/billingRepositorySupport";
import { getAsaasRuntime } from "./runtime";

type Row = Record<string, unknown>;
type RegularizationPayment = {
  id?: string;
  subscription?: string;
  status?: string;
  dueDate?: string;
  invoiceUrl?: string;
};

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export function safeAsaasInvoiceUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== "https:" ||
      (hostname !== "asaas.com" && !hostname.endsWith(".asaas.com"))
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function selectAsaasRegularizationPayment(input: {
  externalSubscriptionId: string;
  payments: RegularizationPayment[];
  now?: Date;
}) {
  const today = dateOnly(input.now ?? new Date());
  const candidates = input.payments
    .filter(payment => payment.subscription === input.externalSubscriptionId)
    .map(payment => ({
      ...payment,
      normalizedStatus: String(payment.status ?? "").toUpperCase(),
      safeInvoiceUrl: safeAsaasInvoiceUrl(payment.invoiceUrl),
    }))
    .filter(payment => {
      if (!payment.id || !payment.safeInvoiceUrl) return false;
      if (payment.normalizedStatus === "OVERDUE") return true;
      return (
        payment.normalizedStatus === "PENDING" &&
        typeof payment.dueDate === "string" &&
        payment.dueDate <= today
      );
    })
    .sort((left, right) => {
      const statusOrder =
        Number(right.normalizedStatus === "OVERDUE") -
        Number(left.normalizedStatus === "OVERDUE");
      if (statusOrder !== 0) return statusOrder;
      return String(left.dueDate ?? "9999-12-31").localeCompare(
        String(right.dueDate ?? "9999-12-31")
      );
    });
  return candidates[0] ?? null;
}

export async function prepareAsaasRegularization(input: {
  subscriptionId: string;
  payerUserId: number;
}) {
  const db = await requireDb(getDb);
  const [row] = resultRows<Row>(
    await db.execute(sql`
      SELECT s.id, s.externalSubscriptionId, l.state
      FROM billingSubscriptions s
      INNER JOIN billingSubscriptionLifecycle l ON l.subscriptionId = s.id
      WHERE s.id = ${input.subscriptionId}
        AND s.payerUserId = ${input.payerUserId}
        AND s.provider = 'asaas'
      LIMIT 1
    `)
  );
  if (!row) throw new Error("billing_subscription_not_found");
  const lifecycleState = String(row.state ?? "");
  if (lifecycleState !== "past_due" && lifecycleState !== "suspended") {
    throw new Error("asaas_regularization_not_available");
  }
  if (!row.externalSubscriptionId) {
    throw new Error("asaas_regularization_reference_missing");
  }
  const externalSubscriptionId = String(row.externalSubscriptionId);
  const payments = (await getAsaasRuntime().adapter.listSubscriptionPayments(
    externalSubscriptionId
  )) as RegularizationPayment[];
  const payment = selectAsaasRegularizationPayment({
    externalSubscriptionId,
    payments,
  });
  if (!payment?.safeInvoiceUrl) {
    throw new Error("asaas_regularization_invoice_not_available");
  }
  return {
    provider: "asaas" as const,
    kind: "hosted_invoice" as const,
    url: payment.safeInvoiceUrl,
    state: "pending" as const,
  };
}