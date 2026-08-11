import type { Request, Response } from "express";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { requireDb, resultRows } from "../../../repositories/billingRepositorySupport";
import type { BillingPaymentMethod } from "../catalogPolicy";
import {
  billingCatalogService,
  configureBillingPaymentCapabilitiesProvider,
} from "../catalogRuntime";
import {
  INDIVIDUAL_TRIAL_DAYS,
  PROFESSIONAL_TRIAL_DAYS,
} from "../subscriptionLifecycle";
import {
  billingSubscriptionLifecycleRepository,
  billingSubscriptionLifecycleService,
} from "../subscriptionLifecycleRuntime";
import type { BillingProviderCustomerInput } from "../provider";
import type { BillingTrialChoice } from "../subscriptionLifecycleTypes";
import {
  createAsaasAdapter,
  shouldCreateScheduledPixPayment,
  type AsaasAdapter,
} from "./adapter";
import {
  AsaasUncertainOutcomeError,
  createAsaasClient,
  type AsaasEnvironment,
} from "./client";
import { executeGuardedAsaasMutation } from "./mutationGuard";
import {
  createDrizzleAsaasOperationStore,
  type AsaasOperationStore,
} from "./operationStore";
import { createAsaasWebhookRuntime } from "./webhook";

function environment(): AsaasEnvironment {
  return process.env.ASAAS_ENV?.trim().toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

function credentials() {
  const production = environment() === "production";
  return {
    environment: production ? ("production" as const) : ("sandbox" as const),
    apiKey: (
      production
        ? process.env.ASAAS_PRODUCTION_API_KEY
        : process.env.ASAAS_SANDBOX_API_KEY
    )?.trim() ?? "",
    webhookToken: (
      production
        ? process.env.ASAAS_PRODUCTION_WEBHOOK_TOKEN
        : process.env.ASAAS_SANDBOX_WEBHOOK_TOKEN
    )?.trim() ?? "",
  };
}

function enabledMethods(): BillingPaymentMethod[] {
  const configuredCredentials = credentials();
  if (!configuredCredentials.apiKey || !configuredCredentials.webhookToken) return [];
  const configured = (
    process.env.ASAAS_ENABLED_PAYMENT_METHODS ?? "credit_card,pix_automatic"
  )
    .split(",")
    .map(value => value.trim())
    .filter(
      (value): value is BillingPaymentMethod =>
        value === "credit_card" || value === "pix_automatic"
    );
  return Array.from(new Set(configured));
}

function requestTimeoutMs() {
  const value = Number(process.env.ASAAS_REQUEST_TIMEOUT_MS ?? 60_000);
  return Number.isFinite(value) && value >= 1_000 ? value : 60_000;
}

function appUrl() {
  const value = process.env.PUBLIC_APP_URL?.trim();
  if (!value) throw new Error("public_app_url_required_for_billing");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("public_app_url_invalid_for_billing");
  }
  return parsed;
}

function callbacks(contractKey: string) {
  const base = appUrl();
  function build(path: string) {
    const value = new URL(path, base);
    value.searchParams.set("billingAttempt", contractKey);
    return value.toString();
  }
  return {
    successUrl: build("/billing/return/success"),
    cancelUrl: build("/billing/return/cancel"),
    expiredUrl: build("/billing/return/expired"),
  };
}

function uncertainty(error: unknown) {
  return (
    error instanceof AsaasUncertainOutcomeError ||
    (error instanceof Error && error.message.includes("reconciliation_pending"))
  );
}

type Runtime = {
  adapter: AsaasAdapter;
  store: AsaasOperationStore;
  webhook: ReturnType<typeof createAsaasWebhookRuntime>;
};

let cached: Runtime | null = null;
let schedulerStarted = false;

function createRuntime(): Runtime {
  const config = credentials();
  if (!config.apiKey) throw new Error("asaas_not_configured");
  if (!config.webhookToken) throw new Error("asaas_webhook_not_configured");
  const store = createDrizzleAsaasOperationStore();
  const adapter = createAsaasAdapter({
    client: createAsaasClient({
      environment: config.environment,
      apiKey: config.apiKey,
      timeoutMs: requestTimeoutMs(),
    }),
    store,
    enabledPaymentMethods: enabledMethods(),
  });
  return {
    adapter,
    store,
    webhook: createAsaasWebhookRuntime({
      webhookToken: config.webhookToken,
      adapter,
      store,
    }),
  };
}

