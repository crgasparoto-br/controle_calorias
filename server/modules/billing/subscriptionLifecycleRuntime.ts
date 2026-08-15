import { getDb, logPersistenceWarning } from "../../db";
import { createBillingSubscriptionLifecycleRepository } from "../../repositories/billingSubscriptionLifecycleRepository";
import { createBillingLifecycleRemediationReadModel } from "../../repositories/billingLifecycleRemediationReadModel";
import { billingCatalogService } from "./catalogRuntime";
import { professionalCoverageService } from "./professionalCoverageService";
import {
  enrichBillingProviderFinancialFact,
  runBillingProviderAfterStartContract,
} from "./providerLifecycleHooks";
import type { BillingProviderNeutralFinancialFact } from "./subscriptionLifecycleTypes";
import {
  createBillingSubscriptionLifecycleService,
  createTrialIdentityHasher,
} from "./subscriptionLifecycle";

let cachedTrialIdentitySecret: string | null = null;
let cachedTrialIdentityHasher: ((type: string, value: string) => string) | null = null;

function hashTrialIdentity(type: string, value: string) {
  const secret = process.env.BILLING_TRIAL_IDENTITY_SECRET?.trim() ?? "";
  if (!secret) {
    throw new Error(
      "BILLING_TRIAL_IDENTITY_SECRET is required before granting subscription trials."
    );
  }
  if (!cachedTrialIdentityHasher || cachedTrialIdentitySecret !== secret) {
    cachedTrialIdentitySecret = secret;
    cachedTrialIdentityHasher = createTrialIdentityHasher(secret);
  }
  return cachedTrialIdentityHasher(type, value);
}

export const billingSubscriptionLifecycleRepository =
  createBillingSubscriptionLifecycleRepository({
    getDb,
    onWarning: logPersistenceWarning,
  });

export const billingSubscriptionLifecycleRemediationReadModel =
  createBillingLifecycleRemediationReadModel({
    getDb,
    onWarning: logPersistenceWarning,
  });

const baseBillingSubscriptionLifecycleService =
  createBillingSubscriptionLifecycleService({
    repository: billingSubscriptionLifecycleRepository,
    remediationReadModel: billingSubscriptionLifecycleRemediationReadModel,
    hashTrialIdentity,
    couponCoordinator: {
      async reserve(input) {
        const result = await billingCatalogService.reserveCoupon(input);
        return result.reserved
          ? { reserved: true as const }
          : { reserved: false as const, reason: result.eligibility.reason };
      },
    },
  });

async function applyProfessionalCoverageFacts() {
  await professionalCoverageService.processLifecycleFacts(100);
}

export const billingSubscriptionLifecycleService = {
  ...baseBillingSubscriptionLifecycleService,
  async startContract(
    input: Parameters<typeof baseBillingSubscriptionLifecycleService.startContract>[0]
  ) {
    const result = await baseBillingSubscriptionLifecycleService.startContract(input);
    await runBillingProviderAfterStartContract(input, result);
    return result;
  },
  async applyFinancialFact(input: BillingProviderNeutralFinancialFact) {
    const result = await baseBillingSubscriptionLifecycleService.applyFinancialFact(
      await enrichBillingProviderFinancialFact(input)
    );
    await applyProfessionalCoverageFacts();
    return result;
  },
  async tickSubscription(
    subscriptionId: string,
    now?: Date
  ) {
    const result = await baseBillingSubscriptionLifecycleService.tickSubscription(
      subscriptionId,
      now
    );
    await applyProfessionalCoverageFacts();
    return result;
  },
  async processDue(limit = 100) {
    const result = await baseBillingSubscriptionLifecycleService.processDue(limit);
    await professionalCoverageService.processLifecycleFacts(limit);
    return result;
  },
};
