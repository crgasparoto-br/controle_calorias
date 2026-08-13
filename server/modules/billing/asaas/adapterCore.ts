import crypto from "node:crypto";
import type {
  BillingProvider,
  BillingProviderCapabilities,
  BillingProviderNormalizedEvent,
  BillingProviderPaymentFlow,
  BillingProviderPaymentFlowInput,
} from "../provider";
import {
  AsaasHttpError,
  AsaasUncertainOutcomeError,
  type AsaasClient,
} from "./client";
import type { AsaasOperation, AsaasOperationStore } from "./operationStore";

export type AsaasCustomerResponse = {
  id?: string;
  cpfCnpj?: string;
  phone?: string;
  mobilePhone?: string;
};

type CustomerListResponse = {
  data?: Array<{ id?: string; externalReference?: string }>;
};
type CheckoutResponse = { id?: string; link?: string; status?: string };
type PixAuthorizationResponse = {
  id?: string;
  status?: string;
  immediateQrCode?: { payload?: string; expirationDate?: string };
};
type SubscriptionResponse = {
  id?: string;
  status?: string;
  customer?: string;
  externalReference?: string;
  nextDueDate?: string;
  value?: number;
};
type SubscriptionListResponse = { data?: SubscriptionResponse[] };
type PaymentResponse = {
  id?: string;
  status?: string;
  dueDate?: string;
  externalReference?: string;
};
type PaymentListResponse = { data?: PaymentResponse[] };

const HOSTED_CHECKOUT_CUSTOMER_MARKER = "hosted_checkout";

function requiredString(value: unknown, code: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 86_400_000);
}

function cycle(value: BillingProviderPaymentFlowInput["billingCycle"]) {
  if (value === "monthly") return "MONTHLY";
  if (value === "yearly") return "YEARLY";
  throw new Error("asaas_unsupported_billing_cycle");
}

function amountMajor(minor: number) {
  if (!Number.isInteger(minor) || minor <= 0) {
    throw new Error("asaas_invalid_amount");
  }
  return minor / 100;
}

function finalAmount(flow: BillingProviderPaymentFlowInput) {
  if (!Number.isInteger(flow.unitAmount) || flow.unitAmount <= 0) {
    throw new Error("asaas_invalid_amount");
  }
  const discount = flow.discount?.amountMinor ?? 0;
  if (
    !Number.isInteger(discount) ||
    discount < 0 ||
    discount > flow.unitAmount ||
    (flow.discount &&
      (!Number.isInteger(flow.discount.durationCharges) ||
        flow.discount.durationCharges <= 0))
  ) {
    throw new Error("asaas_invalid_discount");
  }
  return flow.unitAmount - discount;
}

function customerExternalReference(userId: number) {
  return `controle-calorias:user:${userId}`;
}

function validateCallbackUrl(value: string, code: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(code);
  }
  return parsed.toString();
}

function shortContractId(contractKey: string) {
  return crypto.createHash("sha256").update(contractKey).digest("hex").slice(0, 32);
}

function failureCode(error: unknown) {
  return error instanceof AsaasHttpError ? `http_${error.status}` : "unexpected";
}

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("asaas_invalid_due_date");
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("asaas_invalid_due_date");
  return date;
}

/** Weekday approximation used only to choose a conservative point inside the
 * provider's documented 2-10 business-day window. The provider remains the
 * authority and deterministic rejection is surfaced without an automatic retry. */
export function businessWeekdaysUntil(dueDate: string, now: Date) {
  const due = parseDateOnly(dueDate);
  const cursor = new Date(`${dateOnly(now)}T12:00:00.000Z`);
  if (due.getTime() <= cursor.getTime()) return 0;
  let weekdays = 0;
  for (let value = addDays(cursor, 1); value.getTime() <= due.getTime(); value = addDays(value, 1)) {
    const day = value.getUTCDay();
    if (day !== 0 && day !== 6) weekdays += 1;
  }
  return weekdays;
}

export function shouldCreateScheduledPixPayment(dueDate: string, now: Date) {
  const days = businessWeekdaysUntil(dueDate, now);
  return days >= 2 && days <= 6;
}