export function getAsaasRuntime() {
  cached ??= createRuntime();
  return cached;
}

export function configureAsaasBillingRuntime() {
  configureBillingPaymentCapabilitiesProvider(() => enabledMethods());
}

export function getAsaasWebhookHandler(): (req: Request, res: Response) => Promise<void> {
  const config = credentials();
  if (!config.apiKey || !config.webhookToken) {
    return async (_req: Request, res: Response) => {
      res.status(503).json({ ok: false });
    };
  }
  return getAsaasRuntime().webhook.handle;
}

export type PrepareAsaasBillingFlowInput = {
  contractKey: string;
  payerUserId: number;
  versionCode: string;
  paymentMethod: BillingPaymentMethod;
  trialChoice: BillingTrialChoice;
  customer: BillingProviderCustomerInput;
  couponCode?: string | null;
  correlationId: string;
  transitionAccessUntil?: Date | null;
};

export async function prepareAsaasBillingFlow(
  input: PrepareAsaasBillingFlowInput
) {
  if (input.customer.payerUserId !== input.payerUserId) {
    throw new Error("billing_customer_payer_mismatch");
  }
  const runtime = getAsaasRuntime();
  const catalog = await billingCatalogService.listCatalog();
  const plan = catalog.find(item => item.versionCode === input.versionCode);
  if (!plan) throw new Error("billing_plan_not_available");
  if (!plan.effectivePaymentMethods.includes(input.paymentMethod)) {
    throw new Error("billing_payment_method_not_available");
  }
  if (plan.currency !== "BRL") throw new Error("billing_currency_not_supported");

  const coupon = input.couponCode
    ? await billingCatalogService.reserveCoupon({
        userId: input.payerUserId,
        couponCode: input.couponCode,
        versionCode: input.versionCode,
        contractKey: input.contractKey,
      })
    : null;
  if (coupon && !coupon.reserved) {
    throw new Error(`billing_coupon_${coupon.eligibility.reason}`);
  }

  const discount =
    coupon?.reserved && coupon.eligibility.eligible
      ? {
          amountMinor: coupon.eligibility.discountAmount,
          durationCharges: coupon.eligibility.durationCharges,
        }
      : null;

  const deferredTrialRegistration =
    input.paymentMethod === "credit_card" && input.trialChoice === "request";
  let subscriptionId: string | null = null;
  if (!deferredTrialRegistration) {
    const prepared = await billingSubscriptionLifecycleService.startContract({
      contractKey: input.contractKey,
      providerCode: "asaas",
      payerUserId: input.payerUserId,
      versionCode: input.versionCode,
      paymentMethod: input.paymentMethod,
      trialChoice: input.trialChoice,
      couponCode: input.couponCode,
      correlationId: input.correlationId,
      transitionAccessUntil: input.transitionAccessUntil,
    });
    if (!prepared.ok) throw new Error(`billing_contract_${prepared.reason}`);
    subscriptionId = prepared.intent.subscriptionId;
  }

  const trialDays =
    input.trialChoice === "request"
      ? plan.audience === "professional"
        ? PROFESSIONAL_TRIAL_DAYS
        : INDIVIDUAL_TRIAL_DAYS
      : 0;
  try {
    const flow = await runtime.adapter.createPaymentFlow({
      contractKey: input.contractKey,
      subscriptionId,
      payerUserId: input.payerUserId,
      versionCode: input.versionCode,
      productName: plan.name,
      billingCycle: plan.billingCycle,
      currency: "BRL",
      unitAmount: plan.unitAmount,
      paymentMethod: input.paymentMethod,
      trialChoice: input.trialChoice,
      trialDays,
      customer: input.customer,
      couponCode: input.couponCode,
      discount,
      correlationId: input.correlationId,
      transitionAccessUntil: input.transitionAccessUntil,
      ...callbacks(input.contractKey),
    });
    return { flow, subscriptionId, pendingAuthoritativeConfirmation: true };
  } catch (error) {
    if (!uncertainty(error)) {
      if (subscriptionId) {
        await billingSubscriptionLifecycleService
          .requestCancellation(
            subscriptionId,
            `${input.correlationId}:provider-failed`
          )
          .catch(() => undefined);
      } else if (input.couponCode) {
        await billingSubscriptionLifecycleRepository
          .cancelCouponReservation(input.contractKey)
          .catch(() => undefined);
      }
    }
    throw error;
  }
}

