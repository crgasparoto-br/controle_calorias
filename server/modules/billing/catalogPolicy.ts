import { PROFESSIONAL_ENTITLEMENT_RESOURCES } from "../../../shared/professionalEntitlements";

export const BILLING_PERSONAL_ENTITLEMENTS = [
  "system_access",
  "web_access",
  "whatsapp_access",
  "meal_text",
  "meal_image",
  "meal_audio",
  "ai_assistance",
  "nutrition_goals",
  "reports",
  "weight_tracking",
  "water_tracking",
  "exercise_tracking",
  "health_integrations",
] as const;

export const BILLING_PAYMENT_METHODS = ["credit_card", "pix_automatic"] as const;
export const BILLING_CYCLES = ["monthly", "yearly"] as const;
export const BILLING_AUDIENCES = ["individual", "professional"] as const;

export type BillingPersonalEntitlement =
  (typeof BILLING_PERSONAL_ENTITLEMENTS)[number];
export type BillingPaymentMethod = (typeof BILLING_PAYMENT_METHODS)[number];
export type BillingCycle = (typeof BILLING_CYCLES)[number];
export type BillingAudience = (typeof BILLING_AUDIENCES)[number];
export type BillingCatalogVersionStatus = "draft" | "active" | "inactive";
export type BillingCouponDiscountType = "percentage" | "fixed_amount";
export type BillingCatalogMutationProvenance =
  | {
      origin: "admin_manual";
    }
  | {
      origin: "catalog_range_review";
      alertIds: readonly string[];
      analysisRef: string;
    };

const CANONICAL_ENTITLEMENTS = new Set<string>([
  ...BILLING_PERSONAL_ENTITLEMENTS,
  ...PROFESSIONAL_ENTITLEMENT_RESOURCES,
]);
const CANONICAL_PAYMENT_METHODS = new Set<string>(BILLING_PAYMENT_METHODS);

export const BILLING_PROFESSIONAL_ENTITLEMENTS = [
  ...BILLING_PERSONAL_ENTITLEMENTS,
  ...PROFESSIONAL_ENTITLEMENT_RESOURCES,
] as const;

export type BillingCatalogVersionDefinition = {
  productCode: string;
  versionCode: string;
  version: number;
  audience: BillingAudience;
  name: string;
  billingCycle: BillingCycle;
  currency: "BRL";
  unitAmount: number;
  capacityLimit: number | null;
  entitlements: readonly string[];
  coveredBeneficiaryEntitlements: readonly string[];
  commercialPaymentMethods: readonly BillingPaymentMethod[];
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  status: BillingCatalogVersionStatus;
  sortOrder: number;
};

export type BillingCouponPolicy = {
  code: string;
  discountType: BillingCouponDiscountType;
  discountValue: number;
  currency: string | null;
  eligibleProductCodes: readonly string[];
  eligibleVersionCodes: readonly string[];
  eligibleCycles: readonly BillingCycle[];
  validFrom: Date;
  validUntil: Date | null;
  maxTotalUses: number | null;
  maxUsesPerUser: number | null;
  firstContractOnly: boolean;
  durationCharges: number;
  active: boolean;
};

export type BillingCouponEligibilityContext = {
  now: Date;
  productCode: string;
  versionCode: string;
  billingCycle: BillingCycle;
  unitAmount: number;
  currency: string;
  totalConfirmedUses: number;
  userConfirmedUses: number;
  userHasPriorPaidContract: boolean;
};

export type BillingCouponEligibilityResult =
  | {
      eligible: true;
      discountAmount: number;
      finalAmount: number;
      durationCharges: number;
    }
  | {
      eligible: false;
      reason:
        | "inactive"
        | "outside_validity"
        | "product_not_eligible"
        | "version_not_eligible"
        | "cycle_not_eligible"
        | "total_limit_reached"
        | "user_limit_reached"
        | "first_contract_required"
        | "currency_mismatch"
        | "invalid_discount";
    };

function uniqueStrings(values: readonly string[]) {
  return Array.from(new Set(values));
}

export function normalizeCatalogEntitlements(values: readonly string[]) {
  const normalized = uniqueStrings(values.map(value => value.trim()).filter(Boolean));
  const unknown = normalized.filter(value => !CANONICAL_ENTITLEMENTS.has(value));
  if (unknown.length) {
    throw new Error(`Unknown billing entitlement: ${unknown.sort().join(", ")}`);
  }
  return normalized.sort();
}

export function normalizeCommercialPaymentMethods(values: readonly string[]) {
  const normalized = uniqueStrings(values.map(value => value.trim()).filter(Boolean));
  const unknown = normalized.filter(value => !CANONICAL_PAYMENT_METHODS.has(value));
  if (unknown.length) {
    throw new Error(`Unknown billing payment method: ${unknown.sort().join(", ")}`);
  }
  return normalized.sort() as BillingPaymentMethod[];
}

