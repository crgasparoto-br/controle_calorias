import { nanoid } from "nanoid";
import type { User } from "../../../drizzle/schema";
import {
  type BillingEvent,
  type BillingEventType,
  type SubscriptionPlan,
  type SubscriptionStatus,
  type UserSubscription,
  isActiveSubscriptionStatus,
  mapExternalBillingStatus,
} from "./billingTypes";
import { createExternalCheckoutProvider } from "./providers/externalCheckoutProvider";

const defaultPlans: SubscriptionPlan[] = [
  {
    id: "plan-core-monthly",
    code: "core_monthly",
    name: "Controle de Calorias Plus",
    description: "Acesso mensal aos recursos premium quando eles forem habilitados.",
    priceCents: 0,
    currency: "BRL",
    billingCycle: "monthly",
    provider: "external_checkout",
    providerPlanId: "configure-provider-plan-id",
    active: true,
    benefits: [
      "Base preparada para recursos premium",
      "Confirmação segura por webhook antes de liberar acesso",
      "Cancelamento registrado no backend",
    ],
  },
];

const subscriptions = new Map<number, UserSubscription>();
const billingEvents = new Map<string, BillingEvent>();

function nowIso() {
  return new Date().toISOString();
}

function getConfiguredPlans() {
  const configured = process.env.BILLING_PLANS_JSON?.trim();
  if (!configured) return defaultPlans;

  try {
    const parsed = JSON.parse(configured) as SubscriptionPlan[];
    const validPlans = parsed.filter(plan => plan.active && plan.code && plan.name && plan.currency === "BRL");
    return validPlans.length ? validPlans : defaultPlans;
  } catch {
    return defaultPlans;
  }
}

export async function listBillingPlans() {
  return getConfiguredPlans().filter(plan => plan.active);
}

export async function getUserSubscription(userId: number) {
  return subscriptions.get(userId) ?? null;
}

export async function getUserSubscriptionStatus(userId: number): Promise<SubscriptionStatus | "none"> {
  return (await getUserSubscription(userId))?.status ?? "none";
}

export async function userHasActiveSubscription(userId: number) {
  const status = await getUserSubscriptionStatus(userId);
  return status !== "none" && isActiveSubscriptionStatus(status);
}

export async function createBillingCheckout(input: {
  user: User;
  planCode: string;
  successUrl?: string;
  cancelUrl?: string;
}) {
  const plans = await listBillingPlans();
  const plan = plans.find(item => item.code === input.planCode);
  if (!plan) {
    throw new Error("BILLING_PLAN_NOT_FOUND");
  }

  const provider = createExternalCheckoutProvider();
  const checkout = await provider.createCheckout({
    userId: input.user.id,
    userEmail: input.user.email,
    userName: input.user.name,
    plan,
    successUrl: input.successUrl ?? null,
    cancelUrl: input.cancelUrl ?? null,
  });

  const existing = subscriptions.get(input.user.id);
  const timestamp = nowIso();
  const subscription: UserSubscription = {
    id: existing?.id ?? nanoid(16),
    userId: input.user.id,
    planCode: plan.code,
    provider: plan.provider,
    providerCustomerId: checkout.providerCustomerId,
    providerSubscriptionId: checkout.providerSubscriptionId,
    status: "pending",
    currentPeriodStart: existing?.currentPeriodStart ?? null,
    currentPeriodEnd: existing?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: false,
    paymentMethodLabel: checkout.paymentMethodLabel,
    checkoutUrl: checkout.checkoutUrl,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  subscriptions.set(input.user.id, subscription);
  return subscription;
}

function normalizeEventType(eventType: string, status: SubscriptionStatus): BillingEventType {
  const normalized = eventType.trim().toLowerCase();
  if (normalized === "subscription.renewed") return "subscription.renewed";
  if (normalized === "subscription.canceled") return "subscription.canceled";
  if (normalized === "subscription.expired") return "subscription.expired";
  if (status === "active") return "payment.confirmed";
  if (status === "past_due") return "payment.failed";
  if (status === "canceled") return "subscription.canceled";
  if (status === "expired") return "subscription.expired";
  return "payment.pending";
}

export async function processBillingWebhook(input: {
  providerEventId: string;
  eventType: string;
  subscriptionId?: string;
  externalStatus: string;
  payload?: unknown;
}) {
  const existingEvent = billingEvents.get(input.providerEventId);
  if (existingEvent) {
    return { event: existingEvent, duplicate: true } as const;
  }

  const status = mapExternalBillingStatus(input.externalStatus);
  const subscription = Array.from(subscriptions.values()).find(item =>
    input.subscriptionId ? item.id === input.subscriptionId || item.providerSubscriptionId === input.subscriptionId : false,
  );
  const timestamp = nowIso();

  if (subscription) {
    subscriptions.set(subscription.userId, {
      ...subscription,
      status,
      currentPeriodStart: status === "active" ? subscription.currentPeriodStart ?? timestamp : subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      updatedAt: timestamp,
    });
  }

  const event: BillingEvent = {
    id: nanoid(16),
    provider: "external_checkout",
    providerEventId: input.providerEventId,
    eventType: normalizeEventType(input.eventType, status),
    userId: subscription?.userId ?? null,
    subscriptionId: subscription?.id ?? null,
    payload: input.payload ?? null,
    processedAt: timestamp,
    createdAt: timestamp,
  };
  billingEvents.set(input.providerEventId, event);

  return { event, duplicate: false } as const;
}

export async function cancelUserSubscription(userId: number) {
  const subscription = await getUserSubscription(userId);
  if (!subscription) {
    throw new Error("BILLING_SUBSCRIPTION_NOT_FOUND");
  }

  const provider = createExternalCheckoutProvider();
  const cancellation = await provider.cancelSubscription(subscription);
  const timestamp = nowIso();
  const updated: UserSubscription = {
    ...subscription,
    status: cancellation.cancelAtPeriodEnd ? subscription.status : "canceled",
    cancelAtPeriodEnd: cancellation.cancelAtPeriodEnd,
    updatedAt: timestamp,
  };
  subscriptions.set(userId, updated);
  return updated;
}

export function resetBillingStateForTests() {
  subscriptions.clear();
  billingEvents.clear();
}
