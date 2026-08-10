import { getDb, logPersistenceWarning } from "../../db";
import { createBillingCatalogRepository } from "../../repositories/billingCatalogRepository";
import { createBillingCatalogService } from "./catalogService";
import type { BillingCatalogCapabilitiesProvider } from "./catalogTypes";

let configuredCapabilitiesProvider: BillingCatalogCapabilitiesProvider = () => [];

export function configureBillingPaymentCapabilitiesProvider(
  provider: BillingCatalogCapabilitiesProvider
) {
  configuredCapabilitiesProvider = provider;
}

export const billingCatalogRepository = createBillingCatalogRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

export const billingCatalogService = createBillingCatalogService({
  repository: billingCatalogRepository,
  capabilitiesProvider: () => configuredCapabilitiesProvider(),
});