export function intersectPaymentMethods(
  commercialMethods: readonly string[],
  providerCapabilities: readonly string[]
): BillingPaymentMethod[] {
  const commercial = new Set(normalizeCommercialPaymentMethods(commercialMethods));
  const provider = new Set(providerCapabilities);
  return BILLING_PAYMENT_METHODS.filter(
    method => commercial.has(method) && provider.has(method)
  );
}

export function assertCatalogVersionCanActivate(
  version: BillingCatalogVersionDefinition
) {
  if (!version.productCode.trim() || !version.versionCode.trim()) {
    throw new Error("Product and version codes are required.");
  }
  if (!Number.isInteger(version.version) || version.version < 1) {
    throw new Error("Catalog version must be a positive integer.");
  }
  if (!Number.isInteger(version.unitAmount) || version.unitAmount <= 0) {
    throw new Error("Catalog price must use a positive integer minor-unit amount.");
  }
  if (version.currency !== "BRL") {
    throw new Error("The initial billing catalog supports BRL only.");
  }
  if (
    version.effectiveUntil &&
    version.effectiveUntil.getTime() <= version.effectiveFrom.getTime()
  ) {
    throw new Error("Catalog validity end must be after its start.");
  }
  if (version.audience === "individual" && version.capacityLimit !== null) {
    throw new Error("Individual products cannot consume professional capacity.");
  }
  if (
    version.audience === "professional" &&
    (!Number.isInteger(version.capacityLimit) || (version.capacityLimit ?? 0) <= 0)
  ) {
    throw new Error("Professional products require a positive capacity.");
  }

  const entitlements = normalizeCatalogEntitlements(version.entitlements);
  const coveredBeneficiaryEntitlements = normalizeCatalogEntitlements(
    version.coveredBeneficiaryEntitlements
  );
  const paymentMethods = normalizeCommercialPaymentMethods(
    version.commercialPaymentMethods
  );

  if (!paymentMethods.length) {
    throw new Error("Active catalog versions require at least one payment method.");
  }
  const expectedEntitlements =
    version.audience === "professional"
      ? [...BILLING_PROFESSIONAL_ENTITLEMENTS].sort()
      : [...BILLING_PERSONAL_ENTITLEMENTS].sort();
  if (
    entitlements.length !== expectedEntitlements.length ||
    entitlements.some((value, index) => value !== expectedEntitlements[index])
  ) {
    throw new Error(
      version.audience === "professional"
        ? "Professional catalog versions must use the canonical combined entitlement matrix."
        : "Individual catalog versions must use the canonical personal entitlement matrix."
    );
  }
  const expectedCoveredBeneficiaryEntitlements =
    version.audience === "professional"
      ? [...BILLING_PERSONAL_ENTITLEMENTS].sort()
      : [];
  if (
    coveredBeneficiaryEntitlements.length !==
      expectedCoveredBeneficiaryEntitlements.length ||
    coveredBeneficiaryEntitlements.some(
      (value, index) =>
        value !== expectedCoveredBeneficiaryEntitlements[index]
    )
  ) {
    throw new Error(
      version.audience === "professional"
        ? "Professional catalog versions must persist the canonical covered-patient entitlement matrix."
        : "Individual catalog versions cannot define covered-patient entitlements."
    );
  }
}

export function isCatalogVersionEffective(
  version: Pick<
    BillingCatalogVersionDefinition,
    "status" | "effectiveFrom" | "effectiveUntil"
  >,
  now: Date
) {
  return (
    version.status === "active" &&
    version.effectiveFrom.getTime() <= now.getTime() &&
    (!version.effectiveUntil || version.effectiveUntil.getTime() > now.getTime())
  );
}

export function normalizeCatalogMutationProvenance(
  provenance: BillingCatalogMutationProvenance
): BillingCatalogMutationProvenance {
  if (provenance.origin === "admin_manual") {
    return { origin: "admin_manual" };
  }

  const alertIds = uniqueStrings(
    provenance.alertIds.map(value => value.trim()).filter(Boolean)
  );
  const analysisRef = provenance.analysisRef.trim();
  if (!alertIds.length || !analysisRef) {
    throw new Error(
      "Catalog range review requires alert references and a demand analysis reference."
    );
  }
  return {
    origin: "catalog_range_review",
    alertIds,
    analysisRef,
  };
}

export function assertAdministrativeCatalogMutation(input: {
  actorRole: string;
  provenance: BillingCatalogMutationProvenance;
}) {
  if (input.actorRole !== "admin") {
    throw new Error("Catalog publication requires an explicit administrator action.");
  }
  return normalizeCatalogMutationProvenance(input.provenance);
}

