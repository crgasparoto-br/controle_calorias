import type { User } from "../../../drizzle/schema";
import {
  createBillingSubscription,
  findBillingEvent,
  findBillingPlanByCode,
  findBillingPlanById,
  findLatestSubscriptionByUserId,
  findSubscriptionByProviderSubscriptionId,
  listActiveBillingPlans,
  recordBillingEvent,
  resetBillingRepositoryForTests,
  updateBillingSubscription,
} from "./billingRepository";
import type { BillingPlan, BillingSubscription, BillingSubscriptionStatus } from "./billingTypes";
import type { BillingWebhookInput, CancelBillingSubscriptionInput, CreateBillingCheckoutInput } from "./schemas";
import type { BillingProvider } from "./providers/billingProvider";
import { createHostedCheckoutProvider } from "./providers/hostedCheckoutProvider";
import { verifyBillingWebhookSignature } from "./webhookSecurity";

export class BillingError extends Error {
  constructor(
    readonly code:
      | "PLAN_NOT_FOUND"
      | "PLAN_INACTIVE"
      | "SUBSCRIPTION_NOT_FOUND"
      | "PREMIUM_ACCESS_REQUIRED"
      | "INVALID_WEBHOOK_SIGNATURE"
      | "WEBHOOK_SUBSCRIPTION_NOT_FOUND",
    message: string
  ) {
    super(message);
    this.name = "BillingError";
  }
}

let providerOverride: BillingProvider | null = null;

function getProvider() {
  return providerOverride ?? createHostedCheckoutProvider();
}

