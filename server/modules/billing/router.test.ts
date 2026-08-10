import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activateWhatsappOnboardingUser: vi.fn(),
  getUserEntitlements: vi.fn(),
  getUserSubscriptionStatus: vi.fn(),
  searchAdminUsers: vi.fn(),
  listAdminOverrides: vi.fn(),
  grantAdminOverride: vi.fn(),
  revokeAdminOverride: vi.fn(),
  getAdminAnalytics: vi.fn(),
  listCatalog: vi.fn(),
  previewCouponEligibility: vi.fn(),
  listAdminVersions: vi.fn(),
  listAdminCoupons: vi.fn(),
  createProduct: vi.fn(),
  createVersion: vi.fn(),
  publishVersion: vi.fn(),
  deactivateVersion: vi.fn(),
  createCouponRevision: vi.fn(),
  deactivateCoupon: vi.fn(),
}));

vi.mock("./service", () => ({ billingService: mocks }));
vi.mock("./catalogRuntime", () => ({ billingCatalogService: mocks }));
vi.mock("../onboarding/whatsappLeadService", () => ({
  activateWhatsappOnboardingUser: mocks.activateWhatsappOnboardingUser,
}));

import { billingRouter } from "./router";

function context(role: "user" | "admin", id = 71) {
  return {
    user: {
      id,
      email: `${role}@example.com`,
      name: role,
      role,
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminAnalytics.mockResolvedValue({ plans: [] });
  mocks.listAdminOverrides.mockResolvedValue([]);
  mocks.grantAdminOverride.mockResolvedValue({ id: "override" });
  mocks.revokeAdminOverride.mockResolvedValue({ id: "override" });
  mocks.listCatalog.mockResolvedValue([]);
  mocks.previewCouponEligibility.mockResolvedValue({
    eligible: false,
    reason: "inactive",
  });
  mocks.listAdminVersions.mockResolvedValue([]);
  mocks.listAdminCoupons.mockResolvedValue([]);
  mocks.createProduct.mockResolvedValue({ id: "product" });
  mocks.createVersion.mockResolvedValue({ id: "version" });
  mocks.publishVersion.mockResolvedValue({ id: "version", status: "active" });
  mocks.deactivateVersion.mockResolvedValue({ id: "version", status: "inactive" });
  mocks.createCouponRevision.mockResolvedValue({ id: "coupon" });
  mocks.deactivateCoupon.mockResolvedValue({ id: "coupon", state: "inactive" });
  mocks.activateWhatsappOnboardingUser.mockResolvedValue({
    status: "no_onboarding_lead",
  });
});

describe("billing router catalog", () => {
  it("serves catalog and coupon preview to authenticated users", async () => {
    const caller = billingRouter.createCaller(context("user", 55));

    await caller.catalog();
    await caller.couponEligibility({
      code: "BOASVINDAS",
      versionCode: "individual-monthly-v1",
    });

    expect(mocks.listCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.previewCouponEligibility).toHaveBeenCalledWith(55, {
      code: "BOASVINDAS",
      versionCode: "individual-monthly-v1",
    });
  });

  it("does not expose persistence details from catalog queries", async () => {
    mocks.listCatalog.mockRejectedValueOnce(
      new Error("ER_NO_SUCH_TABLE billingCoupons at 10.0.0.12")
    );
    const caller = billingRouter.createCaller(context("user", 55));

    await expect(caller.catalog()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível consultar a configuração comercial.",
    });
  });
});

