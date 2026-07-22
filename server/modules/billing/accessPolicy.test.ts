import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  createBillingAccessPolicy,
  isBillingAccessExemptPath,
} from "./accessPolicy";

const ctx = {
  user: {
    id: 42,
    email: "user@example.com",
    name: "Usuário",
    role: "user" as const,
  },
} as any;

describe("billing protected procedure policy", () => {
  it("keeps billing status procedures accessible while commercial access is pending", async () => {
    const userCanUseSystem = vi.fn(async () => false);
    const policy = createBillingAccessPolicy({ userCanUseSystem });

    await expect(
      policy({ path: "billing.subscriptionStatus", ctx })
    ).resolves.toBeUndefined();
    expect(userCanUseSystem).not.toHaveBeenCalled();
  });

  it("blocks protected domain procedures when eligibility is denied", async () => {
    const policy = createBillingAccessPolicy({
      userCanUseSystem: vi.fn(async () => false),
    });

    await expect(
      policy({ path: "nutrition.meals.list", ctx })
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: "FORBIDDEN",
    });
  });

  it("allows protected domain procedures when eligibility is valid", async () => {
    const userCanUseSystem = vi.fn(async () => true);
    const policy = createBillingAccessPolicy({ userCanUseSystem });

    await expect(
      policy({ path: "nutrition.meals.list", ctx })
    ).resolves.toBeUndefined();
    expect(userCanUseSystem).toHaveBeenCalledWith(42);
  });

  it("does not exempt similarly named non-billing procedures", () => {
    expect(isBillingAccessExemptPath("billing.me")).toBe(true);
    expect(isBillingAccessExemptPath("nutrition.billing.me")).toBe(false);
  });
});