function getPeriodEnd(start: Date, plan: BillingPlan) {
  const end = new Date(start);
  if (plan.billingCycle === "yearly") {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

function mapExternalStatus(status: string): BillingSubscriptionStatus {
  const normalized = status.trim().toLowerCase();
  if (["active", "approved", "authorized", "accredited", "confirmed", "received", "payment_confirmed"].includes(normalized)) {
    return "active";
  }
  if (["past_due", "overdue", "failed", "rejected", "payment_failed", "charge_failed"].includes(normalized)) {
    return "past_due";
  }
  if (["canceled", "cancelled", "subscription_canceled"].includes(normalized)) {
    return "canceled";
  }
  if (["expired", "subscription_expired"].includes(normalized)) {
    return "expired";
  }
  return "pending";
}

function getPayloadJson(input: BillingWebhookInput) {
  return input.payload ?? {
    eventType: input.eventType,
    status: input.status,
    providerSubscriptionId: input.providerSubscriptionId,
    providerCustomerId: input.providerCustomerId,
    planCode: input.planCode,
    userId: input.userId,
  };
}

function refreshExpiredSubscription(subscription: BillingSubscription | null) {
  if (!subscription) return null;
  if (subscription.status !== "active" || !subscription.currentPeriodEnd) return subscription;
  if (subscription.currentPeriodEnd.getTime() > Date.now()) return subscription;
  return updateBillingSubscription(subscription.id, {
    status: subscription.cancelAtPeriodEnd ? "canceled" : "expired",
    cancelAtPeriodEnd: false,
  });
}

export function listBillingPlans() {
  return listActiveBillingPlans();
}

export function getUserSubscriptionStatus(userId: number) {
  const subscription = refreshExpiredSubscription(findLatestSubscriptionByUserId(userId));
  const plan = subscription ? findBillingPlanById(subscription.planId) : null;
  const hasActiveSubscription = subscription?.status === "active";

  return {
    status: subscription?.status ?? "none",
    hasActiveSubscription,
    subscription,
    plan,
  };
}

export function userHasActiveSubscription(userId: number) {
  return getUserSubscriptionStatus(userId).hasActiveSubscription;
}

export function requireActiveSubscription(userId: number) {
  const snapshot = getUserSubscriptionStatus(userId);
  if (!snapshot.hasActiveSubscription) {
    throw new BillingError("PREMIUM_ACCESS_REQUIRED", "Assinatura ativa necessária para acessar este recurso.");
  }
  return snapshot;
}

export async function createBillingCheckout(user: Pick<User, "id" | "email" | "name">, input: CreateBillingCheckoutInput) {
  const plan = findBillingPlanByCode(input.planCode);
  if (!plan) {
    throw new BillingError("PLAN_NOT_FOUND", "Plano não encontrado.");
  }
  if (!plan.active) {
    throw new BillingError("PLAN_INACTIVE", "Este plano não está disponível para novas assinaturas.");
  }

  const provider = getProvider();
  const checkout = await provider.createCheckout({
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    plan,
  });

  const subscription = createBillingSubscription({
    userId: user.id,
    planId: plan.id,
    provider: provider.code,
    providerSubscriptionId: checkout.providerSubscriptionId ?? checkout.providerCheckoutId,
    status: "pending",
    checkoutUrl: checkout.checkoutUrl,
  });

  return {
    checkoutUrl: checkout.checkoutUrl,
    subscription,
    plan,
  };
}

export async function cancelBillingSubscription(userId: number, input?: CancelBillingSubscriptionInput) {
  const subscription = findLatestSubscriptionByUserId(userId);
  if (!subscription || subscription.status === "canceled" || subscription.status === "expired") {
    throw new BillingError("SUBSCRIPTION_NOT_FOUND", "Nenhuma assinatura ativa ou pendente foi encontrada.");
  }

  if (subscription.providerSubscriptionId) {
    await getProvider().cancelSubscription(subscription.providerSubscriptionId);
  }

  const cancelAtPeriodEnd = input?.cancelAtPeriodEnd ?? true;
  const updated = updateBillingSubscription(subscription.id, {
    status: cancelAtPeriodEnd && subscription.status === "active" ? "active" : "canceled",
    cancelAtPeriodEnd: cancelAtPeriodEnd && subscription.status === "active",
  });

  return {
    subscription: updated,
    canceledAtPeriodEnd: Boolean(updated?.cancelAtPeriodEnd),
  };
}

export async function processBillingWebhook(input: BillingWebhookInput) {
  const payloadJson = getPayloadJson(input);
  const signatureIsValid = verifyBillingWebhookSignature(
    input.verificationPayload ?? JSON.stringify(payloadJson),
    input.signature,
    process.env.BILLING_WEBHOOK_SECRET
  );

  if (!signatureIsValid) {
    recordBillingEvent({
      provider: input.provider,
      providerEventId: `invalid:${input.providerEventId}`,
      eventType: input.eventType,
      userId: input.userId ?? null,
      subscriptionId: null,
      payloadJson,
      processingError: "invalid_signature",
    });
    throw new BillingError("INVALID_WEBHOOK_SIGNATURE", "Assinatura do webhook inválida.");
  }

  const existingEvent = findBillingEvent(input.provider, input.providerEventId);
  if (existingEvent) {
    const subscription = input.providerSubscriptionId
      ? findSubscriptionByProviderSubscriptionId(input.providerSubscriptionId)
      : input.userId
        ? findLatestSubscriptionByUserId(input.userId)
        : null;
    return {
      processed: false,
      duplicate: true,
      subscription,
    };
  }

  let subscription = input.providerSubscriptionId
    ? findSubscriptionByProviderSubscriptionId(input.providerSubscriptionId)
    : input.userId
      ? findLatestSubscriptionByUserId(input.userId)
      : null;
  const plan = input.planCode ? findBillingPlanByCode(input.planCode) : subscription ? findBillingPlanById(subscription.planId) : null;

  if (!subscription && input.userId && plan) {
    subscription = createBillingSubscription({
      userId: input.userId,
      planId: plan.id,
      provider: input.provider,
      providerCustomerId: input.providerCustomerId ?? null,
      providerSubscriptionId: input.providerSubscriptionId ?? null,
      status: "pending",
    });
  }

  if (!subscription || !plan) {
    throw new BillingError("WEBHOOK_SUBSCRIPTION_NOT_FOUND", "Webhook sem assinatura local relacionada.");
  }

  const status = mapExternalStatus(input.status);
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const periodEnd = status === "active" ? getPeriodEnd(occurredAt, plan) : subscription.currentPeriodEnd;

  const updated = updateBillingSubscription(subscription.id, {
    status,
    providerCustomerId: input.providerCustomerId ?? subscription.providerCustomerId,
    providerSubscriptionId: input.providerSubscriptionId ?? subscription.providerSubscriptionId,
    paymentMethodLabel: input.paymentMethodLabel ?? subscription.paymentMethodLabel,
    currentPeriodStart: status === "active" ? occurredAt : subscription.currentPeriodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: status === "canceled" || status === "expired" ? false : subscription.cancelAtPeriodEnd,
  });

  recordBillingEvent({
    provider: input.provider,
    providerEventId: input.providerEventId,
    eventType: input.eventType,
    userId: updated?.userId ?? subscription.userId,
    subscriptionId: updated?.id ?? subscription.id,
    payloadJson,
    processedAt: new Date(),
  });

  return {
    processed: true,
    duplicate: false,
    subscription: updated,
  };
}

export function setBillingProviderForTests(provider: BillingProvider | null) {
  providerOverride = provider;
}

export function resetBillingStateForTests() {
  providerOverride = null;
  resetBillingRepositoryForTests();
}

export const billingStatusMappingForTests = {
  mapExternalStatus,
};
