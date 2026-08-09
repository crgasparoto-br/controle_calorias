import {
  INITIAL_BILLING_CATALOG,
  assertAdministrativeCatalogMutation,
  evaluateCouponEligibility,
  intersectPaymentMethods,
  isCatalogVersionEffective,
  type BillingCouponPolicy,
} from "./catalogPolicy";
import type {
  BillingCatalogCapabilitiesProvider,
  BillingCatalogRepository,
  CreateBillingCatalogProductInput,
  CreateBillingCatalogVersionInput,
  CreateBillingCouponRevisionInput,
  DeactivateBillingCatalogVersionInput,
  DeactivateBillingCouponInput,
  PublishBillingCatalogVersionInput,
  ReserveBillingCouponInput,
} from "./catalogTypes";

export function createBillingCatalogService(deps: {
  repository: BillingCatalogRepository;
  capabilitiesProvider?: BillingCatalogCapabilitiesProvider;
  now?: () => Date;
}) {
  const nowProvider = deps.now ?? (() => new Date());
  const capabilitiesProvider = deps.capabilitiesProvider ?? (() => []);

  async function listCatalog() {
    const [versions, providerCapabilities] = await Promise.all([
      deps.repository.listEffectiveVersions(nowProvider()),
      Promise.resolve(capabilitiesProvider()),
    ]);
    return versions.map(version => ({
      productCode: version.productCode,
      versionCode: version.versionCode,
      version: version.version,
      audience: version.audience,
      name: version.name,
      description: version.description,
      billingCycle: version.billingCycle,
      currency: version.currency,
      unitAmount: version.unitAmount,
      capacityLimit: version.capacityLimit,
      entitlements: version.entitlements,
      coveredBeneficiaryEntitlements: version.coveredBeneficiaryEntitlements,
      commercialPaymentMethods: version.commercialPaymentMethods,
      effectivePaymentMethods: intersectPaymentMethods(
        version.commercialPaymentMethods,
        providerCapabilities
      ),
      effectiveFrom: version.effectiveFrom,
      effectiveUntil: version.effectiveUntil,
      sortOrder: version.sortOrder,
    }));
  }

  async function previewCouponEligibility(
    userId: number,
    input: { code: string; versionCode: string }
  ) {
    const now = nowProvider();
    const [coupon, version] = await Promise.all([
      deps.repository.getActiveCouponByCode(input.code),
      deps.repository.getVersionByCode(input.versionCode),
    ]);
    if (!coupon) return { eligible: false as const, reason: "inactive" as const };
    if (
      !version ||
      version.productState !== "active" ||
      !isCatalogVersionEffective(version, now)
    ) {
      return { eligible: false as const, reason: "version_not_eligible" as const };
    }
    const stats = await deps.repository.getCouponUsageStats(coupon.id, userId);
    return evaluateCouponEligibility(coupon, {
      now,
      productCode: version.productCode,
      versionCode: version.versionCode,
      billingCycle: version.billingCycle,
      unitAmount: version.unitAmount,
      currency: version.currency,
      totalConfirmedUses: stats.totalConfirmedOrReserved,
      userConfirmedUses: stats.userConfirmedOrReserved,
      userHasPriorPaidContract: stats.userHasPriorPaidContract,
    });
  }

  function listAdminVersions(limit: number) {
    return deps.repository.listAllVersions(limit);
  }

  function listAdminCoupons(limit: number) {
    return deps.repository.listCoupons(limit);
  }

  async function createProduct(
    input: Omit<CreateBillingCatalogProductInput, "actorUserId"> & {
      actorUserId: number;
    }
  ) {
    const provenance = assertAdministrativeCatalogMutation({
      actorRole: "admin",
      provenance: input.provenance,
    });
    return deps.repository.createProduct({ ...input, provenance });
  }

  async function createVersion(
    input: Omit<CreateBillingCatalogVersionInput, "actorUserId"> & {
      actorUserId: number;
    }
  ) {
    const provenance = assertAdministrativeCatalogMutation({
      actorRole: "admin",
      provenance: input.provenance,
    });
    return deps.repository.createVersion({ ...input, provenance });
  }

  async function publishVersion(input: PublishBillingCatalogVersionInput) {
    const provenance = assertAdministrativeCatalogMutation({
      actorRole: "admin",
      provenance: input.provenance,
    });
    return deps.repository.publishVersion({ ...input, provenance });
  }

  async function deactivateVersion(input: DeactivateBillingCatalogVersionInput) {
    assertAdministrativeCatalogMutation({
      actorRole: "admin",
      provenance: { origin: "admin_manual" },
    });
    return deps.repository.deactivateVersion(input);
  }

  async function createCouponRevision(input: {
    policy: BillingCouponPolicy;
    actorUserId: number;
    reason: string;
  }) {
    assertAdministrativeCatalogMutation({
      actorRole: "admin",
      provenance: { origin: "admin_manual" },
    });
    const payload: CreateBillingCouponRevisionInput = input;
    return deps.repository.createCouponRevision(payload);
  }

  async function deactivateCoupon(input: DeactivateBillingCouponInput) {
    assertAdministrativeCatalogMutation({
      actorRole: "admin",
      provenance: { origin: "admin_manual" },
    });
    return deps.repository.deactivateCoupon(input);
  }

  function reserveCoupon(input: Omit<ReserveBillingCouponInput, "now">) {
    return deps.repository.reserveCoupon({ ...input, now: nowProvider() });
  }

  function seedInitialCatalog() {
    return deps.repository.seedInitialCatalog(INITIAL_BILLING_CATALOG);
  }

  return {
    listCatalog,
    previewCouponEligibility,
    listAdminVersions,
    listAdminCoupons,
    createProduct,
    createVersion,
    publishVersion,
    deactivateVersion,
    createCouponRevision,
    deactivateCoupon,
    reserveCoupon,
    seedInitialCatalog,
  };
}
