import type { BillingEvent, BillingPlan, BillingProviderCode, BillingSubscription, BillingSubscriptionStatus } from "./billingTypes";

function priceFromEnv(envName: string, fallback: number) {
  const value = Number(process.env[envName]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function providerPlanIdFromEnv(envName: string) {
  const value = process.env[envName]?.trim();
  return value ? value : null;
}

function now() {
  return new Date();
}

const defaultProvider = (): BillingProviderCode => {
  const provider = process.env.BILLING_PROVIDER;
  if (provider === "mercadopago" || provider === "asaas" || provider === "sandbox") return provider;
  return "sandbox";
};

const plans = new Map<number, BillingPlan>();
const subscriptions = new Map<number, BillingSubscription>();
const events = new Map<string, BillingEvent>();
let nextSubscriptionId = 1;
let nextEventId = 1;

function billingEventKey(provider: BillingProviderCode, providerEventId: string) {
  return `${provider}:${providerEventId}`;
}

function seedDefaultPlans() {
  plans.clear();
  const createdAt = now();
  const provider = defaultProvider();
  const defaults: BillingPlan[] = [
    {
      id: 1,
      code: "pro_mensal",
      name: "Plano Pro Mensal",
      description: "Acesso premium com cobrança mensal pelo checkout hospedado.",
      priceCents: priceFromEnv("BILLING_PLAN_PRO_MONTHLY_CENTS", 2990),
      currency: "BRL",
      billingCycle: "monthly",
      provider,
      providerPlanId: providerPlanIdFromEnv("BILLING_PROVIDER_PLAN_PRO_MONTHLY_ID"),
      active: true,
      benefits: [
        "Recursos premium liberados após confirmação do pagamento",
        "Renovação mensal controlada por webhook",
        "Cancelamento preparado para respeitar o período pago",
      ],
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: 2,
      code: "pro_anual",
      name: "Plano Pro Anual",
      description: "Acesso premium anual com confirmação segura no backend.",
      priceCents: priceFromEnv("BILLING_PLAN_PRO_YEARLY_CENTS", 29900),
      currency: "BRL",
      billingCycle: "yearly",
      provider,
      providerPlanId: providerPlanIdFromEnv("BILLING_PROVIDER_PLAN_PRO_YEARLY_ID"),
      active: true,
      benefits: [
        "Recursos premium por 12 meses após confirmação",
        "Menos renovações durante o ano",
        "Eventos de cobrança registrados para auditoria",
      ],
      createdAt,
      updatedAt: createdAt,
    },
  ];

  for (const plan of defaults) {
    plans.set(plan.id, plan);
  }
}

seedDefaultPlans();

export function listActiveBillingPlans() {
  return [...plans.values()].filter(plan => plan.active);
}

export function findBillingPlanByCode(code: string) {
  return [...plans.values()].find(plan => plan.code === code) ?? null;
}

export function findBillingPlanById(id: number) {
  return plans.get(id) ?? null;
}

export function findLatestSubscriptionByUserId(userId: number) {
  return [...subscriptions.values()]
    .filter(subscription => subscription.userId === userId)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] ?? null;
}

export function findSubscriptionByProviderSubscriptionId(providerSubscriptionId: string) {
  return [...subscriptions.values()].find(subscription => subscription.providerSubscriptionId === providerSubscriptionId) ?? null;
}

export function createBillingSubscription(input: {
  userId: number;
  planId: number;
  provider: BillingProviderCode;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  status: BillingSubscriptionStatus;
  checkoutUrl?: string | null;
}) {
  const createdAt = now();
  const subscription: BillingSubscription = {
    id: nextSubscriptionId++,
    userId: input.userId,
    planId: input.planId,
    provider: input.provider,
    providerCustomerId: input.providerCustomerId ?? null,
    providerSubscriptionId: input.providerSubscriptionId ?? null,
    status: input.status,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    paymentMethodLabel: null,
    checkoutUrl: input.checkoutUrl ?? null,
    createdAt,
    updatedAt: createdAt,
  };
  subscriptions.set(subscription.id, subscription);
  return subscription;
}

export function updateBillingSubscription(id: number, patch: Partial<Omit<BillingSubscription, "id" | "createdAt">>) {
  const subscription = subscriptions.get(id);
  if (!subscription) return null;
  const updated: BillingSubscription = {
    ...subscription,
    ...patch,
    updatedAt: now(),
  };
  subscriptions.set(id, updated);
  return updated;
}

export function findBillingEvent(provider: BillingProviderCode, providerEventId: string) {
  return events.get(billingEventKey(provider, providerEventId)) ?? null;
}

export function recordBillingEvent(input: {
  provider: BillingProviderCode;
  providerEventId: string;
  eventType: string;
  userId?: number | null;
  subscriptionId?: number | null;
  payloadJson: Record<string, unknown>;
  processingError?: string | null;
  processedAt?: Date | null;
}) {
  const key = billingEventKey(input.provider, input.providerEventId);
  const existing = events.get(key);
  if (existing) {
    return { event: existing, duplicate: true } as const;
  }

  const createdAt = now();
  const event: BillingEvent = {
    id: nextEventId++,
    provider: input.provider,
    providerEventId: input.providerEventId,
    eventType: input.eventType,
    userId: input.userId ?? null,
    subscriptionId: input.subscriptionId ?? null,
    payloadJson: input.payloadJson,
    processingError: input.processingError ?? null,
    processedAt: input.processedAt ?? null,
    createdAt,
  };
  events.set(key, event);
  return { event, duplicate: false } as const;
}

export function resetBillingRepositoryForTests() {
  seedDefaultPlans();
  subscriptions.clear();
  events.clear();
  nextSubscriptionId = 1;
  nextEventId = 1;
}

export function listBillingEventsForTests() {
  return [...events.values()];
}