export function validateCouponPolicy(policy: BillingCouponPolicy) {
  const normalizedCode = policy.code.trim().toUpperCase();
  if (!normalizedCode) throw new Error("Coupon code is required.");
  if (!/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/.test(normalizedCode)) {
    throw new Error("Coupon code contains unsupported characters.");
  }
  const eligibleProductCodes = uniqueStrings(
    policy.eligibleProductCodes
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
  const eligibleVersionCodes = uniqueStrings(
    policy.eligibleVersionCodes
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
  const normalizedCycles = uniqueStrings(policy.eligibleCycles);
  const unknownCycle = normalizedCycles.find(
    value => !BILLING_CYCLES.includes(value as BillingCycle)
  );
  if (unknownCycle) {
    throw new Error(`Unknown billing coupon cycle: ${unknownCycle}`);
  }
  const eligibleCycles = normalizedCycles as BillingCycle[];
  if (!eligibleCycles.length) {
    throw new Error("Coupon policy requires at least one eligible billing cycle.");
  }
  if (!eligibleProductCodes.length && !eligibleVersionCodes.length) {
    throw new Error("Coupon policy must target at least one product or version.");
  }
  if (!Number.isInteger(policy.discountValue) || policy.discountValue <= 0) {
    throw new Error("Coupon discount must be a positive integer.");
  }
  if (policy.discountType === "percentage" && policy.discountValue > 30) {
    throw new Error("Public percentage coupons cannot exceed 30%.");
  }
  if (policy.discountType === "fixed_amount") {
    if (!policy.currency || policy.currency.trim().toUpperCase() !== "BRL") {
      throw new Error("Fixed-amount coupons require BRL currency.");
    }
  } else if (policy.currency) {
    throw new Error("Percentage coupons cannot define currency.");
  }
  if (
    policy.validUntil &&
    policy.validUntil.getTime() <= policy.validFrom.getTime()
  ) {
    throw new Error("Coupon validity end must be after its start.");
  }
  for (const value of [policy.maxTotalUses, policy.maxUsesPerUser]) {
    if (value !== null && (!Number.isInteger(value) || value <= 0)) {
      throw new Error("Coupon usage limits must be positive integers.");
    }
  }
  if (!Number.isInteger(policy.durationCharges) || policy.durationCharges <= 0) {
    throw new Error("Coupon duration must be a positive number of charges.");
  }
  const currency =
    policy.discountType === "fixed_amount"
      ? policy.currency!.trim().toUpperCase()
      : null;
  if (
    policy.eligibleCycles.includes("monthly") &&
    policy.durationCharges > 3
  ) {
    throw new Error("Monthly coupons can discount at most three charges.");
  }
  if (
    policy.eligibleCycles.includes("yearly") &&
    policy.durationCharges > 1
  ) {
    throw new Error("Yearly coupons can discount only the first charge.");
  }
  return {
    ...policy,
    code: normalizedCode,
    currency,
    eligibleProductCodes,
    eligibleVersionCodes,
    eligibleCycles,
  };
}

export function evaluateCouponEligibility(
  policy: BillingCouponPolicy,
  context: BillingCouponEligibilityContext
): BillingCouponEligibilityResult {
  const validated = validateCouponPolicy(policy);
  if (!validated.active) return { eligible: false, reason: "inactive" };
  if (
    context.now.getTime() < validated.validFrom.getTime() ||
    (validated.validUntil &&
      context.now.getTime() >= validated.validUntil.getTime())
  ) {
    return { eligible: false, reason: "outside_validity" };
  }
  if (
    validated.eligibleProductCodes.length &&
    !validated.eligibleProductCodes.includes(context.productCode)
  ) {
    return { eligible: false, reason: "product_not_eligible" };
  }
  if (
    validated.eligibleVersionCodes.length &&
    !validated.eligibleVersionCodes.includes(context.versionCode)
  ) {
    return { eligible: false, reason: "version_not_eligible" };
  }
  if (!validated.eligibleCycles.includes(context.billingCycle)) {
    return { eligible: false, reason: "cycle_not_eligible" };
  }
  if (
    validated.maxTotalUses !== null &&
    context.totalConfirmedUses >= validated.maxTotalUses
  ) {
    return { eligible: false, reason: "total_limit_reached" };
  }
  if (
    validated.maxUsesPerUser !== null &&
    context.userConfirmedUses >= validated.maxUsesPerUser
  ) {
    return { eligible: false, reason: "user_limit_reached" };
  }
  if (validated.firstContractOnly && context.userHasPriorPaidContract) {
    return { eligible: false, reason: "first_contract_required" };
  }
  if (
    validated.discountType === "fixed_amount" &&
    validated.currency !== context.currency.trim().toUpperCase()
  ) {
    return { eligible: false, reason: "currency_mismatch" };
  }

  const discountAmount =
    validated.discountType === "percentage"
      ? Math.floor((context.unitAmount * validated.discountValue) / 100)
      : validated.discountValue;
  if (
    discountAmount <= 0 ||
    discountAmount >= context.unitAmount ||
    discountAmount * 100 > context.unitAmount * 30
  ) {
    return { eligible: false, reason: "invalid_discount" };
  }

  return {
    eligible: true,
    discountAmount,
    finalAmount: context.unitAmount - discountAmount,
    durationCharges: validated.durationCharges,
  };
}

const INITIAL_CATALOG_EFFECTIVE_FROM = new Date("2026-08-08T00:00:00.000Z");

export const INITIAL_BILLING_CATALOG: readonly BillingCatalogVersionDefinition[] = [
  {
    productCode: "individual",
    versionCode: "individual-monthly-v1",
    version: 1,
    audience: "individual",
    name: "Individual",
    billingCycle: "monthly",
    currency: "BRL",
    unitAmount: 3990,
    capacityLimit: null,
    entitlements: BILLING_PERSONAL_ENTITLEMENTS,
    coveredBeneficiaryEntitlements: [],
    commercialPaymentMethods: BILLING_PAYMENT_METHODS,
    effectiveFrom: INITIAL_CATALOG_EFFECTIVE_FROM,
    effectiveUntil: null,
    status: "active",
    sortOrder: 10,
  },
  {
    productCode: "individual",
    versionCode: "individual-yearly-v1",
    version: 1,
    audience: "individual",
    name: "Individual",
    billingCycle: "yearly",
    currency: "BRL",
    unitAmount: 35900,
    capacityLimit: null,
    entitlements: BILLING_PERSONAL_ENTITLEMENTS,
    coveredBeneficiaryEntitlements: [],
    commercialPaymentMethods: BILLING_PAYMENT_METHODS,
    effectiveFrom: INITIAL_CATALOG_EFFECTIVE_FROM,
    effectiveUntil: null,
    status: "active",
    sortOrder: 11,
  },
  {
    productCode: "professional",
    versionCode: "professional-monthly-v1",
    version: 1,
    audience: "professional",
    name: "Profissional",
    billingCycle: "monthly",
    currency: "BRL",
    unitAmount: 8990,
    capacityLimit: 30,
    entitlements: BILLING_PROFESSIONAL_ENTITLEMENTS,
    coveredBeneficiaryEntitlements: BILLING_PERSONAL_ENTITLEMENTS,
    commercialPaymentMethods: BILLING_PAYMENT_METHODS,
    effectiveFrom: INITIAL_CATALOG_EFFECTIVE_FROM,
    effectiveUntil: null,
    status: "active",
    sortOrder: 20,
  },
  {
    productCode: "professional",
    versionCode: "professional-yearly-v1",
    version: 1,
    audience: "professional",
    name: "Profissional",
    billingCycle: "yearly",
    currency: "BRL",
    unitAmount: 89900,
    capacityLimit: 30,
    entitlements: BILLING_PROFESSIONAL_ENTITLEMENTS,
    coveredBeneficiaryEntitlements: BILLING_PERSONAL_ENTITLEMENTS,
    commercialPaymentMethods: BILLING_PAYMENT_METHODS,
    effectiveFrom: INITIAL_CATALOG_EFFECTIVE_FROM,
    effectiveUntil: null,
    status: "active",
    sortOrder: 21,
  },
  {
    productCode: "professional-plus",
    versionCode: "professional-plus-monthly-v1",
    version: 1,
    audience: "professional",
    name: "Profissional Plus",
    billingCycle: "monthly",
    currency: "BRL",
    unitAmount: 13990,
    capacityLimit: 100,
    entitlements: BILLING_PROFESSIONAL_ENTITLEMENTS,
    coveredBeneficiaryEntitlements: BILLING_PERSONAL_ENTITLEMENTS,
    commercialPaymentMethods: BILLING_PAYMENT_METHODS,
    effectiveFrom: INITIAL_CATALOG_EFFECTIVE_FROM,
    effectiveUntil: null,
    status: "active",
    sortOrder: 30,
  },
  {
    productCode: "professional-plus",
    versionCode: "professional-plus-yearly-v1",
    version: 1,
    audience: "professional",
    name: "Profissional Plus",
    billingCycle: "yearly",
    currency: "BRL",
    unitAmount: 139900,
    capacityLimit: 100,
    entitlements: BILLING_PROFESSIONAL_ENTITLEMENTS,
    coveredBeneficiaryEntitlements: BILLING_PERSONAL_ENTITLEMENTS,
    commercialPaymentMethods: BILLING_PAYMENT_METHODS,
    effectiveFrom: INITIAL_CATALOG_EFFECTIVE_FROM,
    effectiveUntil: null,
    status: "active",
    sortOrder: 31,
  },
] as const;

for (const version of INITIAL_BILLING_CATALOG) {
  assertCatalogVersionCanActivate(version);
}
