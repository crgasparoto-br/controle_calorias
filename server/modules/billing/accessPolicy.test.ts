import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  createBillingAccessPolicy,
  isBillingAccessExemptPath,
  isBillingReadOnlyWriteAllowedPath,
} from "./accessPolicy";
import type { UserEntitlementsResult } from "./types";

const ctx = {
  user: {
    id: 42,
    email: "user@example.com",
    name: "Usuário",
    role: "user" as const,
  },
} as any;

const access = (
  overrides: Partial<UserEntitlementsResult> = {}
): UserEntitlementsResult => ({
  allowed: true,
  reason: "active_subscription",
  entitlements: ["system_access"],
  sourceAvailable: true,
  evaluatedAt: new Date("2026-08-10T12:00:00.000Z"),
  ...overrides,
});

describe("billing protected procedure policy", () => {
  it("keeps billing status procedures accessible while commercial access is pending", async () => {
    const getUserEntitlements = vi.fn(async () =>
      access({ allowed: false, reason: "no_access", entitlements: [] })
    );
    const policy = createBillingAccessPolicy({ getUserEntitlements });

    await expect(
      policy({ path: "billing.subscriptionStatus", type: "query", ctx })
    ).resolves.toBeUndefined();
    expect(getUserEntitlements).not.toHaveBeenCalled();
  });

  it("keeps account deletion available while suspended", async () => {
    const getUserEntitlements = vi.fn(async () =>
      access({ reason: "read_only_access" })
    );
    const policy = createBillingAccessPolicy({ getUserEntitlements });

    await expect(
      policy({ path: "nutrition.privacy.requestAccountDeletion", type: "mutation", ctx })
    ).resolves.toBeUndefined();
    expect(getUserEntitlements).not.toHaveBeenCalled();
  });

  it("keeps authenticated WhatsApp account linking accessible while commercial access is pending", async () => {
    const getUserEntitlements = vi.fn(async () =>
      access({ allowed: false, reason: "no_access", entitlements: [] })
    );
    const policy = createBillingAccessPolicy({ getUserEntitlements });

    await expect(
      policy({
        path: "auth.whatsappOnboarding.linkExistingAccount",
        type: "mutation",
        ctx,
      })
    ).resolves.toBeUndefined();
    expect(getUserEntitlements).not.toHaveBeenCalled();
  });

  it("blocks protected domain procedures when eligibility is denied", async () => {
    const policy = createBillingAccessPolicy({
      getUserEntitlements: vi.fn(async () =>
        access({ allowed: false, reason: "no_access", entitlements: [] })
      ),
    });

    await expect(
      policy({ path: "nutrition.meals.list", type: "query", ctx })
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: "FORBIDDEN",
    });
  });

  it("allows protected domain procedures when eligibility is valid", async () => {
    const getUserEntitlements = vi.fn(async () => access());
    const policy = createBillingAccessPolicy({ getUserEntitlements });

    await expect(
      policy({ path: "nutrition.meals.createManual", type: "mutation", ctx })
    ).resolves.toBeUndefined();
    expect(getUserEntitlements).toHaveBeenCalledWith(42);
  });

  it("allows read-only queries but blocks mutations while suspended", async () => {
    const getUserEntitlements = vi.fn(async () =>
      access({
        reason: "read_only_access",
        entitlements: ["system_access", "web_access", "reports"],
      })
    );
    const policy = createBillingAccessPolicy({ getUserEntitlements });

    await expect(
      policy({ path: "nutrition.meals.list", type: "query", ctx })
    ).resolves.toBeUndefined();
    await expect(
      policy({ path: "nutrition.meals.createManual", type: "mutation", ctx })
    ).rejects.toMatchObject<Partial<TRPCError>>({ code: "FORBIDDEN" });
  });

  it("allows only basic professional settings writes while suspended", async () => {
    const getUserEntitlements = vi.fn(async () =>
      access({
        reason: "read_only_access",
        entitlements: ["system_access", "web_access", "reports"],
      })
    );
    const policy = createBillingAccessPolicy({ getUserEntitlements });

    await expect(
      policy({
        path: "professionalRecord.settings.updateIdentity",
        type: "mutation",
        ctx,
      })
    ).resolves.toBeUndefined();
    await expect(
      policy({
        path: "professionalRecord.settings.updatePreferences",
        type: "mutation",
        ctx,
      })
    ).resolves.toBeUndefined();
    await expect(
      policy({
        path: "professionalRecord.settings.setActive",
        type: "mutation",
        ctx,
      })
    ).resolves.toBeUndefined();
    await expect(
      policy({
        path: "professionalRecord.saveAssessment",
        type: "mutation",
        ctx,
      })
    ).rejects.toMatchObject<Partial<TRPCError>>({ code: "FORBIDDEN" });
  });

  it("does not turn the basic-settings exception into access for denied users", async () => {
    const policy = createBillingAccessPolicy({
      getUserEntitlements: vi.fn(async () =>
        access({ allowed: false, reason: "no_access", entitlements: [] })
      ),
    });

    await expect(
      policy({
        path: "professionalRecord.settings.updateIdentity",
        type: "mutation",
        ctx,
      })
    ).rejects.toMatchObject<Partial<TRPCError>>({ code: "FORBIDDEN" });
  });

  it("keeps billing management mutations available while suspended", async () => {
    const getUserEntitlements = vi.fn(async () =>
      access({ reason: "read_only_access" })
    );
    const policy = createBillingAccessPolicy({ getUserEntitlements });

    await expect(
      policy({ path: "billing.refreshOnboardingActivation", type: "mutation", ctx })
    ).resolves.toBeUndefined();
    expect(getUserEntitlements).not.toHaveBeenCalled();
  });

  it("does not exempt similarly named non-billing procedures", () => {
    expect(isBillingAccessExemptPath("billing.me")).toBe(true);
    expect(isBillingAccessExemptPath("nutrition.billing.me")).toBe(false);
    expect(
      isBillingAccessExemptPath(
        "auth.whatsappOnboarding.linkExistingAccount.preview"
      )
    ).toBe(false);
    expect(
      isBillingReadOnlyWriteAllowedPath(
        "professionalRecord.settings.updateIdentity"
      )
    ).toBe(true);
    expect(
      isBillingReadOnlyWriteAllowedPath(
        "professionalRecord.settings.updateIdentity.preview"
      )
    ).toBe(false);
  });
});
