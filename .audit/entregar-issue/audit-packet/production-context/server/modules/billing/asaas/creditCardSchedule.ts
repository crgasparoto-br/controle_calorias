import {
  AsaasHttpError,
  AsaasUncertainOutcomeError,
  type AsaasClient,
} from "./client";
import type { AsaasOperationKind, AsaasOperationStore } from "./operationStore";

const SUBSCRIPTION_SCHEDULE_KIND = "subscription_schedule" as AsaasOperationKind;
const PAYMENT_RESCHEDULE_KIND = "payment_reschedule" as AsaasOperationKind;

export type AsaasCreditCardScheduleInput = {
  subscriptionId: string;
  externalSubscriptionId: string;
  contractKey: string;
  scopeKey: string;
  billingCycle: "monthly" | "yearly";
  targetDueDate: string;
  amountMinor: number;
  paymentExternalReference: string;
  expectedCurrentDueDate?: string | null;
  commercialConfirmationKey?: string | null;
};

type SubscriptionResponse = {
  nextDueDate?: string;
};

type PaymentResponse = {
  id?: string;
  status?: string;
  dueDate?: string;
  externalReference?: string;
  subscription?: string;
  value?: number;
};

type PaymentListResponse = { data?: PaymentResponse[] };

function requiredString(value: unknown, code: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("asaas_invalid_due_date");
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("asaas_invalid_due_date");
  return date;
}

function amountMajor(minor: number) {
  if (!Number.isInteger(minor) || minor <= 0) throw new Error("asaas_invalid_amount");
  return minor / 100;
}

function failureCode(error: unknown) {
  return error instanceof AsaasHttpError ? `http_${error.status}` : "unexpected";
}

function paymentAmountMinor(payment: PaymentResponse) {
  return typeof payment.value === "number" && Number.isFinite(payment.value)
    ? Math.round(payment.value * 100)
    : null;
}

export function nextBillingCycleDate(
  dueDate: string,
  billingCycle: AsaasCreditCardScheduleInput["billingCycle"]
) {
  const current = parseDateOnly(dueDate);
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth();
  const day = current.getUTCDate();
  const targetMonth = billingCycle === "monthly" ? month + 1 : month;
  const targetYear = billingCycle === "yearly" ? year + 1 : year;
  const normalizedYear = targetYear + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(normalizedYear, normalizedMonth + 1, 0)
  ).getUTCDate();
  return new Date(
    Date.UTC(normalizedYear, normalizedMonth, Math.min(day, lastDay), 12)
  )
    .toISOString()
    .slice(0, 10);
}

