import { describe, expect, it, vi } from "vitest";
import { INITIAL_BILLING_CATALOG } from "./catalogPolicy";
import { createBillingCatalogService } from "./catalogService";
import type {
  BillingCatalogRepository,
  BillingCatalogVersionRecord,
  BillingCouponRecord,
} from "./catalogTypes";

const NOW = new Date("2026-08-08T12:00:00.000Z");

function version(
  index = 0,
  overrides: Partial<BillingCatalogVersionRecord> = {}
): BillingCatalogVersionRecord {
  const definition = INITIAL_BILLING_CATALOG[index]!;
  return {
    ...definition,
    id: `version-${index}`,
    productId: `product-${definition.productCode}`,
    productState: "active",
    description: null,
    createdByUserId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const coupon: BillingCouponRecord = {
  id: "coupon-1",
  code: "BOASVINDAS",
  revision: 1,
  discountType: "percentage",
  discountValue: 30,
  currency: null,
  eligibleProductCodes: ["individual"],
  eligibleVersionCodes: [],
  eligibleCycles: ["monthly"],
  validFrom: new Date("2026-08-01T00:00:00.000Z"),
  validUntil: null,
  maxTotalUses: 10,
  maxUsesPerUser: 1,
  firstContractOnly: true,
  durationCharges: 3,
  active: true,
  state: "active",
  supersedesCouponId: null,
  createdByUserId: 1,
  deactivatedByUserId: null,
  deactivatedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

function repository(
  overrides: Partial<BillingCatalogRepository> = {}
): BillingCatalogRepository {
  return {
    listEffectiveVersions: vi.fn(async () => [version()]),
    listAllVersions: vi.fn(async () => [version()]),
    getVersionByCode: vi.fn(async () => version()),
    listCoupons: vi.fn(async () => [coupon]),
    getActiveCouponByCode: vi.fn(async () => coupon),
    getCouponUsageStats: vi.fn(async () => ({
      totalConfirmedOrReserved: 0,
      userConfirmedOrReserved: 0,
      userHasPriorPaidContract: false,
    })),
    createProduct: vi.fn(),
    createVersion: vi.fn(),
    publishVersion: vi.fn(),
    deactivateVersion: vi.fn(),
    createCouponRevision: vi.fn(),
    deactivateCoupon: vi.fn(),
    reserveCoupon: vi.fn(),
    seedInitialCatalog: vi.fn(async () => ({ products: 3, versions: 6 })),
    ...overrides,
  };
}

describe("billing catalog service", () => {
  it("returns commercial payment policy separately from effective provider methods", async () => {
    const service = createBillingCatalogService({
      repository: repository(),
      capabilitiesProvider: () => ["credit_card", "boleto"],
      now: () => NOW,
    });

    const [publicVersion] = await service.listCatalog();
    expect(publicVersion).toEqual(
      expect.objectContaining({
        versionCode: "individual-monthly-v1",
        commercialPaymentMethods: ["credit_card", "pix_automatic"],
        effectivePaymentMethods: ["credit_card"],
      })
    );
    expect(publicVersion).not.toHaveProperty("createdByUserId");
    expect(publicVersion).not.toHaveProperty("productId");
    expect(publicVersion).not.toHaveProperty("id");
  });

  it("previews coupon eligibility exclusively from persisted catalog and usage facts", async () => {
    const repo = repository();
    const service = createBillingCatalogService({ repository: repo, now: () => NOW });

    await expect(
      service.previewCouponEligibility(77, {
        code: "boasvindas",
        versionCode: "individual-monthly-v1",
      })
    ).resolves.toEqual({
      eligible: true,
      discountAmount: 1197,
      finalAmount: 2793,
      durationCharges: 3,
    });

    expect(repo.getCouponUsageStats).toHaveBeenCalledWith("coupon-1", 77);
  });

  it("does not expose inactive, future, or product-disabled versions as coupon eligible", async () => {
    const service = createBillingCatalogService({
      repository: repository({
        getVersionByCode: vi.fn(async () => version(0, { status: "inactive" })),
      }),
      now: () => NOW,
    });

    await expect(
      service.previewCouponEligibility(77, {
        code: "boasvindas",
        versionCode: "individual-monthly-v1",
      })
    ).resolves.toEqual({ eligible: false, reason: "version_not_eligible" });

    const futureService = createBillingCatalogService({
      repository: repository({
        getVersionByCode: vi.fn(async () =>
          version(0, { effectiveFrom: new Date("2026-08-09T00:00:00.000Z") })
        ),
      }),
      now: () => NOW,
    });
    await expect(
      futureService.previewCouponEligibility(77, {
        code: "boasvindas",
        versionCode: "individual-monthly-v1",
      })
    ).resolves.toEqual({ eligible: false, reason: "version_not_eligible" });

    const disabledProductService = createBillingCatalogService({
      repository: repository({
        getVersionByCode: vi.fn(async () =>
          version(0, { productState: "inactive" })
        ),
      }),
      now: () => NOW,
    });
    await expect(
      disabledProductService.previewCouponEligibility(77, {
        code: "boasvindas",
        versionCode: "individual-monthly-v1",
      })
    ).resolves.toEqual({ eligible: false, reason: "version_not_eligible" });
  });

  it("seeds the canonical catalog through the durable repository contract", async () => {
    const repo = repository();
    const service = createBillingCatalogService({ repository: repo, now: () => NOW });

    await expect(service.seedInitialCatalog()).resolves.toEqual({
      products: 3,
      versions: 6,
    });
    expect(repo.seedInitialCatalog).toHaveBeenCalledWith(INITIAL_BILLING_CATALOG);
  });

  it("normalizes and forwards range-review provenance on administrative mutations", async () => {
    const repo = repository({
      createProduct: vi.fn(async input => ({
        id: "product-range",
        code: input.code,
        audience: input.audience,
        name: input.name,
        description: input.description ?? null,
        state: "active",
        createdAt: NOW,
        updatedAt: NOW,
      })),
    });
    const service = createBillingCatalogService({ repository: repo, now: () => NOW });

    await service.createProduct({
      code: "clinic",
      audience: "professional",
      name: "Clínica",
      actorUserId: 314,
      reason: "Nova faixa aprovada",
      provenance: {
        origin: "catalog_range_review",
        alertIds: [" alert-100-plus ", "alert-100-plus"],
        analysisRef: " analysis-2026-08-09 ",
      },
    });

    expect(repo.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 314,
        provenance: {
          origin: "catalog_range_review",
          alertIds: ["alert-100-plus"],
          analysisRef: "analysis-2026-08-09",
        },
      })
    );
  });

  it("rejects incomplete range-review provenance before persistence", async () => {
    const repo = repository();
    const service = createBillingCatalogService({ repository: repo, now: () => NOW });

    await expect(
      service.createProduct({
        code: "clinic",
        audience: "professional",
        name: "Clínica",
        actorUserId: 314,
        reason: "Nova faixa aprovada",
        provenance: {
          origin: "catalog_range_review",
          alertIds: [],
          analysisRef: "analysis-2026-08-09",
        },
      })
    ).rejects.toThrow("requires alert references");
    expect(repo.createProduct).not.toHaveBeenCalled();
  });
});