describe("billing router administration", () => {
  it("blocks every administrative procedure for a regular user", async () => {
    const caller = billingRouter.createCaller(context("user"));

    await expect(caller.adminAnalytics()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.adminSearchUsers({ query: "", limit: 25 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.adminListOverrides({ userId: 99, limit: 25 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.adminGrantOverride({ userId: 99, reason: "Acesso de suporte" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.adminRevokeOverride({
        overrideId: "11111111-1111-4111-8111-111111111111",
        reason: "Solicitação encerrada",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.adminCatalogVersions({ limit: 100 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.adminCoupons({ limit: 100 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.adminCreateCatalogProduct({
        code: "clinic",
        audience: "professional",
        name: "Clínica",
        reason: "Nova faixa aprovada",
        provenance: {
          origin: "catalog_range_review",
          alertIds: ["alert-100-plus"],
          analysisRef: "analysis-2026-08-09",
        },
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.adminCreateCouponRevision({
        code: "BOASVINDAS",
        discountType: "percentage",
        discountValue: 10,
        currency: null,
        eligibleProductCodes: ["individual"],
        eligibleVersionCodes: [],
        eligibleCycles: ["monthly"],
        validFrom: new Date("2026-08-08T00:00:00.000Z"),
        validUntil: null,
        maxTotalUses: 100,
        maxUsesPerUser: 1,
        firstContractOnly: false,
        durationCharges: 1,
        active: true,
        reason: "Campanha de teste",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(mocks.getAdminAnalytics).not.toHaveBeenCalled();
    expect(mocks.listAdminOverrides).not.toHaveBeenCalled();
    expect(mocks.grantAdminOverride).not.toHaveBeenCalled();
    expect(mocks.listAdminVersions).not.toHaveBeenCalled();
    expect(mocks.createProduct).not.toHaveBeenCalled();
    expect(mocks.activateWhatsappOnboardingUser).not.toHaveBeenCalled();
  });


  it("returns forbidden when transactional admin authority changes", async () => {
    mocks.createProduct.mockRejectedValueOnce(
      new Error("Administrator authorization changed before catalog mutation.")
    );
    const caller = billingRouter.createCaller(context("admin", 314));

    await expect(
      caller.adminCreateCatalogProduct({
        code: "clinic",
        audience: "professional",
        name: "Clínica",
        reason: "Nova faixa aprovada",
        provenance: { origin: "admin_manual" },
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message:
        "Sua autorização administrativa mudou. Recarregue a sessão antes de tentar novamente.",
    });
  });

  it("returns a bad request for invalid catalog coupon policy without exposing internals", async () => {
    mocks.createCouponRevision.mockRejectedValueOnce(
      new Error("Coupon policy must target at least one product or version.")
    );
    const caller = billingRouter.createCaller(context("admin", 314));

    await expect(
      caller.adminCreateCouponRevision({
        code: "BOASVINDAS",
        discountType: "percentage",
        discountValue: 10,
        currency: null,
        eligibleProductCodes: [],
        eligibleVersionCodes: [],
        eligibleCycles: ["monthly"],
        validFrom: new Date("2026-08-08T00:00:00.000Z"),
        validUntil: null,
        maxTotalUses: 100,
        maxUsesPerUser: 1,
        firstContractOnly: false,
        durationCharges: 1,
        active: true,
        reason: "Campanha sem escopo",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Coupon policy must target at least one product or version.",
    });
  });

  it("does not expose persistence details from administrative catalog reads", async () => {
    mocks.listAdminVersions.mockRejectedValueOnce(
      new Error("ER_ACCESS_DENIED_ERROR host=10.0.0.12")
    );
    const caller = billingRouter.createCaller(context("admin", 314));

    await expect(caller.adminCatalogVersions({ limit: 100 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Não foi possível consultar a configuração comercial.",
    });
  });

  it("takes grant and revoke authorship from the authenticated admin", async () => {
    const caller = billingRouter.createCaller(context("admin", 314));

    await caller.adminGrantOverride({
      userId: 99,
      reason: "Acesso temporário aprovado",
    });
    await caller.adminRevokeOverride({
      overrideId: "11111111-1111-4111-8111-111111111111",
      reason: "Período de suporte finalizado",
    });

    expect(mocks.grantAdminOverride).toHaveBeenCalledWith({
      userId: 99,
      reason: "Acesso temporário aprovado",
      grantedByUserId: 314,
    });
    expect(mocks.activateWhatsappOnboardingUser).toHaveBeenCalledWith(
      99,
      "admin_override"
    );
    expect(mocks.revokeAdminOverride).toHaveBeenCalledWith({
      overrideId: "11111111-1111-4111-8111-111111111111",
      reason: "Período de suporte finalizado",
      revokedByUserId: 314,
    });
  });

  it("takes catalog and coupon authorship from the authenticated admin", async () => {
    const caller = billingRouter.createCaller(context("admin", 314));
    const effectiveFrom = new Date("2026-08-09T00:00:00.000Z");

    await caller.adminCreateCatalogProduct({
      code: "clinic",
      audience: "professional",
      name: "Clínica",
      reason: "Nova faixa aprovada",
      provenance: {
        origin: "catalog_range_review",
        alertIds: ["alert-100-plus"],
        analysisRef: "analysis-2026-08-09",
      },
    });
    await caller.adminPublishCatalogVersion({
      versionCode: "professional-monthly-v2",
      effectiveFrom,
      reason: "Revisão comercial aprovada",
      provenance: {
        origin: "catalog_range_review",
        alertIds: ["alert-100-plus"],
        analysisRef: "analysis-2026-08-09",
      },
    });
    await caller.adminCreateCouponRevision({
      code: "boasvindas",
      discountType: "percentage",
      discountValue: 20,
      currency: null,
      eligibleProductCodes: ["individual"],
      eligibleVersionCodes: [],
      eligibleCycles: ["monthly"],
      validFrom: effectiveFrom,
      validUntil: null,
      maxTotalUses: 100,
      maxUsesPerUser: 1,
      firstContractOnly: true,
      durationCharges: 3,
      active: true,
      reason: "Campanha aprovada",
    });

    expect(mocks.createProduct).toHaveBeenCalledWith({
      code: "clinic",
      audience: "professional",
      name: "Clínica",
      reason: "Nova faixa aprovada",
      provenance: {
        origin: "catalog_range_review",
        alertIds: ["alert-100-plus"],
        analysisRef: "analysis-2026-08-09",
      },
      actorUserId: 314,
    });
    expect(mocks.publishVersion).toHaveBeenCalledWith({
      versionCode: "professional-monthly-v2",
      effectiveFrom,
      reason: "Revisão comercial aprovada",
      provenance: {
        origin: "catalog_range_review",
        alertIds: ["alert-100-plus"],
        analysisRef: "analysis-2026-08-09",
      },
      actorUserId: 314,
    });
    expect(mocks.createCouponRevision).toHaveBeenCalledWith({
      policy: {
        code: "boasvindas",
        discountType: "percentage",
        discountValue: 20,
        currency: null,
        eligibleProductCodes: ["individual"],
        eligibleVersionCodes: [],
        eligibleCycles: ["monthly"],
        validFrom: effectiveFrom,
        validUntil: null,
        maxTotalUses: 100,
        maxUsesPerUser: 1,
        firstContractOnly: true,
        durationCharges: 3,
        active: true,
      },
      reason: "Campanha aprovada",
      actorUserId: 314,
    });
  });

  it("can recover an override id after reload and revoke it", async () => {
    const overrideId = "11111111-1111-4111-8111-111111111111";
    mocks.grantAdminOverride.mockResolvedValueOnce({ id: overrideId });
    mocks.listAdminOverrides.mockResolvedValueOnce([
      { id: overrideId, userId: 99, state: "active" },
    ]);
    const caller = billingRouter.createCaller(context("admin", 314));

    await caller.adminGrantOverride({
      userId: 99,
      reason: "Acesso temporário aprovado",
    });
    const [activeOverride] = await caller.adminListOverrides({
      userId: 99,
      limit: 25,
    });
    await caller.adminRevokeOverride({
      overrideId: activeOverride.id,
      reason: "Período de suporte finalizado",
    });

    expect(mocks.listAdminOverrides).toHaveBeenCalledWith(99, 25);
    expect(mocks.revokeAdminOverride).toHaveBeenCalledWith({
      overrideId,
      reason: "Período de suporte finalizado",
      revokedByUserId: 314,
    });
  });

  it("lets a pending user re-evaluate onboarding activation from billing", async () => {
    const caller = billingRouter.createCaller(context("user", 502));

    await caller.refreshOnboardingActivation();

    expect(mocks.activateWhatsappOnboardingUser).toHaveBeenCalledWith(502);
  });
});
