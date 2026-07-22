import type { BillingRepository } from "../modules/billing/types";
import { createBillingAccessRepository } from "./billingAccessRepository";
import { createBillingAdminAnalyticsRepository } from "./billingAdminAnalyticsRepository";
import { createBillingAdminRepository } from "./billingAdminRepository";
import { createBillingCapacityRepository } from "./billingCapacityRepository";
import type { BillingRepositoryDeps } from "./billingRepositorySupport";

export { BillingPersistenceUnavailableError } from "./billingRepositorySupport";

export function createDrizzleBillingRepository(
  deps: BillingRepositoryDeps
): BillingRepository {
  return {
    ...createBillingAccessRepository(deps),
    ...createBillingCapacityRepository(deps),
    ...createBillingAdminRepository(deps),
    ...createBillingAdminAnalyticsRepository(deps),
  };
}
