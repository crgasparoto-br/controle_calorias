import { sql } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  requireDb,
  resultRows,
} from "../../../repositories/billingRepositorySupport";
import { configureBillingProviderLifecycleHooks } from "../providerLifecycleHooks";
import type { BillingConfirmEarlyConversionInput } from "../subscriptionLifecycle";
import {
  billingSubscriptionLifecycleRepository,
  billingSubscriptionLifecycleService,
} from "../subscriptionLifecycleRuntime";
import { createAsaasClient, type AsaasEnvironment } from "./client";
import {
  createAsaasCreditCardSchedule,
  type AsaasCreditCardSchedule,
} from "./creditCardSchedule";
import { createAsaasLifecycleHooks } from "./lifecycleHooks";
import { getAsaasRuntime } from "./runtime";

function environment(): AsaasEnvironment {
  return process.env.ASAAS_ENV?.trim().toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

function apiKey() {
  return (
    environment() === "production"
      ? process.env.ASAAS_PRODUCTION_API_KEY
      : process.env.ASAAS_SANDBOX_API_KEY
  )?.trim() ?? "";
}

function requestTimeoutMs() {
  const value = Number(process.env.ASAAS_REQUEST_TIMEOUT_MS ?? 60_000);
  return Number.isFinite(value) && value >= 1_000 ? value : 60_000;
}

let scheduleCache: AsaasCreditCardSchedule | null = null;

function getCreditCardSchedule() {
  if (scheduleCache) return scheduleCache;
  const key = apiKey();
  if (!key) throw new Error("asaas_not_configured");
  scheduleCache = createAsaasCreditCardSchedule({
    client: createAsaasClient({
      environment: environment(),
      apiKey: key,
      timeoutMs: requestTimeoutMs(),
    }),
    store: getAsaasRuntime().store,
  });
  return scheduleCache;
}

export function configureAsaasBillingLifecycleHooks() {
  configureBillingProviderLifecycleHooks(
    "asaas",
    createAsaasLifecycleHooks(() => ({
      store: getAsaasRuntime().store,
      creditCardSchedule: getCreditCardSchedule(),
    }))
  );
}

async function loadSubscriptionOperation(input: {
  subscriptionId: string;
  payerUserId: number;
}) {
  const db = await requireDb(getDb);
  const [row] = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT s.id, s.externalSubscriptionId, i.contractKey, i.paymentMethod
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
  return {
    contractKey: String(row.contractKey),
    paymentMethod: String(row.paymentMethod),
    externalSubscriptionId: row.externalSubscriptionId
      ? String(row.externalSubscriptionId)
      : null,
  };
}

export async function prepareAsaasProfessionalEarlyConversion(
  input: BillingConfirmEarlyConversionInput
) {
  const snapshot = await billingSubscriptionLifecycleRepository.loadLifecycle(
    input.subscriptionId
  );
  if (!snapshot) throw new Error("billing_subscription_not_found");
  if (!snapshot.firstChargeAt) {
    throw new Error("billing_professional_trial_first_charge_missing");
  }

  const financial = await loadSubscriptionOperation({
    subscriptionId: input.subscriptionId,
    payerUserId: input.actorUserId,
  });
  if (
    financial.paymentMethod !== "credit_card" ||
    !financial.externalSubscriptionId
  ) {
    throw new Error("asaas_credit_card_trial_subscription_required");
  }
  if (input.billingCycle !== "monthly" && input.billingCycle !== "yearly") {
    throw new Error("asaas_unsupported_billing_cycle");
  }

  const runtime = getAsaasRuntime();
  const checkout = await runtime.store.get(
    "checkout",
    `${financial.contractKey}:checkout`
  );
  if (
    !checkout ||
    checkout.subscriptionId !== input.subscriptionId ||
    !checkout.amountMinor ||
    !checkout.unitAmountMinor
  ) {
    throw new Error("asaas_trial_checkout_context_missing");
  }
  if (checkout.unitAmountMinor !== input.unitAmount) {
    throw new Error("asaas_early_conversion_terms_mismatch");
  }

  const confirmation = await billingSubscriptionLifecycleService.confirmEarlyConversion(
    input
  );
  const schedule = await getCreditCardSchedule().alignCreditCardSubscriptionSchedule({
    subscriptionId: input.subscriptionId,
    externalSubscriptionId: financial.externalSubscriptionId,
    contractKey: financial.contractKey,
    scopeKey: `early-conversion:${input.confirmationKey}`,
    billingCycle: input.billingCycle,
    targetDueDate: input.firstChargeAt.toISOString().slice(0, 10),
    expectedCurrentDueDate: snapshot.firstChargeAt.toISOString().slice(0, 10),
    amountMinor: checkout.amountMinor,
    paymentExternalReference: `${financial.contractKey}:early_conversion`,
    commercialConfirmationKey: input.confirmationKey,
  });
  return {
    confirmation,
    schedule,
    pendingAuthoritativeConfirmation: true as const,
  };
}
