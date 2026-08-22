import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  requireDb,
  resultRows,
} from "../../repositories/billingRepositorySupport";

const HISTORY_TITLES: Record<string, string> = {
  trial_started: "Período de avaliação iniciado",
  trial_ending: "Período de avaliação próximo do fim",
  contract_pending: "Contratação aguardando confirmação",
  contract_confirmed: "Contratação confirmada",
  contract_refused: "Contratação não confirmada",
  contract_expired: "Tentativa de contratação expirada",
  renewal_confirmed: "Renovação confirmada",
  past_due_entered: "Pagamento ficou pendente",
  subscription_suspended: "Assinatura suspensa",
  subscription_recovered: "Assinatura recuperada",
  subscription_expired: "Assinatura encerrada",
  cancellation_requested: "Cancelamento da renovação solicitado",
  cancellation_reactivated: "Renovação reativada",
  cancellation_effective: "Cancelamento efetivado",
  late_payment_reconciliation_required: "Pagamento tardio em conciliação",
  financial_reconciliation_required: "Confirmação financeira em conciliação",
  administrative_termination: "Assinatura encerrada administrativamente",
};

export async function getSubscriptionWebHistory(input: {
  subscriptionId: string;
  payerUserId: number;
  limit?: number;
}) {
  const db = await requireDb(getDb);
  const limit = Math.max(1, Math.min(input.limit ?? 12, 30));
  const rows = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT f.factType, f.effectiveAt
      FROM billingSubscriptionFacts f
      INNER JOIN billingSubscriptions s ON s.id = f.subscriptionId
      WHERE f.subscriptionId = ${input.subscriptionId}
        AND s.payerUserId = ${input.payerUserId}
      ORDER BY f.effectiveAt DESC, f.createdAt DESC
      LIMIT ${limit}
    `)
  );
  return rows
    .map(row => {
      const type = String(row.factType);
      const title = HISTORY_TITLES[type];
      if (!title) return null;
      const occurredAt =
        row.effectiveAt instanceof Date
          ? row.effectiveAt
          : new Date(String(row.effectiveAt));
      if (Number.isNaN(occurredAt.getTime())) return null;
      return { title, occurredAt };
    })
    .filter((entry): entry is { title: string; occurredAt: Date } => entry !== null);
}