export function createAsaasCreditCardSchedule(input: {
  client: AsaasClient;
  store: AsaasOperationStore;
}) {
  async function listPendingSubscriptionPayments(externalSubscriptionId: string) {
    const response = await input.client.get<PaymentListResponse>(
      `/subscriptions/${encodeURIComponent(externalSubscriptionId)}/payments`,
      { status: "PENDING" }
    );
    return (response.data ?? []).filter(payment => !!payment.id && !!payment.dueDate);
  }

  function choosePendingPayment(
    payments: PaymentResponse[],
    schedule: AsaasCreditCardScheduleInput
  ) {
    const alreadyAligned = payments.filter(
      payment =>
        payment.dueDate === schedule.targetDueDate &&
        payment.externalReference === schedule.paymentExternalReference
    );
    if (alreadyAligned.length > 1) {
      throw new Error("asaas_subscription_payment_reconciliation_ambiguous");
    }
    if (alreadyAligned.length === 1) {
      return { payment: alreadyAligned[0]!, aligned: true } as const;
    }

    const expected = schedule.expectedCurrentDueDate
      ? payments.filter(
          payment =>
            payment.dueDate === schedule.expectedCurrentDueDate &&
            payment.externalReference === schedule.contractKey
        )
      : [];
    if (expected.length > 1) {
      throw new Error("asaas_subscription_payment_reconciliation_ambiguous");
    }
    if (expected.length === 1) {
      return { payment: expected[0]!, aligned: false } as const;
    }

    const contractPayments = payments
      .filter(payment => payment.externalReference === schedule.contractKey)
      .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)));
    if (contractPayments.length > 0) {
      const earliestDueDate = contractPayments[0]!.dueDate;
      const earliest = contractPayments.filter(payment => payment.dueDate === earliestDueDate);
      if (earliest.length > 1) {
        throw new Error("asaas_subscription_payment_reconciliation_ambiguous");
      }
      return { payment: earliest[0]!, aligned: false } as const;
    }
    return { payment: null, aligned: false } as const;
  }

  async function alignSubscriptionScheduleMutation(
    schedule: AsaasCreditCardScheduleInput,
    nextDueDate: string
  ) {
    const operationKey = `${schedule.subscriptionId}:${schedule.scopeKey}:subscription-schedule`;
    const prepared = await input.store.prepare({
      kind: SUBSCRIPTION_SCHEDULE_KIND,
      operationKey,
      subscriptionId: schedule.subscriptionId,
      externalReference: schedule.contractKey,
      publicReference: schedule.externalSubscriptionId,
      correlationId: schedule.commercialConfirmationKey ?? schedule.scopeKey,
      billingCycle: schedule.billingCycle,
      dueDate: nextDueDate,
    });
    if (prepared.operation.state === "created") return;
    if (prepared.operation.state === "outcome_unknown") {
      const current = await input.client.get<SubscriptionResponse>(
        `/subscriptions/${encodeURIComponent(schedule.externalSubscriptionId)}`
      );
      const followingDueDate = nextBillingCycleDate(nextDueDate, schedule.billingCycle);
      if (current.nextDueDate === nextDueDate || current.nextDueDate === followingDueDate) {
        await input.store.markCreated({
          kind: SUBSCRIPTION_SCHEDULE_KIND,
          operationKey,
          externalId: schedule.externalSubscriptionId,
          externalReference: schedule.contractKey,
          publicReference: schedule.externalSubscriptionId,
        });
        return;
      }
      throw new Error("asaas_subscription_schedule_reconciliation_pending");
    }
    if (!prepared.created && prepared.operation.state === "failed") {
      throw new Error("asaas_subscription_schedule_failed");
    }
    try {
      await input.client.put(
        `/subscriptions/${encodeURIComponent(schedule.externalSubscriptionId)}`,
        { nextDueDate, updatePendingPayments: false }
      );
      await input.store.markCreated({
        kind: SUBSCRIPTION_SCHEDULE_KIND,
        operationKey,
        externalId: schedule.externalSubscriptionId,
        externalReference: schedule.contractKey,
        publicReference: schedule.externalSubscriptionId,
      });
    } catch (error) {
      if (error instanceof AsaasUncertainOutcomeError) {
        await input.store.markOutcomeUnknown(SUBSCRIPTION_SCHEDULE_KIND, operationKey);
      } else {
        await input.store.markFailed(SUBSCRIPTION_SCHEDULE_KIND, operationKey, failureCode(error));
      }
      throw error;
    }
  }

  async function alignPendingPaymentMutation(
    schedule: AsaasCreditCardScheduleInput,
    payment: PaymentResponse
  ) {
    const paymentId = requiredString(payment.id, "asaas_payment_id_missing");
    const operationKey = `${schedule.subscriptionId}:${schedule.scopeKey}:payment-reschedule`;
    const prepared = await input.store.prepare({
      kind: PAYMENT_RESCHEDULE_KIND,
      operationKey,
      subscriptionId: schedule.subscriptionId,
      externalReference: schedule.contractKey,
      publicReference: paymentId,
      correlationId: schedule.commercialConfirmationKey ?? schedule.scopeKey,
      billingCycle: schedule.billingCycle,
      amountMinor: schedule.amountMinor,
      dueDate: schedule.targetDueDate,
    });
    if (prepared.operation.state === "created") return paymentId;
    if (prepared.operation.state === "outcome_unknown") {
      const current = await input.client.get<PaymentResponse>(
        `/payments/${encodeURIComponent(paymentId)}`
      );
      if (
        current.dueDate === schedule.targetDueDate &&
        current.externalReference === schedule.paymentExternalReference &&
        paymentAmountMinor(current) === schedule.amountMinor
      ) {
        await input.store.markCreated({
          kind: PAYMENT_RESCHEDULE_KIND,
          operationKey,
          externalId: paymentId,
          externalReference: schedule.contractKey,
          publicReference: paymentId,
        });
        return paymentId;
      }
      throw new Error("asaas_payment_reschedule_reconciliation_pending");
    }
    if (!prepared.created && prepared.operation.state === "failed") {
      throw new Error("asaas_payment_reschedule_failed");
    }
    try {
      await input.client.put<PaymentResponse>(
        `/payments/${encodeURIComponent(paymentId)}`,
        {
          billingType: "CREDIT_CARD",
          value: amountMajor(schedule.amountMinor),
          dueDate: schedule.targetDueDate,
          externalReference: schedule.paymentExternalReference,
        }
      );
      await input.store.markCreated({
        kind: PAYMENT_RESCHEDULE_KIND,
        operationKey,
        externalId: paymentId,
        externalReference: schedule.contractKey,
        publicReference: paymentId,
      });
      return paymentId;
    } catch (error) {
      if (error instanceof AsaasUncertainOutcomeError) {
        await input.store.markOutcomeUnknown(PAYMENT_RESCHEDULE_KIND, operationKey);
      } else {
        await input.store.markFailed(PAYMENT_RESCHEDULE_KIND, operationKey, failureCode(error));
      }
      throw error;
    }
  }

  async function recordAlignedPaymentOperation(
    schedule: AsaasCreditCardScheduleInput,
    payment: PaymentResponse
  ) {
    const paymentId = requiredString(payment.id, "asaas_payment_id_missing");
    const operationKey = `${schedule.subscriptionId}:${schedule.scopeKey}:payment-reschedule`;
    const prepared = await input.store.prepare({
      kind: PAYMENT_RESCHEDULE_KIND,
      operationKey,
      subscriptionId: schedule.subscriptionId,
      externalReference: schedule.contractKey,
      publicReference: paymentId,
      correlationId: schedule.commercialConfirmationKey ?? schedule.scopeKey,
      billingCycle: schedule.billingCycle,
      amountMinor: schedule.amountMinor,
      dueDate: schedule.targetDueDate,
    });
    if (prepared.operation.state === "created") return paymentId;
    if (prepared.operation.state === "outcome_unknown") {
      return alignPendingPaymentMutation(schedule, { id: paymentId });
    }
    if (!prepared.created && prepared.operation.state === "failed") {
      throw new Error("asaas_payment_reschedule_failed");
    }
    await input.store.markCreated({
      kind: PAYMENT_RESCHEDULE_KIND,
      operationKey,
      externalId: paymentId,
      externalReference: schedule.contractKey,
      publicReference: paymentId,
    });
    return paymentId;
  }

  async function alignCreditCardSubscriptionSchedule(
    schedule: AsaasCreditCardScheduleInput
  ) {
    parseDateOnly(schedule.targetDueDate);
    amountMajor(schedule.amountMinor);
    if (!schedule.scopeKey.trim() || !schedule.contractKey.trim()) {
      throw new Error("asaas_subscription_schedule_reference_required");
    }

    const paymentOperationKey = `${schedule.subscriptionId}:${schedule.scopeKey}:payment-reschedule`;
    const priorPaymentOperation = await input.store.get(
      PAYMENT_RESCHEDULE_KIND,
      paymentOperationKey
    );
    if (priorPaymentOperation?.publicReference) {
      const nextDueDate = nextBillingCycleDate(schedule.targetDueDate, schedule.billingCycle);
      await alignSubscriptionScheduleMutation(schedule, nextDueDate);
      await alignPendingPaymentMutation(schedule, { id: priorPaymentOperation.publicReference });
      return { paymentId: priorPaymentOperation.publicReference, nextDueDate };
    }

    const pending = await listPendingSubscriptionPayments(schedule.externalSubscriptionId);
    const selected = choosePendingPayment(pending, schedule);
    const subscriptionNextDueDate = selected.payment
      ? nextBillingCycleDate(schedule.targetDueDate, schedule.billingCycle)
      : schedule.targetDueDate;

    await alignSubscriptionScheduleMutation(schedule, subscriptionNextDueDate);
    if (!selected.payment) {
      return { paymentId: null, nextDueDate: subscriptionNextDueDate };
    }
    if (selected.aligned) {
      await recordAlignedPaymentOperation(schedule, selected.payment);
    } else {
      await alignPendingPaymentMutation(schedule, selected.payment);
    }
    return {
      paymentId: requiredString(selected.payment.id, "asaas_payment_id_missing"),
      nextDueDate: subscriptionNextDueDate,
    };
  }

  return { alignCreditCardSubscriptionSchedule };
}

export type AsaasCreditCardSchedule = ReturnType<typeof createAsaasCreditCardSchedule>;
