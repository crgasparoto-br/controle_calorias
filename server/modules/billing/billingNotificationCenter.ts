import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  dateOrNull,
  requireDb,
  resultRows,
} from "../../repositories/billingRepositorySupport";

type Row = Record<string, unknown>;
export type BillingNotificationDeliveryChannel = "email" | "whatsapp";
export type BillingNotificationDeliveryState =
  | "not_attempted"
  | "pending"
  | "delivered"
  | "failed";

type BillingNotificationPresentation = {
  campaign: string;
  title: string;
  whatOccurred: string;
  expectedAction: string | null;
  consequence: string;
  support: string;
  actionHref: "/billing" | null;
};

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function numberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateText(value: unknown) {
  const date = dateOrNull(value);
  return date ? date.toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null;
}

function capacityText(payload: Record<string, unknown>) {
  const contracted = numberOrNull(payload.contractedLimit);
  const occupancy = numberOrNull(payload.occupancy ?? payload.initialOccupancy);
  const excess = numberOrNull(payload.excess);
  const endsAt = dateText(payload.temporaryEndsAt ?? payload.endsAt ?? payload.expiredAt);
  const parts = [
    contracted == null ? null : `capacidade contratada de ${contracted} pacientes`,
    occupancy == null ? null : `ocupação atual de ${occupancy}`,
    excess == null ? null : `${Math.max(0, excess)} acima do limite`,
    endsAt ? `prazo em ${endsAt}` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

function capacityMilestone(payload: Record<string, unknown>) {
  const milestone = String(payload.milestone ?? "");
  const days = numberOrNull(payload.daysRemaining);
  if (milestone === "started") return "Período de capacidade temporária iniciado";
  if (milestone === "expired" || days === 0) return "Capacidade temporária chegou ao vencimento";
  if (days != null) return `Capacidade temporária: ${days} dias restantes`;
  return "Atualização da capacidade temporária";
}

function commercialTransitionPresentation(
  payload: Record<string, unknown>,
  support: string,
  manage: "/billing"
): BillingNotificationPresentation {
  const milestone = String(payload.milestone ?? "");
  const validUntil = dateText(payload.validUntil);
  const endText = validUntil ? ` em ${validUntil}` : "";
  if (milestone === "start") {
    return {
      campaign: "Transição comercial",
      title: "Seu período de transição começou",
      whatOccurred: `Seu acesso de transição foi registrado por 30 dias corridos e termina${endText}.`,
      expectedAction: "Conheça as opções disponíveis em Plano e acesso antes do encerramento do período.",
      consequence: "A transição não cria assinatura nem cobrança automática; depois do prazo, o acesso seguirá somente as origens válidas confirmadas pelo backend.",
      support,
      actionHref: manage,
    };
  }
  if (milestone === "end") {
    return {
      campaign: "Transição comercial",
      title: "Seu período de transição terminou",
      whatOccurred: `O período comercial de 30 dias chegou ao fim${endText}.`,
      expectedAction: "Consulte Plano e acesso para contratar uma opção quando quiser continuar com recursos pagos.",
      consequence: "O encerramento preserva seus dados e não cria cobrança, assinatura ou checkout automaticamente.",
      support,
      actionHref: manage,
    };
  }
  const remaining = milestone === "D15" ? 15 : milestone === "D7" ? 7 : milestone === "D1" ? 1 : null;
  return {
    campaign: "Transição comercial",
    title: remaining == null
      ? "Atualização do período de transição"
      : `Seu período de transição termina em ${remaining} ${remaining === 1 ? "dia" : "dias"}`,
    whatOccurred: `O período gratuito de transição continua ativo e termina${endText}.`,
    expectedAction: "Revise as opções em Plano e acesso antes do encerramento se quiser continuar com recursos pagos.",
    consequence: "Nenhuma cobrança ou assinatura será criada apenas por este aviso.",
    support,
    actionHref: manage,
  };
}

export function presentBillingFactAsNotification(input: {
  factType: string;
  payloadJson?: unknown;
}): BillingNotificationPresentation | null {
  const payload = jsonObject(input.payloadJson);
  const support = "Se precisar de ajuda, use o canal oficial de suporte do aplicativo.";
  const manage = "/billing" as const;

  switch (input.factType) {
    case "commercial_transition_notification":
      return commercialTransitionPresentation(payload, support, manage);
    case "trial_started":
      return {
        campaign: "Período de avaliação",
        title: "Seu período de avaliação começou",
        whatOccurred: "O período de avaliação foi registrado pelo backend.",
        expectedAction: "Confira a data final e os termos da primeira cobrança em Plano e acesso.",
        consequence: "Sem cancelamento antes do término aplicável, a continuidade segue os termos do plano contratado.",
        support,
        actionHref: manage,
      };
    case "trial_ending":
      return {
        campaign: "Período de avaliação",
        title: "Seu período de avaliação está perto do fim",
        whatOccurred: "O backend identificou a proximidade do encerramento do trial.",
        expectedAction: "Revise sua assinatura antes da primeira cobrança se não quiser continuar.",
        consequence: "Se nenhuma ação for tomada, a cobrança seguirá os termos vigentes do contrato.",
        support,
        actionHref: manage,
      };
    case "contract_pending":
      return {
        campaign: "Contratação",
        title: "Contratação aguardando confirmação",
        whatOccurred: "A tentativa foi registrada, mas ainda depende de confirmação financeira autoritativa.",
        expectedAction: "Aguarde a atualização do backend antes de repetir ou trocar a contratação.",
        consequence: "O retorno do navegador, sozinho, não libera acesso nem confirma pagamento.",
        support,
        actionHref: manage,
      };
    case "contract_confirmed":
      return {
        campaign: "Contratação",
        title: "Contratação confirmada",
        whatOccurred: "A confirmação financeira foi recebida e processada pelo backend.",
        expectedAction: null,
        consequence: "O acesso e a vigência passam a seguir o contrato confirmado.",
        support,
        actionHref: null,
      };
    case "contract_refused":
      return {
        campaign: "Contratação",
        title: "Contratação não confirmada",
        whatOccurred: "O backend recebeu uma recusa para a tentativa de contratação.",
        expectedAction: "Revise a oferta e inicie uma nova tentativa somente quando estiver pronto.",
        consequence: "Nenhum acesso pago é ativado por uma tentativa recusada.",
        support,
        actionHref: manage,
      };
    case "contract_expired":
      return {
        campaign: "Contratação",
        title: "Tentativa de contratação expirada",
        whatOccurred: "A tentativa terminou sem confirmação financeira.",
        expectedAction: "Inicie uma nova contratação se ainda quiser o plano.",
        consequence: "A tentativa expirada não ativa acesso nem gera promessa de cobrança futura.",
        support,
        actionHref: manage,
      };
    case "renewal_confirmed":
      return {
        campaign: "Renovação",
        title: "Renovação confirmada",
        whatOccurred: "O backend confirmou a renovação da assinatura para o novo período.",
        expectedAction: null,
        consequence: "A vigência e os recursos seguem o período renovado confirmado.",
        support,
        actionHref: null,
      };
    case "past_due_entered":
    case "past_due_notice_day_0":
    case "past_due_notice_day_2":
    case "past_due_notice_day_5":
    case "past_due_notice_day_7":
      return {
        campaign: "Regularização financeira",
        title: "Pagamento pendente",
        whatOccurred: "O backend confirmou uma pendência financeira na assinatura.",
        expectedAction: "Regularize a cobrança pelo fluxo seguro disponível em Plano e acesso.",
        consequence: "A carência é temporária; sem regularização, a assinatura pode ser suspensa conforme a data exibida pelo backend.",
        support,
        actionHref: manage,
      };
    case "subscription_suspended":
      return {
        campaign: "Recuperação de assinatura",
        title: "Assinatura suspensa",
        whatOccurred: "A assinatura entrou no período de recuperação após a carência financeira.",
        expectedAction: "Use somente a ação de recuperação disponibilizada pelo backend quando ela estiver habilitada.",
        consequence: "Recursos pagos permanecem bloqueados; leitura, exportação e gestão continuam conforme a política de recuperação.",
        support,
        actionHref: manage,
      };
    case "subscription_recovered":
      return {
        campaign: "Recuperação de assinatura",
        title: "Assinatura recuperada",
        whatOccurred: "A recuperação financeira foi confirmada pelo backend.",
        expectedAction: null,
        consequence: "A vigência e os recursos voltam a seguir o estado confirmado da assinatura.",
        support,
        actionHref: null,
      };
    case "subscription_expired":
      return {
        campaign: "Encerramento de assinatura",
        title: "Assinatura encerrada",
        whatOccurred: "O ciclo de recuperação terminou sem uma origem comercial válida para manter a assinatura.",
        expectedAction: "Faça uma nova contratação se quiser voltar aos recursos pagos.",
        consequence: "Os dados da conta são preservados; novos registros pagos permanecem bloqueados até nova origem válida.",
        support,
        actionHref: manage,
      };
    case "cancellation_requested":
      return {
        campaign: "Renovação",
        title: "Cancelamento da renovação solicitado",
        whatOccurred: "O backend registrou que a próxima renovação não deve continuar automaticamente.",
        expectedAction: "Se mudar de ideia, use Reativar renovação somente quando essa ação estiver disponível para o método atual.",
        consequence: "A vigência já paga continua até o fim do período confirmado.",
        support,
        actionHref: manage,
      };
    case "cancellation_reactivated":
      return {
        campaign: "Renovação",
        title: "Renovação reativada",
        whatOccurred: "O backend confirmou a reativação da próxima renovação.",
        expectedAction: null,
        consequence: "Plano, versão e preço permanecem os do contrato vigente até nova alteração autoritativa.",
        support,
        actionHref: null,
      };
    case "cancellation_effective":
      return {
        campaign: "Renovação",
        title: "Cancelamento efetivado",
        whatOccurred: "O cancelamento chegou à data efetiva registrada pelo backend.",
        expectedAction: "Faça uma nova contratação se quiser retomar um plano pago.",
        consequence: "Nenhuma renovação será presumida a partir deste aviso.",
        support,
        actionHref: manage,
      };
    case "late_payment_reconciliation_required":
    case "financial_reconciliation_required":
      return {
        campaign: "Conciliação financeira",
        title: "Confirmação financeira em análise",
        whatOccurred: "O backend detectou uma confirmação que precisa ser conciliada antes de alterar o acesso.",
        expectedAction: "Aguarde a conciliação; evite repetir pagamentos ou criar outra tentativa incompatível.",
        consequence: "O sistema não libera acesso nem altera contrato enquanto a confirmação não for autoritativa.",
        support,
        actionHref: manage,
      };
    case "administrative_termination":
      return {
        campaign: "Encerramento de assinatura",
        title: "Assinatura encerrada administrativamente",
        whatOccurred: "O backend registrou um encerramento administrativo da assinatura.",
        expectedAction: "Consulte Plano e acesso para verificar as origens de acesso ainda válidas e o próximo passo disponível.",
        consequence: "O aviso não remove dados da conta e não cria uma nova contratação automaticamente.",
        support,
        actionHref: manage,
      };
    case "professional_capacity_grandfathered_started":
      return {
        campaign: "Capacidade profissional",
        title: "Capacidade temporária iniciada",
        whatOccurred: `Sua carteira ficou acima do limite contratado${capacityText(payload) ? `: ${capacityText(payload)}` : "."}`,
        expectedAction: "Reduza a carteira por encerramentos naturais, faça upgrade para uma oferta suficiente ou acompanhe uma análise administrativa.",
        consequence: "Pacientes existentes são preservados, mas novas inclusões e reativações ficam bloqueadas enquanto a ocupação estiver acima do limite.",
        support,
        actionHref: manage,
      };
    case "professional_capacity_warning":
      return {
        campaign: "Capacidade profissional",
        title: capacityMilestone(payload),
        whatOccurred: `O prazo temporário continua em andamento${capacityText(payload) ? `: ${capacityText(payload)}` : "."}`,
        expectedAction: "Regularize a capacidade por redução natural, upgrade compatível ou atendimento administrativo antes do prazo final.",
        consequence: "O vencimento não remove pacientes, mas mantém bloqueadas novas inclusões e reativações.",
        support,
        actionHref: manage,
      };
    case "professional_capacity_extension_granted":
      return {
        campaign: "Capacidade profissional",
        title: "Extensão temporária confirmada",
        whatOccurred: `Uma extensão administrativa foi confirmada${capacityText(payload) ? `: ${capacityText(payload)}` : "."}`,
        expectedAction: "Use o novo prazo para regularizar a carteira; extensões adicionais dependem de nova decisão administrativa.",
        consequence: "A extensão não cria novo plano e não amplia silenciosamente a capacidade comercial contratada.",
        support,
        actionHref: manage,
      };
    case "professional_capacity_grandfathered_expired":
      return {
        campaign: "Capacidade profissional",
        title: "Capacidade temporária vencida",
        whatOccurred: `O prazo terminou sem a carteira voltar ao limite${capacityText(payload) ? `: ${capacityText(payload)}` : "."}`,
        expectedAction: "Aguarde ou acompanhe a análise administrativa/comercial e considere upgrade quando houver oferta suficiente.",
        consequence: "Pacientes e dados são preservados, mas novas inclusões e reativações continuam bloqueadas.",
        support,
        actionHref: manage,
      };
    case "professional_capacity_admin_alert_opened": {
      const highest = numberOrNull(payload.highestPublicCapacity);
      const occupancy = numberOrNull(payload.occupancy);
      const abovePublicRange =
        highest != null && occupancy != null && occupancy > highest;
      return {
        campaign: "Capacidade profissional",
        title: abovePublicRange
          ? "Carteira encaminhada para análise comercial"
          : "Capacidade excedida em análise administrativa",
        whatOccurred: abovePublicRange
          ? "Sua carteira excede a maior capacidade pública atualmente disponível e o caso foi encaminhado para análise administrativa/comercial."
          : "O excesso de capacidade gerou uma pendência administrativa persistente para acompanhamento.",
        expectedAction: "Acompanhe o prazo temporário e as alternativas exibidas em Plano e acesso. Nenhum novo plano será criado automaticamente.",
        consequence: "A análise não remove pacientes nem altera preço ou plano sem decisão comercial explícita.",
        support,
        actionHref: manage,
      };
    }
    case "professional_capacity_grandfathered_resolved":
      return {
        campaign: "Capacidade profissional",
        title: "Capacidade regularizada",
        whatOccurred: "O backend confirmou que a ocupação voltou a uma faixa compatível com a capacidade vigente.",
        expectedAction: null,
        consequence: "O limite contratado volta a reger novas inclusões e reativações conforme a disponibilidade atual.",
        support,
        actionHref: null,
      };
    case "professional_coverage_individual_renewal_requested":
    case "professional_coverage_individual_renewal_pending":
      return {
        campaign: "Cobertura profissional e renovação individual",
        title: "Renovação individual em sincronização",
        whatOccurred: "Após a cobertura profissional ser confirmada, o sistema iniciou a sincronização da próxima renovação da sua assinatura individual.",
        expectedAction: "Se quiser manter ou reativar a renovação individual, use a ação de renovação da sua própria assinatura quando ela estiver disponível.",
        consequence: "O período individual já pago permanece válido até o vencimento; a cobertura profissional é a origem principal durante a sobreposição.",
        support,
        actionHref: manage,
      };
    case "professional_coverage_individual_renewal_confirmed":
      return {
        campaign: "Cobertura profissional e renovação individual",
        title: "Próxima renovação individual cancelada",
        whatOccurred: "O backend confirmou o cancelamento da próxima renovação individual após o início da cobertura profissional.",
        expectedAction: "Você pode reativar explicitamente sua renovação individual se quiser mantê-la, quando o método atual permitir.",
        consequence: "A cobertura do profissional continua sendo a origem principal enquanto estiver válida.",
        support,
        actionHref: manage,
      };
    case "professional_coverage_individual_renewal_kept_by_user":
      return {
        campaign: "Cobertura profissional e renovação individual",
        title: "Opção de manter renovação individual registrada",
        whatOccurred: "Sua escolha explícita de manter a renovação individual foi registrada.",
        expectedAction: null,
        consequence: "Cobertura profissional e assinatura individual continuam origens separadas e obedecem à precedência de acesso do backend.",
        support,
        actionHref: null,
      };
    default:
      return null;
  }
}

function boolValue(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function completionState(row: Row) {
  if (row.invalidatedAt) return "completed" as const;
  const type = String(row.factType);
  const lifecycleState = String(row.lifecycleState ?? "");
  if (type === "commercial_transition_notification") {
    const payload = jsonObject(row.payloadJson);
    if (String(payload.milestone ?? "") === "end") return "completed" as const;
    const validUntil = dateOrNull(payload.validUntil);
    return validUntil && validUntil.getTime() > Date.now() ? "open" as const : "completed" as const;
  }
  if (type.startsWith("past_due_")) {
    return lifecycleState === "past_due" ? "open" as const : "completed" as const;
  }
  if (type === "subscription_suspended") {
    return lifecycleState === "suspended" ? "open" as const : "completed" as const;
  }
  if (type === "contract_pending") {
    return lifecycleState === "pending" ? "open" as const : "completed" as const;
  }
  if (type === "trial_started" || type === "trial_ending") {
    const trialEndsAt = dateOrNull(row.trialEndsAt);
    return lifecycleState === "pending" && trialEndsAt && trialEndsAt.getTime() > Date.now()
      ? "open" as const
      : "completed" as const;
  }
  if (type === "cancellation_requested") {
    return boolValue(row.cancelAtPeriodEnd) ? "open" as const : "completed" as const;
  }
  if (
    type === "late_payment_reconciliation_required" ||
    type === "financial_reconciliation_required"
  ) {
    return boolValue(row.reconciliationRequired) ? "open" as const : "completed" as const;
  }
  if (type.startsWith("professional_capacity_")) {
    if (type === "professional_capacity_grandfathered_resolved") return "completed" as const;
    return boolValue(row.capacityResolved) ? "completed" as const : "open" as const;
  }
  if (
    type === "professional_coverage_individual_renewal_requested" ||
    type === "professional_coverage_individual_renewal_pending"
  ) {
    return boolValue(row.individualRenewalResolved) ? "completed" as const : "open" as const;
  }
  return "completed" as const;
}

function receiptProviderEventId(userId: number, sourceFactId: string) {
  return `notification-receipt:${userId}:${sourceFactId}`;
}

async function requireOwnedPresentableFact(userId: number, sourceFactId: string) {
  const db = await requireDb(getDb);
  let [row] = resultRows<Row>(
    await db.execute(sql`
      SELECT id, subscriptionId, factType, payloadJson
      FROM billingSubscriptionFacts
      WHERE id = ${sourceFactId}
        AND payerUserId = ${userId}
      LIMIT 1
    `)
  );
  if (!row) {
    [row] = resultRows<Row>(await db.execute(sql`
      SELECT id, subscriptionId, 'commercial_transition_notification' AS factType, payloadJson
      FROM billingProviderEvents
      WHERE id=${sourceFactId}
        AND provider='billing-commercial-transition'
        AND eventType='commercial_transition_notification'
        AND status='processed'
        AND CAST(JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.userId')) AS UNSIGNED)=${userId}
      LIMIT 1
    `));
  }
  if (!row || !presentBillingFactAsNotification({ factType: String(row.factType), payloadJson: row.payloadJson })) {
    throw new Error("billing_notification_not_found");
  }
  return { db, row };
}

function notificationFromRow(row: Row) {
  const presentation = presentBillingFactAsNotification({
    factType: String(row.factType),
    payloadJson: row.payloadJson,
  });
  if (!presentation) return null;
  const effectiveAt = dateOrNull(row.effectiveAt) ?? new Date(0);
  const completed = completionState(row);
  const deliveryState = String(
    row.lastDeliveryState ?? "not_attempted"
  ) as BillingNotificationDeliveryState;
  const deliveryChannel = row.lastDeliveryChannel
    ? (String(row.lastDeliveryChannel) as BillingNotificationDeliveryChannel)
    : null;
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
    readState: row.readAt ? "read" as const : "unread" as const,
    readAt: dateOrNull(row.readAt),
    deliveryState,
    deliveryChannel,
    deliveryUpdatedAt: dateOrNull(row.lastDeliveryAt),
    completionState: completed,
    situation: completed === "open" ? "Ação ou acompanhamento pendente" : "Resolvida ou informativa",
  };
}

export async function listBillingUserNotifications(userId: number, limit = 100) {
  const db = await requireDb(getDb);
  const boundedLimit = Math.max(1, Math.min(limit, 250));
  const rows = resultRows<Row>(
    await db.execute(sql`
      SELECT f.id, f.factType, f.factVersion, f.effectiveAt, f.payloadJson,
        f.invalidatedAt, l.state AS lifecycleState, l.trialEndsAt,
        l.reconciliationRequired, s.cancelAtPeriodEnd,
        JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.readAt')) AS readAt,
        JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryChannel')) AS lastDeliveryChannel,
        JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryState')) AS lastDeliveryState,
        JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryAt')) AS lastDeliveryAt,
        EXISTS (
          SELECT 1 FROM billingSubscriptionFacts resolved
          WHERE resolved.subscriptionId = f.subscriptionId
            AND resolved.factType = 'professional_capacity_grandfathered_resolved'
            AND JSON_UNQUOTE(JSON_EXTRACT(resolved.payloadJson, '$.windowKey')) =
                JSON_UNQUOTE(JSON_EXTRACT(f.payloadJson, '$.windowKey'))
            AND resolved.effectiveAt >= f.effectiveAt
        ) AS capacityResolved,
        EXISTS (
          SELECT 1 FROM billingSubscriptionFacts renewal
          WHERE renewal.subscriptionId = f.subscriptionId
            AND renewal.factType IN (
              'professional_coverage_individual_renewal_confirmed',
              'professional_coverage_individual_renewal_kept_by_user'
            )
            AND renewal.effectiveAt >= f.effectiveAt
        ) AS individualRenewalResolved
      FROM billingSubscriptionFacts f
      INNER JOIN billingSubscriptions s ON s.id = f.subscriptionId
      LEFT JOIN billingSubscriptionLifecycle l ON l.subscriptionId = f.subscriptionId
      LEFT JOIN billingProviderEvents receipt
        ON receipt.provider = 'billing-web'
        AND receipt.eventType = 'notification_receipt'
        AND receipt.providerEventId = CONCAT('notification-receipt:', ${userId}, ':', f.id)
      WHERE f.payerUserId = ${userId}
        AND f.factType IN (
          'trial_started', 'trial_ending',
          'contract_pending', 'contract_confirmed', 'contract_refused', 'contract_expired',
          'renewal_confirmed',
          'past_due_entered', 'past_due_notice_day_0', 'past_due_notice_day_2',
          'past_due_notice_day_5', 'past_due_notice_day_7',
          'subscription_suspended', 'subscription_recovered', 'subscription_expired',
          'cancellation_requested', 'cancellation_reactivated', 'cancellation_effective',
          'late_payment_reconciliation_required', 'financial_reconciliation_required',
          'administrative_termination',
          'professional_capacity_grandfathered_started',
          'professional_capacity_warning',
          'professional_capacity_extension_granted',
          'professional_capacity_grandfathered_expired',
          'professional_capacity_admin_alert_opened',
          'professional_capacity_grandfathered_resolved',
          'professional_coverage_individual_renewal_requested',
          'professional_coverage_individual_renewal_pending',
          'professional_coverage_individual_renewal_confirmed',
          'professional_coverage_individual_renewal_kept_by_user'
        )
      ORDER BY f.effectiveAt DESC, f.createdAt DESC
      LIMIT ${boundedLimit}
    `)
  );
  const transitionRows = resultRows<Row>(await db.execute(sql`
    SELECT n.id, 'commercial_transition_notification' AS factType, 1 AS factVersion,
      n.occurredAt AS effectiveAt, n.payloadJson, NULL AS invalidatedAt,
      JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.readAt')) AS readAt,
      JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryChannel')) AS lastDeliveryChannel,
      JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryState')) AS lastDeliveryState,
      JSON_UNQUOTE(JSON_EXTRACT(receipt.payloadJson, '$.lastDeliveryAt')) AS lastDeliveryAt
    FROM billingProviderEvents n
    LEFT JOIN billingProviderEvents receipt
      ON receipt.provider='billing-web'
      AND receipt.eventType='notification_receipt'
      AND receipt.providerEventId=CONCAT('notification-receipt:', ${userId}, ':', n.id)
    WHERE n.provider='billing-commercial-transition'
      AND n.eventType='commercial_transition_notification'
      AND n.status='processed'
      AND CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payloadJson, '$.userId')) AS UNSIGNED)=${userId}
    ORDER BY n.occurredAt DESC, n.createdAt DESC
    LIMIT ${boundedLimit}
  `));

  return [...rows, ...transitionRows]
    .map(notificationFromRow)
    .filter((item): item is NonNullable<typeof item> => item != null)
    .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime())
    .slice(0, boundedLimit);
}

export async function markBillingNotificationRead(input: {
  userId: number;
  notificationId: string;
}) {
  const { db, row } = await requireOwnedPresentableFact(
    input.userId,
    input.notificationId
  );
  const readAt = new Date();
  const providerEventId = receiptProviderEventId(input.userId, input.notificationId);
  const payload = JSON.stringify({
    userId: input.userId,
    sourceFactId: input.notificationId,
    readAt: readAt.toISOString(),
    lastDeliveryState: "not_attempted",
  });
  const subscriptionId = row.subscriptionId == null ? null : String(row.subscriptionId);
  await db.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, subscriptionId,
      payloadJson, occurredAt, processedAt, createdAt, updatedAt
    ) VALUES (
      ${crypto.randomUUID()}, 'billing-web', ${providerEventId}, 'notification_receipt',
      'processed', ${subscriptionId}, ${payload}, ${readAt}, ${readAt}, NOW(), NOW()
    )
    ON DUPLICATE KEY UPDATE
      status = 'processed',
      payloadJson = JSON_SET(
        COALESCE(payloadJson, JSON_OBJECT()),
        '$.readAt', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.readAt')), ${readAt.toISOString()})
      ),
      processedAt = ${readAt},
      updatedAt = NOW()
  `);
  return { readAt };
}

async function setDeliveryState(input: {
  userId: number;
  notificationId: string;
  channel: BillingNotificationDeliveryChannel;
  state: Exclude<BillingNotificationDeliveryState, "not_attempted">;
}) {
  const { db, row } = await requireOwnedPresentableFact(
    input.userId,
    input.notificationId
  );
  const at = new Date();
  const providerEventId = receiptProviderEventId(input.userId, input.notificationId);
  const payload = JSON.stringify({
    userId: input.userId,
    sourceFactId: input.notificationId,
    readAt: null,
    lastDeliveryChannel: input.channel,
    lastDeliveryState: input.state,
    lastDeliveryAt: at.toISOString(),
  });
  const subscriptionId = row.subscriptionId == null ? null : String(row.subscriptionId);
  await db.execute(sql`
    INSERT INTO billingProviderEvents (
      id, provider, providerEventId, eventType, status, subscriptionId,
      payloadJson, occurredAt, processedAt, createdAt, updatedAt
    ) VALUES (
      ${crypto.randomUUID()}, 'billing-web', ${providerEventId}, 'notification_receipt',
      'processed', ${subscriptionId}, ${payload}, ${at}, ${at}, NOW(), NOW()
    )
    ON DUPLICATE KEY UPDATE
      status = 'processed',
      payloadJson = JSON_SET(
        COALESCE(payloadJson, JSON_OBJECT()),
        '$.lastDeliveryChannel', ${input.channel},
        '$.lastDeliveryState', ${input.state},
        '$.lastDeliveryAt', ${at.toISOString()}
      ),
      processedAt = ${at},
      updatedAt = NOW()
  `);
}

export async function deliverBillingNotificationExternally(input: {
  userId: number;
  notificationId: string;
  channel: BillingNotificationDeliveryChannel;
  deliver: () => Promise<boolean>;
}) {
  // The authoritative notification source exists before this receipt is touched.
  // Persist pending delivery before the external side effect; a failed channel
  // never deletes or invalidates the internal notification source.
  await setDeliveryState({ ...input, state: "pending" });
  let delivered = false;
  try {
    delivered = await input.deliver();
  } catch {
    delivered = false;
  }
  await setDeliveryState({
    ...input,
    state: delivered ? "delivered" : "failed",
  });
  return { status: delivered ? "delivered" as const : "failed" as const };
}
