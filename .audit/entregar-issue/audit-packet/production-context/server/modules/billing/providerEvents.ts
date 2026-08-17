const ALLOWED_METADATA_KEYS = [
  "objectId",
  "operationReference",
  "status",
  "reason",
  "currency",
  "amountMinor",
  "unitAmountMinor",
  "discountDurationCharges",
  "payerUserId",
  "planCode",
  "paymentMethod",
  "trialChoice",
  "couponCode",
  "billingCycle",
  "correlationId",
  "contractReference",
  "subscriptionReference",
  "customerReference",
  "authorizationReference",
  "publicReference",
  "dueDate",
  "chargePurpose",
  "transitionAccessUntil",
  "providerCreatedAt",
] as const;

type AllowedMetadataKey = (typeof ALLOWED_METADATA_KEYS)[number];
export type BillingProviderEventMetadata = Partial<
  Record<AllowedMetadataKey, string | number | boolean | null>
>;

const MAX_STRING_LENGTH = 500;

function normalizeMetadataValue(value: unknown) {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    return value.trim().slice(0, MAX_STRING_LENGTH);
  }
  return undefined;
}

/**
 * Billing never persists the provider's raw webhook payload. Providers must map
 * only normalized, non-sensitive metadata required for replay and diagnostics.
 */
export function sanitizeBillingProviderEventMetadata(
  input: Record<string, unknown> | null | undefined
): BillingProviderEventMetadata | null {
  if (!input) return null;
  const sanitized: BillingProviderEventMetadata = {};
  for (const key of ALLOWED_METADATA_KEYS) {
    const value = normalizeMetadataValue(input[key]);
    if (value !== undefined) sanitized[key] = value;
  }
  return Object.keys(sanitized).length ? sanitized : null;
}
