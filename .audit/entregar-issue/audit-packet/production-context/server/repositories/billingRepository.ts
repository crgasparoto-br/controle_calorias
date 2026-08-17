import type { BillingRepository } from "../modules/billing/types";
import { createBillingAccessRepository } from "./billingAccessRepository";
import { createBillingAdminAnalyticsRepository } from "./billingAdminAnalyticsRepository";
import { createBillingAdminRepository } from "./billingAdminRepository";
import { createBillingCapacityRepository } from "./billingCapacityRepository";
import { createBillingLifecycleAccessRepository } from "./billingLifecycleAccessRepository";
import { createBillingLifecycleCapacityRepository } from "./billingLifecycleCapacityRepository";
import {
  configureBillingDbProvider,
  type BillingRepositoryDeps,
} from "./billingRepositorySupport";

export { BillingPersistenceUnavailableError } from "./billingRepositorySupport";

export function createDrizzleBillingRepository(
  deps: BillingRepositoryDeps
): BillingRepository {
  configureBillingDbProvider(deps.getDb);
  const accessRepository = createBillingAccessRepository(deps);
  const capacityRepository = createBillingCapacityRepository(deps);
  return {
    ...accessRepository,
    ...capacityRepository,
    ...createBillingAdminRepository(deps),
    ...createBillingAdminAnalyticsRepository(deps),
    ...createBillingLifecycleAccessRepository(deps, accessRepository),
    ...createBillingLifecycleCapacityRepository(deps, capacityRepository),
  };
}