async function loadSubscriptionOperation(input: {
  subscriptionId: string;
  payerUserId: number;
}) {
  const db = await requireDb(getDb);
  const [row] = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT s.id, s.payerUserId, s.provider, s.externalSubscriptionId,
        s.currentPeriodEnd, i.contractKey, i.paymentMethod
      FROM billingSubscriptions s
      INNER JOIN billingContractIntents i ON i.subscriptionId = s.id
      WHERE s.id = ${input.subscriptionId}
        AND s.payerUserId = ${input.payerUserId}
        AND s.provider = 'asaas'
      ORDER BY i.createdAt DESC
      LIMIT 1
    `)
  );
  if (!row) throw new Error("billing_subscription_not_found");
  const contractKey = String(row.contractKey);
  const paymentMethod = String(row.paymentMethod) as BillingPaymentMethod;
  const pixOperation =
    paymentMethod === "pix_automatic"
      ? await getAsaasRuntime().store.get(
          "pix_automatic_authorization",
          `${contractKey}:pix-automatic`
        )
      : null;
  return {
    contractKey,
    paymentMethod,
    externalSubscriptionId: row.externalSubscriptionId
      ? String(row.externalSubscriptionId)
      : null,
    currentPeriodEnd: row.currentPeriodEnd
      ? new Date(String(row.currentPeriodEnd))
      : null,
    pixAuthorizationId: pixOperation?.externalId ?? null,
  };
}

export async function requestAsaasCancellation(input: {
  subscriptionId: string;
  payerUserId: number;
  correlationId: string;
}) {
  const financial = await loadSubscriptionOperation(input);
  await executeGuardedAsaasMutation({
    store: getAsaasRuntime().store,
    operationKey: `cancel:${input.subscriptionId}:${input.correlationId}`,
    subscriptionId: input.subscriptionId,
    contractKey: financial.contractKey,
    action: async () => {
      if (financial.paymentMethod === "pix_automatic") {
        if (!financial.pixAuthorizationId) {
          throw new Error("asaas_pix_authorization_not_found");
        }
        await getAsaasRuntime().adapter.cancelPixAutomaticAuthorization(
          financial.pixAuthorizationId
        );
        return financial.pixAuthorizationId;
      }
      if (!financial.externalSubscriptionId) {
        throw new Error("asaas_subscription_reference_not_found");
      }
      await getAsaasRuntime().adapter.provider.cancelSubscription(
        financial.externalSubscriptionId
      );
      return financial.externalSubscriptionId;
    },
    reconcile: async () => {
      if (financial.paymentMethod === "pix_automatic") {
        if (!financial.pixAuthorizationId) return { status: "pending" as const };
        const authorization = await getAsaasRuntime().adapter.getPixAutomaticAuthorization(
          financial.pixAuthorizationId
        );
        const status = String(authorization.status ?? "").toUpperCase();
        return ["CANCELLED", "CANCELED", "EXPIRED", "REFUSED"].includes(status)
          ? { status: "applied" as const, externalId: financial.pixAuthorizationId }
          : { status: "not_applied" as const };
      }
      if (!financial.externalSubscriptionId) return { status: "pending" as const };
      const synchronized = await getAsaasRuntime().adapter.provider.synchronizeSubscription(
        financial.externalSubscriptionId
      );
      return synchronized.status === "canceled" || synchronized.status === "expired"
        ? { status: "applied" as const, externalId: financial.externalSubscriptionId }
        : { status: "not_applied" as const };
    },
  });
  return billingSubscriptionLifecycleService.requestCancellation(
    input.subscriptionId,
    input.correlationId
  );
}

export async function reactivateAsaasCancellation(input: {
  subscriptionId: string;
  payerUserId: number;
  correlationId: string;
}) {
  const financial = await loadSubscriptionOperation(input);
  if (financial.paymentMethod === "pix_automatic") {
    throw new Error("asaas_pix_reactivation_requires_new_authorization");
  }
  if (!financial.externalSubscriptionId || !financial.currentPeriodEnd) {
    throw new Error("asaas_subscription_reactivation_context_missing");
  }
  await executeGuardedAsaasMutation({
    store: getAsaasRuntime().store,
    operationKey: `reactivate:${input.subscriptionId}:${input.correlationId}`,
    subscriptionId: input.subscriptionId,
    contractKey: financial.contractKey,
    action: async () => {
      const reactivate = getAsaasRuntime().adapter.provider.reactivateSubscription;
      if (!reactivate) throw new Error("asaas_reactivation_not_supported");
      await reactivate({
        externalSubscriptionId: financial.externalSubscriptionId!,
        nextRenewalAt: financial.currentPeriodEnd!,
      });
      return financial.externalSubscriptionId!;
    },
    reconcile: async () => {
      if (!financial.externalSubscriptionId || !financial.currentPeriodEnd) {
        return { status: "pending" as const };
      }
      const synchronized = await getAsaasRuntime().adapter.provider.synchronizeSubscription(
        financial.externalSubscriptionId
      );
      const sameRenewal =
        synchronized.currentPeriodEnd?.toISOString().slice(0, 10) ===
        financial.currentPeriodEnd.toISOString().slice(0, 10);
      return synchronized.status === "active" && !synchronized.cancelAtPeriodEnd && sameRenewal
        ? { status: "applied" as const, externalId: financial.externalSubscriptionId }
        : { status: "not_applied" as const };
    },
  });
  return billingSubscriptionLifecycleService.reactivateCancellation(
    input.subscriptionId,
    input.correlationId
  );
}

export async function updateAsaasCardPaymentMethod(input: {
  subscriptionId: string;
  payerUserId: number;
  providerPaymentMethodReference: string;
  remoteIp: string;
  correlationId: string;
}) {
  void input;
  throw new Error("asaas_update_payment_method_requires_recoverable_external_flow");
}

export async function synchronizeAsaasSubscription(input: {
  subscriptionId: string;
  payerUserId: number;
}) {
  const financial = await loadSubscriptionOperation(input);
  if (!financial.externalSubscriptionId) {
    return {
      provider: "asaas" as const,
      status: "pending" as const,
      nextRenewalAt: null,
    };
  }
  const synchronized = await getAsaasRuntime().adapter.provider.synchronizeSubscription(
    financial.externalSubscriptionId
  );
  return {
    provider: "asaas" as const,
    status: synchronized.status,
    nextRenewalAt: synchronized.currentPeriodEnd ?? null,
  };
}

export async function reconcileAsaasContract(contractKey: string) {
  const runtime = getAsaasRuntime();
  const checkout = await runtime.store.get("checkout", `${contractKey}:checkout`);
  if (!checkout) return { found: false as const };
  const subscription = await runtime.adapter.findSubscriptionByReference(contractKey);
  if (!subscription?.id) return { found: false as const };
  const correlated = await runtime.webhook.reconcileSubscriptionCreated({
    contractKey,
    externalSubscriptionId: subscription.id,
    customerReference: subscription.customer ?? checkout.customerReference,
  });
  return { found: true as const, ...correlated };
}

export async function reconcileAsaasBilling(limit = 100) {
  const runtime = getAsaasRuntime();
  const webhooks = await runtime.webhook.processDueEvents(limit);
  const scheduled = await runtime.store.listScheduledPixPayments(limit);
  let pixCreated = 0;
  let pixReconciled = 0;
  for (const operation of scheduled) {
    if (operation.state === "prepared") {
      if (!operation.dueDate || !shouldCreateScheduledPixPayment(operation.dueDate, new Date())) {
        continue;
      }
      if (!operation.authorizationReference) continue;
      const active = await runtime.store.get(
        "reconciliation",
        `pix-authorization-active:${operation.authorizationReference}`
      );
      if (active?.state !== "created") continue;
    }
    try {
      await runtime.adapter.executeScheduledPixPayment(operation);
      if (operation.state === "outcome_unknown") pixReconciled += 1;
      else pixCreated += 1;
    } catch (error) {
      console.warn("[Billing/Asaas] Pix payment execution deferred", {
        operationId: operation.id,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return { webhooks, pixCreated, pixReconciled };
}

export function startAsaasBillingReconciliationScheduler() {
  if (schedulerStarted || enabledMethods().length === 0) return;
  schedulerStarted = true;
  const intervalMs = Math.max(
    60_000,
    Number(process.env.ASAAS_RECONCILIATION_INTERVAL_MS ?? 300_000) || 300_000
  );
  const run = () => {
    void reconcileAsaasBilling().catch(error => {
      console.warn("[Billing/Asaas] reconciliation cycle failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    });
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
}