export function createAsaasAdapter(input: {
  client: AsaasClient;
  store: AsaasOperationStore;
  enabledPaymentMethods: readonly BillingProviderPaymentFlowInput["paymentMethod"][];
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  const paymentMethods = Array.from(new Set(input.enabledPaymentMethods)).filter(
    method => method === "credit_card" || method === "pix_automatic"
  );

  const capabilities: BillingProviderCapabilities = {
    paymentMethods,
    hostedCheckout: paymentMethods.includes("credit_card"),
    recurringBilling: paymentMethods.includes("credit_card"),
    automaticPix: paymentMethods.includes("pix_automatic"),
    // The token-based mutation cannot be authoritatively re-read after a timeout,
    // so it is not advertised as a recoverable provider capability.
    updatePaymentMethod: false,
    synchronization: true,
  };

  function validateFlow(flow: BillingProviderPaymentFlowInput) {
    if (!paymentMethods.includes(flow.paymentMethod)) {
      throw new Error("asaas_payment_method_unavailable");
    }
    if (flow.currency !== "BRL") throw new Error("asaas_currency_not_supported");
    if (!flow.contractKey.trim() || !flow.versionCode.trim()) {
      throw new Error("asaas_contract_reference_required");
    }
    cycle(flow.billingCycle);
    const amount = finalAmount(flow);
    if (amount === 0) {
      throw new Error("asaas_zero_value_charge_not_supported");
    }
    if (flow.paymentMethod === "pix_automatic" && flow.trialChoice !== "waive") {
      throw new Error("pix_automatic_requires_trial_waiver");
    }
    validateCallbackUrl(flow.successUrl, "asaas_invalid_success_url");
    validateCallbackUrl(flow.cancelUrl, "asaas_invalid_cancel_url");
    validateCallbackUrl(flow.expiredUrl, "asaas_invalid_expired_url");
    return amount;
  }

  async function ensureCustomer(customer: BillingProviderPaymentFlowInput["customer"]) {
    const externalReference = customerExternalReference(customer.payerUserId);
    const operationKey = externalReference;
    const prepared = await input.store.prepare({
      kind: "customer",
      operationKey,
      externalReference,
      customerReference: String(customer.payerUserId),
      payerUserId: customer.payerUserId,
    });
    if (prepared.operation.state === "created" && prepared.operation.externalId) {
      return prepared.operation.externalId;
    }
    if (prepared.operation.state === "outcome_unknown") {
      const existing = await input.client.get<CustomerListResponse>("/customers", {
        externalReference,
        limit: 2,
      });
      const matches = (existing.data ?? []).filter(
        row => row.externalReference === externalReference && row.id
      );
      if (matches.length === 1) {
        const id = requiredString(matches[0]?.id, "asaas_customer_id_missing");
        await input.store.markCreated({
          kind: "customer",
          operationKey,
          externalId: id,
          externalReference,
        });
        return id;
      }
      throw new Error(
        matches.length > 1
          ? "asaas_customer_reconciliation_ambiguous"
          : "asaas_customer_reconciliation_pending"
      );
    }
    if (!prepared.created && prepared.operation.state === "failed") {
      throw new Error("asaas_customer_creation_failed");
    }

    try {
      const created = await input.client.post<AsaasCustomerResponse>("/customers", {
        name: requiredString(customer.name, "asaas_customer_name_required"),
        ...(customer.email ? { email: customer.email } : {}),
        ...(customer.mobilePhone ? { mobilePhone: customer.mobilePhone } : {}),
        ...(customer.cpfCnpj ? { cpfCnpj: customer.cpfCnpj } : {}),
        externalReference,
      });
      const id = requiredString(created.id, "asaas_customer_id_missing");
      await input.store.markCreated({
        kind: "customer",
        operationKey,
        externalId: id,
        externalReference,
      });
      return id;
    } catch (error) {
      if (error instanceof AsaasUncertainOutcomeError) {
        await input.store.markOutcomeUnknown("customer", operationKey);
      } else {
        await input.store.markFailed("customer", operationKey, failureCode(error));
      }
      throw error;
    }
  }

  async function hostedCheckoutCustomerId(payerUserId: number) {
    const operation = await input.store.get(
      "customer",
      customerExternalReference(payerUserId)
    );
    return operation?.state === "created" &&
      operation.publicReference === HOSTED_CHECKOUT_CUSTOMER_MARKER &&
      operation.externalId
      ? operation.externalId
      : null;
  }

  async function rememberHostedCheckoutCustomer(
    payerUserId: number,
    customerId: string
  ) {
    const externalId = requiredString(
      customerId,
      "asaas_hosted_checkout_customer_id_required"
    );
    const externalReference = customerExternalReference(payerUserId);
    const prepared = await input.store.prepare({
      kind: "customer",
      operationKey: externalReference,
      externalReference,
      customerReference: String(payerUserId),
      payerUserId,
    });
    if (
      prepared.operation.publicReference === HOSTED_CHECKOUT_CUSTOMER_MARKER &&
      prepared.operation.externalId &&
      prepared.operation.externalId !== externalId
    ) {
      throw new Error("asaas_hosted_checkout_customer_conflict");
    }
    await input.store.markCreated({
      kind: "customer",
      operationKey: externalReference,
      externalId,
      externalReference,
      customerReference: String(payerUserId),
      publicReference: HOSTED_CHECKOUT_CUSTOMER_MARKER,
    });
    return externalId;
  }

  function flowOperationFields(
    flow: BillingProviderPaymentFlowInput,
    customerId: string | null,
    amountMinor: number
  ) {
    return {
      subscriptionId: flow.subscriptionId,
      externalReference: flow.contractKey,
      customerReference: customerId,
      payerUserId: flow.payerUserId,
      planCode: flow.versionCode,
      paymentMethod: flow.paymentMethod,
      trialChoice: flow.trialChoice,
      couponCode: flow.couponCode ?? null,
      billingCycle: flow.billingCycle,
      correlationId: flow.correlationId,
      amountMinor,
      unitAmountMinor: flow.unitAmount,
      discountDurationCharges: flow.discount?.durationCharges ?? null,
      transitionAccessUntil: flow.transitionAccessUntil ?? null,
    } as const;
  }

  function assertFlowOperationMatches(
    operation: AsaasOperation,
    flow: BillingProviderPaymentFlowInput,
    customerId: string | null,
    amountMinor: number
  ) {
    if (
      operation.payerUserId !== flow.payerUserId ||
      operation.planCode !== flow.versionCode ||
      operation.paymentMethod !== flow.paymentMethod ||
      operation.trialChoice !== flow.trialChoice ||
      operation.billingCycle !== flow.billingCycle ||
      operation.customerReference !== customerId ||
      operation.amountMinor !== amountMinor ||
      operation.unitAmountMinor !== flow.unitAmount ||
      (operation.couponCode ?? null) !== (flow.couponCode ?? null)
    ) {
      throw new Error("asaas_operation_key_conflict");
    }
  }

  async function createHostedCheckout(
    flow: BillingProviderPaymentFlowInput,
    customerId: string | null,
    amountMinor: number
  ): Promise<BillingProviderPaymentFlow> {
    const operationKey = `${flow.contractKey}:checkout`;
    const prepared = await input.store.prepare({
      kind: "checkout",
      operationKey,
      ...flowOperationFields(flow, customerId, amountMinor),
    });
    assertFlowOperationMatches(prepared.operation, flow, customerId, amountMinor);
    if (prepared.operation.state === "created" && prepared.operation.externalId) {
      let url = prepared.operation.publicReference;
      if (!url) {
        const current = await input.client.get<CheckoutResponse>(
          `/checkouts/${encodeURIComponent(prepared.operation.externalId)}`
        );
        url = requiredString(current.link, "asaas_checkout_link_missing");
        await input.store.markCreated({
          kind: "checkout",
          operationKey,
          externalId: prepared.operation.externalId,
          externalReference: flow.contractKey,
          customerReference: customerId,
          publicReference: url,
        });
      }
      return {
        kind: "hosted_checkout",
        provider: "asaas",
        externalId: prepared.operation.externalId,
        url,
        state: "pending",
      };
    }
    if (prepared.operation.state === "outcome_unknown") {
      throw new Error("asaas_checkout_reconciliation_pending");
    }
    if (!prepared.created && prepared.operation.state === "failed") {
      throw new Error("asaas_checkout_creation_failed");
    }

    const firstDueDate = addDays(
      now(),
      flow.trialChoice === "request" ? Math.max(2, flow.trialDays + 2) : 1
    );
    try {
      const created = await input.client.post<CheckoutResponse>("/checkouts", {
        billingTypes: ["CREDIT_CARD"],
        chargeTypes: ["RECURRENT"],
        minutesToExpire: 60,
        externalReference: flow.contractKey,
        callback: {
          successUrl: validateCallbackUrl(flow.successUrl, "asaas_invalid_success_url"),
          cancelUrl: validateCallbackUrl(flow.cancelUrl, "asaas_invalid_cancel_url"),
          expiredUrl: validateCallbackUrl(flow.expiredUrl, "asaas_invalid_expired_url"),
        },
        items: [
          {
            externalReference: flow.versionCode,
            name: flow.productName,
            quantity: 1,
            value: amountMajor(amountMinor),
          },
        ],
        ...(customerId ? { customer: customerId } : {}),
        subscription: {
          cycle: cycle(flow.billingCycle),
          nextDueDate: `${dateOnly(firstDueDate)} 12:00:00`,
        },
      });
      const externalId = requiredString(created.id, "asaas_checkout_id_missing");
      const url = requiredString(created.link, "asaas_checkout_link_missing");
      await input.store.markCreated({
        kind: "checkout",
        operationKey,
        externalId,
        externalReference: flow.contractKey,
        customerReference: customerId,
        publicReference: url,
      });
      return {
        kind: "hosted_checkout",
        provider: "asaas",
        externalId,
        url,
        state: "pending",
      };
    } catch (error) {
      if (error instanceof AsaasUncertainOutcomeError) {
        await input.store.markOutcomeUnknown("checkout", operationKey);
      } else {
        await input.store.markFailed("checkout", operationKey, failureCode(error));
      }
      throw error;
    }
  }

  async function createPixAutomatic(
    flow: BillingProviderPaymentFlowInput,
    customerId: string,
    amountMinor: number
  ): Promise<BillingProviderPaymentFlow> {
    const operationKey = `${flow.contractKey}:pix-automatic`;
    const prepared = await input.store.prepare({
      kind: "pix_automatic_authorization",
      operationKey,
      publicReference: shortContractId(flow.contractKey),
      ...flowOperationFields(flow, customerId, amountMinor),
    });
    assertFlowOperationMatches(prepared.operation, flow, customerId, amountMinor);
    if (prepared.operation.state === "outcome_unknown") {
      throw new Error("asaas_pix_authorization_reconciliation_pending");
    }
    if (!prepared.created && prepared.operation.state === "failed") {
      throw new Error("asaas_pix_authorization_failed");
    }
    if (prepared.operation.state === "created" && prepared.operation.externalId) {
      const current = await input.client.get<PixAuthorizationResponse>(
        `/pix/automatic/authorizations/${encodeURIComponent(prepared.operation.externalId)}`
      );
      return {
        kind: "pix_automatic",
        provider: "asaas",
        externalId: prepared.operation.externalId,
        qrCodePayload: requiredString(
          current.immediateQrCode?.payload,
          "asaas_pix_qr_missing"
        ),
        expiresAt: current.immediateQrCode?.expirationDate ?? null,
        state: "pending",
      };
    }

    try {
      const created = await input.client.post<PixAuthorizationResponse>(
        "/pix/automatic/authorizations",
        {
          frequency: cycle(flow.billingCycle),
          contractId: shortContractId(flow.contractKey),
          startDate: dateOnly(now()),
          description: flow.productName.slice(0, 35),
          customerId,
          paymentCreationMode: "MANUAL",
          retryPolicy: "ALLOW_THREE_IN_SEVEN_DAYS",
          immediateQrCode: {
            value: amountMajor(amountMinor),
            expirationSeconds: 3600,
          },
        }
      );
      const externalId = requiredString(
        created.id,
        "asaas_pix_authorization_id_missing"
      );
      await input.store.markCreated({
        kind: "pix_automatic_authorization",
        operationKey,
        externalId,
        externalReference: flow.contractKey,
        customerReference: customerId,
        authorizationReference: externalId,
      });
      return {
        kind: "pix_automatic",
        provider: "asaas",
        externalId,
        qrCodePayload: requiredString(
          created.immediateQrCode?.payload,
          "asaas_pix_qr_missing"
        ),
        expiresAt: created.immediateQrCode?.expirationDate ?? null,
        state: "pending",
      };
    } catch (error) {
      if (error instanceof AsaasUncertainOutcomeError) {
        await input.store.markOutcomeUnknown(
          "pix_automatic_authorization",
          operationKey
        );
      } else {
        await input.store.markFailed(
          "pix_automatic_authorization",
          operationKey,
          failureCode(error)
        );
      }
      throw error;
    }
  }

  async function createPaymentFlow(flow: BillingProviderPaymentFlowInput) {
    const amountMinor = validateFlow(flow);
    if (flow.paymentMethod === "credit_card") {
      const customerId = await hostedCheckoutCustomerId(flow.payerUserId);
      return createHostedCheckout(flow, customerId, amountMinor);
    }
    const customerId = await ensureCustomer(flow.customer);
    return createPixAutomatic(flow, customerId, amountMinor);
  }

  async function schedulePixPayment(inputPayment: {
    subscriptionId: string;
    contractKey: string;
    authorizationId: string;
    customerId: string;
    competenceKey: string;
    dueDate: string;
    amountMinor: number;
  }) {
    parseDateOnly(inputPayment.dueDate);
    amountMajor(inputPayment.amountMinor);
    const operationKey = `${inputPayment.subscriptionId}:${inputPayment.competenceKey}`;
    return input.store.prepare({
      kind: "pix_payment",
      operationKey,
      subscriptionId: inputPayment.subscriptionId,
      externalReference: inputPayment.contractKey,
      customerReference: inputPayment.customerId,
      authorizationReference: inputPayment.authorizationId,
      correlationId: inputPayment.competenceKey,
      amountMinor: inputPayment.amountMinor,
      dueDate: inputPayment.dueDate,
    });
  }

  async function executeScheduledPixPayment(operation: AsaasOperation) {
    if (
      operation.kind !== "pix_payment" ||
      !operation.subscriptionId ||
      !operation.externalReference ||
      !operation.customerReference ||
      !operation.authorizationReference ||
      !operation.correlationId ||
      !operation.dueDate ||
      !operation.amountMinor
    ) {
      throw new Error("asaas_pix_payment_operation_incomplete");
    }
    const externalReference = `${operation.externalReference}:${operation.correlationId}`;
    if (operation.state === "created" && operation.externalId) {
      return operation.externalId;
    }
    if (operation.state === "failed") {
      throw new Error("asaas_pix_payment_creation_failed");
    }
    if (operation.state === "outcome_unknown") {
      const result = await input.client.get<PaymentListResponse>("/payments", {
        externalReference,
        limit: 2,
      });
      const matches = (result.data ?? []).filter(
        item => item.externalReference === externalReference && item.id
      );
      if (matches.length === 1) {
        const id = requiredString(matches[0]?.id, "asaas_payment_id_missing");
        await input.store.markCreated({
          kind: "pix_payment",
          operationKey: operation.operationKey,
          externalId: id,
          externalReference: operation.externalReference,
          customerReference: operation.customerReference,
          authorizationReference: operation.authorizationReference,
        });
        return id;
      }
      throw new Error(
        matches.length > 1
          ? "asaas_pix_payment_reconciliation_ambiguous"
          : "asaas_pix_payment_reconciliation_pending"
      );
    }
    if (!shouldCreateScheduledPixPayment(operation.dueDate, now())) {
      throw new Error("asaas_pix_payment_outside_creation_window");
    }

    try {
      const created = await input.client.post<PaymentResponse>("/payments", {
        customer: operation.customerReference,
        billingType: "PIX",
        value: amountMajor(operation.amountMinor),
        dueDate: operation.dueDate,
        externalReference,
        pixAutomaticAuthorizationId: operation.authorizationReference,
      });
      const externalId = requiredString(created.id, "asaas_payment_id_missing");
      await input.store.markCreated({
        kind: "pix_payment",
        operationKey: operation.operationKey,
        externalId,
        externalReference: operation.externalReference,
        customerReference: operation.customerReference,
        authorizationReference: operation.authorizationReference,
      });
      return externalId;
    } catch (error) {
      if (error instanceof AsaasUncertainOutcomeError) {
        await input.store.markOutcomeUnknown("pix_payment", operation.operationKey);
      } else {
        await input.store.markFailed(
          "pix_payment",
          operation.operationKey,
          failureCode(error)
        );
      }
      throw error;
    }
  }

  async function restoreSubscriptionBaseAmount(inputReset: {
    subscriptionId: string;
    externalSubscriptionId: string;
    contractKey: string;
    unitAmountMinor: number;
  }) {
    const operationKey = `${inputReset.subscriptionId}:coupon-reset`;
    const prepared = await input.store.prepare({
      kind: "coupon_reset",
      operationKey,
      subscriptionId: inputReset.subscriptionId,
      externalReference: inputReset.contractKey,
      unitAmountMinor: inputReset.unitAmountMinor,
    });
    if (prepared.operation.state === "created") return;
    if (prepared.operation.state === "outcome_unknown") {
      const current = await input.client.get<SubscriptionResponse>(
        `/subscriptions/${encodeURIComponent(inputReset.externalSubscriptionId)}`
      );
      const currentMinor =
        typeof current.value === "number" && Number.isFinite(current.value)
          ? Math.round(current.value * 100)
          : null;
      if (currentMinor === inputReset.unitAmountMinor) {
        await input.store.markCreated({
          kind: "coupon_reset",
          operationKey,
          externalId: inputReset.externalSubscriptionId,
          externalReference: inputReset.contractKey,
        });
        return;
      }
      await input.store.resetOutcomeUnknownToPrepared("coupon_reset", operationKey);
      throw new Error("asaas_coupon_reset_safe_retry_required");
    }
    if (!prepared.created && prepared.operation.state === "failed") {
      throw new Error("asaas_coupon_reset_failed");
    }
    try {
      await input.client.put(
        `/subscriptions/${encodeURIComponent(inputReset.externalSubscriptionId)}`,
        {
          value: amountMajor(inputReset.unitAmountMinor),
          updatePendingPayments: false,
        }
      );
      await input.store.markCreated({
        kind: "coupon_reset",
        operationKey,
        externalId: inputReset.externalSubscriptionId,
        externalReference: inputReset.contractKey,
      });
    } catch (error) {
      if (error instanceof AsaasUncertainOutcomeError) {
        await input.store.markOutcomeUnknown("coupon_reset", operationKey);
      } else {
        await input.store.markFailed("coupon_reset", operationKey, failureCode(error));
      }
      throw error;
    }
  }

  const provider: BillingProvider = {
    code: "asaas",
    capabilities: () => capabilities,
    createPaymentFlow,
    async synchronizeSubscription(externalSubscriptionId) {
      const data = await input.client.get<SubscriptionResponse>(
        `/subscriptions/${encodeURIComponent(externalSubscriptionId)}`
      );
      const status = String(data.status ?? "").toUpperCase();
      return {
        externalSubscriptionId,
        status:
          status === "ACTIVE"
            ? ("active" as const)
            : status === "EXPIRED"
              ? ("expired" as const)
              : status === "INACTIVE"
                ? ("canceled" as const)
                : ("pending" as const),
        currentPeriodEnd: data.nextDueDate
          ? parseDateOnly(data.nextDueDate)
          : null,
        cancelAtPeriodEnd: status === "INACTIVE",
      };
    },
    async cancelSubscription(externalSubscriptionId) {
      await input.client.put(
        `/subscriptions/${encodeURIComponent(externalSubscriptionId)}`,
        { status: "INACTIVE" }
      );
    },
    async reactivateSubscription(reactivation) {
      await input.client.put(
        `/subscriptions/${encodeURIComponent(reactivation.externalSubscriptionId)}`,
        {
          status: "ACTIVE",
          nextDueDate: dateOnly(reactivation.nextRenewalAt),
        }
      );
    },
    async authenticateAndNormalizeWebhook(): Promise<BillingProviderNormalizedEvent> {
      throw new Error("asaas_webhook_uses_durable_handler");
    },
  };

  return {
    provider,
    capabilities: () => capabilities,
    ensureCustomer,
    rememberHostedCheckoutCustomer,
    createPaymentFlow,
    schedulePixPayment,
    executeScheduledPixPayment,
    restoreSubscriptionBaseAmount,
    getCustomer(id: string) {
      return input.client.get<AsaasCustomerResponse>(
        `/customers/${encodeURIComponent(id)}`
      );
    },
    async findSubscriptionByReference(externalReference: string) {
      const result = await input.client.get<SubscriptionListResponse>(
        "/subscriptions",
        { externalReference, limit: 2 }
      );
      const matches = (result.data ?? []).filter(
        item => item.externalReference === externalReference && item.id
      );
      if (matches.length > 1) {
        throw new Error("asaas_subscription_reconciliation_ambiguous");
      }
      return matches[0] ?? null;
    },
    async cancelPixAutomaticAuthorization(id: string) {
      await input.client.delete(
        `/pix/automatic/authorizations/${encodeURIComponent(id)}`
      );
    },
    async getPixAutomaticAuthorization(id: string) {
      return input.client.get<PixAuthorizationResponse>(
        `/pix/automatic/authorizations/${encodeURIComponent(id)}`
      );
    },
  };
}

export type AsaasAdapter = ReturnType<typeof createAsaasAdapter>;
