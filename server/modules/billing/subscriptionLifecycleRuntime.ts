import { getDb, logPersistenceWarning } from "../../db";
import { createBillingSubscriptionLifecycleRepository } from "../../repositories/billingSubscriptionLifecycleRepository";
import { billingCatalogService } from "./catalogRuntime";
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

export const billingSubscriptionLifecycleService =
  createBillingSubscriptionLifecycleService({
    repository: billingSubscriptionLifecycleRepository,
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
